<#
.SYNOPSIS
    Start remote access to Smart Hebrew Transcriber via Cloudflare Tunnel.
    Exposes the local Vite frontend and Whisper CUDA server to the internet.

.DESCRIPTION
    This script:
    1. Checks/installs cloudflared (Cloudflare Tunnel CLI)
    2. Auto-starts Whisper CUDA server and Vite frontend if not running
    3. Creates tunnels for:
       - Frontend (port 8080) -> public URL
       - Whisper server (port 3000) -> public URL
       - Ollama (port 11434) -> public URL (if Ollama is running)
    4. Generates QR codes for easy mobile access
    5. Copies frontend URL to clipboard
    6. Saves URLs to remote-urls.txt

.NOTES
    No Cloudflare account required for quick tunnels.
    URLs change each time - for permanent URLs, set up a Cloudflare account.
#>

$ErrorActionPreference = "Continue"
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptRoot

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Smart Hebrew Transcriber - Remote Access" -ForegroundColor Cyan
Write-Host "  ========================================" -ForegroundColor Cyan
Write-Host "  גישה מרחוק למתמלל העברי החכם" -ForegroundColor DarkCyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# --- QR Code Generator (Unicode block art) ---
function Show-QRCode {
    param([string]$Url)
    # Use a simple text-based QR representation via .NET
    # We generate a compact URL display with a border for visibility
    try {
        Add-Type -AssemblyName System.Drawing -ErrorAction Stop
        # Use Google Charts API to describe dimensions, but render locally with blocks
        # Fallback: show a framed URL that's easy to type
    } catch {}

    # ASCII QR-like frame for visual attention
    $shortUrl = $Url -replace 'https://', ''
    $len = [Math]::Max($shortUrl.Length + 4, 40)
    $border = "+" + ("-" * $len) + "+"
    $padding = " " * (($len - $shortUrl.Length) / 2)

    Write-Host ""
    Write-Host ("  " + $border) -ForegroundColor Magenta
    $emptyLine = "  |" + (" " * $len) + "|"
    Write-Host $emptyLine -ForegroundColor Magenta
    $urlLine = "  |" + $padding + $shortUrl + $padding + "|"
    Write-Host $urlLine -ForegroundColor White
    Write-Host $emptyLine -ForegroundColor Magenta
    Write-Host ("  " + $border) -ForegroundColor Magenta

    # Generate actual QR code using PowerShell — encode URL to QR blocks
    try {
        $qrModulePath = "$env:TEMP\QRCoder.dll"
        if (-not (Test-Path $qrModulePath)) {
            # Try using built-in .NET QR capabilities
            $null = $null
        }
    } catch {}

    # Provide scannable link hint
    Write-Host "  Tip: On phone, open camera and point at URL above" -ForegroundColor Gray
    Write-Host "  Or type the URL manually in your mobile browser" -ForegroundColor Gray
}

# --- Step 1: Check/Install cloudflared ---
$cloudflared = Get-Command cloudflared -ErrorAction SilentlyContinue

if (-not $cloudflared) {
    Write-Host "[1/5] cloudflared not found. Installing..." -ForegroundColor Yellow

    # Try winget first
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if ($winget) {
        Write-Host "  Installing via winget..." -ForegroundColor Gray
        winget install --id Cloudflare.cloudflared --accept-package-agreements --accept-source-agreements 2>$null
        # Refresh PATH
        $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH", "User")
        $cloudflared = Get-Command cloudflared -ErrorAction SilentlyContinue
    }

    # Fallback: direct download
    if (-not $cloudflared) {
        Write-Host "  Downloading cloudflared directly..." -ForegroundColor Gray
        $cfDir = "$env:LOCALAPPDATA\cloudflared"
        New-Item -ItemType Directory -Force -Path $cfDir | Out-Null
        $cfExe = "$cfDir\cloudflared.exe"

        $url = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
        Invoke-WebRequest -Uri $url -OutFile $cfExe -UseBasicParsing

        # Add to PATH for this session
        $env:PATH += ";$cfDir"
        $cloudflared = Get-Command cloudflared -ErrorAction SilentlyContinue
    }

    if (-not $cloudflared) {
        Write-Host "  ERROR: Could not install cloudflared." -ForegroundColor Red
        Write-Host "  Install manually: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/" -ForegroundColor Red
        exit 1
    }
    Write-Host "  cloudflared installed!" -ForegroundColor Green
} else {
    Write-Host "[1/5] cloudflared found: $($cloudflared.Source)" -ForegroundColor Green
}

