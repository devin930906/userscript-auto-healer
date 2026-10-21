# TASK-020 / REQ-028 / TEST-028: Windows-only relocation regression.
# Operates solely on fresh, disposable runner temp directories. No user data.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$root=Join-Path $env:RUNNER_TEMP ("uah-relocation-test-"+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $root -ErrorAction Stop | Out-Null
try {
  # Red scenario: the old direct Move-Item really fails for a Windows
  # directory containing a file opened without FILE_SHARE_DELETE.
  $direct=Join-Path $root 'direct-source'
  New-Item -ItemType Directory -Path $direct | Out-Null
  $directFile=Join-Path $direct 'locked.txt'
  [IO.File]::WriteAllText($directFile,'original')
  $open=[IO.File]::Open($directFile,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
  try {
    $directFailed=$false
    try { Move-Item -LiteralPath $direct -Destination (Join-Path $root 'direct-moved') -ErrorAction Stop }
    catch [System.IO.IOException] { $directFailed=$true }
    if(-not $directFailed) { throw 'TEST-028 setup failed to reproduce Windows sharing violation' }
    if(-not (Test-Path -LiteralPath $directFile -PathType Leaf) -or
       (Test-Path -LiteralPath (Join-Path $root 'direct-moved'))) {
      throw 'Direct failed move unexpectedly modified the test directory'
    }
  } finally { $open.Dispose() }
  Write-Output 'PASS: real Windows exclusive file lock rejects old direct Move-Item'

  . (Join-Path $PSScriptRoot 'windows-portable-relocation.ps1')

  # Holding the lock past the bounded retry window must fail, without
  # deleting, copying, overwriting or altering the original contents.
  $permanent=Join-Path $root 'permanently-locked'
  New-Item -ItemType Directory -Path $permanent | Out-Null
  $permanentFile=Join-Path $permanent 'payload.txt'
  [IO.File]::WriteAllText($permanentFile,'preserve-me')
  $locked=[IO.File]::Open($permanentFile,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::None)
  try {
    $rejected=$false
    try { Move-CandidatePortableDirectory $permanent (Join-Path $root 'should-not-exist') 2 50 | Out-Null }
    catch [System.IO.IOException] { $rejected=$true }
    if(-not $rejected -or (Test-Path -LiteralPath (Join-Path $root 'should-not-exist')) -or
       [IO.File]::ReadAllText($permanentFile) -cne 'preserve-me') {
      throw 'Persistent Windows file lock did not fail closed'
    }
  } finally { $locked.Dispose() }
  Write-Output 'PASS: persistent lock blocks relocation without altering payload'

  # Never overwrite another relocated copy, even if the source is valid.
  $source=Join-Path $root 'unmoved-source'
  $existing=Join-Path $root 'existing-destination'
  New-Item -ItemType Directory -Path $source,$existing | Out-Null
  [IO.File]::WriteAllText((Join-Path $source 'source.txt'),'source-data')
  [IO.File]::WriteAllText((Join-Path $existing 'existing.txt'),'do-not-touch')
  $noOverwrite=$false
  try { Move-CandidatePortableDirectory $source $existing 2 50 | Out-Null }
  catch [System.InvalidOperationException] { $noOverwrite=$true }
  if(-not $noOverwrite -or
      [IO.File]::ReadAllText((Join-Path $existing 'existing.txt')) -cne 'do-not-touch' -or
      [IO.File]::ReadAllText((Join-Path $source 'source.txt')) -cne 'source-data') {
    throw 'Existing destination protection failed'
  }
  Write-Output 'PASS: existing destination is never replaced'

  # A separate Windows process temporarily denies delete-sharing; the helper
  # must retry ONLY until the lease is released, then perform one real move.
  $temporary=Join-Path $root 'temporary-source'
  $moved=Join-Path $root 'relocated portable 路径'
  $marker=Join-Path $root 'lock-ready.txt'
  New-Item -ItemType Directory -Path $temporary | Out-Null
  $temporaryFile=Join-Path $temporary 'payload.txt'
  [IO.File]::WriteAllText($temporaryFile,'exact-content')
  $job=Start-Job -ScriptBlock {
    param($path,$ready)
    $handle=[IO.File]::Open($path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::None)
    try {
      [IO.File]::WriteAllText($ready,'ready')
      Start-Sleep -Milliseconds 1100
    } finally { $handle.Dispose() }
  } -ArgumentList $temporaryFile,$marker
  try {
    $deadline=[DateTime]::UtcNow.AddSeconds(15)
    while(-not (Test-Path -LiteralPath $marker -PathType Leaf)) {
      if($job.State -in @('Failed','Stopped','Completed') -or
         [DateTime]::UtcNow -ge $deadline) {
        throw 'Windows locking process did not establish the expected test lock'
      }
      Start-Sleep -Milliseconds 50
    }
    $attempts=Move-CandidatePortableDirectory $temporary $moved 12 200
    if($attempts -lt 2 -or (Test-Path -LiteralPath $temporary) -or
        [IO.File]::ReadAllText((Join-Path $moved 'payload.txt')) -cne 'exact-content') {
      throw 'Transient lock recovery or relocated payload verification failed'
    }
    Write-Output "PASS: Windows transient lock resolved after $attempts bounded attempts"
  } finally {
    $null=Wait-Job -Job $job -Timeout 15
    if($job.State -eq 'Running') { Stop-Job -Job $job -ErrorAction SilentlyContinue }
    Receive-Job -Job $job -ErrorAction Stop | Out-Null
    Remove-Job -Job $job -Force -ErrorAction SilentlyContinue
  }
} finally {
  Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}
