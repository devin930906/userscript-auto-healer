# POC-03A: disposable Windows installer smoke test.
# POC-03C: native Windows ZIP round-trip feasibility in a disposable folder.
# This does not package or validate the real software.
$ErrorActionPreference = 'Stop'
$root = Join-Path $env:RUNNER_TEMP "packaging-audit-$env:GITHUB_RUN_ID-$env:GITHUB_RUN_ATTEMPT"
if (Test-Path $root) { throw 'Refusing to overwrite prior audit directory' }
New-Item -ItemType Directory -Path $root | Out-Null
$pf86 = [Environment]::GetFolderPath('ProgramFilesX86')
$pf = [Environment]::GetFolderPath('ProgramFiles')
$inno = @((Join-Path $pf86 'Inno Setup 6\ISCC.exe'),(Join-Path $pf 'Inno Setup 6\ISCC.exe')) |
  Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $inno) {
  $tool = Get-Command ISCC.exe -ErrorAction SilentlyContinue
  if ($tool) { $inno = $tool.Source }
}
if (-not $inno) { throw 'Inno Setup compiler missing on runner' }
Write-Output "Found installer compiler: $inno"
$nsis = Get-Command makensis.exe -ErrorAction SilentlyContinue
if ($nsis) { Write-Output "NSIS executable available: $($nsis.Source)" }
else { Write-Output 'NSIS executable not discovered' }
Set-Content -Path (Join-Path $root 'payload.txt') -Value 'PoC only; not product code.' -Encoding utf8
$setup = @'
[Setup]
AppId=UserscriptAutoHealerToolchainPoC
AppName=Temporary Userscript Packaging Probe
AppVersion=0.0.0
DefaultDirName={localappdata}\UserscriptToolchainPoC
PrivilegesRequired=lowest
DisableProgramGroupPage=yes
OutputBaseFilename=PoC-Setup
[Files]
Source: "payload.txt"; DestDir: "{app}"; Flags: ignoreversion
'@
Set-Content -Path (Join-Path $root 'poc.iss') -Value $setup -Encoding utf8
Push-Location $root
try {
  & $inno (Join-Path $root 'poc.iss')
  if ($LASTEXITCODE -ne 0) { throw "Compiler exit $LASTEXITCODE" }
} finally { Pop-Location }
$installer = Join-Path $root 'Output\PoC-Setup.exe'
if (-not (Test-Path $installer)) { throw 'Installer not generated' }
Write-Output "PASS POC-03A: genuine EXE installer produced; SHA256 $((Get-FileHash $installer -Algorithm SHA256).Hash)"
$dest = Join-Path $root 'installed'
$install = Start-Process -FilePath $installer -ArgumentList @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART',"/DIR=$dest") -PassThru -Wait
if ($install.ExitCode -ne 0 -or -not (Test-Path (Join-Path $dest 'payload.txt'))) { throw 'Install failed or payload missing' }
Write-Output 'PASS: installer installed disposable payload to a temporary directory'
$uninst = Get-ChildItem -Path $dest -Filter 'unins*.exe' | Select-Object -First 1
if (-not $uninst) { throw 'Uninstaller absent' }
$uninstall = Start-Process -FilePath $uninst.FullName -ArgumentList @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART') -PassThru -Wait
if ($uninstall.ExitCode -ne 0 -or (Test-Path (Join-Path $dest 'payload.txt'))) { throw 'Uninstall incomplete' }
Write-Output 'PASS: temporary installer payload removed via uninstaller'
# POC-03C: create an ordinary ZIP in a disposable test folder and verify safe round-trip.
$portable = Join-Path $root 'portable-fixture'
New-Item -ItemType Directory -Path $portable | Out-Null
Set-Content -Path (Join-Path $portable 'readme.txt') -Value 'Disposable ZIP smoke test; not application code.' -Encoding utf8
$zip = Join-Path $root 'poc-portable.zip'
Compress-Archive -Path (Join-Path $portable '*') -DestinationPath $zip -CompressionLevel Optimal -ErrorAction Stop
if (-not (Test-Path $zip) -or (Get-Item $zip).Length -le 4) { throw 'ZIP missing or empty' }
$magic = [IO.File]::ReadAllBytes($zip) | Select-Object -First 4
$prefix = ($magic | ForEach-Object { $_.ToString('X2') }) -join ' '
if ($prefix -ne '50 4B 03 04') { throw "Unexpected ZIP header: $prefix" }
Add-Type -AssemblyName System.IO.Compression
$archive = [IO.Compression.ZipFile]::OpenRead($zip)
try {
  $entries = @($archive.Entries)
  if ($entries.Count -ne 1 -or $entries[0].FullName -ne 'readme.txt') { throw 'Unexpected ZIP entry list' }
  foreach ($entry in $entries) {
    $name = $entry.FullName.Replace([char]92,[char]47)
    if ($name.StartsWith('/') -or $name -match '(^|/)\.\.(?:/|$)' -or $name -match '^[A-Za-z]:') { throw 'Unsafe ZIP entry path' }
  }
} finally { $archive.Dispose() }
$unpacked = Join-Path $root 'zip-extracted'
Expand-Archive -LiteralPath $zip -DestinationPath $unpacked -ErrorAction Stop
$source = Join-Path $portable 'readme.txt'
$restored = Join-Path $unpacked 'readme.txt'
if (-not (Test-Path $restored)) { throw 'ZIP extraction missing file' }
if ((Get-FileHash $source -Algorithm SHA256).Hash -ne (Get-FileHash $restored -Algorithm SHA256).Hash) { throw 'ZIP payload SHA-256 mismatch' }
Write-Output "PASS POC-03C: native ZIP signature, entry safety, extraction and SHA-256 round trip; zip SHA256 $((Get-FileHash $zip -Algorithm SHA256).Hash)"
Write-Output 'Scope: disposable installer+ZIP fixtures only; NOT actual Userscript Auto Healer binaries or Stable verification.'
