@echo off
chcp 65001 >nul
title הסרה — קלט קולי עברית

:: ─────────────────────────────────────────────────────────────
:: uninstall-startup.bat
:: מסיר את הכלי מהפעלה אוטומטית עם Windows
:: ─────────────────────────────────────────────────────────────

set STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
set TARGET=%STARTUP%\voice-hotkey.vbs

echo  ════════════════════════════════════════
echo    הסרת קלט קולי עברית מהפעלה אוטומטית
echo  ════════════════════════════════════════
echo.

if exist "%TARGET%" (
    del "%TARGET%"
    if %errorlevel%==0 (
        echo  ✅ הוסר בהצלחה מהפעלה אוטומטית.
        echo  הכלי לא יעלה יותר עם Windows.
    ) else (
        echo  ❌ שגיאה בהסרה
    )
) else (
    echo  ⚠️  הכלי לא היה מותקן כהפעלה אוטומטית.
)

echo.
pause
