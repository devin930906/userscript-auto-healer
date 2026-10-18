# POC-03A: disposable Windows installer smoke test and license-safe RAR audit.
# This does not package the product or create RAR files.
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
$rar = Get-Command rar.exe -ErrorAction SilentlyContinue
if (-not $rar) { Write-Output 'BLOCKED RAR: rar.exe not available in PATH; no RAR created and no unlicensed trial bundled.' }
else { Write-Output "RAR executable found: $($rar.Source); license status unknown; creation BLOCKED until authorization." }
Write-Output 'Scope: only ephemeral installer tooling, not the application install, Portable RAR, signing, or real userscript E2E.'
