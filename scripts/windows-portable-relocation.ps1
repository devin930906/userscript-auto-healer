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

# ISSUE-215: collect bounded, read-only evidence at the ACTUAL final
# relocation denial. An earlier no-process snapshot cannot exclude a race.
# Only compare candidate image paths; log counts, never arbitrary full paths.
# Unknown/redacted CIM identities must never be presented as zero owners.
function Get-CandidatePortableRelocationOwnerSummary([string]$candidateExe) {
  try {
    $exact=[IO.Path]::GetFullPath($candidateExe)
    $live=0
    $unknownPath=0
    $processes=@(Get-CimInstance -ClassName Win32_Process -Filter "Name='UserscriptAutoHealer.exe'" -ErrorAction Stop)
    foreach($process in $processes) {
      $image=[string]$process.ExecutablePath
      if([string]::IsNullOrWhiteSpace($image)) {
        $unknownPath++
        continue
      }
      try {
        if([string]::Equals([IO.Path]::GetFullPath($image),$exact,
           [StringComparison]::OrdinalIgnoreCase)) { $live++ }
      } catch { $unknownPath++ }
    }
    return "live=$live unknownPath=$unknownPath query=ok"
  } catch {
    return 'live=unknown unknownPath=unknown query=failed'
  }
}

# ISSUE-215 / TEST-028: a diagnostic snapshot must never make the
# candidate packaging fail with an unrelated CIM exception or lose the
# original directory-move exception. The owner summary explicitly reports
# query failure or opaque executable paths instead of treating them as zero.
function Write-CandidatePortableProcessSnapshot([string]$candidateExe,[string]$label) {
  $summary=Get-CandidatePortableRelocationOwnerSummary $candidateExe
  Write-Output ("DIAGNOSTIC: {0} candidate owners: {1}" -f $label,$summary)
}

