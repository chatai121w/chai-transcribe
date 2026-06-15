# Smart Hebrew Transcriber - Python Server Setup
# Installs PyTorch with CUDA and Whisper server dependencies

param(
    [string]$CudaVersion = "cu124"  # CUDA 12.4+ compatible with 12.9
)

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Smart Hebrew Transcriber - Server Setup" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# Check Python
$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) {
    Write-Host "[ERROR] Python not found. Install Python 3.10+ first." -ForegroundColor Red
    exit 1
}

$pyVersion = python --version 2>&1
Write-Host "  Python: $pyVersion" -ForegroundColor Green

# Check nvidia-smi
$gpu = nvidia-smi --query-gpu=name --format=csv,noheader 2>$null
if ($gpu) {
    Write-Host "  GPU: $gpu" -ForegroundColor Green
} else {
    Write-Host "  GPU: Not detected (will use CPU)" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "  Installing PyTorch with CUDA support..." -ForegroundColor Yellow
Write-Host ""

# Install PyTorch with CUDA
pip install torch --index-url "https://download.pytorch.org/whl/$CudaVersion" --quiet 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "  PyTorch CUDA install failed, trying default..." -ForegroundColor Yellow
    pip install torch --quiet
}

Write-Host ""
Write-Host "  Installing faster-whisper, flask, flask-cors..." -ForegroundColor Yellow
pip install faster-whisper flask flask-cors --quiet

Write-Host ""
Write-Host "  Verifying installation..." -ForegroundColor Yellow
python -c @"
import torch
print(f'  PyTorch: {torch.__version__}')
print(f'  CUDA available: {torch.cuda.is_available()}')
if torch.cuda.is_available():
    print(f'  GPU: {torch.cuda.get_device_name(0)}')
    print(f'  VRAM: {torch.cuda.get_device_properties(0).total_mem / 1024**3:.1f} GB')
import faster_whisper
print(f'  faster-whisper: OK')
from flask import Flask
print(f'  Flask: OK')
print()
print('  All dependencies installed successfully!')
"@

Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "  Setup complete!" -ForegroundColor Green
Write-Host "  Run: python server/transcribe_server.py" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""
