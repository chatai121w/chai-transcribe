@echo off
REM ============================================================
REM  Smart Hebrew Transcriber - double-click for MAX ACCURACY mode
REM  (full ivrit-ai/whisper-large-v3-ct2 model)
REM ============================================================
cd /d "%~dp0"

where pwsh >nul 2>&1
if %errorlevel%==0 (
  pwsh -NoProfile -ExecutionPolicy Bypass -File ".\run-accurate.ps1" %*
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File ".\run-accurate.ps1" %*
)
