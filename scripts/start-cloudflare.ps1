# start-cloudflare.ps1
# Starts a Cloudflare Tunnel exposing localhost:3000 (Whisper CUDA server) to a public HTTPS URL.
# No account needed — uses free trycloudflare.com domain.
# Usage: .\scripts\start-cloudflare.ps1

$ErrorActionPreference = "Stop"
$cloudflaredExe = "$env:LOCALAPPDATA\cloudflared\cloudflared.exe"
$downloadUrl = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"

# ── Download cloudflared if needed ──────────────────────────────────────────
if (!(Test-Path $cloudflaredExe)) {
    Write-Host "Downloading cloudflared..." -ForegroundColor Cyan
    New-Item -ItemType Directory -Force -Path (Split-Path $cloudflaredExe) | Out-Null
    try {
        Invoke-WebRequest -Uri $downloadUrl -OutFile $cloudflaredExe -UseBasicParsing
        Write-Host "  Downloaded: $cloudflaredExe" -ForegroundColor Green
    } catch {
        Write-Error "Failed to download cloudflared: $_"
        exit 1
    }
}

# ── Check whisper server is running ─────────────────────────────────────────
Write-Host "Checking whisper server at localhost:3000..." -ForegroundColor Cyan
try {
    $health = Invoke-RestMethod -Uri "http://localhost:3000/health" -TimeoutSec 3
    Write-Host "  Whisper server: $($health.status) | GPU: $($health.gpu)" -ForegroundColor Green
} catch {
    Write-Warning "Whisper server not responding at localhost:3000"
    Write-Host "  Start it first: .\.venv\Scripts\python.exe server\transcribe_server.py" -ForegroundColor Yellow
}

# ── Start tunnel ─────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "Starting Cloudflare Tunnel → localhost:3000" -ForegroundColor Cyan
Write-Host "The public URL will appear below (look for *.trycloudflare.com):" -ForegroundColor Gray
Write-Host "Paste that URL into the app Settings → Whisper server URL" -ForegroundColor Gray
Write-Host ""

& $cloudflaredExe tunnel --url http://localhost:3000
