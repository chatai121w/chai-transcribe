# ===========================================
#  Start Everything - Smart Hebrew Transcriber
#  Ollama + CUDA Whisper + Dev Server
# ===========================================

param(
    [int]$Port = 5050,
    [int]$WhisperPort = 3000
)

$ErrorActionPreference = "Continue"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Smart Hebrew Transcriber" -ForegroundColor Cyan
Write-Host "  Starting all services..." -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$projectRoot = Split-Path -Parent $PSScriptRoot

# --- 1. Start Ollama ---
Write-Host "[1/4] Starting Ollama server..." -ForegroundColor Yellow

$env:OLLAMA_ORIGINS = "*"
$ollamaCmd = Get-Command ollama -ErrorAction SilentlyContinue

if ($ollamaCmd) {
    $existing = Get-Process ollama -ErrorAction SilentlyContinue
    if ($existing) {
        Write-Host "      Ollama already running" -ForegroundColor Gray
    } else {
        Start-Process -FilePath "ollama" -ArgumentList "serve" -WindowStyle Hidden
        Start-Sleep -Seconds 3
    }
    
    try {
        $res = Invoke-RestMethod -Uri "http://localhost:11434/api/tags" -TimeoutSec 5
        $modelCount = ($res.models | Measure-Object).Count
        Write-Host "      [V] Ollama: $modelCount models available" -ForegroundColor Green
    } catch {
        Write-Host "      [!] Ollama: server starting..." -ForegroundColor Yellow
    }
} else {
    Write-Host "      [!] Ollama not installed - run .\scripts\setup-ollama.ps1 first" -ForegroundColor Yellow
}

# --- 2. CUDA Whisper Server ---
Write-Host "[2/4] Starting CUDA Whisper server..." -ForegroundColor Yellow
$serverRunning = $false
try {
    $r = Invoke-RestMethod -Uri "http://localhost:$WhisperPort/health" -TimeoutSec 3
    Write-Host "      [V] CUDA already running ($($r.gpu))" -ForegroundColor Green
    $serverRunning = $true
} catch {}

if (-not $serverRunning) {
    $venvPy = Join-Path $projectRoot "venv-whisper\Scripts\python.exe"
    if (-not (Test-Path $venvPy)) { $venvPy = Join-Path $projectRoot ".venv\Scripts\python.exe" }
    if (Test-Path $venvPy) {
        $serverScript = Join-Path $projectRoot "server\transcribe_server.py"
        Start-Process -FilePath $venvPy `
            -ArgumentList "$serverScript --port $WhisperPort" `
            -WorkingDirectory $projectRoot `
            -WindowStyle Minimized
        Write-Host "      [V] CUDA server starting (port $WhisperPort)..." -ForegroundColor Green
    } else {
        Write-Host "      [!] Python venv not found - run install-whisper-server.ps1" -ForegroundColor Yellow
    }
}

# --- 3. Install npm deps if needed ---
Write-Host "[3/4] Checking npm dependencies..." -ForegroundColor Yellow

Push-Location $projectRoot
if (-not (Test-Path "node_modules")) {
    Write-Host "      Installing npm packages..." -ForegroundColor Gray
    npm install --silent 2>$null
    Write-Host "      [V] Dependencies installed" -ForegroundColor Green
} else {
    Write-Host "      [V] Dependencies OK" -ForegroundColor Green
}

# --- 4. Start dev server ---
Write-Host "[4/4] Starting dev server on port $Port..." -ForegroundColor Yellow
Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Ready!" -ForegroundColor Green
Write-Host "  App:    http://localhost:$Port" -ForegroundColor Green
Write-Host "  CUDA:   http://localhost:$WhisperPort" -ForegroundColor Green
Write-Host "  Ollama: http://localhost:11434" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Press Ctrl+C to stop" -ForegroundColor Gray
Write-Host ""

npm run dev -- --port $Port

Pop-Location
