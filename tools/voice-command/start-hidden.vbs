Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
repoRoot  = fso.GetParentFolderName(fso.GetParentFolderName(scriptDir))
pythonExe = repoRoot & "\.venv\Scripts\pythonw.exe"
pyScript  = scriptDir & "\voice_command_listener.py"

shell.Run """" & pythonExe & """ """ & pyScript & """ --model tiny --device cuda", 0, False