# ISSUE-215 / TEST-028: a FileAccess.Read open, even with FileShare.Delete,
# does NOT request DELETE access, and cannot discover a handle whose share
# mode allows read but denies deletion/rename. Use a disposable, read-only
# native DELETE-access handle probe instead; CreateFileW does NOT delete data.
# Scan only verified runner-owned candidate files and their parent directories.
# Any inaccessible/ambiguous identity is reported; never treat it as clear.
function Get-CandidatePortableFileShareSummary(
  [string]$source,[string[]]$filePaths
) {
  try {
    if([string]::IsNullOrWhiteSpace($env:RUNNER_TEMP) -or
       [string]::IsNullOrWhiteSpace($source) -or
       $null -eq $filePaths -or $filePaths.Count -gt 512) {
      return 'scan=unavailable'
    }
    $base=[IO.Path]::GetFullPath($source).TrimEnd([char[]]@('\','/'))
    $runner=[IO.Path]::GetFullPath($env:RUNNER_TEMP).TrimEnd([char[]]@('\','/'))
    if(-not $base.StartsWith(($runner+[IO.Path]::DirectorySeparatorChar),
       [StringComparison]::OrdinalIgnoreCase)) { return 'scan=unavailable' }
    Assert-CandidatePortableNoReparsePath $runner $base
    $prefix=$base+[IO.Path]::DirectorySeparatorChar
    $seen=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $manifestFiles=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $targets=[Collections.Generic.List[string]]::new()
    # ISSUE-215: the parent may deny FILE_ADD_SUBDIRECTORY or DELETE_CHILD
    # even while every file in the source tree permits DELETE access.
    # This is only a handle-open diagnostic; it performs no rename or writes.
    $sourceParent=[IO.Path]::GetDirectoryName($base)
    if(-not $sourceParent.StartsWith($runner,[StringComparison]::OrdinalIgnoreCase)) {
      return 'scan=unavailable'
    }
    if($seen.Add($sourceParent)) { $targets.Add($sourceParent) }
    if($seen.Add($base)) { $targets.Add($base) }
    foreach($path in $filePaths) {
      if([string]::IsNullOrWhiteSpace($path)) { return 'scan=unavailable' }
      $full=[IO.Path]::GetFullPath($path)
      if(-not $full.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)) {
        return 'scan=unavailable'
      }
      $null=$manifestFiles.Add($full)
      $parent=[IO.Path]::GetDirectoryName($full)
      while($parent.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)) {
        if($seen.Add($parent)) { $targets.Add($parent) }
        $parent=[IO.Path]::GetDirectoryName($parent)
      }
      if($seen.Add($full)) { $targets.Add($full) }
    }
    # ISSUE-215 / TEST-028: a candidate empty directory is not an ancestor
    # of any enumerated file, yet an open directory handle can deny rename.
    # Walk only direct child directories, reject reparse points before descent,
    # and bound the entire read-only diagnostic independently of file count.
    $pending=[Collections.Generic.Queue[string]]::new()
    $pending.Enqueue($base)
    $directoryCount=0
    $discoveredFiles=0
    $extraFiles=0
    while($pending.Count -gt 0) {
      $parent=$pending.Dequeue()
      foreach($child in @(Get-ChildItem -LiteralPath $parent -Directory -Force -ErrorAction Stop)) {
        $full=[IO.Path]::GetFullPath([string]$child.FullName)
        if(-not $full.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase) -or
           (([int]$child.Attributes -band [int][IO.FileAttributes]::ReparsePoint) -ne 0)) {
          return 'scan=unavailable'
        }
        $directoryCount++
        if($directoryCount -gt 512) { return 'scan=unavailable' }
        if($seen.Add($full)) { $targets.Add($full) }
        $pending.Enqueue($full)
      }
      # Enumerate every actual file as well as directories: Electron or a
      # filesystem filter can create a file after the pre-launch ZIP manifest
      # snapshot. Checking only the original $filePaths could misleadingly
      # report blockedExamples=0 even when that NEW file denies DELETE access.
      # This is read-only, runner-contained and bounded to 512 entries.
      foreach($child in @(Get-ChildItem -LiteralPath $parent -File -Force -ErrorAction Stop)) {
        $full=[IO.Path]::GetFullPath([string]$child.FullName)
        if(-not $full.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase) -or
           (([int]$child.Attributes -band [int][IO.FileAttributes]::ReparsePoint) -ne 0)) {
          return 'scan=unavailable'
        }
        $discoveredFiles++
        if($discoveredFiles -gt 512) { return 'scan=unavailable' }
        if(-not $manifestFiles.Contains($full)) { $extraFiles++ }
        if($seen.Add($full)) { $targets.Add($full) }
      }
    }
    # Includes the root and every parent of a candidate file. Reparse paths
    # are rejected before any native handle is requested.
    foreach($path in $targets) {
      if(([int][IO.File]::GetAttributes($path) -band
         [int][IO.FileAttributes]::ReparsePoint) -ne 0) {
        return 'scan=unavailable'
      }
    }
    if(-not ('UahCandidateDeleteAccessProbe' -as [type])) {
      Add-Type -TypeDefinition @'
using System;
using Microsoft.Win32.SafeHandles;
using System.Runtime.InteropServices;
public static class UahCandidateDeleteAccessProbe {
  [DllImport("kernel32.dll", EntryPoint="CreateFileW", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern SafeFileHandle Open(string path, uint access, uint share,
    IntPtr security, uint disposition, uint flags, IntPtr templateFile);
}
'@ -ErrorAction Stop
    }
    $blocked=[Collections.Generic.List[string]]::new()
    $blockedCount=0
    foreach($path in $targets) {
      $handle=$null
      try {
        # DELETE (0x10000) with share READ|WRITE|DELETE (7),
        # OPEN_EXISTING (3), FILE_FLAG_BACKUP_SEMANTICS (0x02000000)
        # works for both directories and files. No DELETE_ON_CLOSE.
        # A source-tree entry needs DELETE; its common parent instead needs
        # FILE_ADD_SUBDIRECTORY (0x4) and FILE_DELETE_CHILD (0x40).
        # Success merely narrows the cause: it is NOT an effective ACL proof.
        $requested=if([string]::Equals($path,$sourceParent,
          [StringComparison]::OrdinalIgnoreCase)) {[uint32]0x44} else {[uint32]0x10000}
        $handle=[UahCandidateDeleteAccessProbe]::Open($path,
          $requested,[uint32]7,[IntPtr]::Zero,[uint32]3,
          [uint32]0x02000000,[IntPtr]::Zero)
        if($handle.IsInvalid) {
          $code=[Runtime.InteropServices.Marshal]::GetLastWin32Error()
          if($code -notin @(5,32,33)) { return 'scan=unavailable' }
          $blockedCount++
          if($blocked.Count -lt 8) {
            $name=if([string]::Equals($path,$sourceParent,
              [StringComparison]::OrdinalIgnoreCase)) {'(parent)'} elseif(
              [string]::Equals($path,$base,
              [StringComparison]::OrdinalIgnoreCase)) {'(root)'} else {
              $path.Substring($prefix.Length).Replace('\','/')
            }
            $blocked.Add(($name.Replace(';','_').Replace("`r",'').Replace("`n",'')+
              ':Win32='+$code))
          }
        }
      } finally { if($null -ne $handle) { $handle.Dispose() } }
    }
    # Candidate-relative names or fixed (parent)/(root), no absolute paths.
    return "scan=ok probed=$($filePaths.Count) blockedExamples=$blockedCount names=$($blocked -join ';') extraFiles=$extraFiles"
  } catch { return 'scan=unavailable' }
}

# ISSUE-215 / TEST-028: supplementary Windows Restart Manager evidence
# for the actual candidate files when Directory.Move returned Win32=5/32/33.
# Restart Manager can identify file users not visible in a query restricted
# to the candidate executable name. This never ends/shuts down/restarts
# processes, writes user files, publishes process IDs or claims no system-wide
# locks when the sampled set is incomplete. The session is always closed.
function Get-CandidatePortableRestartManagerSummary(
  [string]$source,[string[]]$filePaths
) {
  try {
    if([string]::IsNullOrWhiteSpace($source) -or
       [string]::IsNullOrWhiteSpace($env:RUNNER_TEMP) -or
       $null -eq $filePaths -or $filePaths.Count -lt 1 -or
       $filePaths.Count -gt 512 -or
       -not [IO.Path]::IsPathRooted($source)) { return 'rm=unavailable' }
    $runner=[IO.Path]::GetFullPath($env:RUNNER_TEMP).TrimEnd([char[]]@([char]92,[char]47))
    $base=[IO.Path]::GetFullPath($source).TrimEnd([char[]]@([char]92,[char]47))
    if(-not $base.StartsWith(($runner+[IO.Path]::DirectorySeparatorChar),
       [StringComparison]::OrdinalIgnoreCase) -or
       -not [IO.Directory]::Exists($base)) { return 'rm=unavailable' }
    Assert-CandidatePortableNoReparsePath $runner $base
    $prefix=$base+[IO.Path]::DirectorySeparatorChar
    $seen=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $paths=[Collections.Generic.List[string]]::new()
    foreach($file in $filePaths) {
      if([string]::IsNullOrWhiteSpace($file) -or
         -not [IO.Path]::IsPathRooted($file)) { return 'rm=unavailable' }
      $full=[IO.Path]::GetFullPath($file)
      if(-not $full.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase) -or
         -not [IO.File]::Exists($full)) { return 'rm=unavailable' }
      Assert-CandidatePortableNoReparsePath $runner $full
      if($seen.Add($full)) { $paths.Add($full) }
    }
    if($paths.Count -eq 0) { return 'rm=unavailable' }
    # Register a bounded sample rather than claiming to scan all app files.
    # The application executable is sampled first; the remaining candidates
    # are stable-sorted for reproducibility. RM cannot accept directories.
    $ordered=@($paths | Sort-Object)
    $exe=@($ordered | Where-Object {
      [IO.Path]::GetFileName($_) -ceq 'UserscriptAutoHealer.exe'
    })
    $others=@($ordered | Where-Object {
      [IO.Path]::GetFileName($_) -cne 'UserscriptAutoHealer.exe'
    })
    $sample=@(@($exe)+@($others) | Select-Object -First 40)
    if(-not ('UahCandidateRestartManagerProbe' -as [type])) {
      Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class UahCandidateRestartManagerProbe {
  [StructLayout(LayoutKind.Sequential)]
  private struct FILETIME { public uint lo; public uint hi; }
  [StructLayout(LayoutKind.Sequential)]
  private struct RM_UNIQUE_PROCESS { public uint pid; public FILETIME started; }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  private struct RM_PROCESS_INFO {
    public RM_UNIQUE_PROCESS process;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=256)] public string appName;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=64)] public string service;
    public uint applicationType;
    public uint appStatus;
    public uint terminalSession;
    [MarshalAs(UnmanagedType.Bool)] public bool restartable;
  }
  [DllImport("rstrtmgr.dll", CharSet=CharSet.Unicode)]
  private static extern uint RmStartSession(out uint h, uint flags, StringBuilder key);
  [DllImport("rstrtmgr.dll", CharSet=CharSet.Unicode)]
  private static extern uint RmRegisterResources(uint h, uint fileCount,
    [MarshalAs(UnmanagedType.LPArray, ArraySubType=UnmanagedType.LPWStr)] string[] files,
    uint appCount, IntPtr apps, uint serviceCount, IntPtr services);
  [DllImport("rstrtmgr.dll")]
  private static extern uint RmGetList(uint h, out uint needed,
    ref uint provided, [Out] RM_PROCESS_INFO[] processes, out uint rebootReason);
  [DllImport("rstrtmgr.dll")]
  private static extern uint RmEndSession(uint h);
  // No process names, PIDs, paths, services or application strings leave
  // the native boundary. Count only documented RM_APP_TYPE categories.
  // Indexes: total, window, service, explorer, console, critical, unknown, self.
  public static int[] CountAffectedByType(string[] files) {
    if(files==null || files.Length==0 || files.Length>40) return new int[]{-1};
    uint h;
    if(RmStartSession(out h, 0, new StringBuilder(33))!=0) return new int[]{-1};
    try {
      if(RmRegisterResources(h, (uint)files.Length, files,
          0, IntPtr.Zero, 0, IntPtr.Zero)!=0) return new int[]{-1};
      uint needed=0, provided=0, rebootReason=0;
      RM_PROCESS_INFO[] entries=new RM_PROCESS_INFO[0];
      for(int i=0;i<4;i++) {
        uint result=RmGetList(h,out needed,ref provided,entries,out rebootReason);
        if(result==0) {
          if(provided>(uint)entries.Length) return new int[]{-1};
          int[] counts=new int[8];
          counts[0]=(int)provided;
          int currentPid=Environment.ProcessId;
          for(int j=0;j<(int)provided;j++) {
            if(entries[j].process.pid==(uint)currentPid) counts[7]++;
            switch(entries[j].applicationType) {
              case 1: case 2: counts[1]++; break; // window processes
              case 3: counts[2]++; break; // service
              case 4: counts[3]++; break; // Explorer
              case 5: counts[4]++; break; // console
              case 1000: counts[5]++; break; // critical / non-restartable
              default: counts[6]++; break; // unknown and future values
            }
          }
          return counts;
        }
        if(result!=234 || needed==0 || needed>128) return new int[]{-1};
        provided=needed;
        entries=new RM_PROCESS_INFO[(int)needed];
      }
      return new int[]{-1};
    } finally { RmEndSession(h); }
  }
}
'@ -ErrorAction Stop
    }
    $counts=[UahCandidateRestartManagerProbe]::CountAffectedByType([string[]]$sample)
    if($null -eq $counts -or $counts.Length -ne 8 -or $counts[0] -lt 0) {
      return 'rm=unavailable'
    }
    $classified=0
    foreach($i in 1..6) { $classified+=$counts[$i] }
    if($classified -ne $counts[0] -or $counts[7] -gt $counts[0]) { return 'rm=unavailable' }
    return "rm=ok sampled=$($sample.Count) total=$($paths.Count) affected=$($counts[0]) types=[window=$($counts[1]) service=$($counts[2]) explorer=$($counts[3]) console=$($counts[4]) critical=$($counts[5]) unknown=$($counts[6])]" + " self=$($counts[7])"
  } catch {
    # Fail closed: an unavailable native diagnostic cannot alter an actual
    # directory move result or be represented as zero affected processes.
    return 'rm=unavailable'
  }
}

