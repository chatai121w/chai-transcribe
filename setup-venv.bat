@echo off
REM ============================================================
REM  Smart Hebrew Transcriber - double-click to create the venv
REM  Pass -Cuda for the GPU build:  setup-venv.bat -Cuda
REM ============================================================
cd /d "%~dp0"

where pwsh >nul 2>&1
if %errorlevel%==0 (
  pwsh -NoProfile -ExecutionPolicy Bypass -File ".\setup-venv.ps1" %*
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File ".\setup-venv.ps1" %*
)