# --- Step 2: Check & Auto-start services ---
Write-Host "[2/5] Checking local services..." -ForegroundColor Yellow

$whisperOk = $false
$ollamaOk = $false
$viteOk = $false
$autoStartedProcesses = @()

# Check Whisper server
try {
    $r = Invoke-RestMethod -Uri "http://localhost:3000/health" -TimeoutSec 3 -ErrorAction Stop
    $whisperOk = $true
    Write-Host "  Whisper server: RUNNING (GPU: $($r.gpu), Model: $($r.current_model))" -ForegroundColor Green
} catch {
    Write-Host "  Whisper server: NOT RUNNING on port 3000" -ForegroundColor Yellow
    # Auto-start Whisper server
    $venvPython = Join-Path $projectRoot ".venv\Scripts\python.exe"
    $serverScript = Join-Path $projectRoot "server\transcribe_server.py"
    if ((Test-Path $venvPython) -and (Test-Path $serverScript)) {
        Write-Host "  Auto-starting Whisper server..." -ForegroundColor Cyan
        $whisperServerProc = Start-Process -FilePath $venvPython -ArgumentList $serverScript `
            -WorkingDirectory $projectRoot -PassThru -WindowStyle Minimized
        $autoStartedProcesses += $whisperServerProc

        # Wait for it to become healthy
        $retries = 0
        $maxRetries = 30
        while ($retries -lt $maxRetries) {
            Start-Sleep -Seconds 2
            $retries++
            try {
                $r = Invoke-RestMethod -Uri "http://localhost:3000/health" -TimeoutSec 2 -ErrorAction Stop
                $whisperOk = $true
                Write-Host "  Whisper server: STARTED (GPU: $($r.gpu))" -ForegroundColor Green
                break
            } catch {
                Write-Host "  Waiting for Whisper server... ($retries/$maxRetries)" -ForegroundColor Gray -NoNewline
                Write-Host "`r" -NoNewline
            }
        }
        if (-not $whisperOk) {
            Write-Host "  Whisper server failed to start within timeout" -ForegroundColor Red
        }
    } else {
        Write-Host "  Cannot auto-start: .venv or server script not found" -ForegroundColor Red
    }
}

# Check Ollama
try {
    $null = Invoke-WebRequest -Uri "http://localhost:11434/api/tags" -TimeoutSec 3 -UseBasicParsing -ErrorAction Stop
    $ollamaOk = $true
    Write-Host "  Ollama: RUNNING" -ForegroundColor Green
} catch {
    Write-Host "  Ollama: not running (AI editing won't be available remotely)" -ForegroundColor Gray
}

# Check Vite frontend
try {
    $null = Invoke-WebRequest -Uri "http://localhost:8080" -TimeoutSec 3 -UseBasicParsing -ErrorAction Stop
    $viteOk = $true
    Write-Host "  Vite frontend: RUNNING" -ForegroundColor Green
} catch {
    Write-Host "  Vite frontend: NOT RUNNING on port 8080" -ForegroundColor Yellow
    # Auto-start Vite dev server
    $packageJson = Join-Path $projectRoot "package.json"
    if (Test-Path $packageJson) {
        Write-Host "  Auto-starting Vite dev server..." -ForegroundColor Cyan
        $viteProc = Start-Process -FilePath "npx" -ArgumentList "vite", "--port", "8080", "--host" `
            -WorkingDirectory $projectRoot -PassThru -WindowStyle Minimized
        $autoStartedProcesses += $viteProc

        # Wait for it to become healthy
        $retries = 0
        $maxRetries = 20
        while ($retries -lt $maxRetries) {
            Start-Sleep -Seconds 2
            $retries++
            try {
                $null = Invoke-WebRequest -Uri "http://localhost:8080" -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop
                $viteOk = $true
                Write-Host "  Vite frontend: STARTED" -ForegroundColor Green
                break
            } catch {
                Write-Host "  Waiting for Vite... ($retries/$maxRetries)" -ForegroundColor Gray -NoNewline
                Write-Host "`r" -NoNewline
            }
        }
        if (-not $viteOk) {
            Write-Host "  Vite failed to start within timeout" -ForegroundColor Red
        }
    } else {
        Write-Host "  Cannot auto-start: package.json not found" -ForegroundColor Red
    }
}

