@echo off
chcp 65001 >nul
title קלט קולי עברית — Whisper

:: ─────────────────────────────────────────────────────────────
:: start.bat  —  מריץ את כלי הקלט הקולי עם חלון קונסול גלוי
:: לחץ פעמיים על קובץ זה להפעלה ידנית
:: ─────────────────────────────────────────────────────────────

:: מיקום התיקייה הנוכחית (תמיד נכון ללא קשר מאיפה מפעילים)
set HERE=%~dp0
set PROJECT=%HERE%..\..

:: python מהvenv של הפרויקט
set PYTHON=%PROJECT%\.venv\Scripts\python.exe

if not exist "%PYTHON%" (
    echo [שגיאה] Python לא נמצא ב: %PYTHON%
    echo ודא שהvenv הותקן: python -m venv .venv
    pause
    exit /b 1
)

echo  מפעיל קלט קולי...
echo  קיצור: CTRL+SHIFT+H
echo  לסגירה: סגור חלון זה או Ctrl+C
echo.

"%PYTHON%" "%HERE%voice_hotkey.py" %*
pause
