# POC-01B: Windows portable-path Chrome for Testing (NOT product implementation).
# Downloads an official pinned standalone Chrome into an ephemeral GitHub runner.
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$version = "154.0.8037.57"
$port = 9333
$root = Join-Path $env:RUNNER_TEMP "userscript-poc01b-$env:GITHUB_RUN_ID-$env:GITHUB_RUN_ATTEMPT"
$profile = Join-Path $root "isolated-profile"
$archive = Join-Path $root "chrome-win64.zip"
$browserPath = Join-Path $root "chrome-win64\chrome.exe"
$downloadUrl = "https://storage.googleapis.com/chrome-for-testing-public/$version/win64/chrome-win64.zip"
if (-not $env:RUNNER_TEMP) { throw "Windows runner temp root not available" }
if (Test-Path $root) { throw "Refusing to touch preexisting PoC directory" }
if (@(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue).Count -gt 0) {
  throw "Preflight port $port occupied; refusing to attach"
}
New-Item -ItemType Directory -Path $root | Out-Null
Write-Output "Pinned official Chrome for Testing $version (win64), source $downloadUrl"
Invoke-WebRequest -Uri $downloadUrl -OutFile $archive -MaximumRedirection 4 -TimeoutSec 120
$zipHash = (Get-FileHash -Path $archive -Algorithm SHA256).Hash
if ((Get-Item $archive).Length -lt 1000000) { throw "Archive unexpectedly small" }
# Zip entry names must not traverse outside the dedicated ephemeral directory.
Add-Type -AssemblyName System.IO.Compression
$zip = [IO.Compression.ZipFile]::OpenRead($archive)
try {
  foreach ($entry in $zip.Entries) {
    $name = $entry.FullName.Replace('/', '\')
    if ($name.StartsWith('\') -or $name -match '(^|\\)\.\.(\\|$)' -or $name -match '^[A-Za-z]:') {
      throw "Unexpected archive path: $name"
    }
  }
} finally { $zip.Dispose() }
Expand-Archive -Path $archive -DestinationPath $root
if (-not (Test-Path $browserPath)) { throw "Extracted chrome.exe missing" }
$actualVersion = (Get-Item $browserPath).VersionInfo.ProductVersion
Write-Output "Extracted browser: $browserPath ; file version: $actualVersion ; ZIP SHA256: $zipHash"
New-Item -ItemType Directory -Path $profile | Out-Null

function Get-OwnedEndpoint {
  param([string]$ExpectedExe, [string]$ExpectedProfile)
  $v = Invoke-RestMethod -Uri "http://127.0.0.1:$port/json/version" -TimeoutSec 5
  if (-not $v.Browser -or -not $v.webSocketDebuggerUrl) { throw "CDP version/WS handshake missing" }
  $ws = [Uri]$v.webSocketDebuggerUrl
  if ($ws.Host -ne '127.0.0.1' -or $ws.Port -ne $port) { throw "Unexpected debugger endpoint" }
  $listener = @(Get-NetTCPConnection -LocalPort $port -State Listen | Where-Object { $_.LocalAddress -eq "127.0.0.1" })
  if ($listener.Count -ne 1) { throw "Unexpected listener count: $($listener.Count)" }
  $pidFromSocket = $listener[0].OwningProcess
  $owner = Get-CimInstance Win32_Process -Filter "ProcessId=$pidFromSocket"
  if (-not $owner -or -not $owner.ExecutablePath -or -not $owner.CommandLine) { throw "Cannot bind CDP to owning process" }
  if ([IO.Path]::GetFullPath($owner.ExecutablePath) -ine [IO.Path]::GetFullPath($ExpectedExe)) { throw "Browser executable mismatch" }
  if (-not $owner.CommandLine.Contains($ExpectedProfile)) { throw "Profile identity mismatch" }
  $tabs = @(Invoke-RestMethod -Uri "http://127.0.0.1:$port/json/list" -TimeoutSec 5)
  if ($tabs.Count -lt 1) { throw "No inspectable CDP targets" }
  return @{ Browser = $v.Browser; OwnerPid = $pidFromSocket; Targets = $tabs.Count }
}

$proc = $null
try {
  $args = @(
    "--headless=new",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--remote-debugging-address=127.0.0.1",
    "--remote-debugging-port=$port",
    "--user-data-dir=$profile",
    "about:blank"
  )
  $proc = Start-Process -FilePath $browserPath -ArgumentList $args -PassThru -WindowStyle Hidden
  $endpoint = $null
  for ($try = 0; $try -lt 30; $try++) {
    Start-Sleep -Seconds 1
    try { $endpoint = Get-OwnedEndpoint -ExpectedExe $browserPath -ExpectedProfile $profile; break } catch { }
  }
  if (-not $endpoint) { throw "Portable Chrome did not establish an owned CDP session" }
  Write-Output "PASS POC-01B: isolated extracted Chrome path, version $($endpoint.Browser), PID $($endpoint.OwnerPid), targets $($endpoint.Targets)"

  $rejected = $false
  try { Get-OwnedEndpoint -ExpectedExe $browserPath -ExpectedProfile (Join-Path $root 'WRONG-profile') | Out-Null }
  catch { $rejected = $_.Exception.Message -like '*Profile identity mismatch*' }
  if (-not $rejected) { throw "Negative identity test failed: wrong Profile was accepted" }
  Write-Output "PASS: mismatched Profile explicitly rejected"

  $occupied = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
  if ($occupied.Count -eq 0) { throw "Negative occupied-port setup failed" }
  Write-Output "PASS: occupied-port preflight would refuse second launch, existing instance left intact"
} finally {
  # Only stop Chrome processes whose full command line references the *unique temp profile*.
  $owned = @(Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object {
    $_.CommandLine -and $_.CommandLine.Contains($profile) -and $_.ExecutablePath -and
    ([IO.Path]::GetFullPath($_.ExecutablePath) -ieq [IO.Path]::GetFullPath($browserPath))
  })
  foreach ($p in $owned) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
}
Write-Output "POC-01B tests completed in ephemeral runner; no installed/local user Chrome Profile touched."
