# TASK-020 / ISSUE-215: a successful parent Electron shell smoke receipt
# does not certify that its utility/renderer subprocesses have released DLLs.
# Only inspect this run's disposable candidate EXE under RUNNER_TEMP. Never
# terminate any process; fail closed if that executable remains live.
function Wait-CandidatePortableProcessExit(
  [string]$candidateExe,[int]$maxChecks=20,[int]$delayMilliseconds=250
) {
  if([string]::IsNullOrWhiteSpace($candidateExe) -or
     [string]::IsNullOrWhiteSpace($env:RUNNER_TEMP) -or
     $maxChecks -lt 1 -or $maxChecks -gt 30 -or
     $delayMilliseconds -lt 0 -or $delayMilliseconds -gt 1000) {
    throw [ArgumentException]::new('Invalid candidate process wait options')
  }
  $exact=[IO.Path]::GetFullPath($candidateExe)
  $runner=[IO.Path]::GetFullPath($env:RUNNER_TEMP).TrimEnd([char[]]@('\','/'))
  if(-not $exact.StartsWith(($runner+[IO.Path]::DirectorySeparatorChar),
     [StringComparison]::OrdinalIgnoreCase) -or
     [IO.Path]::GetFileName($exact) -cne 'UserscriptAutoHealer.exe') {
    throw [InvalidOperationException]::new('Process wait is limited to the disposable candidate executable')
  }
  for($check=1; $check -le $maxChecks; $check++) {
    # CIM includes processes with this image name from other directories.
    # Exact path comparison is required; do not use name-only process counts.
    # A failed query OR a redacted/unavailable process path is not proof that
    # the exact candidate has exited. Refuse relocation without a trustworthy
    # disambiguation, even if the opaque process is unrelated.
    $processes=@(Get-CimInstance -ClassName Win32_Process -Filter "Name='UserscriptAutoHealer.exe'" -ErrorAction Stop)
    foreach($process in $processes) {
      if([string]::IsNullOrWhiteSpace([string]$process.ExecutablePath)) {
        throw [InvalidOperationException]::new(
          'Candidate process executable path unavailable; relocation refused')
      }
    }
    $matches=@($processes | Where-Object {
      [string]::Equals(
        [IO.Path]::GetFullPath([string]$_.ExecutablePath),$exact,
        [StringComparison]::OrdinalIgnoreCase)
    })
    if($matches.Count -eq 0) { return $check }
    Write-Warning ("TASK-020 candidate-owned executable remains live: count={0} check={1}/{2}" -f
      $matches.Count,$check,$maxChecks)
    if($check -eq $maxChecks) {
      throw [InvalidOperationException]::new('Candidate-owned executable did not exit before relocation')
    }
    Start-Sleep -Milliseconds $delayMilliseconds
  }
}

# TASK-020 / REQ-028 / TEST-028: same-volume candidate-only portable move.
# A PowerShell Move-Item of a directory containing locked files can partially
# populate a destination before failing. Windows Directory.Move performs one
# same-parent rename, so an error must never become a partial file copy.
# This helper does NOT move real user data and does NOT certify Stable.
# Keep the production warning and the deterministic Windows regression on
# one formatter. This has no file-system effects and does not expose paths.
function Format-CandidatePortableRelocationFailure(
  [int]$attempt,[int]$maxAttempts,[System.Exception]$cause,
  [bool]$sourceExists,[bool]$destinationExists,[DateTime]$observedAtUtc
) {
  $utc=$observedAtUtc.ToUniversalTime().ToString(
    'yyyy-MM-ddTHH:mm:ss.fffZ',[Globalization.CultureInfo]::InvariantCulture)
  $win32Code=$cause.HResult -band 0xFFFF
  return ("TASK-020 relocation attempt {0}/{1} UTC={2} type={3} HRESULT=0x{4:X8} Win32={5} sourceExists={6} destinationExists={7}" -f
    $attempt,$maxAttempts,$utc,$cause.GetType().Name,$cause.HResult,
    $win32Code,$sourceExists,$destinationExists)
}

function Move-CandidatePortableDirectory(
  [string]$source,[string]$destination,
  [int]$maxAttempts=12,[int]$delayMilliseconds=250
) {
  if([string]::IsNullOrWhiteSpace($source) -or
     [string]::IsNullOrWhiteSpace($destination) -or
     $maxAttempts -lt 1 -or $maxAttempts -gt 20 -or
     $delayMilliseconds -lt 0 -or $delayMilliseconds -gt 1000) {
    throw [ArgumentException]::new('Invalid bounded candidate relocation options')
  }
  $from=[IO.Path]::GetFullPath($source)
  $to=[IO.Path]::GetFullPath($destination)
  $sameParent=[String]::Equals(
    [IO.Path]::GetDirectoryName($from),[IO.Path]::GetDirectoryName($to),
    [StringComparison]::OrdinalIgnoreCase)
  if(-not $sameParent -or [String]::Equals($from,$to,[StringComparison]::OrdinalIgnoreCase)) {
    throw [InvalidOperationException]::new('Candidate relocation must rename to a distinct sibling')
  }
  if(-not [IO.Directory]::Exists($from) -or (Test-Path -LiteralPath $to)) {
    throw [InvalidOperationException]::new('Candidate relocation source missing or destination exists')
  }
  for($attempt=1; $attempt -le $maxAttempts; $attempt++) {
    # Before EVERY attempt a renamed/partial/external destination is a hard
    # error. Never delete the destination, copy missing files or force overwrite.
    if(-not [IO.Directory]::Exists($from) -or (Test-Path -LiteralPath $to)) {
      throw [InvalidOperationException]::new('Candidate relocation changed while retrying')
    }
    try {
      [IO.Directory]::Move($from,$to)
      return $attempt
    } catch {
      # PowerShell wraps .NET method failures in MethodInvocationException.
      # Unwrap to the actual Windows file-system error; an open child DLL
      # may surface as ACCESS_DENIED (5), not only SHARING_VIOLATION (32)
      # or LOCK_VIOLATION (33). Retry only these bounded access conflicts.
      # Persistent NTFS ACL denials are never ignored: retries exhaust and
      # rethrow the original exception. All other causes fail immediately.
      $rootError=$_.Exception
      while($rootError.InnerException) { $rootError=$rootError.InnerException }
      $win32Code=$rootError.HResult -band 0xFFFF
      # Issue #215: a top-level PowerShell exception alone hid the actual
      # Windows failure after extracted Electron smoke. Record each attempt
      # without leaking full temp paths or changing the retry/error policy.
      # On an exhausted retry the original exception is still rethrown.
      Write-Warning (Format-CandidatePortableRelocationFailure $attempt $maxAttempts $rootError (
        [IO.Directory]::Exists($from)) (Test-Path -LiteralPath $to) ([DateTime]::UtcNow))
      if($rootError -isnot [System.IO.IOException] -and
         $rootError -isnot [System.UnauthorizedAccessException]) { throw }
      if($win32Code -ne 5 -and $win32Code -ne 32 -and $win32Code -ne 33) { throw }
      if($attempt -eq $maxAttempts) { throw }
      if(-not [IO.Directory]::Exists($from) -or (Test-Path -LiteralPath $to)) {
        throw [InvalidOperationException]::new('Windows access conflict left changed relocation state')
      }
      Start-Sleep -Milliseconds $delayMilliseconds
    }
  }
  throw [InvalidOperationException]::new('Unreachable relocation state')
}
