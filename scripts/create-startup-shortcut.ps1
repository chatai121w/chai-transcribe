$projectRoot = 'c:\Users\jj121\smart-hebrew-transcriber'
$startupFolder = [Environment]::GetFolderPath('Startup')
$batSource = Join-Path $projectRoot 'start-launcher.bat'
$shortcutPath = Join-Path $startupFolder 'SmartTranscriber.lnk'

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $batSource
$shortcut.WorkingDirectory = $projectRoot
$shortcut.WindowStyle = 7
$shortcut.Description = 'Smart Hebrew Transcriber - Tray Launcher'
$shortcut.Save()

Write-Host "Shortcut created at: $shortcutPath" -ForegroundColor Green
