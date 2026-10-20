# TASK-019/020 / REQ-027/028 / TEST-027/028.
# Candidate namespace is deliberately different from any production installation
# and Electron userData identity; never upgrade/overwrite future Stable users.
# ACTUAL compiled Electron Windows EXE/ZIP development candidates only.
# This does NOT certify Tampermonkey, script repair or Stable acceptance.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
function Require-File([string]$path) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Required file missing: $path" }
}
function Assert-IsolatedDataRoot([object]$receipt,[string]$roamingRoot) {
  if($null -eq $receipt -or $receipt.userDataDirectory -isnot [string] -or
     [string]::IsNullOrWhiteSpace($receipt.userDataDirectory) -or
     -not [IO.Path]::IsPathRooted($receipt.userDataDirectory)) {
    throw 'Electron smoke did not report an absolute userData directory'
  }
  $actual=[IO.Path]::GetFullPath([string]$receipt.userDataDirectory).TrimEnd([char[]]@('\','/'))
  $root=[IO.Path]::GetFullPath($roamingRoot).TrimEnd([char[]]@('\','/'))
  if (-not $actual.StartsWith(($root + [IO.Path]::DirectorySeparatorChar),
                              [StringComparison]::OrdinalIgnoreCase) -or
      -not (Split-Path -Leaf $actual).ToLowerInvariant().Contains('candidate')) {
    throw 'Electron userData is not isolated to the disposable candidate namespace'
  }
  return $actual
}
function Assert-RetainedData([object]$receipt,[string]$expectedRoot,
                             [string]$canary,[string]$value,[string]$roamingRoot) {
  $actual=Assert-IsolatedDataRoot $receipt $roamingRoot
  if (-not [string]::Equals($actual,$expectedRoot,
                           [StringComparison]::OrdinalIgnoreCase) -or
      -not (Test-Path -LiteralPath $canary -PathType Leaf) -or
      [IO.File]::ReadAllText($canary) -cne $value) {
    throw 'Candidate userData identity/retention changed between launches'
  }
}
function Smoke([string]$exe,[string]$cwd,[string]$name,[string]$temp) {
  Require-File $exe
  $receipt=Join-Path $temp "shell-$name.json"
  $env:UAH_SMOKE_RECEIPT=$receipt
  try {
    $p=Start-Process -FilePath $exe -ArgumentList @('--uahtest-shell-only') -WorkingDirectory $cwd -PassThru
    try { Wait-Process -Id $p.Id -Timeout 90 -ErrorAction Stop }
    catch { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue; throw "Shell smoke timeout: $name" }
    $p.Refresh()
    if ($p.ExitCode -ne 0) { throw "Electron smoke exit failure: $name" }
  } finally { Remove-Item Env:\UAH_SMOKE_RECEIPT -ErrorAction SilentlyContinue }
  Require-File $receipt
  $r=Get-Content -LiteralPath $receipt -Raw | ConvertFrom-Json
  if ($r.shell -ne 'development-skeleton' -or
      $r.preloadIpcVerified -ne $true -or $r.rendererSandboxVerified -ne $true -or
      $r.automaticRepairAvailable -ne $false) { throw "Unsafe shell receipt: $name" }
  return $r
}
$root=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$pkg=Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
$version=[string]$pkg.version
if ($version -notmatch '^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$') { throw 'Invalid candidate version' }
$sha=(& git -C $root rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $sha -notmatch '^[a-f0-9]{40}$') { throw 'Source SHA unavailable' }
$short=$sha.Substring(0,12)
$prefix="Userscript-Auto-Healer-v$version-$short-CANDIDATE"
$temp=Join-Path $env:RUNNER_TEMP "uah-candidate-$short-$env:GITHUB_RUN_ID-$env:GITHUB_RUN_ATTEMPT"
if (Test-Path -LiteralPath $temp) { throw 'Refusing to overwrite prior candidate' }
New-Item -ItemType Directory -Path $temp | Out-Null
$out=Join-Path $temp 'deliverables'
$stage=Join-Path $temp 'portable-app'
New-Item -ItemType Directory -Path $out,$stage | Out-Null
# Electron resolves Windows AppData via native Known Folder APIs, which
# may ignore a process-local APPDATA override. Verify the ACTUAL userData
# against the disposable GitHub-hosted runner's roaming profile instead.
# Only the separate candidate namespace is permitted; never a Stable path.
$smokeRoaming=$env:APPDATA
if (-not $smokeRoaming -or -not [IO.Path]::IsPathRooted($smokeRoaming)) {
  throw 'Windows hosted runner roaming AppData path unavailable'
}
$runtime=Join-Path $root 'node_modules\electron\dist'
foreach($relative in @('electron.exe','resources')) {
  if (-not (Test-Path (Join-Path $runtime $relative))) { throw "Incomplete Electron runtime: $relative" }
}
foreach($relative in @('dist\app\main\index.js','dist\app\preload\index.js',
  'dist\app\ui\index.html','dist\app\ui\index.js','dist\src\analyze\metadata-parser.js',
  'node_modules\acorn\package.json')) { Require-File (Join-Path $root $relative) }
# Electron loads its packaged app from resources/app, not a development npm environment.
Copy-Item -Path (Join-Path $runtime '*') -Destination $stage -Recurse -Force
Move-Item -LiteralPath (Join-Path $stage 'electron.exe') -Destination (Join-Path $stage 'UserscriptAutoHealer.exe')
$app=Join-Path $stage 'resources\app'
New-Item -ItemType Directory -Path (Join-Path $app 'dist'),(Join-Path $app 'node_modules') | Out-Null
Copy-Item -LiteralPath (Join-Path $root 'dist\app') -Destination (Join-Path $app 'dist\app') -Recurse
Copy-Item -LiteralPath (Join-Path $root 'dist\src') -Destination (Join-Path $app 'dist\src') -Recurse
Copy-Item -LiteralPath (Join-Path $root 'node_modules\acorn') -Destination (Join-Path $app 'node_modules\acorn') -Recurse
@{name='userscript-auto-healer-candidate';productName='Userscript Auto Healer Candidate';version=$version;main='dist/app/main/index.js';private=$true} |
 ConvertTo-Json | Set-Content -LiteralPath (Join-Path $app 'package.json') -Encoding utf8
@('DEVELOPMENT CANDIDATE - NOT STABLE / NOT RELEASED',
  "Source Git commit: $sha",
  'No real Tampermonkey business recovery, automatic repair/rollback, upgrade or user-device GATE certification.') |
 Set-Content -LiteralPath (Join-Path $stage 'CANDIDATE-NOT-STABLE.txt') -Encoding utf8
$stagedReceipt=Smoke (Join-Path $stage 'UserscriptAutoHealer.exe') $stage 'staged' $temp
$userDataRoot=Assert-IsolatedDataRoot $stagedReceipt $smokeRoaming
New-Item -ItemType Directory -Path $userDataRoot -Force | Out-Null
$canary=Join-Path $userDataRoot 'candidate-smoke-retention-only.txt'
if (Test-Path -LiteralPath $canary) { throw 'Refusing to replace existing smoke user data' }
$canaryText="candidate-retention-$sha-$env:GITHUB_RUN_ID"
[IO.File]::WriteAllText($canary,$canaryText)
Require-File $canary
# Create a TRUE portable ZIP containing runtime, compiled app and runtime dependencies.
$zip=Join-Path $out "$prefix-Portable.zip"
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -CompressionLevel Optimal -ErrorAction Stop
Require-File $zip
$stream=[IO.File]::OpenRead($zip)
try { $signature=New-Object byte[] 4; if($stream.Read($signature,0,4) -ne 4 -or
    ($signature -join ',') -ne '80,75,3,4') { throw 'ZIP signature mismatch' } }
finally { $stream.Dispose() }
Add-Type -AssemblyName System.IO.Compression
$archive=[IO.Compression.ZipFile]::OpenRead($zip)
try {
  if ($archive.Entries.Count -lt 10) { throw 'ZIP unexpectedly sparse' }
  $zipFileNames=[System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
  foreach($entry in $archive.Entries) {
    $n=$entry.FullName.Replace([char]92,[char]47)
    if ($n.StartsWith('/') -or $n -match '^[A-Za-z]:' -or $n -match '(^|/)\.\.(/|$)' -or
        $n.Contains([char]0) -or $n.Contains(':') -or $n.Contains('//') -or
        $n -match '(^|/)[^/]*[. ](/|$)') { throw "Unsafe ZIP member: $n" }
    if (-not $n.EndsWith('/')) {
      if (-not $zipFileNames.Add($n)) { throw "Duplicate ZIP file entry: $n" }
    }
  }
} finally { $archive.Dispose() }
$expanded=Join-Path $temp 'expanded'
Expand-Archive -LiteralPath $zip -DestinationPath $expanded -ErrorAction Stop
# Compare EVERY file by its relative name and SHA-256, not just selected
# entry points. A missing runtime DLL or locale must fail before artifact upload.
$sourceFiles=@(Get-ChildItem -LiteralPath $stage -File -Recurse -Force)
$extractedFiles=@(Get-ChildItem -LiteralPath $expanded -File -Recurse -Force)
if ($sourceFiles.Count -ne $extractedFiles.Count -or
    $zipFileNames.Count -ne $sourceFiles.Count) {
  throw 'ZIP source/archive/extracted file counts differ'
}
foreach($original in $sourceFiles) {
  $relative=$original.FullName.Substring($stage.Length+1)
  $zipName=$relative.Replace([char]92,[char]47)
  if (-not $zipFileNames.Contains($zipName)) { throw "ZIP member missing: $zipName" }
  $extracted=Join-Path $expanded $relative
  Require-File $extracted
  if ((Get-FileHash -LiteralPath $original.FullName -Algorithm SHA256).Hash -ne
      (Get-FileHash -LiteralPath $extracted -Algorithm SHA256).Hash) {
    throw "ZIP file hash mismatch: $zipName"
  }
}
Write-Output "PASS: complete ZIP file manifest and SHA-256 round trip ($($sourceFiles.Count) files)"
$expandedReceipt=Smoke (Join-Path $expanded 'UserscriptAutoHealer.exe') $expanded 'extracted' $temp
Assert-RetainedData $expandedReceipt $userDataRoot $canary $canaryText $smokeRoaming
# REQ-028/TEST-028: a read-only extracted application directory must NOT be
# required for data writes. Use real Windows NTFS ACLs (not merely the
# directory ReadOnly attribute, which does not deny file creation).
# Everything here is disposable runner-local candidate content; never alter
# user-provided paths or an installed Stable location.
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
if($sid -notmatch '^S-1-[0-9-]+
# Inno Setup's compiler is checked; never substitute a renamed EXE.
$inno=@(
 (Join-Path ([Environment]::GetFolderPath('ProgramFilesX86')) 'Inno Setup 6\ISCC.exe'),
 (Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'Inno Setup 6\ISCC.exe')
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $inno) { $cmd=Get-Command ISCC.exe -ErrorAction SilentlyContinue; if($cmd){$inno=$cmd.Source} }
if (-not $inno) { throw 'Inno Setup 6 unavailable for candidate packaging' }
$setupName="$prefix-Setup"
$iss=Join-Path $temp 'candidate.iss'
$sourceLine='Source: "' + $stage + '\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs'
@(
 '[Setup]'
 'AppId=UserscriptAutoHealerDevelopmentCandidate'
 'AppName=Userscript Auto Healer (Development Candidate)'
 "AppVersion=$version"
 'DefaultDirName={localappdata}\Programs\UserscriptAutoHealerCandidate'
 'DefaultGroupName=Userscript Auto Healer Candidate'
 'UsePreviousAppDir=no'
 'PrivilegesRequired=lowest'
 'UninstallDisplayIcon={app}\UserscriptAutoHealer.exe'
 "OutputDir=$out"
 "OutputBaseFilename=$setupName"
 'Compression=lzma'
 'SolidCompression=yes'
 '[Tasks]'
 'Name: "desktopicon"; Description: "Create desktop shortcut"; Flags: unchecked'
 '[Files]'
 $sourceLine
 '[Icons]'
 'Name: "{group}\Userscript Auto Healer Candidate"; Filename: "{app}\UserscriptAutoHealer.exe"'
 'Name: "{autodesktop}\Userscript Auto Healer Candidate"; Filename: "{app}\UserscriptAutoHealer.exe"; Tasks: desktopicon'
) | Set-Content -LiteralPath $iss -Encoding utf8
& $inno $iss
if ($LASTEXITCODE -ne 0) { throw "Inno Setup compiler exit: $LASTEXITCODE" }
$exe=Join-Path $out "$setupName.exe"
Require-File $exe
$installedPath=Join-Path $temp 'installed-app'
$p=Start-Process -FilePath $exe -ArgumentList @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART',"/DIR=$installedPath") -PassThru -Wait
if ($p.ExitCode -ne 0) { throw 'Installer execution failed' }
# A successful installer exit and shell smoke alone cannot prove its payload is complete.
# Match EVERY staged application file against what Inno Setup actually installed;
# Inno's own uninstall metadata is intentionally outside the staged manifest.
foreach($original in $sourceFiles) {
  $relative=$original.FullName.Substring($stage.Length+1)
  $installed=Join-Path $installedPath $relative
  Require-File $installed
  if ((Get-FileHash -LiteralPath $original.FullName -Algorithm SHA256).Hash -ne
      (Get-FileHash -LiteralPath $installed -Algorithm SHA256).Hash) {
    throw "Installed application file hash mismatch: $relative"
  }
}
Write-Output "PASS: complete installed application payload SHA-256 parity ($($sourceFiles.Count) files)"
$installedReceipt=Smoke (Join-Path $installedPath 'UserscriptAutoHealer.exe') $installedPath 'installed' $temp
Assert-RetainedData $installedReceipt $userDataRoot $canary $canaryText $smokeRoaming
$uninstall=Get-ChildItem -LiteralPath $installedPath -Filter 'unins*.exe' | Select-Object -First 1
if (-not $uninstall) { throw 'Uninstaller missing' }
$p=Start-Process -FilePath $uninstall.FullName -ArgumentList @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART') -PassThru -Wait
if ($p.ExitCode -ne 0 -or (Test-Path (Join-Path $installedPath 'UserscriptAutoHealer.exe'))) {
  throw 'Uninstall failed'
}
# Uninstalling the candidate must not remove this unrelated, isolated
# per-user test file. This is NOT a Stable migration/upgrade certification.
if (-not (Test-Path -LiteralPath $canary -PathType Leaf) -or
    [IO.File]::ReadAllText($canary) -cne $canaryText) {
  throw 'Candidate uninstall deleted or altered independent user data'
}
Write-Output 'PASS: disposable candidate userData identity and uninstall retention'
$sum=Join-Path $out 'SHA256SUMS.txt'
@(
 ((Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToLowerInvariant() + '  ' + (Split-Path -Leaf $exe)),
 ((Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant() + '  ' + (Split-Path -Leaf $zip))
) | Set-Content -LiteralPath $sum -Encoding ascii
Write-Output "CANDIDATE ONLY - NOT STABLE. Source: $sha"
Write-Output 'PASS: Electron shell staged, extracted and installed; ZIP integrity and uninstall checks'
Get-Content -LiteralPath $sum
if($env:GITHUB_OUTPUT) { "candidate_directory=$out" | Out-File -FilePath $env:GITHUB_OUTPUT -Encoding utf8 -Append }
) { throw 'Unable to identify Windows test principal' }
$denyRule='*'+$sid+':(OI)(CI)(W)'
$removeRule='*'+$sid
& icacls.exe $expanded /deny $denyRule /T | Out-Null
if($LASTEXITCODE -ne 0) { throw 'Unable to make candidate extraction read-only' }
try {
  $unexpectedWrite=Join-Path $expanded 'uah-candidate-readonly-write-probe.tmp'
  if(Test-Path -LiteralPath $unexpectedWrite) { throw 'Unexpected test probe already exists' }
  $permissionDenied=$false
  try {
    [IO.File]::WriteAllText($unexpectedWrite,'not permitted')
  } catch [UnauthorizedAccessException] {
    $permissionDenied=$true
  }
  if(-not $permissionDenied -or (Test-Path -LiteralPath $unexpectedWrite)) {
    throw 'Read-only portable path still permits application-directory writes'
  }
  $readonlyReceipt=Smoke (Join-Path $expanded 'UserscriptAutoHealer.exe') $expanded 'extracted-readonly' $temp
  Assert-RetainedData $readonlyReceipt $userDataRoot $canary $canaryText $smokeRoaming
} finally {
  # Restore only the denial added to the disposable expanded candidate tree,
  # including child DLLs, so runner cleanup is not impaired.
  & icacls.exe $expanded /remove:d $removeRule /T | Out-Null
  if($LASTEXITCODE -ne 0) { throw 'Failed to restore candidate directory permissions' }
}
Write-Output 'PASS: actual Windows ACL read-only ZIP extraction denies writes and starts Electron using retained external userData'
# Inno Setup's compiler is checked; never substitute a renamed EXE.
$inno=@(
 (Join-Path ([Environment]::GetFolderPath('ProgramFilesX86')) 'Inno Setup 6\ISCC.exe'),
 (Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'Inno Setup 6\ISCC.exe')
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $inno) { $cmd=Get-Command ISCC.exe -ErrorAction SilentlyContinue; if($cmd){$inno=$cmd.Source} }
if (-not $inno) { throw 'Inno Setup 6 unavailable for candidate packaging' }
$setupName="$prefix-Setup"
$iss=Join-Path $temp 'candidate.iss'
$sourceLine='Source: "' + $stage + '\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs'
@(
 '[Setup]'
 'AppId=UserscriptAutoHealerDevelopmentCandidate'
 'AppName=Userscript Auto Healer (Development Candidate)'
 "AppVersion=$version"
 'DefaultDirName={localappdata}\Programs\UserscriptAutoHealerCandidate'
 'DefaultGroupName=Userscript Auto Healer Candidate'
 'UsePreviousAppDir=no'
 'PrivilegesRequired=lowest'
 'UninstallDisplayIcon={app}\UserscriptAutoHealer.exe'
 "OutputDir=$out"
 "OutputBaseFilename=$setupName"
 'Compression=lzma'
 'SolidCompression=yes'
 '[Tasks]'
 'Name: "desktopicon"; Description: "Create desktop shortcut"; Flags: unchecked'
 '[Files]'
 $sourceLine
 '[Icons]'
 'Name: "{group}\Userscript Auto Healer Candidate"; Filename: "{app}\UserscriptAutoHealer.exe"'
 'Name: "{autodesktop}\Userscript Auto Healer Candidate"; Filename: "{app}\UserscriptAutoHealer.exe"; Tasks: desktopicon'
) | Set-Content -LiteralPath $iss -Encoding utf8
& $inno $iss
if ($LASTEXITCODE -ne 0) { throw "Inno Setup compiler exit: $LASTEXITCODE" }
$exe=Join-Path $out "$setupName.exe"
Require-File $exe
$installedPath=Join-Path $temp 'installed-app'
$p=Start-Process -FilePath $exe -ArgumentList @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART',"/DIR=$installedPath") -PassThru -Wait
if ($p.ExitCode -ne 0) { throw 'Installer execution failed' }
# A successful installer exit and shell smoke alone cannot prove its payload is complete.
# Match EVERY staged application file against what Inno Setup actually installed;
# Inno's own uninstall metadata is intentionally outside the staged manifest.
foreach($original in $sourceFiles) {
  $relative=$original.FullName.Substring($stage.Length+1)
  $installed=Join-Path $installedPath $relative
  Require-File $installed
  if ((Get-FileHash -LiteralPath $original.FullName -Algorithm SHA256).Hash -ne
      (Get-FileHash -LiteralPath $installed -Algorithm SHA256).Hash) {
    throw "Installed application file hash mismatch: $relative"
  }
}
Write-Output "PASS: complete installed application payload SHA-256 parity ($($sourceFiles.Count) files)"
$installedReceipt=Smoke (Join-Path $installedPath 'UserscriptAutoHealer.exe') $installedPath 'installed' $temp
Assert-RetainedData $installedReceipt $userDataRoot $canary $canaryText $smokeRoaming
$uninstall=Get-ChildItem -LiteralPath $installedPath -Filter 'unins*.exe' | Select-Object -First 1
if (-not $uninstall) { throw 'Uninstaller missing' }
$p=Start-Process -FilePath $uninstall.FullName -ArgumentList @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART') -PassThru -Wait
if ($p.ExitCode -ne 0 -or (Test-Path (Join-Path $installedPath 'UserscriptAutoHealer.exe'))) {
  throw 'Uninstall failed'
}
# Uninstalling the candidate must not remove this unrelated, isolated
# per-user test file. This is NOT a Stable migration/upgrade certification.
if (-not (Test-Path -LiteralPath $canary -PathType Leaf) -or
    [IO.File]::ReadAllText($canary) -cne $canaryText) {
  throw 'Candidate uninstall deleted or altered independent user data'
}
Write-Output 'PASS: disposable candidate userData identity and uninstall retention'
$sum=Join-Path $out 'SHA256SUMS.txt'
@(
 ((Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToLowerInvariant() + '  ' + (Split-Path -Leaf $exe)),
 ((Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant() + '  ' + (Split-Path -Leaf $zip))
) | Set-Content -LiteralPath $sum -Encoding ascii
Write-Output "CANDIDATE ONLY - NOT STABLE. Source: $sha"
Write-Output 'PASS: Electron shell staged, extracted and installed; ZIP integrity and uninstall checks'
Get-Content -LiteralPath $sum
if($env:GITHUB_OUTPUT) { "candidate_directory=$out" | Out-File -FilePath $env:GITHUB_OUTPUT -Encoding utf8 -Append }
