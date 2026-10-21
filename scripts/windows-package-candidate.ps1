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
# TASK-020 / ISSUE-215 diagnostic only: match the exact disposable test EXE
# location, never query or modify external Chrome profiles or terminate processes.
# Parent Electron's exit does not prove its renderer/utility children exited.
. (Join-Path $PSScriptRoot 'windows-portable-relocation.ps1')
Write-CandidatePortableProcessSnapshot (Join-Path $expanded 'UserscriptAutoHealer.exe') 'after extracted smoke'
$ownedChecks=Wait-CandidatePortableProcessExit (Join-Path $expanded 'UserscriptAutoHealer.exe')
Write-Output "PASS: candidate-owned executable quiescent before relocation (check $ownedChecks)"
# TEST-028: exercise an actual portable directory MOVE (not a second copy
# built in the original path). Spaces and Unicode path components must not
# break Electron's packaged resource lookup or redirect persistent userData.
# Recheck the entire moved payload before any subsequent read-only ACL test.
$moved=Join-Path $temp 'relocated portable 路径'
if (Test-Path -LiteralPath $moved) { throw 'Refusing to overwrite a relocated test directory' }
# Atomic same-parent rename: unlike PowerShell Move-Item this cannot leave a
# partially copied payload when an Electron utility still holds an open DLL.
try {
  $relocationAttempts=Move-CandidatePortableDirectory $expanded $moved
} catch {
  # Preserve the actual exception and the original fail-closed guard.
  Write-CandidatePortableProcessSnapshot (Join-Path $expanded 'UserscriptAutoHealer.exe') 'after relocation failure'
  # Inspect candidate-only file sharing at the failure, without modifying
  # any original data or masking the authoritative Directory.Move exception.
  $candidateFilePaths=@($extractedFiles | ForEach-Object { $_.FullName })
  $shareSummary=Get-CandidatePortableFileShareSummary $expanded $candidateFilePaths
  Write-Output "DIAGNOSTIC: candidate file-sharing $shareSummary"
  Write-Output "DIAGNOSTIC: sourceExists=$(Test-Path -LiteralPath $expanded); destinationExists=$(Test-Path -LiteralPath $moved)"
  throw
}
Write-Output "PASS: atomic portable directory relocation ($relocationAttempts attempt(s))"
$expanded=$moved
$movedFiles=@(Get-ChildItem -LiteralPath $expanded -File -Recurse -Force)
if ($movedFiles.Count -ne $sourceFiles.Count) { throw 'Relocated ZIP payload file count changed' }
foreach($original in $sourceFiles) {
  $relative=$original.FullName.Substring($stage.Length+1)
  $relocated=Join-Path $expanded $relative
  Require-File $relocated
  if ((Get-FileHash -LiteralPath $original.FullName -Algorithm SHA256).Hash -ne
      (Get-FileHash -LiteralPath $relocated -Algorithm SHA256).Hash) {
    throw "Relocated portable payload hash mismatch: $relative"
  }
}
$movedReceipt=Smoke (Join-Path $expanded 'UserscriptAutoHealer.exe') $expanded 'relocated' $temp
Assert-RetainedData $movedReceipt $userDataRoot $canary $canaryText $smokeRoaming
Write-Output 'PASS: moved portable ZIP payload in Unicode/space path launches with all hashes and external userData intact'
# REQ-028/TEST-028: a read-only extracted application directory must NOT be
# required for data writes. Use real Windows NTFS ACLs (not merely the
# directory ReadOnly attribute, which does not deny file creation).
# Deny only Windows FILE_WRITE_DATA / directory FILE_ADD_FILE, not generic
# Write (W), which also prevents CreateProcess from starting the runtime.
# Everything here is disposable runner-local candidate content; never alter
# user-provided paths or an installed Stable location.
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
if($sid -notmatch '^S-1-[0-9-]+$') { throw 'Unable to identify Windows test principal' }
$denyRule='*'+$sid+':(OI)(CI)(WD)'
$removeRule='*'+$sid
& icacls.exe $expanded /deny $denyRule | Out-Null
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
  # inherited by children, so runner cleanup is not impaired.
  & icacls.exe $expanded /remove:d $removeRule | Out-Null
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
# TEST-027 (limited): exercise the REAL Inno same-AppId upgrade path from
# a disposable, synthetic 0.0.0 installer built from this SAME application.
# This is NOT an actual released predecessor or a data migration test.
# Never publish or upload the synthetic prior-version fixture.
$priorOutput=Join-Path $temp 'prior-version-fixture'
New-Item -ItemType Directory -Path $priorOutput | Out-Null
$priorName='UAH-SYNTHETIC-OLD-VERSION-TEST-ONLY'
$priorIss=Join-Path $temp 'prior-version-fixture.iss'
$priorLines=@(Get-Content -LiteralPath $iss | ForEach-Object {
  if($_ -cmatch '^AppVersion=') {'AppVersion=0.0.0'}
  elseif($_ -cmatch '^OutputDir=') {"OutputDir=$priorOutput"}
  elseif($_ -cmatch '^OutputBaseFilename=') {"OutputBaseFilename=$priorName"}
  else {$_}
})
if (@($priorLines | Where-Object {$_ -ceq 'AppVersion=0.0.0'}).Count -ne 1 -or
    @($priorLines | Where-Object {$_ -ceq "OutputDir=$priorOutput"}).Count -ne 1 -or
    @($priorLines | Where-Object {$_ -ceq "OutputBaseFilename=$priorName"}).Count -ne 1) {
  throw 'Unable to isolate synthetic prior installer settings'
}
$priorLines | Set-Content -LiteralPath $priorIss -Encoding utf8
& $inno $priorIss
if ($LASTEXITCODE -ne 0) { throw 'Synthetic prior Inno compiler failed' }
$priorExe=Join-Path $priorOutput "$priorName.exe"
Require-File $priorExe
$installedPath=Join-Path $temp 'installed-app'
$p=Start-Process -FilePath $priorExe -ArgumentList @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART',"/DIR=$installedPath") -PassThru -Wait
if ($p.ExitCode -ne 0) { throw 'Synthetic prior installer failed' }
$priorReceipt=Smoke (Join-Path $installedPath 'UserscriptAutoHealer.exe') $installedPath 'prior-version' $temp
Assert-RetainedData $priorReceipt $userDataRoot $canary $canaryText $smokeRoaming
$upgradeCanary=Join-Path $userDataRoot 'candidate-upgrade-retention-only.txt'
if(Test-Path -LiteralPath $upgradeCanary){throw 'Refusing to overwrite old-version test user data'}
$upgradeCanaryValue="synthetic-prior-$sha-$env:GITHUB_RUN_ID"
[IO.File]::WriteAllText($upgradeCanary,$upgradeCanaryValue)
Require-File $upgradeCanary
# The candidate installer uses the exact same disposable AppId. The explicit
# temp path prevents touching any real or future Stable installation.
& $inno $iss
if ($LASTEXITCODE -ne 0) { throw "Inno Setup compiler exit: $LASTEXITCODE" }
$exe=Join-Path $out "$setupName.exe"
Require-File $exe
$p=Start-Process -FilePath $exe -ArgumentList @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART',"/DIR=$installedPath") -PassThru -Wait
if ($p.ExitCode -ne 0) { throw 'Candidate upgrade installer execution failed' }
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
if (-not (Test-Path -LiteralPath $upgradeCanary -PathType Leaf) -or
    [IO.File]::ReadAllText($upgradeCanary) -cne $upgradeCanaryValue) {
  throw 'Candidate upgrade deleted or altered prior-version user data'
}
Write-Output 'PASS: synthetic older Inno installer upgraded to current candidate with AppData intact (not real historical-version migration)'
$uninstall=Get-ChildItem -LiteralPath $installedPath -Filter 'unins*.exe' | Select-Object -First 1
if (-not $uninstall) { throw 'Uninstaller missing' }
$p=Start-Process -FilePath $uninstall.FullName -ArgumentList @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART') -PassThru -Wait
if ($p.ExitCode -ne 0 -or (Test-Path (Join-Path $installedPath 'UserscriptAutoHealer.exe'))) {
  throw 'Uninstall failed'
}
# Uninstalling the candidate must not remove this unrelated, isolated
# per-user test file. This is NOT a Stable migration/upgrade certification.
if (-not (Test-Path -LiteralPath $canary -PathType Leaf) -or
    [IO.File]::ReadAllText($canary) -cne $canaryText -or
    -not (Test-Path -LiteralPath $upgradeCanary -PathType Leaf) -or
    [IO.File]::ReadAllText($upgradeCanary) -cne $upgradeCanaryValue) {
  throw 'Candidate uninstall deleted or altered independent or prior-version user data'
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
