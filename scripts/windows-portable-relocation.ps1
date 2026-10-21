# TASK-020 / REQ-028 / TEST-028: same-volume candidate-only portable move.
# A PowerShell Move-Item of a directory containing locked files can partially
# populate a destination before failing. Windows Directory.Move performs one
# same-parent rename, so an error must never become a partial file copy.
# This helper does NOT move real user data and does NOT certify Stable.
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
      if($rootError -isnot [System.IO.IOException] -and
         $rootError -isnot [System.UnauthorizedAccessException]) { throw }
      $win32Code=$rootError.HResult -band 0xFFFF
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