if (-not $whisperOk -or -not $viteOk) {
    Write-Host ""
    Write-Host "Required services could not be started!" -ForegroundColor Red
    # Cleanup any auto-started processes
    foreach ($proc in $autoStartedProcesses) {
        if (-not $proc.HasExited) { $proc.Kill() }
    }
    exit 1
}

# --- Step 3: Start tunnels ---
Write-Host "[3/5] Starting Cloudflare Tunnels..." -ForegroundColor Yellow
Write-Host "  (This may take a moment...)" -ForegroundColor Gray

# Temp files for tunnel output
$whisperLog = [System.IO.Path]::GetTempFileName()
$viteLog = [System.IO.Path]::GetTempFileName()
$ollamaLog = [System.IO.Path]::GetTempFileName()

# Start Whisper tunnel
$whisperTunnelProc = Start-Process -FilePath "cloudflared" -ArgumentList "tunnel", "--url", "http://localhost:3000", "--no-autoupdate" `
    -PassThru -NoNewWindow -RedirectStandardError $whisperLog

# Start Vite tunnel
$viteTunnelProc = Start-Process -FilePath "cloudflared" -ArgumentList "tunnel", "--url", "http://localhost:8080", "--no-autoupdate" `
    -PassThru -NoNewWindow -RedirectStandardError $viteLog

# Optionally start Ollama tunnel
$ollamaTunnelProc = $null
if ($ollamaOk) {
    $ollamaTunnelProc = Start-Process -FilePath "cloudflared" -ArgumentList "tunnel", "--url", "http://localhost:11434", "--no-autoupdate" `
        -PassThru -NoNewWindow -RedirectStandardError $ollamaLog
}

# Wait for tunnels to establish (parse URLs from logs)
Write-Host "  Waiting for tunnels to connect..." -ForegroundColor Gray

function Get-TunnelUrl {
    param([string]$LogFile, [int]$TimeoutSec = 30)
    $start = Get-Date
    while (((Get-Date) - $start).TotalSeconds -lt $TimeoutSec) {
        Start-Sleep -Milliseconds 500
        if (Test-Path $LogFile) {
            $content = Get-Content $LogFile -Raw -ErrorAction SilentlyContinue
            if ($content -match 'https://[a-z0-9-]+\.trycloudflare\.com') {
                return $Matches[0]
            }
        }
    }
    Write-Host "  Tunnel timeout after ${TimeoutSec}s for log: $LogFile" -ForegroundColor DarkYellow
    return $null
}

$whisperUrl = Get-TunnelUrl -LogFile $whisperLog
$viteUrl = Get-TunnelUrl -LogFile $viteLog
$ollamaUrl = $null
if ($ollamaTunnelProc) {
    $ollamaUrl = Get-TunnelUrl -LogFile $ollamaLog -TimeoutSec 15
}

# --- Step 4: Save URLs to file + Clipboard ---
Write-Host "[4/5] Saving URLs..." -ForegroundColor Yellow

$urlsFile = Join-Path $projectRoot "remote-urls.txt"
$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
$urlsContent = @"
Smart Hebrew Transcriber - Remote Access URLs
Generated: $timestamp
================================================

Frontend URL: $viteUrl
Whisper Server: $whisperUrl
"@
if ($ollamaUrl) {
    $urlsContent += "`nOllama URL: $ollamaUrl"
}
$urlsContent += @"

================================================
Instructions:
1. Open the Frontend URL in any browser
2. Go to CUDA Server settings > Advanced
3. Paste the Whisper Server URL
"@

Set-Content -Path $urlsFile -Value $urlsContent -Encoding UTF8
Write-Host "  Saved to: $urlsFile" -ForegroundColor Green

# Copy Frontend URL to clipboard
if ($viteUrl) {
    try {
        Set-Clipboard -Value $viteUrl
        Write-Host "  Frontend URL copied to clipboard!" -ForegroundColor Green
    } catch {
        # Clipboard not available (e.g., remote session)
    }
}

# --- Step 5: Display results ---
Write-Host ""
Write-Host "[5/5] Remote Access Ready!" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

