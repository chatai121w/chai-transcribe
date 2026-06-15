# ============================================
# Install Local Whisper Server (CUDA)
# ============================================
# Installs Python dependencies for running
# ivrit-ai Hebrew models on your NVIDIA GPU.
#
# Usage: .\scripts\install-whisper-server.ps1
# Usage: .\scripts\install-whisper-server.ps1 -WithWhisperX
# ============================================

param(
    [switch]$WithWhisperX
)

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Install Local Whisper Server (CUDA)" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# Check Python
$python = $null
foreach ($cmd in @("python", "python3", "py")) {
    $found = Get-Command $cmd -ErrorAction SilentlyContinue
    if ($found) {
        $python = $cmd
        break
    }
}

if (-not $python) {
    Write-Host "[ERROR] Python not found! Install Python 3.10+ from https://www.python.org/downloads/" -ForegroundColor Red
    Write-Host "  Make sure to check 'Add Python to PATH' during installation." -ForegroundColor Yellow
    exit 1
}

$pyVersion = & $python --version 2>&1
Write-Host "[OK] Found: $pyVersion" -ForegroundColor Green

# Check NVIDIA GPU
Write-Host ""
Write-Host "Checking GPU..." -ForegroundColor Yellow
$nvidiaSmi = Get-Command "nvidia-smi" -ErrorAction SilentlyContinue
if ($nvidiaSmi) {
    $gpuInfo = & nvidia-smi --query-gpu=name,memory.total --format=csv,noheader 2>&1
    Write-Host "[OK] GPU: $gpuInfo" -ForegroundColor Green
} else {
    Write-Host "[WARN] nvidia-smi not found. Server will use CPU mode (slower)." -ForegroundColor Yellow
}

# Create virtual environment (.venv is current standard; venv-whisper is legacy)
$venvPath = Join-Path $PSScriptRoot "..\.venv"
if (-not (Test-Path $venvPath)) {
    Write-Host ""
    Write-Host "Creating virtual environment..." -ForegroundColor Yellow
    & $python -m venv $venvPath
    Write-Host "[OK] Virtual environment created at: $venvPath" -ForegroundColor Green
} else {
    Write-Host "[OK] Virtual environment exists: $venvPath" -ForegroundColor Green
}

# Activate and install
$pipPath = Join-Path $venvPath "Scripts\pip.exe"
$pythonVenv = Join-Path $venvPath "Scripts\python.exe"

Write-Host ""
Write-Host "Installing dependencies (this may take a few minutes)..." -ForegroundColor Yellow

# Upgrade pip
& $pythonVenv -m pip install --upgrade pip 2>&1 | Out-Null

# Install PyTorch with CUDA 12.8 (compatible with CUDA 12.9 drivers)
Write-Host "  [1/3] Installing PyTorch with CUDA..." -ForegroundColor Cyan
& $pipPath install torch torchaudio --index-url https://download.pytorch.org/whl/cu128 2>&1 | ForEach-Object {
    if ($_ -match "Successfully installed") { Write-Host "  $_" -ForegroundColor Green }
}

# Install faster-whisper
Write-Host "  [2/3] Installing faster-whisper + CTranslate2..." -ForegroundColor Cyan
& $pipPath install faster-whisper 2>&1 | ForEach-Object {
    if ($_ -match "Successfully installed") { Write-Host "  $_" -ForegroundColor Green }
}

# Install Flask server
Write-Host "  [3/3] Installing Flask server..." -ForegroundColor Cyan
& $pipPath install flask flask-cors 2>&1 | ForEach-Object {
    if ($_ -match "Successfully installed") { Write-Host "  $_" -ForegroundColor Green }
}

if ($WithWhisperX) {
    Write-Host "  [4/4] Installing WhisperX (alignment + diarization)..." -ForegroundColor Cyan
    & $pipPath install whisperx 2>&1 | ForEach-Object {
        if ($_ -match "Successfully installed") { Write-Host "  $_" -ForegroundColor Green }
    }
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "  Installation Complete!" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""
Write-Host "  To start the server:" -ForegroundColor Yellow
Write-Host "    .\scripts\start-whisper-server.ps1" -ForegroundColor White
Write-Host "" 
Write-Host "  To install WhisperX support:" -ForegroundColor Yellow
Write-Host "    .\scripts\install-whisper-server.ps1 -WithWhisperX" -ForegroundColor White
Write-Host ""
Write-Host "  Or with specific model:" -ForegroundColor Yellow
Write-Host "    .\scripts\start-whisper-server.ps1 -Model 'ivrit-ai/whisper-v2-d4-e3'" -ForegroundColor White
Write-Host ""
Write-Host "  Available models:" -ForegroundColor Yellow
Write-Host "    ivrit-ai/whisper-large-v3-turbo  (recommended - fast + Hebrew)" -ForegroundColor White
Write-Host "    ivrit-ai/whisper-v2-d4-e3         (best Hebrew accuracy)" -ForegroundColor White
Write-Host "    openai/whisper-large-v3-turbo     (general purpose)" -ForegroundColor White
Write-Host "    openai/whisper-large-v3           (highest accuracy)" -ForegroundColor White
Write-Host ""
