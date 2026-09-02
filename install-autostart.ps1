# InstaPort TMS — start the server with Windows, and keep it running.
#
# Registers a Scheduled Task under your own account (no administrator
# needed) that launches the keep-alive supervisor at logon and restarts it
# if it ever stops. Run once:
#
#     powershell -ExecutionPolicy Bypass -File install-autostart.ps1
#
# To remove it later:
#
#     schtasks /Delete /TN "InstaPort TMS" /F

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$name = 'InstaPort TMS'

# Find node — the task needs a full path, not whatever is on today's PATH.
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw "Node.js was not found on PATH. Install Node 18+ and run this again." }

$keep = Join-Path $root 'keep-alive.js'
if (-not (Test-Path $keep)) { throw "keep-alive.js not found next to this script ($root)." }

Write-Host "Node       : $node"
Write-Host "Supervisor : $keep"

# Remove any previous registration so re-running this is safe.
schtasks /Query /TN "$name" *> $null
if ($LASTEXITCODE -eq 0) {
  Write-Host "Removing previous task..."
  schtasks /Delete /TN "$name" /F | Out-Null
}

$action    = New-ScheduledTaskAction  -Execute $node -Argument "`"$keep`"" -WorkingDirectory $root
$trigger   = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings  = New-ScheduledTaskSettingsSet `
               -AllowStartIfOnBatteries `
               -DontStopIfGoingOnBatteries `
               -StartWhenAvailable `
               -RestartCount 999 `
               -RestartInterval (New-TimeSpan -Minutes 1) `
               -ExecutionTimeLimit (New-TimeSpan -Seconds 0)
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger `
  -Settings $settings -Principal $principal `
  -Description 'Keeps the InstaPort TMS server running on http://localhost:7434' | Out-Null

Start-ScheduledTask -TaskName $name
Start-Sleep -Seconds 6

try {
  $r = Invoke-WebRequest 'http://localhost:7434/api/version' -UseBasicParsing -TimeoutSec 10
  Write-Host ""
  Write-Host "Installed and running." -ForegroundColor Green
  Write-Host "  http://localhost:7434"
  Write-Host "  $($r.Content)"
} catch {
  Write-Host ""
  Write-Host "Task registered, but the server did not answer yet." -ForegroundColor Yellow
  Write-Host "Check server.log in $root"
}