# ISSUE-215 / TEST-028: collect candidate-only ACL metadata at the actual
# rename failure. Successful DELETE-access handle opens and a successful
# sibling-control rename cannot rule out differing directory ACL inheritance.
# This is read-only, bounded, path-redacted context, NOT an effective-access
# calculation and never permission to retry, move or relax the release gate.
function Get-CandidatePortableRenameAclSummary([string]$source) {
  try {
    if([string]::IsNullOrWhiteSpace($source) -or
       [string]::IsNullOrWhiteSpace($env:RUNNER_TEMP) -or
       -not [IO.Path]::IsPathRooted($source)) { return 'acl=unavailable' }
    $base=[IO.Path]::GetFullPath($source).TrimEnd([char[]]@([char]92,[char]47))
    $runner=[IO.Path]::GetFullPath($env:RUNNER_TEMP).TrimEnd([char[]]@([char]92,[char]47))
    if(-not $base.StartsWith(($runner+[IO.Path]::DirectorySeparatorChar),
      [StringComparison]::OrdinalIgnoreCase) -or
      -not [IO.Directory]::Exists($base)) { return 'acl=unavailable' }
    Assert-CandidatePortableNoReparsePath $runner $base
    $parent=[IO.Path]::GetDirectoryName($base)
    if(-not [string]::Equals($parent,$runner,[StringComparison]::OrdinalIgnoreCase) -and
       -not $parent.StartsWith(($runner+[IO.Path]::DirectorySeparatorChar),
         [StringComparison]::OrdinalIgnoreCase)) { return 'acl=unavailable' }
    $summary=@()
    foreach($path in @($base,$parent)) {
      $acl=Get-Acl -LiteralPath $path -ErrorAction Stop
      $denyCount=@($acl.Access | Where-Object {
        $_.AccessControlType -eq [Security.AccessControl.AccessControlType]::Deny
      }).Count
      $readonly=(([int][IO.File]::GetAttributes($path) -band
        [int][IO.FileAttributes]::ReadOnly) -ne 0)
      $summary+= "denies=$denyCount protected=$($acl.AreAccessRulesProtected) readonly=$readonly"
    }
    return "acl=ok root=[$($summary[0])] parent=[$($summary[1])]"
  } catch { return 'acl=unavailable' }
}

