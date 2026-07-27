@echo off
REM ============================================================
REM  Smart Hebrew Transcriber - double-click to run backend + frontend
REM ============================================================
cd /d "%~dp0"

where pwsh >nul 2>&1
if %errorlevel%==0 (
  pwsh -NoProfile -ExecutionPolicy Bypass -File ".\run-dev.ps1" %*
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File ".\run-dev.ps1" %*
)
