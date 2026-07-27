@echo off
REM ============================================================
REM  Double-click to download + GPU-test the full accurate model
REM ============================================================
cd /d "%~dp0"

where pwsh >nul 2>&1
if %errorlevel%==0 (
  pwsh -NoProfile -ExecutionPolicy Bypass -File ".\download-model.ps1"
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File ".\download-model.ps1"
)
