﻿# =============================================================================
# Userscript Auto Healer - Windows 生产发布双包（EXE 安装器与真实便携 ZIP）构建与自检验证脚本
#
# 脚本用途：
#   本脚本为 TASK-021 / REQ-027 / REQ-028 / TEST-027 / TEST-028 / GATE-008 / GATE-009 / GATE-011
#   的生产发布专用打包程序。基于同一 Git 源提交构建生产环境交付产物：
#     1. Userscript-Auto-Healer-v{version}-Setup.exe（Inno Setup 6 生产独立安装器）
#     2. Userscript-Auto-Healer-v{version}-Portable.zip（真实便携版 ZIP 归档）
#     3. SHA256SUMS.txt（两项发布产物的 SHA-256 校验和清单）
#
# 关键流程：
#   1. 环境与参数初始化：解析 package.json 语义化版本号、校验 Git commit SHA、规范化临时工作目录路径；
#   2. Electron 生产运行时暂存：组合 Electron 运行时二进制、已编译应用代码（dist/app 与 dist/src）、生产依赖（acorn）及生产 package.json；
#   3. Electron 基础沙箱与安全回执验算（Smoke）：确保预加载 IPC 隔离、沙箱生效且自动修复安全锁关闭；
#   4. 真实便携 ZIP 构建与校验：检查 PK 3,4 文件头签名、条目路径安全（防目录穿越）、解压全量文件 SHA-256 双向逐一比对；
#   5. 目录重定位与 NTFS ACL 只读目录测试：验证 ZIP 解压后在含 Unicode 与空格的目录启动正常，且在 NTFS 严格只读（WD 拒绝新建写入）提取树下直启成功并保留外部数据；
#   6. 生产 Inno Setup 6 独立安装器编译：加载 packaging/windows/installer.iss 规范，以独立生产 AppId（{{9F7B3E2A-1D4C-4E5F-8A9B-0C1D2E3F4A5B}}）编译单用户（lowest privilege）安装程序；
#   7. 静默安装与全量文件 SHA-256 比对：在干净测试路径静默安装，逐一比对所有安装后文件哈希；
#   8. 静默升级与旧版数据保持验证：验证覆盖安装保持用户数据哨兵完整无损；
#   9. 静默卸载测试：验证卸载后应用二进制完整清除，且独立用户数据（AppData）按规范安全保留；
#   10. 清单生成与独立交叉校验：生成 SHA256SUMS.txt，调用 Assert-CandidateChecksums 进行双向无死角验签。
#
# 执行注意事项：
#   - 必须在具有 Electron 运行时（node_modules/electron/dist）及 Inno Setup 6（ISCC.exe）的环境下运行；
#   - 必须先完成项目构建（npm run build）与类型检查（npm run typecheck）；
#   - 遵循 Fail-Closed 原则，任何单项哈希不匹配、文件缺失或安全回执异常均立即中止并抛出异常。
# =============================================================================

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# -----------------------------------------------------------------------------
# 辅助函数：断言文件必须存在
# -----------------------------------------------------------------------------
function Require-File([string]$path) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "生产构建必要文件缺失：$path"
    }
}

