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
    # Move-Item may partially create a destination before reporting failure;
    # this is exactly why retrying Move-Item itself would be unsafe.
    Write-Output ("OBSERVED: old Move-Item failed; sourceExists="+
      (Test-Path -LiteralPath $direct)+"; destinationExists="+
      (Test-Path -LiteralPath (Join-Path $root 'direct-moved')))
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
    # WarningVariable on a terminating function invocation is scoped to that
    # invocation and need not survive its throw. Capture PowerShell stream 4
    # outside an inner catch instead, so all emitted records remain testable.
    $script:relocationLockError=$null
    $conflictWarnings=@(& {
      try { Move-CandidatePortableDirectory $permanent (Join-Path $root 'should-not-exist') 2 50 | Out-Null }
      catch { $script:relocationLockError=$_ }
    } 4>&1)
    if($null -ne $script:relocationLockError) {
      $rootError=$script:relocationLockError.Exception
      while($rootError.InnerException) { $rootError=$rootError.InnerException }
      $code=$rootError.HResult -band 0xFFFF
      if(($rootError -isnot [System.IO.IOException] -and
          $rootError -isnot [System.UnauthorizedAccessException]) -or
          $code -notin @(5,32,33)) { throw $script:relocationLockError }
      $rejected=$true
    }
    if(-not $rejected -or (Test-Path -LiteralPath (Join-Path $root 'should-not-exist'))) {
      throw 'Persistent Windows file lock did not fail closed'
    }
    # Verify both bounded failures are explainable from CI logs, including
    # the true Windows HRESULT/Win32 code and time, without logging paths.
    if($conflictWarnings.Count -ne 2) {
      throw 'Expected one structured Windows relocation diagnostic per failed attempt'
    }
    for($n=1; $n -le 2; $n++) {
      $diagnostic=[string]$conflictWarnings[$n-1].Message
      if($diagnostic -notmatch "TASK-020 relocation attempt $n/2 UTC=\d{4}-\d{2}-\d{2}T" -or
         $diagnostic -notmatch 'HRESULT=0x[0-9A-Fa-f]{8} Win32=(5|32|33) ' -or
         $diagnostic -notmatch 'sourceExists=True destinationExists=False') {
        throw "Windows relocation attempt $n missing structured fail-closed diagnostics"
      }
    }
  } finally { $locked.Dispose() }
  if(-not (Test-Path -LiteralPath $permanentFile -PathType Leaf) -or
      [IO.File]::ReadAllText($permanentFile) -cne 'preserve-me') {
    throw 'Persistent Windows file lock modified original payload'
  }
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