# TEST-028: lexical containment is insufficient on Windows: a junction or
# symlink anywhere in the existing source ancestry (including ABOVE
# RUNNER_TEMP) can redirect a nested source to another filesystem tree.
# Source and destination must be siblings, so this covers both parents.
# This is a fail-closed snapshot, NOT an OS-enforced handle against races.
function Assert-CandidatePortableNoReparsePath(
  [string]$runner,[string]$source
) {
  # The earlier runner-to-source walk misses a junction in RUNNER_TEMP's
  # parent chain. Include every ancestor through the volume root; the actual
  # runner directory itself is also checked by the existing attribute guard.
  $paths=@()
  $ancestor=$runner
  while(-not [string]::IsNullOrWhiteSpace($ancestor)) {
    $paths+= $ancestor
    $parent=[IO.Path]::GetDirectoryName($ancestor)
    if([string]::IsNullOrWhiteSpace($parent) -or
       [string]::Equals($parent,$ancestor,[StringComparison]::OrdinalIgnoreCase)) {
      break
    }
    $ancestor=$parent
  }
  $cursor=$runner
  $relative=$source.Substring($runner.Length+1)
  foreach($component in ($relative -split '[\\/]')) {
    if([string]::IsNullOrWhiteSpace($component)) {
      throw [InvalidOperationException]::new('Candidate relocation path component unavailable')
    }
    $cursor=[IO.Path]::Combine($cursor,$component)
    $paths+= $cursor
  }
  foreach($path in $paths) {
    try { $attributes=[IO.File]::GetAttributes($path) }
    catch {
      throw [InvalidOperationException]::new('Candidate relocation path component unavailable')
    }
    if((([int]$attributes) -band ([int][IO.FileAttributes]::ReparsePoint)) -ne 0) {
      throw [InvalidOperationException]::new('Candidate relocation reparse point refused')
    }
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

# ISSUE-215 / TEST-028: when a real candidate move fails, test whether
# the SAME parent allows an atomic rename of an unrelated, freshly created
# EMPTY directory. A clean control narrows (but never proves) candidate-specific
# contention; a blocked control suggests parent/runner-wide interference.
# The only objects created/moved/deleted are this invocation's empty GUID-named
# probe folders. This is diagnostic evidence, never permission to skip Move.
function Get-CandidatePortableSiblingRenameControl([string]$source) {
  $from=$null
  $to=$null
  $created=$false
  try {
    if([string]::IsNullOrWhiteSpace($source) -or
       [string]::IsNullOrWhiteSpace($env:RUNNER_TEMP) -or
       -not [IO.Path]::IsPathRooted($source)) { return 'control=unavailable' }
    $base=[IO.Path]::GetFullPath($source)
    $runner=[IO.Path]::GetFullPath($env:RUNNER_TEMP).TrimEnd([char[]]@('\','/'))
    if(-not $base.StartsWith(($runner+[IO.Path]::DirectorySeparatorChar),
       [StringComparison]::OrdinalIgnoreCase) -or
       -not [IO.Directory]::Exists($base)) { return 'control=unavailable' }
    Assert-CandidatePortableNoReparsePath $runner $base
    $parent=[IO.Path]::GetDirectoryName($base)
    if(-not [string]::Equals($parent,$runner,[StringComparison]::OrdinalIgnoreCase) -and
       -not $parent.StartsWith(($runner+[IO.Path]::DirectorySeparatorChar),
       [StringComparison]::OrdinalIgnoreCase)) { return 'control=unavailable' }
    $label='uah-empty-rename-control-'+[Guid]::NewGuid().ToString('N')
    $from=[IO.Path]::Combine($parent,$label)
    $to=[IO.Path]::Combine($parent,$label+'-moved')
    if([IO.Directory]::Exists($from) -or [IO.Directory]::Exists($to)) {
      return 'control=unavailable'
    }
    $null=[IO.Directory]::CreateDirectory($from)
    $created=$true
    try {
      [IO.Directory]::Move($from,$to)
      return 'control=move-ok'
    } catch {
      $cause=$_.Exception
      while($null -ne $cause.InnerException) { $cause=$cause.InnerException }
      if($cause -is [System.IO.IOException] -or
         $cause -is [System.UnauthorizedAccessException]) {
        return ('control=move-denied Win32='+($cause.HResult -band 0xFFFF))
      }
      return 'control=unavailable'
    }
  } catch { return 'control=unavailable' }
  finally {
    if($created) {
      # Do not recurse or force-delete: an interfered-with/nonempty or reparse
      # probe is ambiguous and must remain untouched for runner disposal.
      foreach($path in @($to,$from)) {
        if($null -ne $path) {
          try {
            if([IO.Directory]::Exists($path) -and
               (([int][IO.File]::GetAttributes($path) -band
                 [int][IO.FileAttributes]::ReparsePoint) -eq 0)) {
              [IO.Directory]::Delete($path,$false)
            }
          } catch { }
        }
      }
    }
  }
}

# ISSUE-215: capture evidence at the FIRST access denial rather than only
# after bounded retries. A transient denial may disappear before the final
# attempt; the caller provides its already enumerated candidate-only files.
# This probe never resolves a denial into permission to move or modify data.
function Get-CandidatePortableFirstDenialSummary(
  [string]$source,[string[]]$candidateFiles
) {
  $owners=Get-CandidatePortableRelocationOwnerSummary (
    Join-Path $source 'UserscriptAutoHealer.exe')
  $sharing=Get-CandidatePortableFileShareSummary $source $candidateFiles
  $sibling=Get-CandidatePortableSiblingRenameControl $source
  $acl=Get-CandidatePortableRenameAclSummary $source
  $rm=Get-CandidatePortableRestartManagerSummary $source $candidateFiles
  return "owners=[$owners] sharing=[$sharing] sibling=[$sibling] $acl restartManager=[$rm]"
}

function Move-CandidatePortableDirectory(
  [string]$source,[string]$destination,
  [int]$maxAttempts=12,[int]$delayMilliseconds=250,
  [string[]]$candidateFiles=$null
) {
  if([string]::IsNullOrWhiteSpace($source) -or
     [string]::IsNullOrWhiteSpace($destination) -or
     $maxAttempts -lt 1 -or $maxAttempts -gt 20 -or
     $delayMilliseconds -lt 0 -or $delayMilliseconds -gt 1000) {
    throw [ArgumentException]::new('Invalid bounded candidate relocation options')
  }
  # Never permit this candidate-only helper to rename non-runner directories.
  # GetFullPath normalizes dot segments; the trailing separator prevents an
  # attacker-controlled sibling of RUNNER_TEMP from passing a prefix check.
  if([string]::IsNullOrWhiteSpace($env:RUNNER_TEMP) -or
     -not [IO.Path]::IsPathRooted($source) -or
     -not [IO.Path]::IsPathRooted($destination)) {
    throw [InvalidOperationException]::new('Candidate relocation requires absolute runner temp paths')
  }
  $from=[IO.Path]::GetFullPath($source)
  $to=[IO.Path]::GetFullPath($destination)
  $runner=[IO.Path]::GetFullPath($env:RUNNER_TEMP).TrimEnd([char[]]@('\','/'))
  $runnerPrefix=$runner+[IO.Path]::DirectorySeparatorChar
  if(-not $from.StartsWith($runnerPrefix,[StringComparison]::OrdinalIgnoreCase) -or
     -not $to.StartsWith($runnerPrefix,[StringComparison]::OrdinalIgnoreCase)) {
    throw [InvalidOperationException]::new('Candidate relocation outside runner temp refused')
  }
  $sameParent=[String]::Equals(
    [IO.Path]::GetDirectoryName($from),[IO.Path]::GetDirectoryName($to),
    [StringComparison]::OrdinalIgnoreCase)
  if(-not $sameParent -or [String]::Equals($from,$to,[StringComparison]::OrdinalIgnoreCase)) {
    throw [InvalidOperationException]::new('Candidate relocation must rename to a distinct sibling')
  }
  Assert-CandidatePortableNoReparsePath $runner $from
  if(-not [IO.Directory]::Exists($from) -or (Test-Path -LiteralPath $to)) {
    throw [InvalidOperationException]::new('Candidate relocation source missing or destination exists')
  }
  for($attempt=1; $attempt -le $maxAttempts; $attempt++) {
    # Before EVERY attempt a renamed/partial/external destination is a hard
    # error. Never delete the destination, copy missing files or force overwrite.
    if(-not [IO.Directory]::Exists($from) -or (Test-Path -LiteralPath $to)) {
      throw [InvalidOperationException]::new('Candidate relocation changed while retrying')
    }
    # Check again: a previous denial or wait does not preserve ancestor identity.
    Assert-CandidatePortableNoReparsePath $runner $from
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
      if($attempt -eq 1) {
        # Diagnostics are strictly observational. Even a successful sibling
        # control cannot bypass or shorten this move's fail-closed retries.
        Write-Warning ("TASK-020 first relocation denial: "+(
          Get-CandidatePortableFirstDenialSummary $from $candidateFiles))
      }
      if($attempt -eq $maxAttempts) {
        # Do not mask/replace the original .NET access exception when CIM is
        # unavailable; this is diagnostic evidence, not an unlock mechanism.
        $owners=Get-CandidatePortableRelocationOwnerSummary (
          Join-Path $from 'UserscriptAutoHealer.exe')
        Write-Warning "TASK-020 final relocation denial candidate owners: $owners"
        throw
      }
      if(-not [IO.Directory]::Exists($from) -or (Test-Path -LiteralPath $to)) {
        throw [InvalidOperationException]::new('Windows access conflict left changed relocation state')
      }
      Start-Sleep -Milliseconds $delayMilliseconds
    }
  }
  throw [InvalidOperationException]::new('Unreachable relocation state')
}
