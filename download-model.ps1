# ============================================================
#  Download + GPU-test the full accurate model
#  (ivrit-ai/whisper-large-v3-ct2). Shows output AND writes a log.
# ============================================================
Set-Location -Path $PSScriptRoot

# Stop any leftover python from a previous attempt that may hold the log file.
Get-Process python, pythonw -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -like "$PSScriptRoot*" } |
    Stop-Process -Force -ErrorAction SilentlyContinue

$log = Join-Path $PSScriptRoot "model-download-log.txt"
if (Test-Path $log) { Remove-Item $log -Force -ErrorAction SilentlyContinue }

$py = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
Write-Host "Running download... (this can take a few minutes for ~3GB)" -ForegroundColor Cyan
& $py "$PSScriptRoot\_dl_model.py" 2>&1 | Tee-Object -FilePath $log

Write-Host ""
Write-Host "Log saved to: $log" -ForegroundColor DarkGray
Read-Host "Done - press Enter to close"
