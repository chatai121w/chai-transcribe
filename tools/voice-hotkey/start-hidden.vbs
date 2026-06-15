' start-hidden.vbs
' ─────────────────────────────────────────────────────────────
' מריץ את voice_hotkey.py ב-pythonw.exe (ללא חלון קונסול)
' קובץ זה משמש להפעלה אוטומטית עם Windows (ראה install-startup.bat)
' ─────────────────────────────────────────────────────────────

Dim fso, shell, scriptDir, projectRoot, pythonExe, pyScript, cmd

Set fso   = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

' תיקיית הסקריפט הנוכחי
scriptDir   = fso.GetParentFolderName(WScript.ScriptFullName)

' שורש הפרויקט = שתי תיקיות מעל (tools/voice-hotkey → tools → project)
projectRoot = fso.GetParentFolderName(fso.GetParentFolderName(scriptDir))

' pythonw.exe — מריץ Python ללא חלון קונסול
pythonExe = projectRoot & "\.venv\Scripts\pythonw.exe"

' הסקריפט הראשי
pyScript  = scriptDir & "\voice_hotkey.py"

' בדיקה שהקבצים קיימים
If Not fso.FileExists(pythonExe) Then
    MsgBox "Python לא נמצא:" & vbCrLf & pythonExe & vbCrLf & vbCrLf & _
           "ודא שהvenv הותקן בשורש הפרויקט.", _
           vbCritical, "Voice Hotkey — שגיאה"
    WScript.Quit 1
End If

If Not fso.FileExists(pyScript) Then
    MsgBox "הסקריפט לא נמצא:" & vbCrLf & pyScript, _
           vbCritical, "Voice Hotkey — שגיאה"
    WScript.Quit 1
End If

' הרצה ללא חלון (0 = SW_HIDE), False = אל תמתין
cmd = """" & pythonExe & """ """ & pyScript & """"
shell.Run cmd, 0, False
