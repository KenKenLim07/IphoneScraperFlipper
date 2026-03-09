param(
  [string]$PythonExe = "python",
  [int]$MaxCards = 50,
  [int]$MaxRandomDelayMinutes = 30
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

& $PythonExe "scraper/sniffer_phase1.py" --max-cards $MaxCards *>&1 | Tee-Object -FilePath $logFile
exit $LASTEXITCODE
