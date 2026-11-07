# Installs the ActivityWatch -> Aurboda push agent on Windows and runs it every 5 minutes.
#
#   $env:AURBODA_TOKEN='<TOKEN>'; irm __AURBODA_API_URL__/agents/activitywatch.ps1 | iex
#
# Optional: $env:AURBODA_DEVICE='<name>' names this computer (default: its computer name),
# $env:AURBODA_URL='<api url>' points at another Aurboda server, and
# $env:AURBODA_UNINSTALL='1' removes the agent, its scheduled task and its settings.
#
# Re-running replaces the installed files and keeps one scheduled task. No administrator rights needed.
# Kept to ASCII so Windows PowerShell 5.1 reads it the same whatever the code page.

function Install-AwAurboda {
  $ErrorActionPreference = 'Stop'
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

  $apiUrl = '__AURBODA_API_URL__'
  if ($env:AURBODA_URL) { $apiUrl = $env:AURBODA_URL }
  $apiUrl = $apiUrl.TrimEnd('/')
  $dir = Join-Path $env:LOCALAPPDATA 'aw-aurboda'
  $agentPath = Join-Path $dir 'aw-to-aurboda.ps1'
  $configPath = Join-Path $dir 'config.json'
  $taskName = 'Aurboda ActivityWatch push'

  if ($env:AURBODA_UNINSTALL -eq '1') {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
    if (Test-Path $dir) { Remove-Item -Recurse -Force -Path $dir }
    Remove-Item Env:AURBODA_UNINSTALL -ErrorAction SilentlyContinue
    Write-Host 'Removed the ActivityWatch -> Aurboda agent, its scheduled task and its settings.' -ForegroundColor Green
    return
  }

  $token = $env:AURBODA_TOKEN
  if (-not $token) {
    Write-Host "Set your Aurboda API key first: `$env:AURBODA_TOKEN='<TOKEN>'" -ForegroundColor Red
    return
  }
  if ($token -notmatch '^[A-Za-z0-9+/=._:~-]+$') {
    Write-Host 'That does not look like an Aurboda API key.' -ForegroundColor Red
    return
  }
  if ($apiUrl -notmatch '^https?://') {
    Write-Host "Set the Aurboda API URL first: `$env:AURBODA_URL='https://...'" -ForegroundColor Red
    return
  }
  $device = $env:AURBODA_DEVICE
  if (-not $device) { $device = $env:COMPUTERNAME }
  if ($device.Length -gt 100) {
    Write-Host 'The device name can be at most 100 characters.' -ForegroundColor Red
    return
  }

  try {
    Invoke-RestMethod -Uri 'http://localhost:5600/api/0/info' -TimeoutSec 3 | Out-Null
    Write-Host 'ActivityWatch is running.' -ForegroundColor Green
  } catch {
    Write-Host 'ActivityWatch is not answering at http://localhost:5600 yet. Install it from https://activitywatch.net and start it; the agent sends data from the first run after it is up.' -ForegroundColor Yellow
  }

  $agentScript = @'
# ActivityWatch -> Aurboda push agent for Windows, run every 5 minutes by a scheduled task.
# Reads its settings from config.json next to it; sends the same payload as the bash agent.

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$Dir = Join-Path $env:LOCALAPPDATA 'aw-aurboda'
$Config = Get-Content -Raw -Path (Join-Path $Dir 'config.json') | ConvertFrom-Json
$StateFile = Join-Path $Dir 'last_sync'
$AwUrl = 'http://localhost:5600'
if ($env:AW_URL) { $AwUrl = $env:AW_URL }
$LookbackHours = 1
$Invariant = [Globalization.CultureInfo]::InvariantCulture
$SecondFormat = "yyyy-MM-dd'T'HH:mm:ss'Z'"
$MilliFormat = "yyyy-MM-dd'T'HH:mm:ss.fff'Z'"

function Get-AwJson([string]$Path) {
  $client = New-Object System.Net.WebClient
  $client.Encoding = [Text.Encoding]::UTF8
  try { return ($client.DownloadString("$AwUrl$Path") | ConvertFrom-Json) } finally { $client.Dispose() }
}

function ConvertTo-UtcDate($Value) {
  if ($Value -is [DateTime]) { return $Value.ToUniversalTime() }
  return [DateTimeOffset]::Parse([string]$Value, $Invariant).UtcDateTime
}

if (Test-Path $StateFile) {
  $startText = (Get-Content -Raw -Path $StateFile).Trim()
} else {
  $startText = [DateTime]::UtcNow.AddHours(-$LookbackHours).ToString($SecondFormat, $Invariant)
}
# 5 minutes ago gives the AFK watcher time to finalize heartbeats
$endText = [DateTime]::UtcNow.AddMinutes(-5).ToString($SecondFormat, $Invariant)

$windowBucket = $null
$afkBucket = $null
try { $buckets = Get-AwJson '/api/0/buckets/' } catch { $buckets = $null }
if ($buckets) {
  foreach ($bucket in $buckets.PSObject.Properties) {
    if (-not $windowBucket -and $bucket.Value.type -eq 'currentwindow') { $windowBucket = $bucket.Name }
    if (-not $afkBucket -and $bucket.Value.type -eq 'afkstatus') { $afkBucket = $bucket.Name }
  }
}
if (-not $windowBucket) {
  Write-Output 'No aw-watcher-window bucket found - is ActivityWatch running?'
  exit 0
}

$range = "start=$startText&end=$endText&limit=10000"
$events = Get-AwJson "/api/0/buckets/$([uri]::EscapeDataString($windowBucket))/events?$range"

$afkPeriods = New-Object System.Collections.Generic.List[object]
if ($afkBucket) {
  try { $afkEvents = Get-AwJson "/api/0/buckets/$([uri]::EscapeDataString($afkBucket))/events?$range" } catch { $afkEvents = $null }
  foreach ($afk in $afkEvents) {
    if ($null -ne $afk -and $afk.data.status -eq 'afk') {
      $afkStart = ConvertTo-UtcDate $afk.timestamp
      $afkPeriods.Add([pscustomobject]@{ Start = $afkStart; End = $afkStart.AddSeconds([double]$afk.duration) })
    }
  }
}

$total = 0
$filtered = 0
$transformed = New-Object System.Collections.Generic.List[object]
foreach ($item in $events) {
  if ($null -eq $item) { continue }
  $total++
  $app = [string]$item.data.app
  if (-not $app) { continue }
  $eventStart = ConvertTo-UtcDate $item.timestamp
  $eventEnd = $eventStart.AddSeconds([double]$item.duration)
  $isAfk = $false
  foreach ($period in $afkPeriods) {
    if ($eventStart -ge $period.Start -and $eventEnd -le $period.End) { $isAfk = $true; break }
  }
  if ($isAfk) { $filtered++; continue }
  $title = ''
  if ($null -ne $item.data.title) { $title = [string]$item.data.title }
  $transformed.Add([ordered]@{
      timestamp = $eventStart.ToString($MilliFormat, $Invariant)
      duration  = [double]$item.duration
      app       = $app
      title     = $title
    })
}

if ($total -eq 0) {
  Write-Output "No events in range $startText -> $endText"
  Set-Content -Path $StateFile -Value $endText -Encoding ASCII
  exit 0
}
if ($transformed.Count -eq 0) {
  Write-Output 'All events were AFK - nothing to push'
  Set-Content -Path $StateFile -Value $endText -Encoding ASCII
  exit 0
}

Write-Output "Pushing $($transformed.Count) events ($total total, $filtered filtered as AFK) for device '$($Config.device_name)'"

$body = [ordered]@{ device_name = [string]$Config.device_name; events = $transformed.ToArray() } | ConvertTo-Json -Depth 5 -Compress
try {
  $response = Invoke-WebRequest -Uri "$($Config.url)/sync/activitywatch" -Method Post -UseBasicParsing -TimeoutSec 60 `
    -Headers @{ Authorization = "bearer $($Config.token)" } `
    -ContentType 'application/json; charset=utf-8' `
    -Body ([Text.Encoding]::UTF8.GetBytes($body))
  Write-Output "Pushed successfully (HTTP $($response.StatusCode))"
  Set-Content -Path $StateFile -Value $endText -Encoding ASCII
} catch {
  $status = 'no response'
  if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
  [Console]::Error.WriteLine("Push failed (HTTP $status): $($_.Exception.Message)")
  exit 1
}
'@

  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  Set-Content -Path $agentPath -Value $agentScript -Encoding UTF8
  [ordered]@{ url = $apiUrl; token = $token; device_name = $device } | ConvertTo-Json | Set-Content -Path $configPath -Encoding UTF8
  Write-Host "Installed the agent at $agentPath (settings in $configPath)." -ForegroundColor Green

  $arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$agentPath`""
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments
  $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
    -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
  $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
    -Description 'Sends ActivityWatch app usage to Aurboda every 5 minutes.' -Force | Out-Null
  Write-Host "Runs every 5 minutes (scheduled task '$taskName')." -ForegroundColor Green

  Write-Host ''
  Write-Host 'Running the agent once:'
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $agentPath
  if ($LASTEXITCODE -eq 0) {
    Write-Host "Done. Data from '$device' shows up in Aurboda within a few minutes." -ForegroundColor Green
  } else {
    Write-Host 'The first run failed (see above). The scheduled task retries every 5 minutes.' -ForegroundColor Yellow
  }
  Remove-Item Env:AURBODA_TOKEN -ErrorAction SilentlyContinue

  Write-Host ''
  Write-Host "To uninstall: `$env:AURBODA_UNINSTALL='1'; irm $apiUrl/agents/activitywatch.ps1 | iex"
}

Install-AwAurboda
