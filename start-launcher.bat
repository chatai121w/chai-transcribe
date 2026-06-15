@echo off
cd /d "%~dp0"

:: Start launcher tray in background (hidden window)
if exist ".venv\Scripts\pythonw.exe" (
    start "" /b ".venv\Scripts\pythonw.exe" "server\launcher_tray.py"
) else if exist "venv-whisper\Scripts\pythonw.exe" (
    start "" /b "venv-whisper\Scripts\pythonw.exe" "server\launcher_tray.py"
) else if exist ".venv\Scripts\python.exe" (
    start /min "" ".venv\Scripts\python.exe" "server\launcher_tray.py"
) else (
    echo [ERROR] Python not found!
    timeout /t 5
    exit /b 1
)
