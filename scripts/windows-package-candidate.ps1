# TASK-019/020 / REQ-027/028 / TEST-027/028.
# ACTUAL compiled Electron Windows EXE/ZIP development candidates only.
# This does NOT certify Tampermonkey, script repair or Stable acceptance.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
function Require-File([string]$path) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Required file missing: $path" }
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
@{name='userscript-auto-healer';version=$version;main='dist/app/main/index.js';private=$true} |
 ConvertTo-Json | Set-Content -LiteralPath (Join-Path $app 'package.json') -Encoding utf8
@('DEVELOPMENT CANDIDATE - NOT STABLE / NOT RELEASED',
  "Source Git commit: $sha",
  'No real Tampermonkey business recovery, automatic repair/rollback, upgrade or user-device GATE certification.') |
 Set-Content -LiteralPath (Join-Path $stage 'CANDIDATE-NOT-STABLE.txt') -Encoding utf8
Smoke (Join-Path $stage 'UserscriptAutoHealer.exe') $stage 'staged' $temp
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
  foreach($entry in $archive.Entries) {
    $n=$entry.FullName.Replace([char]92,[char]47)
    if ($n.StartsWith('/') -or $n -match '^[A-Za-z]:' -or $n -match '(^|/)\.\.(/|$)' -or
        $n.Contains([char]0)) { throw "Unsafe ZIP member: $n" }
  }
} finally { $archive.Dispose() }
$expanded=Join-Path $temp 'expanded'
Expand-Archive -LiteralPath $zip -DestinationPath $expanded -ErrorAction Stop
foreach($relative in @('UserscriptAutoHealer.exe','resources\app\dist\app\main\index.js',
                        'resources\app\dist\app\ui\index.html','resources\app\node_modules\acorn\package.json')) {
  $a=Join-Path $stage $relative; $b=Join-Path $expanded $relative
  Require-File $b
  if ((Get-FileHash -LiteralPath $a -Algorithm SHA256).Hash -ne
      (Get-FileHash -LiteralPath $b -Algorithm SHA256).Hash) { throw "ZIP extracted file mismatch: $relative" }
}
Smoke (Join-Path $expanded 'UserscriptAutoHealer.exe') $expanded 'extracted' $temp
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
 'AppId=UserscriptAutoHealer'
 'AppName=Userscript Auto Healer (Development Candidate)'
 "AppVersion=$version"
 'DefaultDirName={localappdata}\Programs\UserscriptAutoHealer'
 'DefaultGroupName=Userscript Auto Healer (Candidate)'
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
 'Name: "{group}\Userscript Auto Healer"; Filename: "{app}\UserscriptAutoHealer.exe"'
 'Name: "{autodesktop}\Userscript Auto Healer"; Filename: "{app}\UserscriptAutoHealer.exe"; Tasks: desktopicon'
) | Set-Content -LiteralPath $iss -Encoding utf8
& $inno $iss
if ($LASTEXITCODE -ne 0) { throw "Inno Setup compiler exit: $LASTEXITCODE" }
$exe=Join-Path $out "$setupName.exe"
Require-File $exe
$installedPath=Join-Path $temp 'installed-app'
$p=Start-Process -FilePath $exe -ArgumentList @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART',"/DIR=$installedPath") -PassThru -Wait
if ($p.ExitCode -ne 0) { throw 'Installer execution failed' }
Smoke (Join-Path $installedPath 'UserscriptAutoHealer.exe') $installedPath 'installed' $temp
$uninstall=Get-ChildItem -LiteralPath $installedPath -Filter 'unins*.exe' | Select-Object -First 1
if (-not $uninstall) { throw 'Uninstaller missing' }
$p=Start-Process -FilePath $uninstall.FullName -ArgumentList @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART') -PassThru -Wait
if ($p.ExitCode -ne 0 -or (Test-Path (Join-Path $installedPath 'UserscriptAutoHealer.exe'))) {
  throw 'Uninstall failed'
}
$sum=Join-Path $out 'SHA256SUMS.txt'
@(
 ((Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToLowerInvariant() + '  ' + (Split-Path -Leaf $exe)),
 ((Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant() + '  ' + (Split-Path -Leaf $zip))
) | Set-Content -LiteralPath $sum -Encoding ascii
Write-Output "CANDIDATE ONLY - NOT STABLE. Source: $sha"
Write-Output 'PASS: Electron shell staged, extracted and installed; ZIP integrity and uninstall checks'
Get-Content -LiteralPath $sum
if($env:GITHUB_OUTPUT) { "candidate_directory=$out" | Out-File -FilePath $env:GITHUB_OUTPUT -Encoding utf8 -Append }
