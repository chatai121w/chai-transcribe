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
$startupFolder = [Environment]::GetFolderPath('Startup')
$shortcutPath = Join-Path $startupFolder "SmartTranscriber.lnk"
$taskRegistered = $false

# --- Remove ---
if ($Remove) {
    Write-Host "Removing launcher from startup..." -ForegroundColor Yellow
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
    if (Test-Path $shortcutPath) { Remove-Item $shortcutPath -Force }
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

    try {
        Register-ScheduledTask `
            -TaskName $taskName `
            -Action $action `
            -Trigger $trigger `
            -Settings $settings `
            -Description "Smart Hebrew Transcriber - Tray launcher (ports 8764-8773)" `
            -RunLevel Limited `
            -Force `
            -ErrorAction Stop | Out-Null
        $taskRegistered = $true
        if (Test-Path $shortcutPath) { Remove-Item $shortcutPath -Force }
        Write-Host "      [V] Registered as startup task!" -ForegroundColor Green
    } catch {
        # Per-user Startup does not require administrator privileges.
        $shell = New-Object -ComObject WScript.Shell
        $shortcut = $shell.CreateShortcut($shortcutPath)
        $shortcut.TargetPath = $exePath
        $shortcut.Arguments = "`"$launcherScript`""
        $shortcut.WorkingDirectory = $projectRoot
        $shortcut.WindowStyle = 7
        $shortcut.Description = "Smart Hebrew Transcriber - Local Launcher"
        $shortcut.Save()
        Write-Host "      [V] Registered in the current user's Startup folder (no admin required)." -ForegroundColor Green
    }
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
if ($Run -and -not $AutoStart) {
    Write-Host "Starting tray launcher..." -ForegroundColor Cyan
    $exePath = if (Test-Path $venvPythonW) { $venvPythonW } else { $venvPython }
    Start-Process -FilePath $exePath -ArgumentList "`"$launcherScript`"" -WorkingDirectory $projectRoot -WindowStyle Hidden
    Write-Host "[V] Tray launcher started! Look for the icon in the system tray." -ForegroundColor Green
}

# Start scheduled task only if it exists
if ($AutoStart) {
    Write-Host ""
    Write-Host "Starting launcher now..." -ForegroundColor Yellow
    try {
        if ($taskRegistered) {
            Start-ScheduledTask -TaskName $taskName -ErrorAction Stop
        } else {
            Start-Process -FilePath $exePath -ArgumentList "`"$launcherScript`"" -WorkingDirectory $projectRoot -WindowStyle Hidden
        }
        Start-Sleep -Seconds 2
        try {
            $r = $null
            foreach ($candidate in 8764..8773) {
                try {
                    $r = Invoke-RestMethod -Uri "http://127.0.0.1:$candidate/health" -TimeoutSec 1 -ErrorAction Stop
                    if ($r.launcher) { break }
                } catch { }
            }
            if (-not $r) { throw 'Launcher health endpoint not found' }
            Write-Host "[V] Launcher running on port $($r.launcher_port)! Status:" -ForegroundColor Green
            Write-Host "    Whisper: $($r.whisper.running)" -ForegroundColor Gray
            Write-Host "    Ollama:  $($r.ollama.running)" -ForegroundColor Gray
        } catch {
            Write-Host "[!] Launcher starting... may take a moment" -ForegroundColor Yellow
        }
    } catch {
        Write-Host "[!] Could not start task: $_" -ForegroundColor Yellow
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
