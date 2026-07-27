# ============================================================
#  Smart Hebrew Transcriber - one-time venv setup
#  Creates .venv and installs server\requirements.txt into it.
#  Run once:  right-click > Run with PowerShell   (or setup-venv.bat)
#  Options :  .\setup-venv.ps1 -Cuda             (GPU build, default cu128 - RTX 50 series)
#             .\setup-venv.ps1 -Cuda -CudaTag cu126   (older GPU)
# ============================================================
param(
    [switch]$Cuda,                 # install GPU build of torch
    [string]$CudaTag = "cu128"     # CUDA wheel tag; cu128 = RTX 50 series (Blackwell / sm_120)
)

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Smart Hebrew Transcriber - venv setup" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan

# --- 1. Find a base Python to build the venv from ------------------------
$basePython = (Get-Command python -ErrorAction SilentlyContinue).Source
if (-not $basePython) { $basePython = (Get-Command py -ErrorAction SilentlyContinue).Source }
if (-not $basePython) {
    Write-Host "[ERROR] Python not found on PATH. Install Python 3.10-3.12 first." -ForegroundColor Red
    Read-Host "Press Enter to exit"; exit 1
}
Write-Host "[OK] Base Python: $basePython" -ForegroundColor Green

$venvDir    = Join-Path $PSScriptRoot ".venv"
$venvPython = Join-Path $venvDir "Scripts\python.exe"

# --- 2. Create the venv (skip if it already exists) ----------------------
if (Test-Path $venvPython) {
    Write-Host "[OK] .venv already exists - reusing it." -ForegroundColor Green
} else {
    Write-Host "[..] Creating .venv ..." -ForegroundColor Yellow
    & $basePython -m venv $venvDir
    if (-not (Test-Path $venvPython)) {
        Write-Host "[ERROR] Failed to create .venv." -ForegroundColor Red
        Read-Host "Press Enter to exit"; exit 1
    }
}

# --- 3. Upgrade pip ------------------------------------------------------
Write-Host "[..] Upgrading pip ..." -ForegroundColor Yellow
& $venvPython -m pip install --upgrade pip

# --- 4. Install project requirements -------------------------------------
$req = Join-Path $PSScriptRoot "server\requirements.txt"
Write-Host "[..] Installing server\requirements.txt (this can take a while) ..." -ForegroundColor Yellow
& $venvPython -m pip install -r $req

# --- 5. Install torch CUDA build LAST (CUDA build optional) ---------------
# Must come AFTER requirements.txt: requirements pins torch>=2.1.0 and would
# otherwise overwrite the GPU build with the default CPU build from PyPI.
# RTX 50 series (Blackwell, sm_120) needs cu128 wheels - cu121 will NOT run on it.
if ($Cuda) {
    Write-Host "[..] Installing CUDA build of torch ($CudaTag) - this replaces the CPU build ..." -ForegroundColor Yellow
    & $venvPython -m pip install --force-reinstall --no-cache-dir torch torchaudio --index-url "https://download.pytorch.org/whl/$CudaTag"
}

Write-Host ""
Write-Host "[DONE] .venv is ready." -ForegroundColor Green
Write-Host "  Start everything : .\run-dev.ps1" -ForegroundColor Green
Write-Host "  Or backend only  : .\scripts\start-whisper-server.ps1" -ForegroundColor Green
Read-Host "Press Enter to close"
