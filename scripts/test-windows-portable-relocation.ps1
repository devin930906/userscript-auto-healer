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

  # TEST-028: the reusable move helper must not rename any path outside its
  # disposable runner namespace. Use a narrower, fake RUNNER_TEMP within the
  # real runner temp to test denial without touching any user-owned directory.
  $originalRunnerTemp=$env:RUNNER_TEMP
  $sandbox=Join-Path $root 'isolated-runner'
  New-Item -ItemType Directory -Path $sandbox | Out-Null
  try {
    $env:RUNNER_TEMP=$sandbox
    foreach($base in @(
      (Join-Path $root 'external'),
      (Join-Path $root 'isolated-runner-sibling')
    )) {
      $sourceOutside=Join-Path $base 'source'
      $destOutside=Join-Path $base 'moved'
      New-Item -ItemType Directory -Path $sourceOutside -Force | Out-Null
      $payload=Join-Path $sourceOutside 'preserve.txt'
      [IO.File]::WriteAllText($payload,'original-bytes')
      $blocked=$false
      try { Move-CandidatePortableDirectory $sourceOutside $destOutside 1 0 | Out-Null }
      catch [System.InvalidOperationException] {
        if($_.Exception.Message -notlike '*outside runner temp refused*') { throw }
        $blocked=$true
      }
      if(-not $blocked -or (Test-Path -LiteralPath $destOutside) -or
         -not (Test-Path -LiteralPath $payload -PathType Leaf) -or
         [IO.File]::ReadAllText($payload) -cne 'original-bytes') {
        throw 'Out-of-runner candidate move modified a source or destination'
      }
    }
    Write-Output 'PASS: outside runner temp and prefix-sibling paths cannot be moved'

    # TASK-020 / TEST-028: a lexical path under RUNNER_TEMP can escape through
    # a Windows junction. Reproduce entirely inside fresh disposable runner
    # directories; the junction target is OUTSIDE the nested fake RUNNER_TEMP.
    # An unsafe helper would rename a directory in the target instead.
    $junctionTarget=Join-Path $root 'disposable-external-junction-target'
    $externalSource=Join-Path $junctionTarget 'source'
    $externalDestination=Join-Path $junctionTarget 'moved'
    New-Item -ItemType Directory -Path $externalSource -Force | Out-Null
    $externalPayload=Join-Path $externalSource 'preserve.txt'
    [IO.File]::WriteAllText($externalPayload,'no-outside-rename')
    $junction=Join-Path $sandbox 'junction-to-outside'
    New-Item -ItemType Junction -Path $junction -Target $junctionTarget -ErrorAction Stop | Out-Null
    try {
      $reparseDenied=$false
      try {
        Move-CandidatePortableDirectory (Join-Path $junction 'source') (
          Join-Path $junction 'moved') 1 0 | Out-Null
      } catch [System.InvalidOperationException] {
        if($_.Exception.Message -notlike '*reparse point refused*') { throw }
        $reparseDenied=$true
      }
      if(-not $reparseDenied -or
         -not (Test-Path -LiteralPath $externalPayload -PathType Leaf) -or
         [IO.File]::ReadAllText($externalPayload) -cne 'no-outside-rename' -or
         (Test-Path -LiteralPath $externalDestination)) {
        throw 'Junction path escaped candidate runner and modified outside source'
      }
      Write-Output 'PASS: Windows junction cannot redirect candidate relocation outside runner temp'
    } finally {
      Remove-Item -LiteralPath $junction -Force -ErrorAction Stop
    }
    # A junction in an ANCESTOR of RUNNER_TEMP is outside the current guard's
    # runner-to-source walk. The lexical paths still appear under RUNNER_TEMP,
    # but the actual relocation would follow the ancestor junction.
    $parentTarget=Join-Path $root 'disposable-parent-junction-target'
    $nestedRunner=Join-Path $parentTarget 'nested-runner'
    $nestedSource=Join-Path $nestedRunner 'source'
    New-Item -ItemType Directory -Path $nestedSource -Force | Out-Null
    $nestedPayload=Join-Path $nestedSource 'preserve.txt'
    [IO.File]::WriteAllText($nestedPayload,'ancestor-must-not-rename')
    $parentJunction=Join-Path $root 'runner-parent-junction'
    New-Item -ItemType Junction -Path $parentJunction -Target $parentTarget -ErrorAction Stop | Out-Null
    try {
      $env:RUNNER_TEMP=Join-Path $parentJunction 'nested-runner'
      $ancestorDenied=$false
      try {
        Move-CandidatePortableDirectory (Join-Path $env:RUNNER_TEMP 'source') (
          Join-Path $env:RUNNER_TEMP 'moved') 1 0 | Out-Null
      } catch [System.InvalidOperationException] {
        if($_.Exception.Message -notlike '*reparse point refused*') { throw }
        $ancestorDenied=$true
      }
      if(-not $ancestorDenied -or
         -not (Test-Path -LiteralPath $nestedPayload -PathType Leaf) -or
         [IO.File]::ReadAllText($nestedPayload) -cne 'ancestor-must-not-rename' -or
         (Test-Path -LiteralPath (Join-Path $nestedRunner 'moved'))) {
        throw 'Junction ancestor of RUNNER_TEMP redirected candidate relocation'
      }
      Write-Output 'PASS: RUNNER_TEMP ancestor junction cannot redirect candidate relocation'
    } finally {
      $env:RUNNER_TEMP=$sandbox
      Remove-Item -LiteralPath $parentJunction -Force -ErrorAction Stop
    }
  } finally { $env:RUNNER_TEMP=$originalRunnerTemp }

  # The smoke parent may exit before its child/utility image. Wait for only
  # the exact owned candidate binary, and never kill or move it while live.
  # cmd.exe is copied into a fresh RUNNER_TEMP folder as a self-contained,
  # disposable test stand-in; no system or user process is modified.
  $ownedExe=Join-Path $root 'UserscriptAutoHealer.exe'
  Copy-Item -LiteralPath (Join-Path $env:SystemRoot 'System32\cmd.exe') -Destination $ownedExe -ErrorAction Stop
  $owned=Start-Process -FilePath $ownedExe -ArgumentList '/d /c "ping -n 5 127.0.0.1 >nul"' -PassThru -WindowStyle Hidden
  try {
    Start-Sleep -Milliseconds 200
    $owned.Refresh()
    if($owned.HasExited) { throw 'Disposable process fixture exited before ownership verification' }
    $refused=$false
    try { Wait-CandidatePortableProcessExit $ownedExe 1 0 | Out-Null }
    catch [System.InvalidOperationException] {
      if($_.Exception.Message -notlike '*did not exit before relocation*') { throw }
      $refused=$true
    }
    if(-not $refused) { throw 'Live candidate-owned executable was not blocked' }
    $null=Wait-Process -Id $owned.Id -Timeout 20 -ErrorAction Stop
    $checks=Wait-CandidatePortableProcessExit $ownedExe 3 100
    if($checks -lt 1) { throw 'Stopped owned executable remained live' }
    Write-Output 'PASS: candidate-owned process blocks move until natural exit'
  } finally {
    $owned.Refresh()
    # Cleanup is limited to the process started for THIS disposable test.
    if(-not $owned.HasExited) { Stop-Process -Id $owned.Id -Force -ErrorAction SilentlyContinue }
    $owned.Dispose()
  }
  $foreignExe=Join-Path $root 'not-the-candidate.exe'
  $outOfScope=$false
  try { Wait-CandidatePortableProcessExit $foreignExe 1 0 | Out-Null }
  catch [System.InvalidOperationException] { $outOfScope=$true }
  if(-not $outOfScope) { throw 'Process wait accepted a noncandidate executable' }
  Write-Output 'PASS: noncandidate executable path rejected'

  # A successful CIM query can return an image-name match with a hidden path.
  # The exact candidate identity is then unknowable; never return a false
  # "quiescent" receipt. Shadow CIM only in this local test scope.
  $opaqueRejected=& {
    function Get-CimInstance {
      param([string]$ClassName,[string]$Filter,[string]$ErrorAction)
      if($ClassName -cne 'Win32_Process' -or
         $Filter -cne "Name='UserscriptAutoHealer.exe'") {
        throw 'Unexpected candidate process query'
      }
      [pscustomobject]@{Name='UserscriptAutoHealer.exe';ExecutablePath=$null}
    }
    try {
      Wait-CandidatePortableProcessExit $ownedExe 1 0 | Out-Null
      return $false
    } catch [System.InvalidOperationException] {
      if($_.Exception.Message -notlike '*executable path unavailable*') { throw }
      return $true
    }
  }
  if(-not $opaqueRejected) {
    throw 'Hidden CIM executable path incorrectly cleared the relocation gate'
  }
  Write-Output 'PASS: redacted candidate-name process path refuses relocation'

  # A failing or redacted CIM owner query must produce explicit diagnostic
  # uncertainty without throwing and hiding a previous relocation error.
  $queryFailureTrace=& {
    function Get-CimInstance { throw 'Simulated CIM diagnostic query failure' }
    Write-CandidatePortableProcessSnapshot $ownedExe 'after relocation failure'
  }
  if($queryFailureTrace -cne 'DIAGNOSTIC: after relocation failure candidate owners: live=unknown unknownPath=unknown query=failed') {
    throw 'Candidate process tracing masked CIM failure instead of reporting uncertainty'
  }
  $opaqueTrace=& {
    function Get-CimInstance {
      [pscustomobject]@{ExecutablePath=$null}
    }
    Write-CandidatePortableProcessSnapshot $ownedExe 'after extracted smoke'
  }
  if($opaqueTrace -cne 'DIAGNOSTIC: after extracted smoke candidate owners: live=0 unknownPath=1 query=ok') {
    throw 'Candidate process tracing did not preserve redacted identity ambiguity'
  }
  Write-Output 'PASS: candidate diagnostics fail safely without masking relocation exceptions'

  # An access-denied rename needs a read-only snapshot taken AT the denial,
  # not just the earlier pre-move process check. Report exact candidate matches,
  # but never mistake an inaccessible process path for proof of exit.
  $ownerSnapshot=& {
    function Get-CimInstance {
      param([string]$ClassName,[string]$Filter,[string]$ErrorAction)
      if($ClassName -cne 'Win32_Process' -or
         $Filter -cne "Name='UserscriptAutoHealer.exe'") {
        throw 'Unexpected owner diagnostic query'
      }
      @(
        [pscustomobject]@{ExecutablePath=$ownedExe},
        [pscustomobject]@{ExecutablePath=(Join-Path $root 'other\UserscriptAutoHealer.exe')},
        [pscustomobject]@{ExecutablePath=$null}
      )
    }
    Get-CandidatePortableRelocationOwnerSummary $ownedExe
  }
  if($ownerSnapshot -cne 'live=1 unknownPath=1 query=ok') {
    throw 'Candidate owner snapshot failed to distinguish exact and ambiguous identities'
  }
  $failedOwnerSnapshot=& {
    function Get-CimInstance { throw 'Simulated CIM query failure' }
    Get-CandidatePortableRelocationOwnerSummary $ownedExe
  }
  if($failedOwnerSnapshot -cne 'live=unknown unknownPath=unknown query=failed') {
    throw 'Failed process query incorrectly reported no candidate owners'
  }
  Write-Output 'PASS: final-denial owner snapshot handles exact, opaque and failed CIM identity'

  # Holding the lock past the bounded retry window must fail, without
  # deleting, copying, overwriting or altering the original contents.
  $permanent=Join-Path $root 'permanently-locked'
  New-Item -ItemType Directory -Path $permanent | Out-Null
  $permanentFile=Join-Path $permanent 'payload.txt'
  [IO.File]::WriteAllText($permanentFile,'preserve-me')
  $locked=[IO.File]::Open($permanentFile,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::None)
  try {
    # Sharing evidence is read-only, never a reason to weaken Move's guard.
    $shareEvidence=Get-CandidatePortableFileShareSummary $permanent @($permanentFile)
    if($shareEvidence -cne 'scan=ok probed=1 blockedExamples=1 names=payload.txt') {
      throw "Locked disposable file was not identified by bounded share probe: $shareEvidence"
    }
    $outsideShare=Get-CandidatePortableFileShareSummary $permanent @(
      (Join-Path $root 'outside-scope.txt'))
    if($outsideShare -cne 'scan=unavailable') {
      throw 'Share probe accepted a path outside its candidate directory'
    }
    Write-Output 'PASS: file-sharing probe detects owned exclusive lock and rejects out-of-scope paths'
    $rejected=$false
    $rootFailure=$null
    try { Move-CandidatePortableDirectory $permanent (Join-Path $root 'should-not-exist') 2 50 | Out-Null }
    catch {
      $rootError=$_.Exception
      while($rootError.InnerException) { $rootError=$rootError.InnerException }
      $code=$rootError.HResult -band 0xFFFF
      if(($rootError -isnot [System.IO.IOException] -and
          $rootError -isnot [System.UnauthorizedAccessException]) -or
          $code -notin @(5,32,33)) { throw }
      $rootFailure=$rootError
      $rejected=$true
    }
    if(-not $rejected -or (Test-Path -LiteralPath (Join-Path $root 'should-not-exist'))) {
      throw 'Persistent Windows file lock did not fail closed'
    }
    # Validate the production formatter against the actual Windows exception,
    # with a fixed clock so the record can be independently asserted.
    $fixedUtc=[DateTime]::new(2026,10,21,3,12,0,[DateTimeKind]::Utc)
    $record=Format-CandidatePortableRelocationFailure 2 2 $rootFailure $true $false $fixedUtc
    $expected=("TASK-020 relocation attempt 2/2 UTC=2026-10-21T03:12:00.000Z type={0} HRESULT=0x{1:X8} Win32={2} sourceExists=True destinationExists=False" -f
      $rootFailure.GetType().Name,$rootFailure.HResult,$code)
    if($record -cne $expected) {
      throw 'Windows relocation diagnostic formatter lost the HRESULT, attempt or state'
    }
    Write-Output "PASS: Windows lock diagnostic recorded HRESULT and Win32=$code without full paths"
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
