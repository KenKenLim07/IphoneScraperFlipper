param(
  [string]$NodeExe = "node",
  [string]$Engine = "playwright-extra",
  [ValidateSet("discover","monitor","both")]
  [string]$Mode = "discover",
  [int]$MaxCards = 100,
  [int]$MaxRandomDelayMinutes = 30,
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
$logFile = Join-Path $logDir "scrape-$timestamp.log"

$headlessArg = if ($Headless) { "--headless" } else { "--no-headless" }
& $NodeExe "scraper/sniffer.mjs" "--engine=$Engine" "--mode=$Mode" "--max-cards" "$MaxCards" $headlessArg *>&1 | Tee-Object -FilePath $logFile
exit $LASTEXITCODE