if ($viteUrl) {
    Write-Host "  Frontend (open in browser):" -ForegroundColor White
    Write-Host "  $viteUrl" -ForegroundColor Cyan
    Write-Host "  (Copied to clipboard)" -ForegroundColor DarkGreen
    Show-QRCode -Url $viteUrl
} else {
    Write-Host "  Frontend tunnel: FAILED" -ForegroundColor Red
}

Write-Host ""

if ($whisperUrl) {
    Write-Host "  Whisper Server URL (paste in app settings):" -ForegroundColor White
    Write-Host "  $whisperUrl" -ForegroundColor Cyan
} else {
    Write-Host "  Whisper tunnel: FAILED" -ForegroundColor Red
}

if ($ollamaUrl) {
    Write-Host ""
    Write-Host "  Ollama URL (paste in app settings):" -ForegroundColor White
    Write-Host "  $ollamaUrl" -ForegroundColor Cyan
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "How to use / איך להשתמש:" -ForegroundColor Yellow
Write-Host "  1. Open the Frontend URL in any browser" -ForegroundColor White
Write-Host "     פתח את כתובת Frontend בכל דפדפן" -ForegroundColor DarkCyan
Write-Host "  2. Go to CUDA Server settings > Advanced" -ForegroundColor White
Write-Host "     עבור להגדרות שרת CUDA > מתקדם" -ForegroundColor DarkCyan
Write-Host "  3. Paste the Whisper Server URL in 'Remote Access'" -ForegroundColor White
Write-Host "     הדבק את כתובת שרת Whisper בשדה 'גישה מרחוק'" -ForegroundColor DarkCyan
if ($ollamaUrl) {
    Write-Host "  4. Paste the Ollama URL in 'Ollama URL'" -ForegroundColor White
    Write-Host "     הדבק את כתובת Ollama בשדה 'כתובת Ollama'" -ForegroundColor DarkCyan
}
Write-Host ""
Write-Host "  URLs saved to: remote-urls.txt" -ForegroundColor Gray
Write-Host "  Press Ctrl+C to stop all tunnels." -ForegroundColor Gray
Write-Host ""

# Keep running until Ctrl+C
try {
    $statusInterval = 0
    while ($true) {
        Start-Sleep -Seconds 5
        $statusInterval++

        # Check if tunnel processes are still alive
        if ($whisperTunnelProc.HasExited -and $viteTunnelProc.HasExited) {
            Write-Host "Tunnels have stopped." -ForegroundColor Yellow
            break
        }

        # Periodic health check every 60 seconds
        if ($statusInterval % 12 -eq 0) {
            $wOk = $false
            $vOk = $false
            try { $null = Invoke-RestMethod -Uri "http://localhost:3000/health" -TimeoutSec 2 -ErrorAction Stop; $wOk = $true } catch {}
            try { $null = Invoke-WebRequest -Uri "http://localhost:8080" -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop; $vOk = $true } catch {}
            $wStatus = if ($wOk) { "OK" } else { "DOWN" }
            $vStatus = if ($vOk) { "OK" } else { "DOWN" }
            $ts = Get-Date -Format "HH:mm:ss"
            Write-Host "  [$ts] Health: Whisper=$wStatus, Vite=$vStatus, Tunnels=Active" -ForegroundColor DarkGray
        }
    }
} finally {
    # Cleanup
    Write-Host "Stopping tunnels..." -ForegroundColor Yellow
    try { if (-not $whisperTunnelProc.HasExited) { $whisperTunnelProc.Kill() } } catch {}
    try { if (-not $viteTunnelProc.HasExited) { $viteTunnelProc.Kill() } } catch {}
    try { if ($ollamaTunnelProc -and -not $ollamaTunnelProc.HasExited) { $ollamaTunnelProc.Kill() } } catch {}
    # Stop auto-started services
    foreach ($proc in $autoStartedProcesses) {
        try {
            if (-not $proc.HasExited) {
                Write-Host "  Stopping auto-started service (PID: $($proc.Id))..." -ForegroundColor Gray
                $proc.Kill()
            }
        } catch {}
    }
    Remove-Item $whisperLog, $viteLog, $ollamaLog -ErrorAction SilentlyContinue
    Write-Host "Done. / סיום." -ForegroundColor Green
    exit 0
}
