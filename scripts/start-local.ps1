# ===========================================
#  Start ALL Local - CUDA + Ollama + Vite
# ===========================================
#  One command to start everything for local development:
#  1. Ollama (AI text editing)
#  2. CUDA Whisper server (transcription)
#  3. Vite dev server (frontend)
#
#  Usage:
#    .\scripts\start-local.ps1
#    .\scripts\start-local.ps1 -VitePort 3000
# ===========================================

param(
    [int]$VitePort = 8080,
    [int]$WhisperPort = 3000,
    [string]$Model = "ivrit-ai/whisper-large-v3-turbo-ct2"
)

$ErrorActionPreference = "Continue"
$projectRoot = Split-Path -Parent $PSScriptRoot

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Smart Hebrew Transcriber" -ForegroundColor Cyan
Write-Host "  Full Local Development" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# --- 1. Ollama ---
Write-Host "[1/4] Starting Ollama..." -ForegroundColor Yellow
$env:OLLAMA_ORIGINS = "*"
$ollamaCmd = Get-Command ollama -ErrorAction SilentlyContinue
if ($ollamaCmd) {
    $existing = Get-Process ollama -ErrorAction SilentlyContinue
    if ($existing) {
        Write-Host "      [V] Ollama already running" -ForegroundColor Green
    } else {
        Start-Process -FilePath "ollama" -ArgumentList "serve" -WindowStyle Hidden
        Start-Sleep -Seconds 2
        Write-Host "      [V] Ollama started" -ForegroundColor Green
    }
} else {
    Write-Host "      [!] Ollama not installed (optional)" -ForegroundColor Gray
}

# --- 2. CUDA Whisper Server ---
Write-Host "[2/4] Starting CUDA Whisper server..." -ForegroundColor Yellow
$serverRunning = $false
try {
    $r = Invoke-RestMethod -Uri "http://localhost:$WhisperPort/health" -TimeoutSec 3
    Write-Host "      [V] Already running ($($r.gpu))" -ForegroundColor Green
    $serverRunning = $true
} catch {}

if (-not $serverRunning) {
    # Find python venv
    $venvPython = Join-Path $projectRoot "venv-whisper\Scripts\python.exe"
    if (-not (Test-Path $venvPython)) {
        $venvPython = Join-Path $projectRoot ".venv\Scripts\python.exe"
    }

    if (Test-Path $venvPython) {
        $serverScript = Join-Path $projectRoot "server\transcribe_server.py"
        Start-Process -FilePath $venvPython `
            -ArgumentList "$serverScript --port $WhisperPort --model `"$Model`"" `
            -WorkingDirectory $projectRoot `
            -WindowStyle Minimized
        Write-Host "      [V] CUDA server starting (port $WhisperPort)..." -ForegroundColor Green

        # Wait briefly for server
        $maxWait = 30
        $waited = 0
        while ($waited -lt $maxWait) {
            Start-Sleep -Seconds 2
            $waited += 2
            try {
                $r = Invoke-RestMethod -Uri "http://localhost:$WhisperPort/health" -TimeoutSec 3
                Write-Host "      [V] CUDA server ready! GPU: $($r.gpu)" -ForegroundColor Green
                break
            } catch {
                Write-Host "      Waiting for CUDA... ($waited`s)" -ForegroundColor Gray -NoNewline
                Write-Host "`r" -NoNewline
            }
        }
    } else {
        Write-Host "      [X] Python venv not found!" -ForegroundColor Red
        Write-Host "      Run: .\scripts\install-whisper-server.ps1" -ForegroundColor Yellow
    }
}

# --- 3. npm deps ---
Write-Host "[3/4] Checking npm dependencies..." -ForegroundColor Yellow
Push-Location $projectRoot
if (-not (Test-Path "node_modules")) {
    Write-Host "      Installing npm packages..." -ForegroundColor Gray
    npm install --silent 2>$null
    Write-Host "      [V] Dependencies installed" -ForegroundColor Green
} else {
    Write-Host "      [V] Dependencies OK" -ForegroundColor Green
}

# --- 4. Vite Dev Server ---
Write-Host "[4/4] Starting Vite dev server..." -ForegroundColor Yellow
Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Everything is running!" -ForegroundColor Green
Write-Host "  App:     http://localhost:$VitePort" -ForegroundColor Green
Write-Host "  CUDA:    http://localhost:$WhisperPort" -ForegroundColor Green
Write-Host "  Ollama:  http://localhost:11434" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""

# Open browser
Start-Process "http://localhost:$VitePort"

Write-Host "Press Ctrl+C to stop Vite (CUDA server stays running)" -ForegroundColor Gray
Write-Host ""

npm run dev -- --port $VitePort

Pop-Location
