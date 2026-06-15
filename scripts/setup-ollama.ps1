# ===========================================
#  Ollama Setup Script - Smart Hebrew Transcriber
#  RTX 5050 / 8GB-class optimized
# ===========================================

$ErrorActionPreference = "Stop"
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Ollama - Setup Script" -ForegroundColor Cyan
Write-Host "  Smart Hebrew Transcriber" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# --- 1. Check if Ollama is already installed ---
$ollamaPath = Get-Command ollama -ErrorAction SilentlyContinue
if ($ollamaPath) {
    Write-Host "[V] Ollama is already installed at: $($ollamaPath.Source)" -ForegroundColor Green
} else {
    Write-Host "[*] Ollama not found - downloading installer..." -ForegroundColor Yellow
    
    $installerUrl = "https://ollama.com/download/OllamaSetup.exe"
    $installerPath = Join-Path $env:TEMP "OllamaSetup.exe"
    
    try {
        Invoke-WebRequest -Uri $installerUrl -OutFile $installerPath -UseBasicParsing
        Write-Host "[V] Downloaded OllamaSetup.exe" -ForegroundColor Green
        
        Write-Host "[*] Running installer... (follow the installation wizard)" -ForegroundColor Yellow
        Start-Process -FilePath $installerPath -Wait
        
        # Refresh PATH
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
        
        $ollamaCheck = Get-Command ollama -ErrorAction SilentlyContinue
        if ($ollamaCheck) {
            Write-Host "[V] Ollama installed successfully!" -ForegroundColor Green
        } else {
            Write-Host "[!] Ollama installed but not in PATH yet. Restart terminal after script." -ForegroundColor Yellow
        }
    } catch {
        Write-Host "[X] Failed to download Ollama: $_" -ForegroundColor Red
        Write-Host "    Download manually from: https://ollama.com/download" -ForegroundColor Yellow
    }
}

# --- 2. Set OLLAMA_ORIGINS for CORS (browser access) ---
Write-Host ""
Write-Host "[*] Setting OLLAMA_ORIGINS=* for browser CORS access..." -ForegroundColor Yellow

$currentOrigins = [System.Environment]::GetEnvironmentVariable("OLLAMA_ORIGINS", "User")
if ($currentOrigins -eq "*") {
    Write-Host "[V] OLLAMA_ORIGINS already set to *" -ForegroundColor Green
} else {
    [System.Environment]::SetEnvironmentVariable("OLLAMA_ORIGINS", "*", "User")
    $env:OLLAMA_ORIGINS = "*"
    Write-Host "[V] OLLAMA_ORIGINS=* set permanently (User env)" -ForegroundColor Green
}

# --- 3. Start Ollama serve in background ---
Write-Host ""
Write-Host "[*] Starting Ollama server..." -ForegroundColor Yellow

# Kill existing ollama processes
$existing = Get-Process ollama -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "    Stopping existing Ollama process..." -ForegroundColor Gray
    Stop-Process -Name ollama -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
}

Start-Process -FilePath "ollama" -ArgumentList "serve" -WindowStyle Hidden
Start-Sleep -Seconds 3

# Verify server
try {
    $response = Invoke-RestMethod -Uri "http://localhost:11434/api/tags" -TimeoutSec 5
    Write-Host "[V] Ollama server is running!" -ForegroundColor Green
} catch {
    Write-Host "[!] Ollama server not responding yet - it may need a moment" -ForegroundColor Yellow
    Start-Sleep -Seconds 5
}

# --- 4. Pull recommended models for RTX 5050 / 8GB-class VRAM ---
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Downloading AI Models for RTX 5050 / 8GB-class" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$models = @(
    @{ Name = "qwen2.5:7b";    Desc = "Qwen 2.5 7B - Hebrew support (Alibaba)"; Size = "~4.5 GB" },
    @{ Name = "llama3.1:8b";   Desc = "Llama 3.1 8B - Best general (Meta)";      Size = "~5 GB" },
    @{ Name = "mistral:7b";    Desc = "Mistral 7B - Fast and good (Mistral)";     Size = "~4.5 GB" },
    @{ Name = "gemma2:9b";     Desc = "Gemma 2 9B - Strong (Google)";             Size = "~5.5 GB" }
)

Write-Host "Models to download:" -ForegroundColor White
Write-Host ""
for ($i = 0; $i -lt $models.Count; $i++) {
    $m = $models[$i]
    Write-Host "  $($i+1). $($m.Name) - $($m.Desc) [$($m.Size)]" -ForegroundColor Gray
}
Write-Host ""

# Check which are already downloaded
try {
    $existing = (Invoke-RestMethod -Uri "http://localhost:11434/api/tags" -TimeoutSec 5).models
    $existingNames = $existing | ForEach-Object { $_.name }
} catch {
    $existingNames = @()
}

$downloaded = 0
$skipped = 0
$failed = 0

foreach ($model in $models) {
    $name = $model.Name
    
    # Check if already exists
    $alreadyExists = $existingNames | Where-Object { $_ -like "$name*" }
    if ($alreadyExists) {
        Write-Host "[V] $name - already downloaded, skipping" -ForegroundColor Green
        $skipped++
        continue
    }
    
    Write-Host ""
    Write-Host "[*] Downloading $name ($($model.Size))..." -ForegroundColor Yellow
    Write-Host "    $($model.Desc)" -ForegroundColor Gray
    
    try {
        & ollama pull $name
        if ($LASTEXITCODE -eq 0) {
            Write-Host "[V] $name downloaded successfully!" -ForegroundColor Green
            $downloaded++
        } else {
            Write-Host "[X] $name failed to download" -ForegroundColor Red
            $failed++
        }
    } catch {
        Write-Host "[X] $name failed: $_" -ForegroundColor Red
        $failed++
    }
}

# --- 5. Summary ---
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Summary" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Downloaded: $downloaded" -ForegroundColor Green
Write-Host "  Skipped:    $skipped" -ForegroundColor Gray
Write-Host "  Failed:     $failed" -ForegroundColor $(if ($failed -gt 0) { "Red" } else { "Gray" })
Write-Host ""

# Show final model list
Write-Host "Installed models:" -ForegroundColor White
try {
    & ollama list
} catch {
    Write-Host "  (could not list models)" -ForegroundColor Gray
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Setup Complete!" -ForegroundColor Green
Write-Host "  Models location: $env:USERPROFILE\.ollama\models" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Next: Run .\scripts\start-all.ps1 to launch everything!" -ForegroundColor Cyan
Write-Host ""
