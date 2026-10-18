# POC-03B: one-off official RAR trial usability probe (NO PRODUCT / NO RELEASE).
# RARLab EULA authorizes a maximum 40-day evaluation but production use requires a license.
# Do not redistribute the WinRAR installer, exe, or license as an Actions artifact.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$root = Join-Path $env:RUNNER_TEMP "rar-evaluation-$env:GITHUB_RUN_ID-$env:GITHUB_RUN_ATTEMPT"
if (Test-Path $root) { throw 'Temporary scope already exists' }
New-Item -ItemType Directory -Path $root | Out-Null
$url = 'https://www.rarlab.com/rar/winrar-x64-723.exe'
$installer = Join-Path $root 'official-winrar-trial.exe'
Invoke-WebRequest -Uri $url -OutFile $installer -TimeoutSec 90
$sign = Get-AuthenticodeSignature -FilePath $installer
Write-Output "Official installer signature status: $($sign.Status); signer: $($sign.SignerCertificate.Subject)"
if ($sign.Status -ne 'Valid') { throw 'Invalid or unverifiable installer Authenticode signature' }
if ($sign.SignerCertificate.Subject -notmatch 'rar') { throw 'Unexpected installer signer; refusing execution' }
Write-Output "Official trial installer SHA256: $((Get-FileHash $installer -Algorithm SHA256).Hash)"
$install = Start-Process -FilePath $installer -ArgumentList '/S' -PassThru -Wait
if ($install.ExitCode -ne 0) { throw "Official trial installer exit code $($install.ExitCode)" }
$rar = @( (Join-Path $env:ProgramFiles 'WinRAR\Rar.exe'), (Join-Path ([Environment]::GetFolderPath('ProgramFilesX86')) 'WinRAR\Rar.exe') ) |
  Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $rar) { throw 'rar.exe missing after official installer' }
$payload = Join-Path $root 'poc.txt'
Set-Content -Path $payload -Value 'One-off evaluation sample. Not a userscript application.' -Encoding UTF8
$archive = Join-Path $root 'poc-real.rar'
Push-Location $root
try {
  & $rar a -m5 -ep $archive $payload
  if ($LASTEXITCODE -ne 0) { throw "RAR create returned $LASTEXITCODE" }
  & $rar t $archive
  if ($LASTEXITCODE -ne 0) { throw "RAR internal archive test returned $LASTEXITCODE" }
} finally { Pop-Location }
$magic = [IO.File]::ReadAllBytes($archive) | Select-Object -First 8
$prefix = ($magic | ForEach-Object { $_.ToString('X2') }) -join ' '
if ($prefix -ne '52 61 72 21 1A 07 01 00') { throw "Not a RAR5 archive: $prefix" }
$extract = Join-Path $root 'extracted'
New-Item -ItemType Directory -Path $extract | Out-Null
& $rar x -o- $archive "$extract\"
if ($LASTEXITCODE -ne 0) { throw "RAR extract returned $LASTEXITCODE" }
$restored = Join-Path $extract 'poc.txt'
if (-not (Test-Path $restored)) { throw 'Extracted file absent' }
if ((Get-FileHash $payload -Algorithm SHA256).Hash -ne (Get-FileHash $restored -Algorithm SHA256).Hash) { throw 'Extracted payload checksum mismatch' }
Write-Output "PASS POC-03B: real RAR5 create/test/extract/sha256 round-trip; test .rar SHA256 $((Get-FileHash $archive -Algorithm SHA256).Hash)"
Write-Output 'LICENSE BLOCKER: evaluation use only; production automated RAR creation still requires proper licensed tool access and license check.'
Write-Output 'No WinRAR executable or created archive was uploaded to GitHub; temporary runner files are discarded.'
