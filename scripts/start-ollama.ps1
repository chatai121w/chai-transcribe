# ===========================================
#  Start Ollama Server with CORS
# ===========================================

Write-Host ""
Write-Host "[*] Starting Ollama server..." -ForegroundColor Cyan

# Set CORS
$env:OLLAMA_ORIGINS = "*"

# Kill existing
$existing = Get-Process ollama -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "    Stopping existing Ollama..." -ForegroundColor Gray
    Stop-Process -Name ollama -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
}

# Start
Write-Host "[*] ollama serve (OLLAMA_ORIGINS=*)" -ForegroundColor Yellow
Start-Process -FilePath "ollama" -ArgumentList "serve" -WindowStyle Hidden
Start-Sleep -Seconds 3

# Verify
try {
    $res = Invoke-RestMethod -Uri "http://localhost:11434/api/tags" -TimeoutSec 5
    $count = ($res.models | Measure-Object).Count
    Write-Host "[V] Ollama running - $count models available" -ForegroundColor Green
    Write-Host ""
    & ollama list
} catch {
    Write-Host "[!] Ollama not responding - check installation" -ForegroundColor Red
}

Write-Host ""
