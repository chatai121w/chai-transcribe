# ===========================================
#  Install / remove the whisper watchdog as a logon task
# ===========================================
#  Registers a hidden Scheduled Task that runs the watchdog at logon, so the
#  transcription server comes back on its own after a reboot or a crash.
#
#    .\scripts\install-watchdog.ps1              # install and start now
#    .\scripts\install-watchdog.ps1 -Uninstall   # remove it
#    .\scripts\install-watchdog.ps1 -Status      # show current state
# ===========================================

param(
    [switch]$Uninstall,
    [switch]$Status,
    [int]$Port = 3000
)

$ErrorActionPreference = "Stop"
$taskName    = "ChaiTranscribe-WhisperWatchdog"
$projectRoot = Split-Path -Parent $PSScriptRoot
$watchdog    = Join-Path $projectRoot "scripts\whisper-watchdog.ps1"

function Get-Task { Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue }

if ($Status) {
    $task = Get-Task
    if ($task) {
        $info = Get-ScheduledTaskInfo -TaskName $taskName
        Write-Host "Task:        $taskName" -ForegroundColor Cyan
        Write-Host "State:       $($task.State)"
        Write-Host "Last run:    $($info.LastRunTime)  (result: $($info.LastTaskResult))"
    } else {
        Write-Host "Watchdog is not installed." -ForegroundColor Yellow
    }
    try {
        $h = Invoke-RestMethod -Uri "http://localhost:$Port/health" -TimeoutSec 5
        Write-Host "Server:      healthy on port $Port ($($h.gpu))" -ForegroundColor Green
    } catch {
        Write-Host "Server:      not answering on port $Port" -ForegroundColor Yellow
    }
    return
}

if ($Uninstall) {
    if (Get-Task) {
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
        Write-Host "Watchdog removed. The server will no longer restart on its own." -ForegroundColor Yellow
    } else {
        Write-Host "Watchdog was not installed." -ForegroundColor Yellow
    }
    return
}

if (-not (Test-Path $watchdog)) { throw "Watchdog script not found at $watchdog" }

# pwsh if present, otherwise Windows PowerShell — the script runs on both.
$shell = (Get-Command pwsh -ErrorAction SilentlyContinue)?.Source
if (-not $shell) { $shell = (Get-Command powershell).Source }

$action = New-ScheduledTaskAction -Execute $shell `
    -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$watchdog`" -Port $Port" `
    -WorkingDirectory $projectRoot

$trigger  = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
# Keep it running indefinitely and restart it if it ever exits.
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
    -StartWhenAvailable -MultipleInstances IgnoreNew

if (Get-Task) { Unregister-ScheduledTask -TaskName $taskName -Confirm:$false }

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings `
    -Description "Keeps the chai-transcribe Whisper server alive and restarts it after a crash or reboot." | Out-Null

Start-ScheduledTask -TaskName $taskName

Write-Host "Watchdog installed and running." -ForegroundColor Green
Write-Host "  It checks the server every 30s and restarts it if it stops answering."
Write-Host "  Log: logs\watchdog.log   Server output: logs\whisper-server.log"
Write-Host "  Remove with: .\scripts\install-watchdog.ps1 -Uninstall"
