@echo off
chcp 65001 >nul
set SRC=%~dp0start-hidden.vbs
set DEST=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\voice-command-hebrew.vbs

copy /Y "%SRC%" "%DEST%" >nul
if %ERRORLEVEL%==0 (
    echo [OK] הותקן בהפעלה אוטומטית:
    echo      %DEST%
    echo.
    echo להפעיל עכשיו בלי לאפס:
    echo   cscript "%DEST%"
) else (
    echo [ERROR] ההתקנה נכשלה
)
pause
