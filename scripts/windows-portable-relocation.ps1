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
  # Never resolve a relative runner authority against the current directory.
  # Use the same fully qualified path gate as the actual candidate move.
  if(-not [IO.Path]::IsPathFullyQualified($candidateExe) -or
     -not [IO.Path]::IsPathFullyQualified($env:RUNNER_TEMP)) {
    throw [InvalidOperationException]::new('Candidate process wait requires fully qualified runner paths')
  }
  $exact=[IO.Path]::GetFullPath($candidateExe)
  $runner=[IO.Path]::GetFullPath($env:RUNNER_TEMP).TrimEnd([char[]]@('\','/'))
  if(-not $exact.StartsWith(($runner+[IO.Path]::DirectorySeparatorChar),
     [StringComparison]::OrdinalIgnoreCase) -or
     [IO.Path]::GetFileName($exact) -cne 'UserscriptAutoHealer.exe') {
    throw [InvalidOperationException]::new('Process wait is limited to the disposable candidate executable')
  }
  for($check=1; $check -le $maxChecks; $check++) {
    # A lexical RUNNER_TEMP prefix is not sufficient: a junction or symlink
    # in the candidate executable ancestry can redirect this preflight to an
    # external image. Reuse the move's strict root-to-file reparse guard on
    # every bounded poll. This is read-only; it never ends any process.
    Assert-CandidatePortableNoReparsePath $runner $exact
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
    # A caller's WarningPreference=Stop must not replace our bounded,
    # authoritative live-process refusal with a diagnostic warning exception.
    Write-Warning -WarningAction Continue ("TASK-020 candidate-owned executable remains live: count={0} check={1}/{2}" -f
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
  # ISSUE-215: fixed, path-redacted failure stages, not arbitrary exception
  # messages or absolute candidate file names.
  $stage='input'
  try {
    if([string]::IsNullOrWhiteSpace($env:RUNNER_TEMP) -or
       [string]::IsNullOrWhiteSpace($source) -or
       $null -eq $filePaths -or $filePaths.Count -gt 512) {
      return 'scan=unavailable stage=input'
    }
    $base=[IO.Path]::GetFullPath($source).TrimEnd([char[]]@('\','/'))
    $runner=[IO.Path]::GetFullPath($env:RUNNER_TEMP).TrimEnd([char[]]@('\','/'))
    if(-not $base.StartsWith(($runner+[IO.Path]::DirectorySeparatorChar),
       [StringComparison]::OrdinalIgnoreCase)) { return 'scan=unavailable stage=manifest-scope' }
    $stage='manifest-scope'
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
      return 'scan=unavailable stage=manifest-scope'
    }
    if($seen.Add($sourceParent)) { $targets.Add($sourceParent) }
    if($seen.Add($base)) { $targets.Add($base) }
    foreach($path in $filePaths) {
      if([string]::IsNullOrWhiteSpace($path)) { return 'scan=unavailable stage=manifest-scope' }
      $full=[IO.Path]::GetFullPath($path)
      if(-not $full.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)) {
        return 'scan=unavailable stage=manifest-scope'
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
    $stage='enumeration'
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
          return 'scan=unavailable stage=enumeration'
        }
        $directoryCount++
        if($directoryCount -gt 512) { return 'scan=unavailable stage=enumeration' }
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
          return 'scan=unavailable stage=enumeration'
        }
        $discoveredFiles++
        if($discoveredFiles -gt 512) { return 'scan=unavailable stage=enumeration' }
        if(-not $manifestFiles.Contains($full)) { $extraFiles++ }
        if($seen.Add($full)) { $targets.Add($full) }
      }
    }
    # Includes the root and every parent of a candidate file. Reparse paths
    # are rejected before any native handle is requested.
    $stage='attributes'
    foreach($path in $targets) {
      if(([int][IO.File]::GetAttributes($path) -band
         [int][IO.FileAttributes]::ReparsePoint) -ne 0) {
        return 'scan=unavailable stage=attributes'
      }
    }
    $stage='native-setup'
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
    $stage='native-probe'
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
          if($code -notin @(5,32,33)) { return 'scan=unavailable stage=native-probe' }
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
  } catch { return "scan=unavailable stage=$stage" }
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
    $probeOrder=@(@($exe)+@($others))
    $sample=@($probeOrder | Select-Object -First 40)
    if(-not ('UahCandidateRestartManagerProbe' -as [type])) {
      Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Text;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
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
  [DllImport("kernel32.dll", SetLastError=true)]
  private static extern SafeProcessHandle OpenProcess(uint access,
    [MarshalAs(UnmanagedType.Bool)] bool inherit, uint pid);
  [DllImport("kernel32.dll", SetLastError=true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool GetProcessTimes(SafeProcessHandle process,
    out FILETIME created, out FILETIME exited, out FILETIME kernel, out FILETIME user);
  [DllImport("kernel32.dll", EntryPoint="QueryFullProcessImageNameW",
    CharSet=CharSet.Unicode, SetLastError=true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool QueryImage(SafeProcessHandle process, uint flags,
    StringBuilder image, ref uint length);

  // Only allowlisted image-name categories leave this read-only boundary.
  // A basename category is NOT ownership or permission to stop a process.
  // Query by one limited-information handle and match RM's creation time,
  // so a recycled PID cannot be attributed to the original file user.
  private static int ImageCategory(RM_UNIQUE_PROCESS identity, string candidateExe,
    string runnerTemp, out int imageScope) {
    // 24: image INSIDE candidate tree; 25: other runner-temp image;
    // 26: image outside runner temp; 27: unreadable/stale identity.
    // Image scope is NOT process ancestry, lock causation or ownership.
    imageScope=27;
    try {
      using(SafeProcessHandle handle=OpenProcess(0x1000, false, identity.pid)) {
        if(handle.IsInvalid) return 14;
        FILETIME created, exited, kernel, user;
        if(!GetProcessTimes(handle, out created, out exited, out kernel, out user) ||
           created.lo!=identity.started.lo || created.hi!=identity.started.hi) return 14;
        uint length=32768;
        StringBuilder image=new StringBuilder((int)length);
        if(!QueryImage(handle, 0, image, ref length) || length==0) return 14;
        string full=Path.GetFullPath(image.ToString());
        string candidatePrefix=Path.GetDirectoryName(candidateExe)+Path.DirectorySeparatorChar;
        string runnerPrefix=runnerTemp+Path.DirectorySeparatorChar;
        if(full.StartsWith(candidatePrefix,StringComparison.OrdinalIgnoreCase))
          imageScope=24;
        else if(full.StartsWith(runnerPrefix,StringComparison.OrdinalIgnoreCase))
          imageScope=25;
        else imageScope=26;
        if(String.Equals(full, candidateExe, StringComparison.OrdinalIgnoreCase)) return 8;
        switch(Path.GetFileName(full).ToLowerInvariant()) {
          case "conhost.exe": case "openconsole.exe": return 9;
          case "pwsh.exe": case "powershell.exe": return 10;
          case "node.exe": return 11;
          case "runner.worker.exe": case "runner.listener.exe": return 12;
          // Additional allowlisted tool families only. These are supplemental
          // counts under the existing "other" image category, never process
          // ownership or permission to stop any executable.
          case "cmd.exe": return 15;
          case "explorer.exe": return 16;
          case "dllhost.exe": return 17;
          case "rundll32.exe": return 18;
          case "werfault.exe": case "wermgr.exe": return 19;
          case "compattelrunner.exe": return 20;
          case "msmpeng.exe": case "securityhealthservice.exe": return 21;
          case "csc.exe": case "vbc.exe": case "msbuild.exe": return 22;
          case "svchost.exe": return 23;
          default: return 13;
        }
      }
    } catch { return 14; }
  }

  // No arbitrary image names, PIDs, paths, services or application strings
  // leave the native boundary. Keep the original RM categories and self count.
  // 8..14: exact candidate, console-host name, shell name, node name,
  // runner name, other known image, unavailable/time-mismatched identity.
  // 15..23: known tool families (a bounded subset of image category 13).
  // 24..27: time-matched executable path scope, without recording its path.
  // A child process can execute outside the candidate tree; do NOT equate
  // "outsideRunner" with "not a descendant" or terminate anything.
  public static int[] CountAffectedByType(string[] files, string candidateExe,
    string runnerTemp) {
    if(files==null || files.Length==0 || files.Length>40 ||
       String.IsNullOrWhiteSpace(candidateExe) ||
       String.IsNullOrWhiteSpace(runnerTemp)) return new int[]{-1};
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
          int[] counts=new int[31];
          counts[0]=(int)provided;
          int currentPid=Environment.ProcessId;
          for(int j=0;j<(int)provided;j++) {
            if(entries[j].process.pid==(uint)currentPid) counts[7]++;
            int scope;
            int category=ImageCategory(entries[j].process, candidateExe,
              runnerTemp, out scope);
            counts[scope]++;
            // Aggregate only start-age ranges for identity-checked live images.
            // Never publish exact launch time, image path or PID.
            if(category==14) counts[30]++;
            else {
              try {
                long ticks=((long)entries[j].process.started.hi<<32) |
                  (long)entries[j].process.started.lo;
                double age=(DateTime.UtcNow-DateTime.FromFileTimeUtc(ticks)).TotalSeconds;
                if(age<0) counts[30]++;
                else if(age<=60) counts[28]++;
                else counts[29]++;
              } catch { counts[30]++; }
            }
            if(category>=15 && category<=23) {
              counts[13]++; // tool families remain part of "other"
              counts[category]++;
            } else {
              counts[category]++;
            }
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
    $candidateExe=[IO.Path]::Combine($base,'UserscriptAutoHealer.exe')
    $counts=[UahCandidateRestartManagerProbe]::CountAffectedByType(
      [string[]]$sample,$candidateExe,$runner)
    if($null -eq $counts -or $counts.Length -ne 31 -or $counts[0] -lt 0) {
      return 'rm=unavailable'
    }
    $classified=0
    foreach($i in 1..6) { $classified+=$counts[$i] }
    $images=0
    foreach($i in 8..14) { $images+=$counts[$i] }
    $scoped=0
    foreach($i in 24..27) { $scoped+=$counts[$i] }
    $ageTotal=$counts[28]+$counts[29]+$counts[30]
     if($classified -ne $counts[0] -or $images -ne $counts[0] -or
       $scoped -ne $counts[0] -or $ageTotal -ne $counts[0] -or $counts[7] -gt $counts[0]) {
      return 'rm=unavailable'
    }
    # The initial RM registration sees only the first 40 candidate files.
    # Inspect the rest in bounded, read-only sessions (up to 512 total).
    # A process may appear in multiple batches: count *observations*, not
    # unique owners, and never turn an unavailable batch into a zero count.
    $coverage=''
    if($probeOrder.Count -gt $sample.Count) {
      $checked=$sample.Count
      $unavailable=0
      $extraAffectedObservations=0
      $batches=1
      for($offset=$sample.Count; $offset -lt $probeOrder.Count; $offset+=40) {
        $batches++
        $next=@($probeOrder | Select-Object -Skip $offset -First 40)
        $extra=[UahCandidateRestartManagerProbe]::CountAffectedByType(
          [string[]]$next,$candidateExe,$runner)
        if($null -eq $extra -or $extra.Length -ne 31 -or $extra[0] -lt 0) {
          $unavailable++
          continue
        }
        $extraTypes=0
        foreach($i in 1..6) { $extraTypes+=$extra[$i] }
        $extraImages=0
        foreach($i in 8..14) { $extraImages+=$extra[$i] }
        $extraScopes=0
        foreach($i in 24..27) { $extraScopes+=$extra[$i] }
        $extraAges=$extra[28]+$extra[29]+$extra[30]
         if($extraTypes -ne $extra[0] -or $extraImages -ne $extra[0] -or
           $extraScopes -ne $extra[0] -or $extraAges -ne $extra[0] -or $extra[7] -gt $extra[0]) {
          $unavailable++
          continue
        }
        $checked+=$next.Count
        $extraAffectedObservations+=$extra[0]
      }
      $complete=if($unavailable -eq 0 -and $checked -eq $probeOrder.Count) {
        'true'
      } else { 'false' }
      $coverage=" coverage=[batches=$batches sampled=$checked total=$($probeOrder.Count) complete=$complete extraAffectedObservations=$extraAffectedObservations unavailableBatches=$unavailable]"
    }
    return "rm=ok sampled=$($sample.Count) total=$($paths.Count) affected=$($counts[0]) types=[window=$($counts[1]) service=$($counts[2]) explorer=$($counts[3]) console=$($counts[4]) critical=$($counts[5]) unknown=$($counts[6])]" + " self=$($counts[7]) images=[candidate=$($counts[8]) consoleHost=$($counts[9]) shell=$($counts[10]) node=$($counts[11]) runner=$($counts[12]) other=$($counts[13]) unknown=$($counts[14])]" + " tools=[command=$($counts[15]) explorer=$($counts[16]) dllHost=$($counts[17]) runDll=$($counts[18]) crash=$($counts[19]) compat=$($counts[20]) security=$($counts[21]) compiler=$($counts[22]) serviceHost=$($counts[23])]" + " imageScope=[candidateTree=$($counts[24]) runnerOther=$($counts[25]) outsideRunner=$($counts[26]) unknown=$($counts[27])]" + " ageBuckets=[recent=$($counts[28]) established=$($counts[29]) unknown=$($counts[30])]" + $coverage
  } catch {
    # Fail closed: an unavailable native diagnostic cannot alter an actual
    # directory move result or be represented as zero affected processes.
    return 'rm=unavailable'
  }
}

# ISSUE-215 / TEST-028: a batch-level Restart Manager association is
# not evidence of which file is used. Inspect no more than the SAME first 40
# bounded candidate files individually; emit anonymous file-kind counts only.
# A per-file association is STILL not proof of a rename-denying handle.
# Never log filenames/PIDs, terminate processes or mutate payload bytes.
function Get-CandidatePortableRmFileAssociationSummary(
  [string]$source,[string[]]$candidateFiles
) {
  try {
    if([string]::IsNullOrWhiteSpace($source) -or
       [string]::IsNullOrWhiteSpace($env:RUNNER_TEMP) -or
       $null -eq $candidateFiles -or $candidateFiles.Count -lt 1 -or
       $candidateFiles.Count -gt 512 -or
       -not [IO.Path]::IsPathFullyQualified($source) -or
       -not [IO.Path]::IsPathFullyQualified($env:RUNNER_TEMP)) {
      return 'rmFiles=unavailable'
    }
    $base=[IO.Path]::GetFullPath($source).TrimEnd([char[]]@('\','/'))
    $runner=[IO.Path]::GetFullPath($env:RUNNER_TEMP).TrimEnd([char[]]@('\','/'))
    $prefix=$base+[IO.Path]::DirectorySeparatorChar
    if(-not $base.StartsWith(($runner+[IO.Path]::DirectorySeparatorChar),
       [StringComparison]::OrdinalIgnoreCase) -or
       -not [IO.Directory]::Exists($base)) { return 'rmFiles=unavailable' }
    Assert-CandidatePortableNoReparsePath $runner $base
    $seen=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $paths=[Collections.Generic.List[string]]::new()
    foreach($file in $candidateFiles) {
      if([string]::IsNullOrWhiteSpace($file) -or
         -not [IO.Path]::IsPathFullyQualified($file)) { return 'rmFiles=unavailable' }
      $full=[IO.Path]::GetFullPath($file)
      if(-not $full.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase) -or
         -not [IO.File]::Exists($full) -or -not $seen.Add($full)) {
        return 'rmFiles=unavailable'
      }
      Assert-CandidatePortableNoReparsePath $runner $full
      $paths.Add($full)
    }
    $sorted=@($paths | Sort-Object)
    $exe=@($sorted | Where-Object {
      [IO.Path]::GetFileName($_) -ceq 'UserscriptAutoHealer.exe'
    })
    $other=@($sorted | Where-Object {
      [IO.Path]::GetFileName($_) -cne 'UserscriptAutoHealer.exe'
    })
    $probeOrder=@(@($exe)+@($other))
    $associated=0;$exeAssociated=0;$libraryAssociated=0
    $otherAssociated=0;$outsideAssociated=0
    $sampled=0;$scannedBatches=0;$unresolvedOutsideBatches=0
    # A per-file RM session for all 512 files could turn a diagnostic into
    # an unbounded delay at the first rename denial. Query at most 13 groups
    # of 40, then inspect at most ONE 40-file associated group individually.
    # Later associated groups remain explicitly PARTIAL, never false "clear".
    for($offset=0;$offset -lt $probeOrder.Count;$offset+=40) {
      $batch=@($probeOrder | Select-Object -Skip $offset -First 40)
      $scannedBatches++
      $group=Get-CandidatePortableRestartManagerSummary $base $batch
      $header=[regex]::Match($group,
        '^rm=ok sampled=(\d+) total=(\d+) affected=(\d+) ')
      $scope=[regex]::Match($group,
        ' imageScope=\[candidateTree=\d+ runnerOther=\d+ outsideRunner=(\d+) unknown=\d+\]')
      if(-not $header.Success -or -not $scope.Success -or
         [int]$header.Groups[1].Value -ne $batch.Count -or
         [int]$header.Groups[2].Value -ne $batch.Count) {
        return 'rmFiles=unavailable'
      }
      $count=[int]$header.Groups[3].Value
      $outside=[int]$scope.Groups[1].Value
      if($outside -gt $count) { return 'rmFiles=unavailable' }
      if($outside -eq 0) { continue }
      if($sampled+$batch.Count -gt 40) {
        $unresolvedOutsideBatches++
        continue
      }
      $foundOutsideFile=$false
      foreach($file in $batch) {
        # Existing routine independently validates each exact runner-owned
        # file, classifies time-matched process images, and closes its session.
        $detail=Get-CandidatePortableRestartManagerSummary $base @($file)
        $affected=[regex]::Match($detail,
          '^rm=ok sampled=1 total=1 affected=(\d+) ')
        $scopes=[regex]::Match($detail,
          ' imageScope=\[candidateTree=\d+ runnerOther=\d+ outsideRunner=(\d+) unknown=\d+\]')
        if(-not $affected.Success -or -not $scopes.Success) {
          return 'rmFiles=unavailable'
        }
        $fileCount=[int]$affected.Groups[1].Value
        $fileOutside=[int]$scopes.Groups[1].Value
        if($fileOutside -gt $fileCount) { return 'rmFiles=unavailable' }
        $sampled++
        if($fileCount -eq 0) { continue }
        $associated++
        if([string]::Equals([IO.Path]::GetFileName($file),'UserscriptAutoHealer.exe',
           [StringComparison]::Ordinal)) { $exeAssociated++ }
        elseif([IO.Path]::GetExtension($file) -ieq '.dll') { $libraryAssociated++ }
        else { $otherAssociated++ }
        if($fileOutside -gt 0) {
          $outsideAssociated++
          $foundOutsideFile=$true
        }
      }
      # RM sessions are successive snapshots, not an atomic lock census.
      # An outside-runner process can release its file between the grouped
      # observation and the per-file queries. Do not report complete file
      # attribution merely because all later samples became empty.
      if(-not $foundOutsideFile) { $unresolvedOutsideBatches++ }
    }
    $state=if($unresolvedOutsideBatches -eq 0) {'rmFiles=ok'} else {'rmFiles=partial'}
    $summary="$state sampled=$sampled associated=$associated kinds=[exe=$exeAssociated library=$libraryAssociated other=$otherAssociated] outsideRunnerAssociated=$outsideAssociated"
    if($probeOrder.Count -gt 40) {
      $summary+=" scannedBatches=$scannedBatches totalFiles=$($probeOrder.Count)"
    }
    if($unresolvedOutsideBatches -gt 0) {
      $summary+=" unresolvedOutsideBatches=$unresolvedOutsideBatches"
    }
    return $summary
  } catch { return 'rmFiles=unavailable' }
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
  # A low 16-bit value is only a Win32 code for FACILITY_WIN32 HRESULTs.
  # Do not attribute unrelated .NET facilities to Windows access denial.
  $hResultHex=('{0:X8}' -f $cause.HResult)
  $win32Code=if($hResultHex.StartsWith('8007',[StringComparison]::Ordinal)) {
    [string]($cause.HResult -band 0xFFFF)
  } else { 'unavailable' }
  return ("TASK-020 relocation attempt {0}/{1} UTC={2} type={3} HRESULT=0x{4:X8} Win32={5} sourceExists={6} destinationExists={7}" -f
    $attempt,$maxAttempts,$utc,$cause.GetType().Name,$cause.HResult,
    $win32Code,$sourceExists,$destinationExists)
}

# TASK-020 / TEST-028: only true FACILITY_WIN32 HRESULTs for access
# denied (5), sharing violation (32), and lock violation (33) are eligible
# for the existing bounded retry. Matching the low word alone can classify
# unrelated IOException facilities as Windows lock conflicts.
function Test-CandidatePortableRetryableMoveError([Exception]$cause) {
  return (($cause -is [IO.IOException] -or
           $cause -is [UnauthorizedAccessException]) -and
          $cause.HResult -in @(-2147024891,-2147024864,-2147024863))
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
       -not [IO.Path]::IsPathFullyQualified($source) -or
       -not [IO.Path]::IsPathFullyQualified($env:RUNNER_TEMP)) {
      return 'control=unavailable'
    }
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

# TEST-028: Electron and filesystem filters may create files AFTER the caller
# snapshots its manifest. An RM query restricted to that old list can report
# affected=0 while the actual new child file prevents the same-parent rename.
# Refresh only runner-contained, non-reparse candidate files at the denial.
# If the bounded snapshot is incomplete, return 'unavailable'; never claim
# that no process is associated. Read-only; no processes are stopped.
function Get-CandidatePortableCurrentRmManifest(
  [string]$source,[string[]]$candidateFiles
) {
  $unavailable=[pscustomobject]@{State='unavailable';Files=@()}
  try {
    if([string]::IsNullOrWhiteSpace($source) -or
       [string]::IsNullOrWhiteSpace($env:RUNNER_TEMP) -or
       $null -eq $candidateFiles -or $candidateFiles.Count -lt 1 -or
       $candidateFiles.Count -gt 512 -or
       -not [IO.Path]::IsPathFullyQualified($source) -or
       -not [IO.Path]::IsPathFullyQualified($env:RUNNER_TEMP)) {
      return $unavailable
    }
    $runner=[IO.Path]::GetFullPath($env:RUNNER_TEMP).TrimEnd([char[]]@('\','/'))
    $base=[IO.Path]::GetFullPath($source).TrimEnd([char[]]@('\','/'))
    $prefix=$base+[IO.Path]::DirectorySeparatorChar
    if(-not $base.StartsWith(($runner+[IO.Path]::DirectorySeparatorChar),
       [StringComparison]::OrdinalIgnoreCase) -or
       -not [IO.Directory]::Exists($base)) { return $unavailable }
    Assert-CandidatePortableNoReparsePath $runner $base
    $expected=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach($file in $candidateFiles) {
      if([string]::IsNullOrWhiteSpace($file) -or
         -not [IO.Path]::IsPathFullyQualified($file)) { return $unavailable }
      $full=[IO.Path]::GetFullPath($file)
      if(-not $full.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase) -or
         -not [IO.File]::Exists($full) -or
         -not $expected.Add($full)) { return $unavailable }
      Assert-CandidatePortableNoReparsePath $runner $full
    }
    $found=[Collections.Generic.List[string]]::new()
    $foundSet=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $pending=[Collections.Generic.Queue[string]]::new()
    $pending.Enqueue($base)
    $directoryCount=0
    while($pending.Count -gt 0) {
      $parent=$pending.Dequeue()
      foreach($child in @(Get-ChildItem -LiteralPath $parent -Force -ErrorAction Stop)) {
        $full=[IO.Path]::GetFullPath([string]$child.FullName)
        if(-not $full.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase) -or
           (([int]$child.Attributes -band [int][IO.FileAttributes]::ReparsePoint) -ne 0)) {
          return $unavailable
        }
        if($child.PSIsContainer) {
          $directoryCount++
          if($directoryCount -gt 512) { return $unavailable }
          $pending.Enqueue($full)
        } elseif($child -is [IO.FileInfo]) {
          if(-not $foundSet.Add($full)) { return $unavailable }
          $found.Add($full)
          if($found.Count -gt 512) { return $unavailable }
        } else { return $unavailable }
      }
    }
    if($found.Count -eq 0) { return $unavailable }
    foreach($file in $expected) {
      if(-not $foundSet.Contains($file)) { return $unavailable }
    }
    return [pscustomobject]@{State='ok';Files=@($found.ToArray())}
  } catch { return $unavailable }
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
  $rmSnapshot=Get-CandidatePortableCurrentRmManifest $source $candidateFiles
  $rm=if($rmSnapshot.State -eq 'ok') {
    Get-CandidatePortableRestartManagerSummary $source $rmSnapshot.Files
  } else { 'rm=unavailable' }
  # Run individual attribution only when a batch already observed an
  # outside-runner association. Never treat this evidence as causal proof.
  $rmFiles='rmFiles=not-probed'
  if($rm -match ' imageScope=\[[^\]]*outsideRunner=([1-9][0-9]*)' -or
     $rm -match ' coverage=\[[^\]]*extraAffectedObservations=([1-9][0-9]*)') {
    # A later 40-file RM batch may be the ONLY place with an association.
    # Inspect targeted batches even when the first batch reports zero.
    $rmFiles=Get-CandidatePortableRmFileAssociationSummary $source $rmSnapshot.Files
  }
  return "owners=[$owners] sharing=[$sharing] sibling=[$sibling] $acl restartManager=[$rm] fileAssociations=[$rmFiles]"
}

# ISSUE-215 / TEST-028: observe whether an anonymous Restart Manager
# association to the candidate EXE still exists AFTER a successful atomic
# rename that previously encountered a real Windows access denial.
# This is a subsequent snapshot, NOT proof of the prior denial's cause.
# No process paths, identities or PIDs are returned. Never stop processes.
# Do not inspect outside verified, non-reparse runner-owned candidate paths.
function Get-CandidatePortablePostMoveExeRmSummary([string]$destination) {
  try {
    if([string]::IsNullOrWhiteSpace($destination) -or
       [string]::IsNullOrWhiteSpace($env:RUNNER_TEMP) -or
       -not [IO.Path]::IsPathFullyQualified($destination) -or
       -not [IO.Path]::IsPathFullyQualified($env:RUNNER_TEMP)) {
      return 'postMove=unavailable'
    }
    $runner=[IO.Path]::GetFullPath($env:RUNNER_TEMP).TrimEnd([char[]]@('\\','/'))
    $base=[IO.Path]::GetFullPath($destination).TrimEnd([char[]]@('\\','/'))
    if(-not $base.StartsWith(($runner+[IO.Path]::DirectorySeparatorChar),
       [StringComparison]::OrdinalIgnoreCase) -or
       -not [IO.Directory]::Exists($base)) {
      return 'postMove=unavailable'
    }
    Assert-CandidatePortableNoReparsePath $runner $base
    $exe=[IO.Path]::Combine($base,'UserscriptAutoHealer.exe')
    if(-not [IO.File]::Exists($exe)) { return 'postMove=unavailable' }
    Assert-CandidatePortableNoReparsePath $runner $exe
    # One exact candidate file, one bounded native session. This separate
    # post-success observation is deliberately not a whole-tree clear claim.
    $rm=Get-CandidatePortableRestartManagerSummary $base @($exe)
    if($rm -cnotmatch '^rm=ok sampled=1 total=1 affected=[0-9]+ ' -or
       $rm.Contains("`r") -or $rm.Contains("`n")) {
      return 'postMove=unavailable'
    }
    return "postMove=ok $rm"
  } catch {
    return 'postMove=unavailable'
  }
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
     -not [IO.Path]::IsPathFullyQualified($env:RUNNER_TEMP) -or
     -not [IO.Path]::IsPathFullyQualified($source) -or
     -not [IO.Path]::IsPathFullyQualified($destination)) {
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
      if($attempt -gt 1) {
        # Only after a real retry-success, compare EXE association at the
        # relocated path. An unavailable probe is NOT a zero-owner receipt.
        # The move already succeeded; any diagnostic error must not convert
        # that success into a packaging failure or authorize process cleanup.
        try {
          $after=Get-CandidatePortablePostMoveExeRmSummary $to
          Write-Warning -WarningAction Continue ("TASK-020 post-success relocation EXE comparison: "+$after)
        } catch { }
      }
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
      # Issue #215: a top-level PowerShell exception alone hid the actual
      # Windows failure after extracted Electron smoke. Record each attempt
      # without leaking full temp paths or changing the retry/error policy.
      # On an exhausted retry the original exception is still rethrown.
      Write-Warning -WarningAction Continue (Format-CandidatePortableRelocationFailure $attempt $maxAttempts $rootError (
        [IO.Directory]::Exists($from)) (Test-Path -LiteralPath $to) ([DateTime]::UtcNow))
      if(-not (Test-CandidatePortableRetryableMoveError $rootError)) { throw }
      if($attempt -eq 1) {
        # Diagnostics are strictly observational. Even a successful sibling
        # control cannot bypass or shorten this move's fail-closed retries.
        # Read-only evidence is best-effort: if a probe unexpectedly throws,
        # preserve the original Windows rename error and bounded retry path.
        # Diagnostics must not introduce a new packaging failure reason.
        $firstDenial='diagnostic=unavailable'
        try {
          $firstDenial=Get-CandidatePortableFirstDenialSummary $from $candidateFiles
        } catch { }
        Write-Warning -WarningAction Continue ("TASK-020 first relocation denial: "+$firstDenial)
      }
      if($attempt -eq $maxAttempts) {
        # Do not mask/replace the original .NET access exception when CIM is
        # unavailable; this is diagnostic evidence, not an unlock mechanism.
        $owners=Get-CandidatePortableRelocationOwnerSummary (
          Join-Path $from 'UserscriptAutoHealer.exe')
        Write-Warning -WarningAction Continue "TASK-020 final relocation denial candidate owners: $owners"
        # Compare first-vs-terminal ownership evidence on persistent denial.
        # Only the same bounded, read-only, candidate-local diagnostic runs;
        # no extra rename, permission change, process stop or retry is allowed.
        # Diagnostic failure must NEVER replace the original Move exception.
        $finalEvidence='diagnostic=unavailable'
        try {
          $finalEvidence=Get-CandidatePortableFirstDenialSummary $from $candidateFiles
        } catch { }
        Write-Warning -WarningAction Continue ("TASK-020 final relocation denial: "+$finalEvidence)
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
