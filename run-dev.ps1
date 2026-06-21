# ============================================================
#  Smart Hebrew Transcriber - run backend + frontend (dev)
#  Backend : server\transcribe_server.py  ->  http://localhost:3000
#  Frontend: vite (npm run dev)           ->  http://localhost:8080
#  Usage   : right-click > Run with PowerShell   (or run run-dev.bat)
# ============================================================
param(
    [int]$Port      = 3000,    # backend port
    [string]$Model  = "",      # optional: override default Whisper model
    [switch]$NoPreload         # optional: don't preload the model at startup
)

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

Write-Host "========================================" -ForegroundColor Cyan
Write-Host " Smart Hebrew Transcriber - Dev launcher" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# --- 1. Find a Python interpreter ----------------------------------------
# Prefer a project venv (.venv, then venv-whisper); fall back to system python.
$python = $null
foreach ($dir in @(".venv", "venv-whisper")) {
    $candidate = Join-Path $PSScriptRoot "$dir\Scripts\python.exe"
    if (Test-Path $candidate) { $python = $candidate; break }
}
if (-not $python) {
    $cmd = Get-Command python -ErrorAction SilentlyContinue
    if ($cmd) { $python = $cmd.Source }
}
if (-not $python) {
    Write-Host "[ERROR] Python not found (no .venv / venv-whisper and no python on PATH)." -ForegroundColor Red
    Read-Host "Press Enter to exit"; exit 1
}
Write-Host "[OK] Python : $python" -ForegroundColor Green

# --- 2. Make sure frontend deps are installed ----------------------------
if (-not (Test-Path (Join-Path $PSScriptRoot "node_modules"))) {
    Write-Host "[..] node_modules missing - running 'npm install' (first run only)..." -ForegroundColor Yellow
    npm install
}

# --- 3. Build the backend argument list ----------------------------------
$serverScript = Join-Path $PSScriptRoot "server\transcribe_server.py"
$backendArgs  = @("`"$serverScript`"", "--port", "$Port")
if ($Model)     { $backendArgs += @("--model", "`"$Model`"") }
if ($NoPreload) { $backendArgs += "--no-preload" }

# --- 4. Start backend in its own window ----------------------------------
Write-Host "[..] Starting BACKEND  on http://localhost:$Port" -ForegroundColor Yellow
Start-Process -FilePath $python -ArgumentList $backendArgs -WorkingDirectory $PSScriptRoot

# --- 5. Start frontend in its own window ---------------------------------
Write-Host "[..] Starting FRONTEND on http://localhost:8080" -ForegroundColor Yellow
Start-Process -FilePath "cmd.exe" -ArgumentList "/k", "npm run dev" -WorkingDirectory $PSScriptRoot

Write-Host ""
Write-Host "Both started in separate windows." -ForegroundColor Green
Write-Host "  Frontend : http://localhost:8080" -ForegroundColor Green
Write-Host "  Backend  : http://localhost:$Port" -ForegroundColor Green
Write-Host "Close those windows (or Ctrl+C in each) to stop." -ForegroundColor DarkGray
