@echo off
chcp 65001 >nul
title התקנה — קלט קולי עברית עם Windows

:: ─────────────────────────────────────────────────────────────
:: install-startup.bat
:: מוסיף את start-hidden.vbs לתיקיית ההפעלה האוטומטית של Windows
:: כך שהכלי יעלה עם כל כניסה למשתמש — ללא חלון, ברקע
:: ─────────────────────────────────────────────────────────────

set HERE=%~dp0
set VBS_SRC=%HERE%start-hidden.vbs
set STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
set VBS_DST=%STARTUP%\voice-hotkey.vbs

echo  ════════════════════════════════════════
echo    התקנת קלט קולי עברית — הפעלה אוטומטית
echo  ════════════════════════════════════════
echo.

:: בדוק שהקובץ המקור קיים
if not exist "%VBS_SRC%" (
    echo [שגיאה] לא נמצא: %VBS_SRC%
    pause & exit /b 1
)

:: העתק לתיקיית Startup
copy /Y "%VBS_SRC%" "%VBS_DST%" >nul

if %errorlevel%==0 (
    echo  ✅ הותקן בהצלחה!
    echo.
    echo  הכלי יתחיל אוטומטית עם כל כניסה ל-Windows.
    echo  קיצור: CTRL+SHIFT+H
    echo.
    echo  מיקום: %VBS_DST%
    echo.
    echo  להסרה: הרץ את uninstall-startup.bat
) else (
    echo  ❌ שגיאה בהתקנה — נסה להריץ כמנהל מערכת
)

echo.
pause
