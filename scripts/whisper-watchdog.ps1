# ===========================================
#  Whisper server watchdog
# ===========================================
#  Keeps the local transcription server alive. It is started once and then
#  nothing supervises it, so a machine crash, a reboot or an accidental kill
#  leaves it down until someone notices — usually as an unexplained 502.
#
#  This polls /health and restarts the server whenever it stops answering.
#  Everything it does is written to logs/watchdog.log, and the server's own
#  output finally lands in logs/whisper-server.log instead of a hidden window.
#
#  Run directly:
#    .\scripts\whisper-watchdog.ps1
#  Install as a logon task (recommended):
#    .\scripts\install-watchdog.ps1
# ===========================================

param(
    [int]$Port = 3000,
    [int]$IntervalSeconds = 30,
    [string]$Model = "ivrit-ai/whisper-large-v3-turbo-ct2",
    # Give a starting server time to load its model before judging it dead.
    [int]$StartupGraceSeconds = 180
)

$ErrorActionPreference = "Continue"
$projectRoot = Split-Path -Parent $PSScriptRoot
$logDir      = Join-Path $projectRoot "logs"
$watchdogLog = Join-Path $logDir "watchdog.log"
$serverLog   = Join-Path $logDir "whisper-server.log"
$serverErr   = Join-Path $logDir "whisper-server.err.log"

if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }

function Write-WatchdogLog {
    param([string]$Message, [string]$Level = "INFO")
    $line = "{0} [{1}] {2}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Level, $Message
    Add-Content -Path $watchdogLog -Value $line -Encoding UTF8
    Write-Host $line
}

function Get-PythonExe {
    foreach ($candidate in @("venv-whisper\Scripts\python.exe", ".venv\Scripts\python.exe")) {
        $full = Join-Path $projectRoot $candidate
        if (Test-Path $full) { return $full }
    }
    return $null
}

function Test-ServerHealthy {
    try {
        $r = Invoke-RestMethod -Uri "http://localhost:$Port/health" -TimeoutSec 5 -ErrorAction Stop
        return $r.status -eq "ok"
    } catch {
        return $false
    }
}

function Get-ServerProcess {
    Get-CimInstance Win32_Process -Filter "Name='python.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -like "*transcribe_server*" -and $_.CommandLine -like "*--port $Port*" }
}

function Start-WhisperServer {
    $python = Get-PythonExe
    if (-not $python) {
        Write-WatchdogLog "No Python venv found — cannot start the server. Run scripts\setup-venv.ps1" "ERROR"
        return $false
    }
    $script = Join-Path $projectRoot "server\transcribe_server.py"
    if (-not (Test-Path $script)) {
        Write-WatchdogLog "Server script missing at $script" "ERROR"
        return $false
    }

    # Roll the log so a restart loop cannot fill the disk.
    foreach ($f in @($serverLog, $serverErr)) {
        if ((Test-Path $f) -and ((Get-Item $f).Length -gt 20MB)) {
            Move-Item $f "$f.1" -Force -ErrorAction SilentlyContinue
        }
    }

    Write-WatchdogLog "Starting server on port $Port (model: $Model)"
    Start-Process -FilePath $python `
        -ArgumentList "`"$script`" --port $Port --model `"$Model`"" `
        -WorkingDirectory $projectRoot `
        -WindowStyle Hidden `
        -RedirectStandardOutput $serverLog `
        -RedirectStandardError $serverErr
    return $true
}

Write-WatchdogLog "Watchdog started — checking port $Port every ${IntervalSeconds}s"

$startedAt = $null
while ($true) {
    if (Test-ServerHealthy) {
        if ($null -ne $startedAt) {
            Write-WatchdogLog "Server is healthy again"
            $startedAt = $null
        }
    } else {
        $proc = Get-ServerProcess
        if ($null -ne $startedAt -and ((Get-Date) - $startedAt).TotalSeconds -lt $StartupGraceSeconds -and $proc) {
            # Still loading its model — not dead, just slow.
        } elseif ($proc -and $null -eq $startedAt) {
            # Process exists but is not answering: it is wedged, not starting.
            Write-WatchdogLog "Process alive but /health not answering — restarting" "WARN"
            $proc | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
            Start-Sleep -Seconds 2
            if (Start-WhisperServer) { $startedAt = Get-Date }
        } else {
            if ($null -eq $startedAt) { Write-WatchdogLog "Server is down" "WARN" }
            if (Start-WhisperServer) { $startedAt = Get-Date }
        }
    }
    Start-Sleep -Seconds $IntervalSeconds
}
