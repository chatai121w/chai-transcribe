# ============================================
#  One-Click: Start CUDA Server + Open Website
# ============================================
#  Starts the whisper CUDA server and opens
#  the Lovable website in your default browser.
#
#  Usage:
#    .\scripts\start-lovable.ps1
#    .\scripts\start-lovable.ps1 -Port 3000
# ============================================

param(
    [int]$Port = 3000,
    [string]$Model = "ivrit-ai/whisper-large-v3-turbo-ct2",
    [string]$Url = "https://a1add912-bd72-490b-949a-bf5fe8ed03b5.lovable.app"
)

$ErrorActionPreference = "Continue"
$projectRoot = Split-Path -Parent $PSScriptRoot

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Smart Hebrew Transcriber" -ForegroundColor Cyan
Write-Host "  One-Click Lovable Launcher" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# --- 1. Check if server already running ---
Write-Host "[1/4] Checking existing server..." -ForegroundColor Yellow
$serverRunning = $false
try {
    $r = Invoke-RestMethod -Uri "http://localhost:$Port/health" -TimeoutSec 3
    Write-Host "      [V] Server already running ($($r.gpu))" -ForegroundColor Green
    $serverRunning = $true
} catch {
    Write-Host "      Server not running - will start" -ForegroundColor Gray
}

# --- 2. Start Ollama if available ---
Write-Host "[2/4] Checking Ollama..." -ForegroundColor Yellow
$env:OLLAMA_ORIGINS = "*"
$ollamaCmd = Get-Command ollama -ErrorAction SilentlyContinue
if ($ollamaCmd) {
    $existing = Get-Process ollama -ErrorAction SilentlyContinue
    if ($existing) {
        Write-Host "      [V] Ollama already running" -ForegroundColor Green
    } else {
        Start-Process -FilePath "ollama" -ArgumentList "serve" -WindowStyle Hidden
        Write-Host "      [V] Ollama started" -ForegroundColor Green
    }
} else {
    Write-Host "      [!] Ollama not installed (optional)" -ForegroundColor Gray
}

# --- 3. Start CUDA server if needed ---
if (-not $serverRunning) {
    Write-Host "[3/4] Starting CUDA Whisper server..." -ForegroundColor Yellow

    # Find python
    $venvPython = Join-Path $projectRoot ".venv\Scripts\python.exe"
    if (-not (Test-Path $venvPython)) {
        $venvPython = Join-Path $projectRoot "venv-whisper\Scripts\python.exe"
    }
    if (-not (Test-Path $venvPython)) {
        Write-Host "      [X] No virtual environment found!" -ForegroundColor Red
        Write-Host "      Run: .\scripts\install-whisper-server.ps1" -ForegroundColor Yellow
        Read-Host "Press Enter to exit"
        exit 1
    }

    # Start server in background
    $serverScript = Join-Path $projectRoot "server\transcribe_server.py"
    Start-Process -FilePath $venvPython -ArgumentList "$serverScript --port $Port --model `"$Model`"" -WorkingDirectory $projectRoot -WindowStyle Minimized
    Write-Host "      Server starting..." -ForegroundColor Gray

    # Wait for server to be ready
    $maxWait = 60
    $waited = 0
    $ready = $false
    while ($waited -lt $maxWait) {
        Start-Sleep -Seconds 2
        $waited += 2
        try {
            $r = Invoke-RestMethod -Uri "http://localhost:$Port/health" -TimeoutSec 3
            Write-Host "      [V] Server ready! ($($r.gpu))" -ForegroundColor Green
            $ready = $true
            break
        } catch {
            Write-Host "      Waiting... ($waited`s)" -ForegroundColor Gray -NoNewline
            Write-Host "`r" -NoNewline
        }
    }

    if (-not $ready) {
        Write-Host "      [!] Server taking long to start, opening browser anyway..." -ForegroundColor Yellow
    }
} else {
    Write-Host "[3/4] Server already running - skipping" -ForegroundColor Green
}

# --- 4. Open browser ---
Write-Host "[4/4] Opening browser..." -ForegroundColor Yellow
Start-Process $Url
Write-Host "      [V] Browser opened" -ForegroundColor Green

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Ready! Server on localhost:$Port" -ForegroundColor Green
Write-Host "  Website: $Url" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Press Ctrl+C to stop, or close this window." -ForegroundColor Gray
Write-Host "The CUDA server will keep running in the background." -ForegroundColor Gray
Write-Host ""

# Keep window open so user sees status
Read-Host "Press Enter to exit"
