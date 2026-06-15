@echo off
cd /d "%~dp0"
echo.
echo   Smart Hebrew Transcriber - Install
echo   ====================================
echo.
powershell -ExecutionPolicy Bypass -File ".\scripts\launcher-setup.ps1" -Install
echo.
pause