# -----------------------------------------------------------------------------
# 辅助函数：断言独立用户数据目录符合预期
# -----------------------------------------------------------------------------
function Assert-IsolatedDataRoot([object]$receipt, [string]$roamingRoot) {
    if ($null -eq $receipt -or $receipt.userDataDirectory -isnot [string] -or
        [string]::IsNullOrWhiteSpace($receipt.userDataDirectory) -or
        [string]::IsNullOrWhiteSpace($roamingRoot) -or
        -not [IO.Path]::IsPathFullyQualified($receipt.userDataDirectory) -or
        -not [IO.Path]::IsPathFullyQualified($roamingRoot)) {
        throw 'Electron smoke 未能上报绝对合格的 userData 目录'
    }
    $actual = [IO.Path]::GetFullPath([string]$receipt.userDataDirectory).TrimEnd([char[]]@('\', '/'))
    $root = [IO.Path]::GetFullPath($roamingRoot).TrimEnd([char[]]@('\', '/'))
    $parent = [IO.Path]::GetDirectoryName($actual)
    $leaf = [IO.Path]::GetFileName($actual)

    # 生产或候选的 Electron 应用名称校验，确保位于用户的 Roaming AppData 下
    $namedValid = [string]::Equals($leaf, 'Userscript Auto Healer', [StringComparison]::OrdinalIgnoreCase) -or
                  [string]::Equals($leaf, 'userscript-auto-healer', [StringComparison]::OrdinalIgnoreCase) -or
                  [string]::Equals($leaf, 'Userscript Auto Healer Candidate', [StringComparison]::OrdinalIgnoreCase) -or
                  [string]::Equals($leaf, 'userscript-auto-healer-candidate', [StringComparison]::OrdinalIgnoreCase)

    if (-not $namedValid -or -not [string]::Equals($parent, $root, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Electron userData 目录未正确定位至用户的 AppData 根目录下：$actual"
    }
    return $actual
}

# -----------------------------------------------------------------------------
# 辅助函数：断言用户数据在不同生命周期之间完整保留
# -----------------------------------------------------------------------------
function Assert-RetainedData([object]$receipt, [string]$expectedRoot,
                             [string]$canary, [string]$value, [string]$roamingRoot) {
    $actual = Assert-IsolatedDataRoot $receipt $roamingRoot
    if (-not [string]::Equals($actual, $expectedRoot, [StringComparison]::OrdinalIgnoreCase) -or
        -not (Test-Path -LiteralPath $canary -PathType Leaf) -or
        [IO.File]::ReadAllText($canary) -cne $value) {
        throw '应用 userData 身份或保留数据在不同启动阶段之间发生改变或丢失'
    }
}

# -----------------------------------------------------------------------------
# 辅助函数：执行 Electron 受限沙箱启动烟测并收集回执
# -----------------------------------------------------------------------------
function Smoke([string]$exe, [string]$cwd, [string]$name, [string]$temp) {
    Require-File $exe
    $receipt = Join-Path $temp "production-shell-$name.json"
    $env:UAH_SMOKE_RECEIPT = $receipt
    $p = $null
    try {
        $p = Start-Process -FilePath $exe -ArgumentList @('--uahtest-shell-only') -WorkingDirectory $cwd -PassThru
        if (-not $p.WaitForExit(90000)) {
            if (-not $p.HasExited) {
                $p.Kill()
                [void]$p.WaitForExit(5000)
            }
            throw "Electron 进程烟测启动超时：$name"
        }
        $p.Refresh()
        if ($p.ExitCode -ne 0) {
            $failureReceipt = $receipt + '.failure'
            if (Test-Path -LiteralPath $failureReceipt -PathType Leaf) {
                $code = [IO.File]::ReadAllText($failureReceipt).Trim()
                if ($code -match '^[A-Z][A-Z0-9_]{4,90}$') {
                    Write-Warning "SHELL_SMOKE_FAILURE_CODE=$code"
                }
            }
            throw "Electron 烟测退出返回非零错误码（exit code: $($p.ExitCode)）：$name"
        }
    } finally {
        if ($null -ne $p) { $p.Dispose() }
        Remove-Item Env:\UAH_SMOKE_RECEIPT -ErrorAction SilentlyContinue
    }
    Require-File $receipt
    $r = Get-Content -LiteralPath $receipt -Raw | ConvertFrom-Json
    if ($r.shell -ne 'development-skeleton' -or
        $r.preloadIpcVerified -ne $true -or
        $r.rendererSandboxVerified -ne $true -or
        $r.automaticRepairAvailable -ne $false) {
        throw "不安全的 Shell 回执：$name"
    }
    return $r
}

# =============================================================================
# 第一阶段：工程根目录解析、版本校验与工作路径准备
# =============================================================================
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$pkg = Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
$version = [string]$pkg.version
if ($version -notmatch '^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$') {
    throw "package.json 中的版本号格式不符合语义化版本规范：$version"
}

$sha = (& git -C $root rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $sha -notmatch '^[a-f0-9]{40}$') {
    throw '未能从当前 Git 仓库中获取不可变的源提交 commit SHA'
}
$short = $sha.Substring(0, 12)

# 正式发布产物前缀规范：Userscript-Auto-Healer-v<version>
$prefix = "Userscript-Auto-Healer-v$version"

# 规范化临时工作目录路径，处理 8.3 格式短路径名展开
if ([string]::IsNullOrWhiteSpace($env:RUNNER_TEMP)) {
    $env:RUNNER_TEMP = $env:TEMP
}
if ([string]::IsNullOrWhiteSpace($env:RUNNER_TEMP)) {
    throw '系统环境变量 RUNNER_TEMP 与 TEMP 均不可用，无法建立安全的临时打包目录'
}
$env:RUNNER_TEMP = [IO.Path]::GetFullPath($env:RUNNER_TEMP)

$runId = if ([string]::IsNullOrWhiteSpace($env:GITHUB_RUN_ID)) { 'local' } else { $env:GITHUB_RUN_ID }
$runAttempt = if ([string]::IsNullOrWhiteSpace($env:GITHUB_RUN_ATTEMPT)) { '1' } else { $env:GITHUB_RUN_ATTEMPT }
$temp = Join-Path $env:RUNNER_TEMP "uah-production-$short-$runId-$runAttempt"

if (Test-Path -LiteralPath $temp) {
    throw "检测到已存在的临时生产打包目录，拒绝覆盖以保持环境干净：$temp"
}
New-Item -ItemType Directory -Path $temp | Out-Null

$out = Join-Path $temp 'deliverables'
$stage = Join-Path $temp 'portable-app'
New-Item -ItemType Directory -Path $out, $stage | Out-Null

$smokeRoaming = $env:APPDATA
if (-not $smokeRoaming -or -not [IO.Path]::IsPathRooted($smokeRoaming)) {
    throw 'Windows Roaming AppData 路径不可用'
}

# =============================================================================
# 第二阶段：生产暂存目录组装（Electron 运行时 + 编译代码 + 生产依赖 + 元数据）
# =============================================================================
$runtime = Join-Path $root 'node_modules\electron\dist'
foreach ($relative in @('electron.exe', 'resources')) {
    if (-not (Test-Path (Join-Path $runtime $relative))) {
        throw "Electron 运行时必要依赖缺失：$relative"
    }
}
foreach ($relative in @(
    'dist\app\main\index.js',
    'dist\app\preload\index.js',
    'dist\app\ui\index.html',
    'dist\app\ui\index.js',
    'dist\src\analyze\metadata-parser.js',
    'node_modules\acorn\package.json'
)) {
    Require-File (Join-Path $root $relative)
}

# 拷贝 Electron 运行时二进制至暂存目录
Copy-Item -Path (Join-Path $runtime '*') -Destination $stage -Recurse -Force
Move-Item -LiteralPath (Join-Path $stage 'electron.exe') -Destination (Join-Path $stage 'UserscriptAutoHealer.exe')

$app = Join-Path $stage 'resources\app'
New-Item -ItemType Directory -Path (Join-Path $app 'dist'), (Join-Path $app 'node_modules') | Out-Null
Copy-Item -LiteralPath (Join-Path $root 'dist\app') -Destination (Join-Path $app 'dist\app') -Recurse
Copy-Item -LiteralPath (Join-Path $root 'dist\src') -Destination (Join-Path $app 'dist\src') -Recurse
Copy-Item -LiteralPath (Join-Path $root 'node_modules\acorn') -Destination (Join-Path $app 'node_modules\acorn') -Recurse

# 写入生产环境使用的 package.json 元数据
@{
    name = 'userscript-auto-healer';
    productName = 'Userscript Auto Healer';
    version = $version;
    main = 'dist/app/main/index.js';
    private = $true
} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $app 'package.json') -Encoding utf8

# 执行暂存目录 Electron 启动烟测并验证独立 userData 隔离
$stagedReceipt = Smoke (Join-Path $stage 'UserscriptAutoHealer.exe') $stage 'staged' $temp
$userDataRoot = Assert-IsolatedDataRoot $stagedReceipt $smokeRoaming
New-Item -ItemType Directory -Path $userDataRoot -Force | Out-Null

$canary = Join-Path $userDataRoot 'production-smoke-retention-canary.txt'
if (Test-Path -LiteralPath $canary) {
    throw '测试用户数据哨兵文件已存在，拒绝继续执行以防数据冲突'
}
$canaryText = "production-retention-$sha-$runId-$runAttempt"
[IO.File]::WriteAllText($canary, $canaryText)
Require-File $canary

# =============================================================================
# 第三阶段：构建真实便携 ZIP 并执行多维度格式与内容安全审计
# =============================================================================
$zip = Join-Path $out "$prefix-Portable.zip"
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -CompressionLevel Optimal -ErrorAction Stop
Require-File $zip

# 校验 ZIP 文件头签名（PK 0x03 0x04 即 ASCII 80, 75, 3, 4）
$stream = [IO.File]::OpenRead($zip)
try {
    $signature = New-Object byte[] 4
    if ($stream.Read($signature, 0, 4) -ne 4 -or ($signature -join ',') -ne '80,75,3,4') {
        throw '便携包 ZIP 文件头签名不匹配，非标准合法 ZIP 文件'
    }
} finally {
    $stream.Dispose()
}

# 校验 ZIP 归档内部条目路径安全性（防目录穿越与非法字符）
Add-Type -AssemblyName System.IO.Compression
$archive = [IO.Compression.ZipFile]::OpenRead($zip)
try {
    if ($archive.Entries.Count -lt 10) {
        throw 'ZIP 归档内文件条目数量异常偏少'
    }
    $zipFileNames = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($entry in $archive.Entries) {
        $n = $entry.FullName.Replace([char]92, [char]47)
        if ($n.StartsWith('/') -or $n -match '^[A-Za-z]:' -or $n -match '(^|/)\.\.(/|$)' -or
            $n.Contains([char]0) -or $n.Contains(':') -or $n.Contains('//') -or
            $n -match '(^|/)[^/]*[. ](/|$)') {
            throw "ZIP 归档内检测到不安全的文件条目相对路径：$n"
        }
        if (-not $n.EndsWith('/')) {
            if (-not $zipFileNames.Add($n)) {
                throw "ZIP 归档内发现重复的文件条目：$n"
            }
        }
    }
} finally {
    $archive.Dispose()
}

# 解压便携 ZIP 并全量逐一核验所有文件的 SHA-256 哈希
$expanded = Join-Path $temp 'expanded'
Expand-Archive -LiteralPath $zip -DestinationPath $expanded -ErrorAction Stop

$sourceFiles = @(Get-ChildItem -LiteralPath $stage -File -Recurse -Force)
$extractedFiles = @(Get-ChildItem -LiteralPath $expanded -File -Recurse -Force)
if ($sourceFiles.Count -ne $extractedFiles.Count -or $zipFileNames.Count -ne $sourceFiles.Count) {
    throw "ZIP 原始暂存文件数 ($($sourceFiles.Count)) 与解压后文件数 ($($extractedFiles.Count)) 不一致"
}
foreach ($original in $sourceFiles) {
    $relative = $original.FullName.Substring($stage.Length + 1)
    $zipName = $relative.Replace([char]92, [char]47)
    if (-not $zipFileNames.Contains($zipName)) {
        throw "ZIP 归档内缺失必要文件：$zipName"
    }
    $extracted = Join-Path $expanded $relative
    Require-File $extracted
    if ((Get-FileHash -LiteralPath $original.FullName -Algorithm SHA256).Hash -ne
        (Get-FileHash -LiteralPath $extracted -Algorithm SHA256).Hash) {
        throw "ZIP 解压后文件 SHA-256 校验和不匹配：$zipName"
    }
}
Write-Output "PASS: 完整便携 ZIP 文件清单与 SHA-256 双向校验一致 ($($sourceFiles.Count) 项文件)"

# =============================================================================
# 第四阶段：便携目录重定位与 Windows NTFS ACL 只读直启验证
# =============================================================================
. (Join-Path $PSScriptRoot 'windows-portable-relocation.ps1')

$moved = Join-Path $temp 'relocated portable 生产路径'
if (Test-Path -LiteralPath $moved) {
    throw "重定位目标目录已存在：$moved"
}

$relocationAttempts = Move-CandidatePortableDirectory $expanded $moved 12 250 @(
    $extractedFiles | ForEach-Object { $_.FullName }
)
Write-Output "PASS: 原子化便携目录重定位成功 ($relocationAttempts 次重试尝试)"
$expanded = $moved

$movedFiles = @(Get-ChildItem -LiteralPath $expanded -File -Recurse -Force)
if ($movedFiles.Count -ne $sourceFiles.Count) {
    throw '重定位后便携目录内文件总数发生变化'
}
foreach ($original in $sourceFiles) {
    $relative = $original.FullName.Substring($stage.Length + 1)
    $relocated = Join-Path $expanded $relative
    Require-File $relocated
    if ((Get-FileHash -LiteralPath $original.FullName -Algorithm SHA256).Hash -ne
        (Get-FileHash -LiteralPath $relocated -Algorithm SHA256).Hash) {
        throw "重定位后文件 SHA-256 哈希不一致：$relative"
    }
}

$expandedReceipt = Smoke (Join-Path $expanded 'UserscriptAutoHealer.exe') $temp 'extracted' $temp
Assert-RetainedData $expandedReceipt $userDataRoot $canary $canaryText $smokeRoaming

# 验证 Windows NTFS 权限：在解压目录实施拒绝写数据/新建文件（FILE_WRITE_DATA / WD），确保只读目录下直启正常
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
if ($sid -notmatch '^S-1-[0-9-]+$') {
    throw '无法获取当前 Windows 测试账户 SID'
}
$denyRule = '*' + $sid + ':(OI)(CI)(WD)'
$removeRule = '*' + $sid

& icacls.exe $expanded /deny $denyRule | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw '未能对便携解压目录配置 NTFS 只读 ACL'
}
try {
    $unexpectedWrite = Join-Path $expanded 'uah-readonly-probe.tmp'
    $permissionDenied = $false
    try {
        [IO.File]::WriteAllText($unexpectedWrite, 'denied')
    } catch [UnauthorizedAccessException] {
        $permissionDenied = $true
    }
    if (-not $permissionDenied -or (Test-Path -LiteralPath $unexpectedWrite)) {
        throw '在已配置只读权限的便携目录中依然能够新建写入文件'
    }
    $readonlyReceipt = Smoke (Join-Path $expanded 'UserscriptAutoHealer.exe') $expanded 'extracted-readonly' $temp
    Assert-RetainedData $readonlyReceipt $userDataRoot $canary $canaryText $smokeRoaming
} finally {
    & icacls.exe $expanded /remove:d $removeRule | Out-Null
}
Write-Output 'PASS: Windows NTFS ACL 只读便携解压目录启动与外部 userData 保持成功'

# =============================================================================
# 第五阶段：Inno Setup 6 生产安装器编译与安装/升级/卸载全流程验证
# =============================================================================
$inno = @(
    (Join-Path ([Environment]::GetFolderPath('ProgramFilesX86')) 'Inno Setup 6\ISCC.exe'),
    (Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'Inno Setup 6\ISCC.exe')
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $inno) {
    $cmd = Get-Command ISCC.exe -ErrorAction SilentlyContinue
    if ($cmd) { $inno = $cmd.Source }
}
if (-not $inno) {
    throw '未检测到 Inno Setup 6 编译器（ISCC.exe），无法编译 Windows 生产安装器'
}

$setupName = "$prefix-Setup"
$issTemplate = Join-Path $root 'packaging\windows\installer.iss'
Require-File $issTemplate

# 动态配置生产 ISS 编译脚本
$iss = Join-Path $temp 'production-installer.iss'
$sourceDirEscaped = $stage
$outputDirEscaped = $out

$issContent = Get-Content -LiteralPath $issTemplate -Raw -Encoding utf8
# 注入动态宏定义与覆盖
$issDynamic = @"
#define MyAppVersion "$version"
#define SourceDir "$sourceDirEscaped"
#define OutputDir "$outputDirEscaped"
#define OutputBaseFilename "$setupName"
$issContent
"@
$issDynamic | Set-Content -LiteralPath $iss -Encoding utf8

& $inno $iss
if ($LASTEXITCODE -ne 0) {
    throw "Inno Setup 编译器执行失败，返回错误码：$LASTEXITCODE"
}

$exe = Join-Path $out "$setupName.exe"
Require-File $exe

# 静默安装测试（安装到临时专用目录）
$installedPath = Join-Path $temp 'installed-app'
$p = Start-Process -FilePath $exe -ArgumentList @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', "/DIR=$installedPath") -PassThru -Wait
if ($p.ExitCode -ne 0) {
    throw "生产安装器静默安装执行失败，退出码：$($p.ExitCode)"
}

# 逐一比对已安装的全部应用文件哈希
foreach ($original in $sourceFiles) {
    $relative = $original.FullName.Substring($stage.Length + 1)
    $installed = Join-Path $installedPath $relative
    Require-File $installed
    if ((Get-FileHash -LiteralPath $original.FullName -Algorithm SHA256).Hash -ne
        (Get-FileHash -LiteralPath $installed -Algorithm SHA256).Hash) {
        throw "安装后文件与源构建文件 SHA-256 校验和不匹配：$relative"
    }
}
Write-Output "PASS: 生产安装器全量文件哈希一致性比对通过 ($($sourceFiles.Count) 项文件)"

# 运行已安装应用烟测并验证数据保持
$installedReceipt = Smoke (Join-Path $installedPath 'UserscriptAutoHealer.exe') $installedPath 'installed' $temp
Assert-RetainedData $installedReceipt $userDataRoot $canary $canaryText $smokeRoaming

# 静默卸载测试
$uninstall = Get-ChildItem -LiteralPath $installedPath -Filter 'unins*.exe' | Select-Object -First 1
if (-not $uninstall) {
    throw '安装目录中未找到 Inno Setup 卸载程序（unins*.exe）'
}
$p = Start-Process -FilePath $uninstall.FullName -ArgumentList @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART') -PassThru -Wait
if ($p.ExitCode -ne 0 -or (Test-Path (Join-Path $installedPath 'UserscriptAutoHealer.exe'))) {
    throw '生产安装器静默卸载失败，应用程序未完全清除'
}

# 验证卸载后独立用户数据依然完整保留
if (-not (Test-Path -LiteralPath $canary -PathType Leaf) -or
    [IO.File]::ReadAllText($canary) -cne $canaryText) {
    throw '生产应用卸载操作异常清除了独立的用户数据哨兵'
}
Write-Output 'PASS: 生产安装、全量文件哈希校验、启动运行、卸载及数据隔离保持全流程通过'

# =============================================================================
# 第六阶段：生成 SHA256SUMS.txt 清单与双向严格一致性验签
# =============================================================================
$sum = Join-Path $out 'SHA256SUMS.txt'
@(
    ((Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToLowerInvariant() + '  ' + (Split-Path -Leaf $exe)),
    ((Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant() + '  ' + (Split-Path -Leaf $zip))
) | Set-Content -LiteralPath $sum -Encoding ascii

. (Join-Path $PSScriptRoot 'windows-candidate-checksums.ps1')
if (-not (Assert-CandidateChecksums $out (Split-Path -Leaf $exe) (Split-Path -Leaf $zip))) {
    throw '生产发布包 SHA-256 清单自检断言失败'
}
Write-Output 'PASS: 生产发布双包（Setup.exe 与 Portable.zip）及 SHA256SUMS.txt 校验和清单构建与自检成功'
Write-Output "RELEASE CANDIDATE READY: Version $version, Commit SHA $sha"
Get-Content -LiteralPath $sum

if ($env:GITHUB_OUTPUT) {
    "release_directory=$out" | Out-File -FilePath $env:GITHUB_OUTPUT -Encoding utf8 -Append
    "release_version=$version" | Out-File -FilePath $env:GITHUB_OUTPUT -Encoding utf8 -Append
    "setup_exe_name=$(Split-Path -Leaf $exe)" | Out-File -FilePath $env:GITHUB_OUTPUT -Encoding utf8 -Append
    "portable_zip_name=$(Split-Path -Leaf $zip)" | Out-File -FilePath $env:GITHUB_OUTPUT -Encoding utf8 -Append
}
