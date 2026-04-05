param(
  [string]$TaskName = "IAASE-Sniffer",
  [string]$NodeExe = "node",
  [string]$Engine = "playwright-extra",
  [ValidateSet("discover","monitor","both")]
  [string]$Mode = "discover",
  [int]$IntervalMinutes = 60,
  [int]$MaxRandomDelayMinutes = 30,
  [int]$MaxCards = 50
)

$ErrorActionPreference = "Stop"
$scriptsDir = $PSScriptRoot
$runnerPath = Join-Path $scriptsDir "run_scraper.ps1"

$actionArgs = "-NoProfile -ExecutionPolicy Bypass -File `"$runnerPath`" -NodeExe `"$NodeExe`" -Engine `"$Engine`" -Mode `"$Mode`" -MaxCards $MaxCards -MaxRandomDelayMinutes $MaxRandomDelayMinutes -Headless"
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $actionArgs

$startAt = (Get-Date).AddMinutes(5)
$trigger = New-ScheduledTaskTrigger `
  -Once `
  -At $startAt `
  -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes) `
  -RepetitionDuration (New-TimeSpan -Days 3650)

$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Description "IAASE Facebook Marketplace scraper (hourly with jitter)." `
  -Force | Out-Null

Write-Host "Registered task '$TaskName' (interval=${IntervalMinutes}m, jitter up to ${MaxRandomDelayMinutes}m)."
