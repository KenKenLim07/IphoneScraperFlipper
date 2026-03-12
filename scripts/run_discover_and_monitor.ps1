param(
  [string]$NodeExe = "node",
  [string]$Engine = "playwright-extra",
  [int]$MaxCards = 100,
  [int]$MaxRandomDelayMinutes = 0,
  [int]$GapSeconds = 5,
  [switch]$Headless
)

$ErrorActionPreference = "Stop"
$projectDir = Split-Path -Parent $PSScriptRoot
Set-Location $projectDir

if ($MaxRandomDelayMinutes -gt 0) {
  $delaySeconds = Get-Random -Minimum 0 -Maximum (($MaxRandomDelayMinutes * 60) + 1)
  Start-Sleep -Seconds $delaySeconds
}

$logDir = Join-Path $projectDir "logs"
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"

$headlessArg = if ($Headless) { "--headless" } else { "--no-headless" }

$discoverLog = Join-Path $logDir "discover-$timestamp.log"
$monitorLog = Join-Path $logDir "monitor-$timestamp.log"

$discoverExit = 1
$monitorExit = 1

$prevEap = $ErrorActionPreference
try {
  # Don't let stderr output from node turn into a terminating PowerShell error.
  $ErrorActionPreference = "Continue"
  & $NodeExe "scraper/sniffer.mjs" "--engine=$Engine" "--mode=discover" "--max-cards" "$MaxCards" $headlessArg 2>&1 | Tee-Object -FilePath $discoverLog
  $discoverExit = $LASTEXITCODE
} finally {
  $ErrorActionPreference = $prevEap
}

Start-Sleep -Seconds ([Math]::Max(0, $GapSeconds))

try {
  $ErrorActionPreference = "Continue"
  & $NodeExe "scraper/sniffer.mjs" "--engine=$Engine" "--mode=monitor" $headlessArg 2>&1 | Tee-Object -FilePath $monitorLog
  $monitorExit = $LASTEXITCODE
} finally {
  $ErrorActionPreference = $prevEap
}

# Exit non-zero if either fails, but always attempt monitor after discovery.
if ($discoverExit -ne 0 -and $monitorExit -ne 0) { exit $monitorExit }
if ($monitorExit -ne 0) { exit $monitorExit }
exit $discoverExit
