param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
  [string]$TaskName = "SmartTranscriber-ContinuousMonitor",
  [string]$LogRoot = "$env:LOCALAPPDATA\SmartTranscriber\monitor",
  [string]$StartupShortcutName = "SmartTranscriber-ContinuousMonitor.lnk",
  [switch]$Remove
)

$ErrorActionPreference = "Stop"

$monitorScript = Join-Path $PSScriptRoot "continuous-monitor.ps1"
if (-not (Test-Path $monitorScript)) {
  throw "Monitor script not found: $monitorScript"
}

$startupFolder = [Environment]::GetFolderPath('Startup')
$shortcutPath = Join-Path $startupFolder $StartupShortcutName

if ($Remove) {
  $existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($existing) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Removed scheduled task: $TaskName" -ForegroundColor Yellow
  } else {
    Write-Host "Task not found: $TaskName" -ForegroundColor DarkYellow
  }

  if (Test-Path $shortcutPath) {
    Remove-Item -Path $shortcutPath -Force
    Write-Host "Removed startup shortcut: $shortcutPath" -ForegroundColor Yellow
  }

  exit 0
}

$pwsh = (Get-Command powershell.exe).Source
$arg = "-NoProfile -ExecutionPolicy Bypass -File `"$monitorScript`" -ProjectRoot `"$ProjectRoot`" -LogRoot `"$LogRoot`" -IntervalSec 5"

$action = New-ScheduledTaskAction -Execute $pwsh -Argument $arg
$triggerLogon = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

$taskInstalled = $false
try {
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $triggerLogon -Settings $settings -Principal $principal -Force | Out-Null
  Start-ScheduledTask -TaskName $TaskName
  $taskInstalled = $true
  Write-Host "Installed and started monitor task: $TaskName" -ForegroundColor Green
} catch {
  Write-Host "Could not register scheduled task (likely permissions). Falling back to Startup shortcut." -ForegroundColor Yellow
}

if (-not $taskInstalled) {
  $wsh = New-Object -ComObject WScript.Shell
  $sc = $wsh.CreateShortcut($shortcutPath)
  $sc.TargetPath = $pwsh
  $sc.Arguments = $arg
  $sc.WorkingDirectory = $ProjectRoot
  $sc.WindowStyle = 7
  $sc.Description = "SmartTranscriber continuous monitor"
  $sc.Save()
  Write-Host "Installed startup shortcut: $shortcutPath" -ForegroundColor Green
}

Start-Process -FilePath $pwsh -ArgumentList $arg -WindowStyle Minimized
Write-Host "Started monitor process now." -ForegroundColor Green
Write-Host "Logs path: $LogRoot" -ForegroundColor Cyan
