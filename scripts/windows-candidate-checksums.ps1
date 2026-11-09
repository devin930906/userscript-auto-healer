# TASK-019/020 / REQ-027/028 / TEST-027/028.
# Native Windows candidate attestation, NOT Stable release authorization.
# Check the two exact candidate files against their published SHA256SUMS
# before the GitHub Actions artifact uploader accepts the directory.
function Assert-CandidateChecksums(
 [string]$Directory,[string]$SetupName,[string]$PortableName
) {
 if([string]::IsNullOrWhiteSpace($Directory) -or
    [string]::IsNullOrWhiteSpace($SetupName) -or
    [string]::IsNullOrWhiteSpace($PortableName) -or
    $SetupName -cne [IO.Path]::GetFileName($SetupName) -or
    $PortableName -cne [IO.Path]::GetFileName($PortableName) -or
    $SetupName -ceq $PortableName -or
    $SetupName -cnotmatch '^[A-Za-z0-9._-]+-Setup\.exe$' -or
    $PortableName -cnotmatch '^[A-Za-z0-9._-]+-Portable\.zip$') {
   throw 'Invalid candidate checksum verification inputs'
 }
 $setupPrefix=$SetupName.Substring(0,$SetupName.Length-'-Setup.exe'.Length)
 $portablePrefix=$PortableName.Substring(0,$PortableName.Length-'-Portable.zip'.Length)
 if($setupPrefix -cne $portablePrefix) {
   throw 'EXE and ZIP do not share a single candidate version identity'
 }
 if(-not (Test-Path -LiteralPath $Directory -PathType Container)) {
   throw 'Candidate delivery directory does not exist'
 }
 $all=@(Get-ChildItem -LiteralPath $Directory -Force -ErrorAction Stop)
 $expected=@($SetupName,$PortableName,'SHA256SUMS.txt')
 if($all.Count -ne $expected.Count) {
   throw 'Unexpected or missing candidate deliverable'
 }
 foreach($item in $all) {
   if($item.PSIsContainer -or
      ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or
      -not ($expected -ccontains $item.Name) -or $item.Length -le 0) {
     throw 'Unexpected, linked or empty candidate deliverable'
   }
 }
 $sumPath=Join-Path $Directory 'SHA256SUMS.txt'
 $lines=@(Get-Content -LiteralPath $sumPath -Encoding ascii -ErrorAction Stop)
 if($lines.Count -ne 2) {throw 'Candidate checksum manifest must contain exactly two entries'}
 $seen=[System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
 foreach($line in $lines) {
   if($line -cnotmatch '^([0-9a-f]{64})  ([A-Za-z0-9._-]+)$') {
     throw 'Malformed candidate SHA-256 manifest entry'
   }
   $digest=$Matches[1]
   $fileName=$Matches[2]
   if(-not (@($SetupName,$PortableName) -ccontains $fileName) -or
      -not $seen.Add($fileName)) {
     throw 'Unexpected or duplicate candidate checksum entry'
   }
   $path=Join-Path $Directory $fileName
   $actual=(Get-FileHash -LiteralPath $path -Algorithm SHA256 -ErrorAction Stop).Hash.ToLowerInvariant()
   if($actual -cne $digest) {
     throw 'Candidate file checksum mismatch'
   }
 }
 if($seen.Count -ne 2) {throw 'Incomplete candidate checksum manifest'}
 return $true
}
