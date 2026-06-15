@echo off
setlocal
cd /d "%~dp0"

echo ========================================
echo Smart Hebrew Transcriber - One Click
echo Starting EVERYTHING for website use...
echo ========================================
echo.

if not exist "scripts\start-remote.ps1" (
  echo [ERROR] Missing scripts\start-remote.ps1
  pause
  exit /b 1
)

where pwsh >nul 2>&1
if %errorlevel%==0 (
  pwsh -NoProfile -ExecutionPolicy Bypass -File ".\scripts\start-remote.ps1"
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File ".\scripts\start-remote.ps1"
)

endlocal
