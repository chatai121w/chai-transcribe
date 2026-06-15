$projectRoot = 'c:\Users\jj121\smart-hebrew-transcriber'
$desktopFolder = [Environment]::GetFolderPath('Desktop')
$batSource = Join-Path $projectRoot 'start-everything.bat'
$iconPath = Join-Path $projectRoot 'public\favicon.ico'
$shortcutPath = Join-Path $desktopFolder 'Smart Transcriber.lnk'

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $batSource
$shortcut.WorkingDirectory = $projectRoot
$shortcut.WindowStyle = 7
$shortcut.Description = 'Smart Hebrew Transcriber - One Click Starter'
if (Test-Path $iconPath) {
    $shortcut.IconLocation = "$iconPath,0"
}
$shortcut.Save()

Write-Host "Desktop shortcut created at: $shortcutPath" -ForegroundColor Green
