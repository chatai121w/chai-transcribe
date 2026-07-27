@echo off
REM ============================================================
REM  Double-click to safely pull everything from GitHub.
REM  Creates a full backup branch first — nothing is lost.
REM ============================================================
cd /d "%~dp0"

where pwsh >nul 2>&1
if %errorlevel%==0 (
  pwsh -NoProfile -ExecutionPolicy Bypass -File ".\git-sync.ps1"
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File ".\git-sync.ps1"
)
