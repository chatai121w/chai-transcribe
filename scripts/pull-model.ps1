# ===========================================
#  Pull Additional Ollama Model
#  Usage: .\scripts\pull-model.ps1 codellama:7b
# ===========================================

param(
    [Parameter(Mandatory=$true, Position=0)]
    [string]$ModelName
)

Write-Host ""
Write-Host "[*] Pulling model: $ModelName" -ForegroundColor Cyan

# Ensure server is running
try {
    Invoke-RestMethod -Uri "http://localhost:11434/api/tags" -TimeoutSec 3 | Out-Null
} catch {
    Write-Host "[!] Ollama server not running - starting..." -ForegroundColor Yellow
    $env:OLLAMA_ORIGINS = "*"
    Start-Process -FilePath "ollama" -ArgumentList "serve" -WindowStyle Hidden
    Start-Sleep -Seconds 3
}

& ollama pull $ModelName

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "[V] $ModelName installed!" -ForegroundColor Green
    Write-Host ""
    & ollama list
} else {
    Write-Host "[X] Failed to pull $ModelName" -ForegroundColor Red
}
