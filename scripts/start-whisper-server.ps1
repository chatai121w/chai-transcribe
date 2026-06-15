# ============================================
# Start Local Whisper Server (CUDA)
# ============================================
# Starts the faster-whisper transcription server
# using the venv-whisper virtual environment.
#
# Usage:
#   .\scripts\start-whisper-server.ps1
#   .\scripts\start-whisper-server.ps1 -Port 3000 -Model ivrit-ai/faster-whisper-v2-d4
# ============================================

param(
    [int]$Port = 3000,
    [string]$Model = "ivrit-ai/whisper-large-v3-turbo-ct2"
)

$projectRoot = Split-Path -Parent $PSScriptRoot

# Check .venv first, then venv-whisper (legacy)
$venvPython = Join-Path $projectRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $venvPython)) {
    $venvPython = Join-Path $projectRoot "venv-whisper\Scripts\python.exe"
}

if (-not (Test-Path $venvPython)) {
    Write-Host "[ERROR] No virtual environment found (.venv or venv-whisper)." -ForegroundColor Red
    Write-Host "  Run: .\scripts\setup-offline.ps1" -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Smart Hebrew Transcriber - Whisper Server" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Port  : $Port" -ForegroundColor Yellow
Write-Host "  Model : $Model" -ForegroundColor Yellow
Write-Host ""
Write-Host "  Press Ctrl+C to stop" -ForegroundColor Gray
Write-Host ""

Push-Location $projectRoot
& $venvPython server/transcribe_server.py --port $Port --model $Model
Pop-Location
