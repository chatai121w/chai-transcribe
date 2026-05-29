@echo off
chcp 65001 >nul
title Voice Command Listener — Hebrew

set REPO=%~dp0..\..
set PYTHON=%REPO%\.venv\Scripts\python.exe

if not exist "%PYTHON%" (
    echo [ERROR] לא נמצא Python ב-.venv
    echo         ודא שה-venv מותקן ב: %REPO%\.venv
    pause
    exit /b 1
)

echo ════════════════════════════════════════
echo   Voice Command Listener — Hebrew
echo   אמור "תמלל" להפעלת הקלטה
echo   Ctrl+C לעצירה
echo ════════════════════════════════════════
echo.

"%PYTHON%" "%~dp0voice_command_listener.py" %*

pause
