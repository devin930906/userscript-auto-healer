# TASK-019/020 / TEST-027/028: verify candidate EXE/ZIP checksum manifest.
# All inputs are disposable runner-only files. Never exercise user installers.
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'windows-candidate-checksums.ps1')
if ([string]::IsNullOrWhiteSpace($env:RUNNER_TEMP)) {
  $env:RUNNER_TEMP = $env:TEMP
}
if ([string]::IsNullOrWhiteSpace($env:RUNNER_TEMP)) {
  throw 'Neither RUNNER_TEMP nor TEMP environment variable is available'
}
$env:RUNNER_TEMP = [IO.Path]::GetFullPath($env:RUNNER_TEMP)
$root = Join-Path $env:RUNNER_TEMP ('uah-checksum-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $root -ErrorAction Stop | Out-Null
$setup='UAH-v0.1.0-abc-CANDIDATE-Setup.exe'
$portable='UAH-v0.1.0-abc-CANDIDATE-Portable.zip'
$exePath=Join-Path $root $setup
$zipPath=Join-Path $root $portable
$sumPath=Join-Path $root 'SHA256SUMS.txt'
function Write-ValidManifest {
 $lines=@(
  ((Get-FileHash -LiteralPath $exePath -Algorithm SHA256).Hash.ToLowerInvariant()+'  '+$setup),
  ((Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()+'  '+$portable)
 )
 [IO.File]::WriteAllLines($sumPath,[string[]]$lines,[Text.Encoding]::ASCII)
}
function Expect-Refused([string]$label) {
 $refused=$false
 try { $null=Assert-CandidateChecksums $root $setup $portable }
 catch { $refused=$true }
 if(-not $refused){throw "Unsafe candidate checksum manifest accepted: $label"}
 Write-Output "PASS: checksum verifier rejects $label"
}
try {
 [IO.File]::WriteAllBytes($exePath,[byte[]](1,2,3,4,5))
 [IO.File]::WriteAllBytes($zipPath,[byte[]](80,75,3,4,6,7))
 Write-ValidManifest
 if(-not (Assert-CandidateChecksums $root $setup $portable)){
  throw 'Valid checksum fixture was rejected'
 }
 Write-Output 'PASS: exact two-file candidate manifest and payload hashes'
 [IO.File]::WriteAllBytes($exePath,[byte[]](1,2,3,4,9))
 Expect-Refused 'mutated installer bytes'
 [IO.File]::WriteAllBytes($exePath,[byte[]](1,2,3,4,5))
 [IO.File]::WriteAllText($sumPath,'not-a-checksum')
 Expect-Refused 'malformed checksum manifest'
 Write-ValidManifest
 [IO.File]::AppendAllText($sumPath,[Environment]::NewLine+'deadbeef')
 Expect-Refused 'additional checksum entry'
 Write-ValidManifest
 $dup=(Get-Content -LiteralPath $sumPath -Encoding ascii)
 [IO.File]::WriteAllLines($sumPath,[string[]]@($dup[0],$dup[0]),[Text.Encoding]::ASCII)
 Expect-Refused 'duplicate installer entry'
 Write-ValidManifest
 [IO.File]::WriteAllBytes((Join-Path $root 'unlisted.exe'),[byte[]](1))
 Expect-Refused 'unexpected deliverable'
 Remove-Item -LiteralPath (Join-Path $root 'unlisted.exe')
 Write-ValidManifest
 Remove-Item -LiteralPath $zipPath
 Expect-Refused 'missing portable ZIP'
} finally { Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue }
