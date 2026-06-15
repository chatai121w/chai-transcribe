# ============================================
#  Install Launcher Tray as Windows Startup
# ============================================
#  Installs pystray + Pillow, then optionally
#  registers the tray launcher as a Windows
#  startup task.
#
#  Usage:
#    .\scripts\install-launcher.ps1              # install deps only
#    .\scripts\install-launcher.ps1 -AutoStart   # + register startup
#    .\scripts\install-launcher.ps1 -Remove      # remove startup task
#    .\scripts\install-launcher.ps1 -Run         # run tray now
# ============================================

param(
    [switch]$AutoStart,
    [switch]$Remove,
    [switch]$Run
)

$projectRoot = Split-Path -Parent $PSScriptRoot
$taskName = "SmartTranscriberLauncher"

# Find pip
$venvPip = Join-Path $projectRoot ".venv\Scripts\pip.exe"
if (-not (Test-Path $venvPip)) {
    $venvPip = Join-Path $projectRoot "venv-whisper\Scripts\pip.exe"
}

# Find pythonw (silent) or python (with window)
$venvPythonW = Join-Path $projectRoot ".venv\Scripts\pythonw.exe"
if (-not (Test-Path $venvPythonW)) {
    $venvPythonW = Join-Path $projectRoot "venv-whisper\Scripts\pythonw.exe"
}
$venvPython = Join-Path $projectRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $venvPython)) {
    $venvPython = Join-Path $projectRoot "venv-whisper\Scripts\python.exe"
}

$launcherScript = Join-Path $projectRoot "server\launcher_tray.py"

# --- Remove ---
if ($Remove) {
    Write-Host "Removing launcher from startup..." -ForegroundColor Yellow
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host "[V] Removed!" -ForegroundColor Green
    exit 0
}

if (-not (Test-Path $venvPython)) {
    Write-Host "[X] Python not found. Run install-whisper-server.ps1 first." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Install Launcher Tray Service" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# --- Install dependencies ---
Write-Host "[1/2] Installing pystray + Pillow..." -ForegroundColor Yellow
if (Test-Path $venvPip) {
    & $venvPip install pystray Pillow --quiet 2>$null
    Write-Host "      [V] Dependencies installed" -ForegroundColor Green
} else {
    Write-Host "      [!] pip not found, trying python -m pip..." -ForegroundColor Yellow
    & $venvPython -m pip install pystray Pillow --quiet 2>$null
}

# --- AutoStart ---
if ($AutoStart) {
    Write-Host "[2/2] Registering as startup task..." -ForegroundColor Yellow

    $exePath = if (Test-Path $venvPythonW) { $venvPythonW } else { $venvPython }
    Write-Host "      Python: $exePath" -ForegroundColor Gray
    Write-Host "      Script: $launcherScript" -ForegroundColor Gray

    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

    $action = New-ScheduledTaskAction `
        -Execute $exePath `
        -Argument "`"$launcherScript`"" `
        -WorkingDirectory $projectRoot

    $trigger = New-ScheduledTaskTrigger -AtLogOn
    $settings = New-ScheduledTaskSettingsSet `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries `
        -StartWhenAvailable `
        -ExecutionTimeLimit ([TimeSpan]::Zero)

    Register-ScheduledTask `
        -TaskName $taskName `
        -Action $action `
        -Trigger $trigger `
        -Settings $settings `
        -Description "Smart Hebrew Transcriber - Tray launcher (port 8764)" `
        -RunLevel Limited `
        -Force | Out-Null

    Write-Host "      [V] Registered as startup task!" -ForegroundColor Green
} else {
    Write-Host "[2/2] Skipping startup registration (use -AutoStart to enable)" -ForegroundColor Gray
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Installation complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "  To run tray now:   .\scripts\install-launcher.ps1 -Run" -ForegroundColor Gray
Write-Host "  To add auto-start: .\scripts\install-launcher.ps1 -AutoStart" -ForegroundColor Gray
Write-Host "  To remove:         .\scripts\install-launcher.ps1 -Remove" -ForegroundColor Gray
Write-Host ""

# --- Run now ---
if ($Run) {
    Write-Host "Starting tray launcher..." -ForegroundColor Cyan
    $exePath = if (Test-Path $venvPythonW) { $venvPythonW } else { $venvPython }
    Start-Process -FilePath $exePath -ArgumentList "`"$launcherScript`"" -WorkingDirectory $projectRoot
    Write-Host "[V] Tray launcher started! Look for the icon in the system tray." -ForegroundColor Green
}

# Start scheduled task only if it exists
if ($AutoStart) {
    Write-Host ""
    Write-Host "Starting launcher now..." -ForegroundColor Yellow
    try {
        Start-ScheduledTask -TaskName $taskName -ErrorAction Stop
        Start-Sleep -Seconds 2
        try {
            $r = Invoke-RestMethod -Uri "http://localhost:8764/health" -TimeoutSec 3
            Write-Host "[V] Launcher running! Status:" -ForegroundColor Green
            Write-Host "    Whisper: $($r.whisper.running)" -ForegroundColor Gray
            Write-Host "    Ollama:  $($r.ollama.running)" -ForegroundColor Gray
        } catch {
            Write-Host "[!] Launcher starting... may take a moment" -ForegroundColor Yellow
        }
    } catch {
        Write-Host "[!] Could not start task: $_" -ForegroundColor Yellow
    }
}

# --- Create startup shortcut (.bat in shell:startup) ---
$startupFolder = [Environment]::GetFolderPath('Startup')
$batSource = Join-Path $projectRoot "start-launcher.bat"
$shortcutPath = Join-Path $startupFolder "SmartTranscriber.lnk"

if ($AutoStart -and (Test-Path $batSource)) {
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $batSource
    $shortcut.WorkingDirectory = $projectRoot
    $shortcut.WindowStyle = 7  # Minimized
    $shortcut.Description = "Smart Hebrew Transcriber - Tray Launcher"
    $shortcut.Save()
    Write-Host "[V] Startup shortcut created: $shortcutPath" -ForegroundColor Green
}

if ($Remove) {
    if (Test-Path $shortcutPath) {
        Remove-Item $shortcutPath -Force
        Write-Host "[V] Startup shortcut removed" -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
if ($AutoStart) {
    Write-Host "  Done! Launcher will auto-start on boot" -ForegroundColor Green
} else {
    Write-Host "  Done!" -ForegroundColor Green
}
Write-Host "  To remove: .\scripts\install-launcher.ps1 -Remove" -ForegroundColor Gray
Write-Host "========================================" -ForegroundColor Green
