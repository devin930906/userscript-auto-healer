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

  # ISSUE-215 / TEST-028: cold move the real ZIP payload before running its
  # executable, then keep both extracted and relocated Windows shell smokes.
  # The actual packaging job still validates hashes and launches the EXE.
  $packageScript=[IO.File]::ReadAllText(
    (Join-Path $PSScriptRoot 'windows-package-candidate.ps1'))
  $verified=$packageScript.IndexOf('PASS: complete ZIP file manifest and SHA-256 round trip')
  $movedAt=$packageScript.IndexOf('Move-CandidatePortableDirectory $expanded $moved')
  $externalCwd=$packageScript.IndexOf(
    'Smoke (Join-Path $expanded '+ "'UserscriptAutoHealer.exe') " + '$temp '+ "'extracted'")
  $relocatedCwd=$packageScript.IndexOf(
    'Smoke (Join-Path $expanded '+ "'UserscriptAutoHealer.exe') " + '$expanded '+ "'relocated'")
  $postUseMove=$packageScript.IndexOf('Move-CandidatePortableDirectory $expanded $postUse')
  $postUseSmoke=$packageScript.IndexOf(
    'Smoke (Join-Path $expanded '+ "'UserscriptAutoHealer.exe') " + '$expanded '+ "('after-use-'+`$postUseCycle)")
  $postUseWait=$packageScript.IndexOf(
    'Wait-CandidatePortableProcessExit (Join-Path $expanded '+ "'UserscriptAutoHealer.exe')",
    $relocatedCwd)
  $readonly=$packageScript.IndexOf("'extracted-readonly'")
  if($verified -lt 0 -or $movedAt -le $verified -or
     $externalCwd -le $movedAt -or $relocatedCwd -le $externalCwd -or
     $postUseWait -le $relocatedCwd -or $postUseMove -le $postUseWait -or
     $postUseSmoke -le $postUseMove -or $readonly -le $postUseSmoke) {
    throw 'TEST-028: verified ZIP must move cold, then move after-use once quiescent and restart'
  }
  # Win32=5 persisted beyond the former 12 x 250ms budget. Keep the
  # post-use atomic move and use a bounded grace, never bypassing a denial.
  if($packageScript -notmatch 'Move-CandidatePortableDirectory\s+\$expanded\s+\$postUse\s+16\s+750\s+@\(') {
    throw 'TEST-028: post-use relocation must retain bounded external-user grace'
  }
  Write-Output 'PASS: candidate ZIP supports cold move and mandatory post-use move/restart ordering with bounded grace'
  # ISSUE-215: prevent reintroducing a second Wait-Process PID-based
  # handle after Start-Process already returned an owned Process instance.
  # The same instance must wait and release its handle before directory moves.
  $smokeStart=$packageScript.IndexOf('function Smoke(')
  $smokeEnd=$packageScript.IndexOf('$root=', $smokeStart)
  if($smokeStart -lt 0 -or $smokeEnd -le $smokeStart) {
    throw 'TEST-028: candidate smoke function boundaries unavailable'
  }
  $smokeBody=$packageScript.Substring($smokeStart,$smokeEnd-$smokeStart)
  if(-not $smokeBody.Contains('$p.WaitForExit(90000)') -or
     $smokeBody -match 'Wait-Process\s+-Id\s+\$p\.Id' -or
     -not $smokeBody.Contains('$p.Dispose()')) {
    throw 'TEST-028: candidate smoke must wait and dispose its single owned process handle'
  }
  Write-Output 'PASS: smoke uses one owned process wait/Dispose lifetime (not separate PID wait)'


  # TEST-028: the reusable move helper must not rename any path outside its
  # disposable runner namespace. Use a narrower, fake RUNNER_TEMP within the
  # real runner temp to test denial without touching any user-owned directory.
  $originalRunnerTemp=$env:RUNNER_TEMP
  $sandbox=Join-Path $root 'isolated-runner'
  New-Item -ItemType Directory -Path $sandbox | Out-Null
  try {
    $env:RUNNER_TEMP=$sandbox
    # TEST-028: a relative RUNNER_TEMP must never be silently resolved
    # against the process working directory as an authority to rename files.
    # Even absolute source/destination paths must fail closed in this case.
    $relativeSource=Join-Path $sandbox 'relative-temp-source'
    $relativeMoved=Join-Path $sandbox 'relative-temp-moved'
    New-Item -ItemType Directory -Path $relativeSource | Out-Null
    $relativePayload=Join-Path $relativeSource 'preserve.txt'
    [IO.File]::WriteAllText($relativePayload,'untouched')
    # An untrusted relative runner path can resolve to this very sandbox
    # under a chosen working directory. Even then, diagnostics must refuse.
    $candidateForWait=Join-Path $relativeSource 'UserscriptAutoHealer.exe'
    Push-Location -LiteralPath $root
    try {
      $env:RUNNER_TEMP='isolated-runner'
      $waitDenied=$false
      try { Wait-CandidatePortableProcessExit $candidateForWait 1 0 | Out-Null }
      catch [System.InvalidOperationException] {
        if($_.Exception.Message -notlike '*fully qualified runner paths*') { throw }
        $waitDenied=$true
      }
      if(-not $waitDenied) {
        throw 'Relative RUNNER_TEMP incorrectly authorized candidate process wait'
      }
      $control=Get-CandidatePortableSiblingRenameControl $relativeSource
      if($control -cne 'control=unavailable') {
        throw ('Relative RUNNER_TEMP incorrectly permitted sibling rename probe: '+$control)
      }
      if(@(Get-ChildItem -LiteralPath $sandbox -Directory -Filter 'uah-empty-rename-control-*').Count -gt 0) {
        throw 'Invalid runner path left a diagnostic rename control directory'
      }
    } finally { $env:RUNNER_TEMP=$sandbox; Pop-Location }
    Write-Output 'PASS: candidate process and rename diagnostics reject cwd-resolved runner temp'
    $relativeTempBlocked=$false
    try {
      $env:RUNNER_TEMP='relative-runner-temp'
      try { Move-CandidatePortableDirectory $relativeSource $relativeMoved 1 0 | Out-Null }
      catch [System.InvalidOperationException] {
        if($_.Exception.Message -notlike '*requires absolute runner temp paths*') { throw }
        $relativeTempBlocked=$true
      }
    } finally { $env:RUNNER_TEMP=$sandbox }
    if(-not $relativeTempBlocked -or (Test-Path -LiteralPath $relativeMoved) -or
       -not (Test-Path -LiteralPath $relativePayload -PathType Leaf) -or
       [IO.File]::ReadAllText($relativePayload) -cne 'untouched') {
      throw 'Relative RUNNER_TEMP allowed unsafe candidate relocation'
    }
    Write-Output 'PASS: relative RUNNER_TEMP is rejected before any candidate relocation'
    # IsPathRooted accepts Windows current-drive-relative and drive-relative
    # spellings. They must not become trusted absolute relocation authorities.
    $driveRoot=[IO.Path]::GetPathRoot($sandbox)
    if($driveRoot.Length -ne 3 -or [string]$driveRoot[1] -cne ':' -or
       [string]$driveRoot[2] -cne [string][IO.Path]::DirectorySeparatorChar) {
      throw 'TEST-028 requires a Windows drive-backed disposable runner'
    }
    $rootRelativeSandbox=[string][IO.Path]::DirectorySeparatorChar + $sandbox.Substring($driveRoot.Length)
    $rootRelativeSource=[string][IO.Path]::DirectorySeparatorChar + $relativeSource.Substring($driveRoot.Length)
    $rootRelativeMoved=[string][IO.Path]::DirectorySeparatorChar + $relativeMoved.Substring($driveRoot.Length)
    $driveRelativeSandbox=$driveRoot.Substring(0,2) + $sandbox.Substring($driveRoot.Length)
    $driveRelativeSource=$driveRoot.Substring(0,2) + $relativeSource.Substring($driveRoot.Length)
    $driveRelativeMoved=$driveRoot.Substring(0,2) + $relativeMoved.Substring($driveRoot.Length)
    foreach($case in @(
      @{ name='runner-root-relative'; runner=$rootRelativeSandbox; from=$relativeSource; to=$relativeMoved },
      @{ name='source-root-relative'; runner=$sandbox; from=$rootRelativeSource; to=$relativeMoved },
      @{ name='destination-root-relative'; runner=$sandbox; from=$relativeSource; to=$rootRelativeMoved },
      @{ name='runner-drive-relative'; runner=$driveRelativeSandbox; from=$relativeSource; to=$relativeMoved },
      @{ name='source-drive-relative'; runner=$sandbox; from=$driveRelativeSource; to=$relativeMoved },
      @{ name='destination-drive-relative'; runner=$sandbox; from=$relativeSource; to=$driveRelativeMoved }
    )) {
      $blocked=$false
      try {
        $env:RUNNER_TEMP=$case.runner
        try { Move-CandidatePortableDirectory $case.from $case.to 1 0 | Out-Null }
        catch [System.InvalidOperationException] {
          if($_.Exception.Message -notlike '*requires absolute runner temp paths*') { throw }
          $blocked=$true
        }
      } finally { $env:RUNNER_TEMP=$sandbox }
      if(-not $blocked -or (Test-Path -LiteralPath $relativeMoved) -or
         -not (Test-Path -LiteralPath $relativePayload -PathType Leaf) -or
         [IO.File]::ReadAllText($relativePayload) -cne 'untouched') {
        throw ('Ambiguous Windows rooted path changed candidate state: '+$case.name)
      }
    }
    Write-Output 'PASS: six ambiguous Windows rooted relocation path inputs rejected'
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
    # ISSUE-215 / TEST-028: a caller promoting warnings must still receive
    # the authoritative bounded candidate-live error, not a warning exception.
    # The real disposable Windows process remains alive during this check.
    $oldWaitWarningPreference=$WarningPreference
    try {
      $WarningPreference='Stop'
      $liveDenialPreserved=$false
      try { Wait-CandidatePortableProcessExit $ownedExe 1 0 | Out-Null }
      catch [System.InvalidOperationException] {
        if($_.Exception.Message -notlike '*did not exit before relocation*') { throw }
        $liveDenialPreserved=$true
      }
      if(-not $liveDenialPreserved) {
        throw 'TEST-028: warning promotion replaced the live-candidate refusal'
      }
    } finally { $WarningPreference=$oldWaitWarningPreference }
    Write-Output 'PASS: candidate process wait preserves live-process refusal under warning escalation'
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

  # ISSUE-215 / TEST-028: a same-parent rename of a fresh EMPTY disposable
  # sibling distinguishes runner/parent rename failure from a candidate-specific
  # refusal. A control must never move, inspect or delete the payload tree.
  $controlParent=Join-Path $root 'sibling-control-parent'
  $controlSource=Join-Path $controlParent 'actual-payload'
  New-Item -ItemType Directory -Path $controlSource -Force | Out-Null
  $controlPayload=Join-Path $controlSource 'original.txt'
  [IO.File]::WriteAllText($controlPayload,'still-original')
  $controlStatus=Get-CandidatePortableSiblingRenameControl $controlSource
  if($controlStatus -cne 'control=move-ok' -or
     -not (Test-Path -LiteralPath $controlPayload -PathType Leaf) -or
     [IO.File]::ReadAllText($controlPayload) -cne 'still-original' -or
     @(Get-ChildItem -LiteralPath $controlParent -Force).Count -ne 1) {
    throw "Disposable sibling control changed original files or leaked a probe: $controlStatus"
  }
  $originalTemp=$env:RUNNER_TEMP
  try {
    $env:RUNNER_TEMP=Join-Path $root 'narrow-control-sandbox'
    New-Item -ItemType Directory -Path $env:RUNNER_TEMP | Out-Null
    $foreignStatus=Get-CandidatePortableSiblingRenameControl $controlSource
  } finally { $env:RUNNER_TEMP=$originalTemp }
  if($foreignStatus -cne 'control=unavailable' -or
     [IO.File]::ReadAllText($controlPayload) -cne 'still-original' -or
     @(Get-ChildItem -LiteralPath $controlParent -Force).Count -ne 1) {
    throw 'Sibling control accepted a path outside RUNNER_TEMP'
  }
  Write-Output 'PASS: same-parent empty sibling move diagnostics preserve payload and deny out-of-scope paths'
  # ISSUE-215: ACL/attribute metadata must be read-only and path-redacted.
  # A clear ACL snapshot is only evidence, not proof that rename is possible.
  $aclEvidence=Get-CandidatePortableRenameAclSummary $controlSource
  if($aclEvidence -notmatch '^acl=ok root=\[denies=\d+ protected=(True|False) readonly=(True|False)\] parent=\[denies=\d+ protected=(True|False) readonly=(True|False)\]$' -or
     $aclEvidence.Contains($controlSource) -or
     [IO.File]::ReadAllText($controlPayload) -cne 'still-original') {
    throw "Candidate ACL diagnostics changed payload or returned invalid evidence: $aclEvidence"
  }
  $outsideAcl=Get-CandidatePortableRenameAclSummary (Join-Path $root 'outside-unknown')
  if($outsideAcl -cne 'acl=unavailable') { throw 'ACL diagnostic accepted unknown candidate path' }
  $aclFailure=& {
    function Get-Acl { throw 'Simulated read-only ACL query failure' }
    Get-CandidatePortableRenameAclSummary $controlSource
  }
  if($aclFailure -cne 'acl=unavailable') {
    throw 'Failed ACL query was misrepresented as successful evidence'
  }
  Write-Output 'PASS: candidate-only ACL metadata diagnostic is bounded, path-redacted and fail closed'


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
    if($shareEvidence -notlike 'scan=ok probed=1 blockedExamples=1 names=payload.txt:Win32=*') {
      throw "Locked disposable file was not identified by bounded share probe: $shareEvidence"
    }
    $outsideShare=Get-CandidatePortableFileShareSummary $permanent @(
      (Join-Path $root 'outside-scope.txt'))
    if($outsideShare -cne 'scan=unavailable stage=manifest-scope') {
      throw 'Share probe did not distinguish out-of-scope input without exposing a path'
    }
    # ISSUE-215: the real post-Electron failure currently reports
    # scan=unavailable, discarding the stage needed to locate the limitation.
    # Force a read-only enumeration failure without changing candidate files;
    # diagnostic exceptions must never leak arbitrary error strings or paths.
    $enumerationUnavailable=& {
      function Get-ChildItem { throw 'DO-NOT-LEAK-disposable-secret-path' }
      Get-CandidatePortableFileShareSummary $permanent @($permanentFile)
    }
    if($enumerationUnavailable -cne 'scan=unavailable stage=enumeration' -or
       $enumerationUnavailable.Contains('DO-NOT-LEAK')) {
      throw "Share probe must report bounded enumeration failure stage: $enumerationUnavailable"
    }
    Write-Output 'PASS: file-sharing probe distinguishes rejected scope from enumeration failure without exposing paths'
    # ISSUE-215: Restart Manager can observe processes using candidate
    # files even when the candidate executable process list is empty.
    # Counts only, no process names or PIDs, and never stop a process.
    $rmLocked=Get-CandidatePortableRestartManagerSummary $permanent @($permanentFile)
    # Windows Restart Manager publicly documents these application categories.
    # A nonempty genuine file lock must be classified without logging any
    # process identifiers, names, paths or caller-owned handles.
    $rmPattern='^rm=ok sampled=1 total=1 affected=([0-9]+) types=\[window=([0-9]+) service=([0-9]+) explorer=([0-9]+) console=([0-9]+) critical=([0-9]+) unknown=([0-9]+)\] self=([0-9]+) images=\[candidate=([0-9]+) consoleHost=([0-9]+) shell=([0-9]+) node=([0-9]+) runner=([0-9]+) other=([0-9]+) unknown=([0-9]+)\] tools=\[command=([0-9]+) explorer=([0-9]+) dllHost=([0-9]+) runDll=([0-9]+) crash=([0-9]+) compat=([0-9]+) security=([0-9]+) compiler=([0-9]+) serviceHost=([0-9]+)\] imageScope=\[candidateTree=([0-9]+) runnerOther=([0-9]+) outsideRunner=([0-9]+) unknown=([0-9]+)\] ageBuckets=\[recent=([0-9]+) established=([0-9]+) unknown=([0-9]+)\]$'
    if($rmLocked -cmatch $rmPattern) {
      $affected=[int]$Matches[1]
      $classified=0
      foreach($kind in 2..7) { $classified+=[int]$Matches[$kind] }
      if($affected -lt 1 -or $classified -ne $affected) {
        throw 'Restart Manager affected-type classification does not match its process count'
      }
      # Image categories are allowlisted labels, never arbitrary names/PIDs.
      # This actual lock must resolve to a time-matched PowerShell image.
      $images=0
      foreach($kind in 9..15) { $images+=[int]$Matches[$kind] }
      $knownTools=0
      foreach($kind in 16..24) { $knownTools+=[int]$Matches[$kind] }
      if($knownTools -gt [int]$Matches[14]) {
        throw 'Restart Manager tool-family subset exceeds other-image owners'
      }
      $imageScoped=0
      foreach($kind in 25..28) { $imageScoped+=[int]$Matches[$kind] }
      if($images -ne $affected -or $imageScoped -ne $affected -or
         [int]$Matches[11] -lt 1 -or [int]$Matches[27] -lt 1) {
        throw 'Restart Manager did not scope its time-matched external PowerShell image'
      }
      # A real RM process start time must map to exactly one anonymous age
      # bucket; this does not disclose process IDs, names or precise times.
      $ages=0
      foreach($kind in 29..31) { $ages+=[int]$Matches[$kind] }
      if($ages -ne $affected -or
         ([int]$Matches[29]+[int]$Matches[30]) -lt 1) {
        throw 'Restart Manager lost process start-age classification'
      }
      # This file handle was opened by THIS pwsh.exe process in this test.
      # The PID must never be emitted; identity is checked within the probe.
      if([int]$Matches[8] -ne 1) {
        throw 'Restart Manager did not identify the current process as the fixture file owner'
      }
    } else {
      throw "Restart Manager missed classified disposable lock evidence: $rmLocked"
    }
    # ISSUE-215: batch-level RM process counts cannot identify which candidate
    # member has the association. A single true external-process file lock
    # must be attributable to its file KIND without exposing names or PIDs.
    $perFile=Get-CandidatePortableRmFileAssociationSummary $permanent @($permanentFile)
    if($perFile -cne 'rmFiles=ok sampled=1 associated=1 kinds=[exe=0 library=0 other=1] outsideRunnerAssociated=1' -or
       $perFile.Contains($permanentFile) -or $perFile.Contains($root)) {
      throw "TEST-028: RM single-file association must preserve anonymous lock evidence: $perFile"
    }
    $perFileOutOfScope=Get-CandidatePortableRmFileAssociationSummary $permanent @(
      (Join-Path $root 'out-of-scope-file.txt'))
    if($perFileOutOfScope -cne 'rmFiles=unavailable') {
      throw 'TEST-028: per-file RM probe crossed the candidate-only boundary'
    }
    Write-Output 'PASS: Restart Manager isolates an associated candidate file kind without names or PIDs'
    $rmOutside=Get-CandidatePortableRestartManagerSummary $permanent @(
      (Join-Path $root 'outside-scope.txt'))
    if($rmOutside -cne 'rm=unavailable') {
      throw 'Restart Manager accepted an out-of-candidate path'
    }
    $rmDirectory=Get-CandidatePortableRestartManagerSummary $permanent @($permanent)
    if($rmDirectory -cne 'rm=unavailable') {
      throw 'Restart Manager accepted a directory instead of a file'
    }
    Write-Output 'PASS: Restart Manager observes a real Windows lock with candidate-only read scope'
    # ISSUE-215: a real exclusive lock at the END of a 41-file manifest.
    # The original first-40-file RM sample cannot see this lock.
    $batchRoot=Join-Path $root 'rm-later-batch'
    New-Item -ItemType Directory -Path $batchRoot -ErrorAction Stop | Out-Null
    $batchFiles=@(1..41 | ForEach-Object {
      $path=Join-Path $batchRoot ("fixture-{0:D3}.txt" -f $_)
      [IO.File]::WriteAllText($path,'disposable')
      $path
    })
    $tailHandle=[IO.File]::Open($batchFiles[40],[IO.FileMode]::Open,
      [IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
    try {
      $batchRm=Get-CandidatePortableRestartManagerSummary $batchRoot $batchFiles
      if($batchRm -cnotmatch 'coverage=\[batches=2 sampled=41 total=41 complete=true extraAffectedObservations=([0-9]+) unavailableBatches=0\]' -or
         [int]$Matches[1] -lt 1 -or
         $batchRm.Contains($batchRoot)) {
        throw 'Restart Manager did not observe exclusively locked last candidate file in later batch'
      }
      # RED TASK-020/TEST-028: an association exclusively in the next
      # 40-file RM batch must reach the privacy-safe per-file diagnostic.
      # The first 40 have NO associated process; this is real Win32 sharing.
      $tailAssociation=Get-CandidatePortableRmFileAssociationSummary $batchRoot $batchFiles
      $expectedTail='rmFiles=ok sampled=1 associated=1 kinds=[exe=0 library=0 other=1] outsideRunnerAssociated=1 scannedBatches=2 totalFiles=41'
      if($tailAssociation -cne $expectedTail -or
         $tailAssociation.Contains($batchRoot) -or
         $tailAssociation.Contains($batchFiles[40])) {
        throw "TEST-028 later-batch RM association was not independently narrowed: $tailAssociation"
      }
      $tailDenial=Get-CandidatePortableFirstDenialSummary $batchRoot $batchFiles
      if(-not $tailDenial.Contains("fileAssociations=[$expectedTail]") -or
         $tailDenial.Contains($batchRoot) -or $tailDenial.Contains($batchFiles[40])) {
        throw 'TEST-028 first-denial diagnostics silently skipped later-batch RM association'
      }
    } finally { $tailHandle.Dispose() }
    Write-Output 'PASS: bounded Restart Manager batches inspect later candidate file locks without leaking paths'
    # Even a transient first denial must carry evidence before a later move
    # might succeed. Reuse only this fixture's known file manifest.
    $firstDenial=Get-CandidatePortableFirstDenialSummary $permanent @($permanentFile)
    if(-not $firstDenial.Contains('sharing=[scan=ok probed=1 blockedExamples=1 names=payload.txt:Win32=') -or
       -not $firstDenial.Contains('sibling=[control=move-ok]') -or
       @((Get-ChildItem -LiteralPath $root -Recurse -Directory -Force) |
          Where-Object { $_.Name -like 'uah-empty-rename-control-*' }).Count -ne 0) {
      throw "First-denial diagnostic missed actual file lock or leaked temporary control: $firstDenial"
    }
    Write-Output 'PASS: first relocation denial records candidate file lock and sibling control without changing payload'
    $rejected=$false
    $rootFailure=$null
    try { Move-CandidatePortableDirectory $permanent (Join-Path $root 'should-not-exist') 2 50 @($permanentFile) | Out-Null }
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

    # ISSUE-215 / TEST-028: a read-only failure-evidence collector is
    # best-effort. A fault in it must not replace the real Windows rename
    # access-denied error, shorten the bound, or alter original bytes.
    $originalFirstDenial=(Get-Item 'Function:\Get-CandidatePortableFirstDenialSummary').ScriptBlock
    $diagnosticFaultDestination=Join-Path $root 'diagnostic-fault-move'
    try {
      Set-Item 'Function:\Get-CandidatePortableFirstDenialSummary' -Value {
        param([string]$source,[string[]]$candidateFiles)
        throw [InvalidOperationException]::new('TEST-028 injected diagnostic fault')
      }
      $preservedOriginal=$false
      try {
        Move-CandidatePortableDirectory $permanent $diagnosticFaultDestination 1 0 @($permanentFile) | Out-Null
      } catch {
        $actual=$_.Exception
        while($actual.InnerException) { $actual=$actual.InnerException }
        if(($actual -is [System.IO.IOException] -or
            $actual -is [System.UnauthorizedAccessException]) -and
           (($actual.HResult -band 0xFFFF) -in @(5,32,33))) {
          $preservedOriginal=$true
        } else { throw }
      }
      if(-not $preservedOriginal -or
         (Test-Path -LiteralPath $diagnosticFaultDestination) -or
         -not (Test-Path -LiteralPath $permanentFile -PathType Leaf)) {
        throw 'A failing read-only diagnostic replaced the original Win32 error or changed the payload'
      }
      Write-Output 'PASS: diagnostic failure preserves original Windows rename exception and payload'
    } finally {
      Set-Item 'Function:\Get-CandidatePortableFirstDenialSummary' -Value $originalFirstDenial
    }

    # TASK-020 / TEST-028: PowerShell callers may promote warnings to
    # terminating errors. Diagnostic warnings must never replace the original
    # .NET rename denial or cause candidate bytes to be changed.
    $previousWarningPreference=$WarningPreference
    try {
      $WarningPreference='Stop'
      $warningStopDestination=Join-Path $root 'warning-stop-destination'
      $originalRenameDenial=$false
      try {
        Move-CandidatePortableDirectory $permanent $warningStopDestination 1 0 @($permanentFile) | Out-Null
      } catch {
        $cause=$_.Exception
        while($cause.InnerException) { $cause=$cause.InnerException }
        $originalRenameDenial=(
          ($cause -is [System.IO.IOException] -or
           $cause -is [System.UnauthorizedAccessException]) -and
          (($cause.HResult -band 0xFFFF) -in @(5,32,33)))
      }
      if(-not $originalRenameDenial -or
         (Test-Path -LiteralPath $warningStopDestination) -or
         -not (Test-Path -LiteralPath $permanentFile -PathType Leaf)) {
        throw 'TEST-028: WarningPreference Stop masked the original Windows rename denial'
      }
    } finally { $WarningPreference=$previousWarningPreference }
    Write-Output 'PASS: warning promotion does not mask the original Windows rename denial'
  } finally { $locked.Dispose() }
  if(-not (Test-Path -LiteralPath $permanentFile -PathType Leaf) -or
      [IO.File]::ReadAllText($permanentFile) -cne 'preserve-me') {
    throw 'Persistent Windows file lock modified original payload'
  }
  Write-Output 'PASS: persistent lock blocks relocation without altering payload'

  # A real executable loaded from a disposable runner directory must be
  # distinguished from the exact candidate path. Do not log its PID or path.
  $commandRoot=Join-Path $root 'classification-command'
  New-Item -ItemType Directory -Path $commandRoot | Out-Null
  $commandExe=Join-Path $commandRoot 'cmd.exe'
  Copy-Item -LiteralPath (Join-Path $env:SystemRoot 'System32\\cmd.exe') -Destination $commandExe
  $commandHash=(Get-FileHash -LiteralPath $commandExe -Algorithm SHA256).Hash
  $commandProcess=Start-Process -FilePath $commandExe -ArgumentList '/d /c "ping -n 8 127.0.0.1 >nul"' -NoNewWindow -PassThru
  try {
    Start-Sleep -Milliseconds 200
    if($commandProcess.HasExited) { throw 'Command classification fixture exited prematurely' }
    $commandEvidence=Get-CandidatePortableRestartManagerSummary $commandRoot @($commandExe)
    if($commandEvidence -notlike '*images=[[]candidate=0 *' -or
       $commandEvidence -notlike '*tools=[[]command=1 *' -or
        $commandEvidence -notlike '*imageScope=[[]candidateTree=1 runnerOther=0 outsideRunner=0 unknown=0[]]*' -or
       $commandEvidence.Contains($commandRoot) -or
       (Get-FileHash -LiteralPath $commandExe -Algorithm SHA256).Hash -cne $commandHash) {
      throw "Restart Manager did not safely classify the real command image: $commandEvidence"
    }
    Write-Output 'PASS: time-matched command file user is distinguished from exact candidate without identity disclosure'
  } finally {
    if(-not $commandProcess.WaitForExit(15000)) {
      # Only the exact disposable Process instance created by THIS fixture.
      if(-not $commandProcess.HasExited) { $commandProcess.Kill() }
      [void]$commandProcess.WaitForExit(5000)
    }
    $commandProcess.Dispose()
  }

  # ISSUE-215 RED regression: a file opened WITH read/write sharing but WITHOUT
  # FILE_SHARE_DELETE still allows the old read-only probe to succeed, even
  # though Windows will refuse to rename its parent. The new diagnostic must
  # actually request DELETE access without deleting or changing any bytes.
  $noDeleteShare=[IO.File]::Open($permanentFile,[IO.FileMode]::Open,
    [IO.FileAccess]::Read,[IO.FileShare]::ReadWrite)
  try {
    $deleteAccess=Get-CandidatePortableFileShareSummary $permanent @($permanentFile)
    if($deleteAccess -notlike '*blockedExamples=1*') {
      throw "Delete-share omission was not detected: $deleteAccess"
    }
    if([IO.File]::ReadAllText($permanentFile) -cne 'preserve-me') {
      throw 'Read-only delete-access diagnostic changed the fixture bytes'
    }
  } finally { $noDeleteShare.Dispose() }
  Write-Output 'PASS: Windows delete-share omission is detected without changing source'

  # ISSUE-215 / TEST-028: files alone do not cover an empty subdirectory.
  # A surviving directory handle without FILE_SHARE_DELETE must be visible
  # to the bounded diagnosis, even though no ZIP file has that directory
  # in its ancestry. This fixture belongs solely to RUNNER_TEMP.
  $emptyDirectory=Join-Path $permanent 'empty-child'
  New-Item -ItemType Directory -Path $emptyDirectory | Out-Null
  $emptyHandle=[UahCandidateDeleteAccessProbe]::Open($emptyDirectory,
    [uint32]2147483648,[uint32]3,[IntPtr]::Zero,[uint32]3,
    [uint32]0x02000000,[IntPtr]::Zero)
  if($emptyHandle.IsInvalid) {
    $emptyHandle.Dispose()
    throw 'Windows empty-directory DELETE-sharing fixture could not be opened'
  }
  try {
    $emptySummary=Get-CandidatePortableFileShareSummary $permanent @($permanentFile)
    if($emptySummary -notlike '*blockedExamples=1*names=empty-child:Win32=*') {
      throw "Empty candidate child directory lock was absent from diagnostics: $emptySummary"
    }
    if([IO.File]::ReadAllText($permanentFile) -cne 'preserve-me') {
      throw 'Empty directory diagnostic altered the candidate file payload'
    }
  } finally { $emptyHandle.Dispose() }
  Write-Output 'PASS: file-share scan includes locked empty candidate child directories'
  # ISSUE-215 / TEST-028: the source tree can contain a NEW file after
  # Electron smoke that did not appear in the original 144-file ZIP manifest.
  # An unlisted child locked WITHOUT FILE_SHARE_DELETE must be discovered
  # rather than producing a false zero-blocked-files share receipt.
  $lateDirectory=Join-Path $permanent 'late-created'
  New-Item -ItemType Directory -Path $lateDirectory | Out-Null
  $lateFile=Join-Path $lateDirectory 'new-cache.bin'
  [IO.File]::WriteAllText($lateFile,'do-not-touch-late-file')
  $lateHandle=[IO.File]::Open($lateFile,[IO.FileMode]::Open,
    [IO.FileAccess]::Read,[IO.FileShare]::ReadWrite)
  try {
    $lateSummary=Get-CandidatePortableFileShareSummary $permanent @($permanentFile)
    if($lateSummary -notlike 'scan=ok probed=1 blockedExamples=1 names=late-created/new-cache.bin:Win32=* extraFiles=1' -or
       [IO.File]::ReadAllText($lateFile) -cne 'do-not-touch-late-file') {
      throw "Post-smoke unlisted file DELETE-sharing denial was missed: $lateSummary"
    }
  } finally { $lateHandle.Dispose() }
  $lateUnlocked=Get-CandidatePortableFileShareSummary $permanent @($permanentFile)
  if($lateUnlocked -cne 'scan=ok probed=1 blockedExamples=0 names= extraFiles=1' -or
     [IO.File]::ReadAllText($lateFile) -cne 'do-not-touch-late-file' -or
     [IO.File]::ReadAllText($permanentFile) -cne 'preserve-me') {
    throw "Unlisted file scan altered fixture or misreported its count: $lateUnlocked"
  }
  Write-Output 'PASS: post-smoke unlisted files and their DELETE-sharing denials are counted read-only'

  # RED TEST-028: a newly created, post-snapshot file can be the only
  # Restart Manager association at the exact first rename denial.
  # A stale pre-Electron manifest alone must not report no associated process.
  $lateRmHandle=[IO.File]::Open($lateFile,[IO.FileMode]::Open,
    [IO.FileAccess]::Read,[IO.FileShare]::ReadWrite)
  try {
    $liveRmEvidence=Get-CandidatePortableFirstDenialSummary $permanent @($permanentFile)
    if($liveRmEvidence -notmatch 'restartManager=\[rm=ok sampled=2 total=2 affected=[1-9]' -or
       $liveRmEvidence -notmatch 'fileAssociations=\[rmFiles=ok sampled=2 associated=1 kinds=\[exe=0 library=0 other=1\] outsideRunnerAssociated=1\]' -or
       $liveRmEvidence.Contains($lateFile) -or $liveRmEvidence.Contains($root)) {
      throw "TEST-028: post-snapshot candidate lock omitted from anonymous Restart Manager diagnosis: $liveRmEvidence"
    }
  } finally { $lateRmHandle.Dispose() }
  Write-Output 'PASS: post-snapshot files remain visible to time-matched anonymous RM diagnosis'


  # ISSUE-215: a directory's own DELETE probe cannot distinguish an ACL or
  # sharing denial on its parent. Hold ONLY a new disposable parent open with
  # exclusive sharing, then confirm that the extended diagnostic reports a
  # bounded (parent) status without leaking an absolute path or changing data.
  $parentFixture=Join-Path $root 'locked-parent-fixture'
  $childFixture=Join-Path $parentFixture 'source'
  New-Item -ItemType Directory -Path $parentFixture | Out-Null
  New-Item -ItemType Directory -Path $childFixture | Out-Null
  $childPayload=Join-Path $childFixture 'payload.txt'
  [IO.File]::WriteAllText($childPayload,'keep-parent-fixture')
  $parentHandle=[UahCandidateDeleteAccessProbe]::Open($parentFixture,
    [uint32]2147483648,[uint32]0,[IntPtr]::Zero,[uint32]3,
    [uint32]0x02000000,[IntPtr]::Zero)
  if($parentHandle.IsInvalid) {
    $parentHandle.Dispose()
    throw 'Disposable parent fixture could not establish a sharing lock'
  }
  try {
    $parentSummary=Get-CandidatePortableFileShareSummary $childFixture @($childPayload)
    if($parentSummary -notlike 'scan=ok probed=1 blockedExamples=1 names=(parent):Win32=*') {
      throw "Parent sharing denial was not distinguished from source file locks: $parentSummary"
    }
    if([IO.File]::ReadAllText($childPayload) -cne 'keep-parent-fixture') {
      throw 'Parent sharing diagnostic changed disposable payload bytes'
    }
  } finally { $parentHandle.Dispose() }
  Write-Output 'PASS: candidate parent rename-rights diagnostic detects exclusive parent handle'

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
      # Exceed the former three-second retry budget with a real file lease.
      Start-Sleep -Milliseconds 4500
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
    $attempts=Move-CandidatePortableDirectory $temporary $moved 16 750
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
