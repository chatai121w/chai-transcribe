<#
.SYNOPSIS
    Smart Hebrew Transcriber — One-Click Offline Setup (Windows)
    סקריפט התקנה אוטומטי למתמלל העברי החכם

.DESCRIPTION
    Scans your system (GPU, RAM, disk, Python, existing tools),
    asks what to install based on what's found, installs everything needed.

.PARAMETER Force
    Reinstall everything, ignoring existing installations.

.PARAMETER SkipModel
    Skip downloading the Hebrew model (~3GB).

.PARAMETER Port
    Server port (default: 3000).

.PARAMETER CpuOnly
    Force CPU-only mode (skip CUDA/GPU).
#>

param(
    [switch]$Force,
    [switch]$SkipModel,
    [int]$Port = 3000,
    [switch]$CpuOnly
)

$ErrorActionPreference = "Continue"
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptRoot
$venvPath = Join-Path $projectRoot ".venv"
$venvPython = Join-Path $venvPath "Scripts\python.exe"
$venvPip = Join-Path $venvPath "Scripts\pip.exe"

# ============================================================
#  Helpers
# ============================================================

function Write-Banner {
    Write-Host ""
    Write-Host "============================================" -ForegroundColor Cyan
    Write-Host "  Smart Hebrew Transcriber — Offline Setup" -ForegroundColor Cyan
    Write-Host "  ========================================" -ForegroundColor Cyan
    Write-Host "  התקנה אופליין למתמלל העברי החכם" -ForegroundColor DarkCyan
    Write-Host "============================================" -ForegroundColor Cyan
    Write-Host ""
}

function Write-Step {
    param([string]$Num, [string]$Text, [string]$TextHe = "")
    Write-Host ""
    Write-Host "[$Num] $Text" -ForegroundColor Yellow
    if ($TextHe) { Write-Host "    $TextHe" -ForegroundColor DarkCyan }
}

function Write-Ok   { param([string]$Text) Write-Host "  [OK] $Text" -ForegroundColor Green }
function Write-Warn { param([string]$Text) Write-Host "  [!]  $Text" -ForegroundColor Yellow }
function Write-Err  { param([string]$Text) Write-Host "  [X]  $Text" -ForegroundColor Red }
function Write-Info { param([string]$Text) Write-Host "  [i]  $Text" -ForegroundColor Gray }

function Ask-YesNo {
    param([string]$Question, [bool]$Default = $true)
    $suffix = if ($Default) { "[Y/n]" } else { "[y/N]" }
    $answer = Read-Host "  $Question $suffix"
    if ([string]::IsNullOrWhiteSpace($answer)) { return $Default }
    return $answer.Trim().ToLower() -in @("y", "yes", "כן")
}

function Get-CudaVersion {
    # Parse CUDA driver version from nvidia-smi
    try {
        $output = & nvidia-smi 2>&1 | Out-String
        if ($output -match "CUDA Version:\s+([\d.]+)") {
            return $Matches[1]
        }
    } catch {}
    return $null
}

function Get-PyTorchCudaIndex {
    param([string]$CudaDriverVersion)
    # Map CUDA driver version to the best PyTorch CUDA wheel
    if (-not $CudaDriverVersion) { return $null }
    $major = [int]($CudaDriverVersion.Split('.')[0])
    $minor = [int]($CudaDriverVersion.Split('.')[1])
    $ver = $major * 10 + $minor

    # PyTorch available wheels: cu118, cu121, cu124, cu126, cu128
    if ($ver -ge 128) { return "cu128" }
    if ($ver -ge 126) { return "cu126" }
    if ($ver -ge 124) { return "cu124" }
    if ($ver -ge 121) { return "cu121" }
    if ($ver -ge 118) { return "cu118" }
    return $null
}

# ============================================================
#  Phase 0: System Scan
# ============================================================

Write-Banner
Write-Step "0" "Scanning system..." "סורק את המערכת..."

$scan = @{
    RAM_GB        = 0
    GPU_Name      = $null
    GPU_VRAM_MB   = 0
    CUDA_Driver   = $null
    Disk_Free_GB  = 0
    Python_Path   = $null
    Python_Version = $null
    Venv_Exists   = $false
    Whisper_OK    = $false
    CUDA_OK       = $false
    Server_Running = $false
    Ollama_Running = $false
}

# RAM
try {
    $ram = (Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory
    $scan.RAM_GB = [math]::Round($ram / 1GB, 1)
    Write-Ok "RAM: $($scan.RAM_GB) GB"
} catch {
    Write-Warn "Could not detect RAM"
}

# GPU
$nvidiaSmi = Get-Command "nvidia-smi" -ErrorAction SilentlyContinue
if ($nvidiaSmi -and -not $CpuOnly) {
    try {
        $gpuCsv = & nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits 2>&1
        if ($gpuCsv -match "^(.+),\s*(\d+)") {
            $scan.GPU_Name = $Matches[1].Trim()
            $scan.GPU_VRAM_MB = [int]$Matches[2]
            Write-Ok "GPU: $($scan.GPU_Name) ($($scan.GPU_VRAM_MB) MB VRAM)"
        }
        $scan.CUDA_Driver = Get-CudaVersion
        if ($scan.CUDA_Driver) {
            Write-Ok "CUDA Driver: $($scan.CUDA_Driver)"
        }
    } catch {
        Write-Warn "nvidia-smi found but failed to query GPU"
    }
} else {
    if ($CpuOnly) {
        Write-Info "CPU-only mode requested (--CpuOnly)"
    } else {
        Write-Warn "NVIDIA GPU not found (nvidia-smi missing). Will use CPU mode. / לא נמצא GPU"
    }
}

# Disk
try {
    $drive = (Get-Item $projectRoot).PSDrive
    $freeBytes = (Get-PSDrive $drive.Name).Free
    $scan.Disk_Free_GB = [math]::Round($freeBytes / 1GB, 1)
    Write-Ok "Disk free: $($scan.Disk_Free_GB) GB (on $($drive.Name):)"
} catch {
    Write-Warn "Could not check disk space"
}

# Python
foreach ($cmd in @("python", "python3", "py")) {
    $found = Get-Command $cmd -ErrorAction SilentlyContinue
    if ($found) {
        try {
            $ver = & $cmd --version 2>&1 | Out-String
            if ($ver -match "Python\s+(3\.\d+)") {
                $scan.Python_Path = $found.Source
                $scan.Python_Version = $Matches[1]
                Write-Ok "Python: $($scan.Python_Version) ($($scan.Python_Path))"
                break
            }
        } catch {}
    }
}
if (-not $scan.Python_Path) {
    Write-Warn "Python not found in PATH / לא נמצא Python"
}

# Existing venv
$venvExists = Test-Path $venvPython
$oldVenvPython = Join-Path $projectRoot "venv-whisper\Scripts\python.exe"
$oldVenvExists = Test-Path $oldVenvPython

if ($venvExists) {
    $scan.Venv_Exists = $true
    Write-Ok "Virtual environment: .venv (found)"
} elseif ($oldVenvExists) {
    $scan.Venv_Exists = $true
    Write-Ok "Virtual environment: venv-whisper (legacy, found)"
} else {
    Write-Info "No virtual environment found"
}

# Check existing Whisper + CUDA in venv
$checkPython = if ($venvExists) { $venvPython } elseif ($oldVenvExists) { $oldVenvPython } else { $null }
if ($checkPython -and -not $Force) {
    try {
        $whisperCheck = & $checkPython -c "import faster_whisper; print('OK')" 2>&1 | Out-String
        if ($whisperCheck -match "OK") { $scan.Whisper_OK = $true; Write-Ok "faster-whisper: installed" }
        else { Write-Info "faster-whisper: not installed" }
    } catch { Write-Info "faster-whisper: not installed" }

    try {
        $cudaCheck = & $checkPython -c "import torch; print('CUDA' if torch.cuda.is_available() else 'CPU')" 2>&1 | Out-String
        if ($cudaCheck -match "CUDA") { $scan.CUDA_OK = $true; Write-Ok "PyTorch CUDA: available" }
        elseif ($cudaCheck -match "CPU") { Write-Info "PyTorch: CPU only (no CUDA)" }
        else { Write-Info "PyTorch: not installed" }
    } catch { Write-Info "PyTorch: not installed" }
}

# Check if server is already running
try {
    $health = Invoke-RestMethod -Uri "http://localhost:$Port/health" -TimeoutSec 3 -ErrorAction Stop
    $scan.Server_Running = $true
    Write-Ok "Whisper server: RUNNING on port $Port (GPU: $($health.gpu), Model: $($health.current_model))"
} catch {
    Write-Info "Whisper server: not running on port $Port"
}

# Check Ollama
try {
    $null = Invoke-WebRequest -Uri "http://localhost:11434/api/tags" -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop
    $scan.Ollama_Running = $true
    Write-Ok "Ollama: running"
} catch {
    Write-Info "Ollama: not running"
}

# ============================================================
#  System Requirements Check
# ============================================================

Write-Host ""
Write-Host "  --- Scan Summary / סיכום סריקה ---" -ForegroundColor White

if ($scan.RAM_GB -lt 4) {
    Write-Err "Not enough RAM ($($scan.RAM_GB) GB). Minimum: 4 GB, Recommended: 8+ GB"
    Write-Err "אין מספיק זיכרון RAM. מינימום: 4 GB"
    exit 1
}
if ($scan.RAM_GB -lt 8) {
    Write-Warn "RAM is low ($($scan.RAM_GB) GB). Recommended: 8+ GB for GPU mode."
}

if ($scan.GPU_VRAM_MB -gt 0 -and $scan.GPU_VRAM_MB -lt 4096) {
    Write-Warn "GPU VRAM is low ($($scan.GPU_VRAM_MB) MB). Recommended: 4+ GB for fast transcription."
}

if ($scan.Disk_Free_GB -lt 5) {
    Write-Err "Not enough disk space ($($scan.Disk_Free_GB) GB free). Need at least 10 GB."
    Write-Err "אין מספיק מקום בדיסק. צריך לפחות 10 GB"
    exit 1
}
if ($scan.Disk_Free_GB -lt 10) {
    Write-Warn "Disk space is tight ($($scan.Disk_Free_GB) GB free). Recommended: 10+ GB."
}

Write-Host ""

# ============================================================
#  Phase 1: Interactive Decision
# ============================================================

Write-Step "1" "Decision / החלטה"

if ($scan.Server_Running -and -not $Force) {
    # Case A: Server already running
    Write-Host ""
    Write-Ok "השרת כבר רץ! / Server is already running!"
    Write-Ok "GPU: $($health.gpu) | Model: $($health.current_model)"
    Write-Host ""
    Write-Host "  Open the app at http://localhost:8080 and select 'שרת CUDA מקומי'" -ForegroundColor Cyan
    Write-Host "  פתח את האפליקציה ובחר 'שרת CUDA מקומי'" -ForegroundColor DarkCyan
    Write-Host ""
    exit 0
}

$installPython = $false
$installVenv   = $false
$installCuda   = $false
$installWhisper= $false
$installDeps   = $false
$downloadModel = $false
$startServer   = $false

if ($Force) {
    # Force mode — install everything
    $installVenv   = $true
    $installCuda   = -not $CpuOnly
    $installWhisper= $true
    $installDeps   = $true
    $downloadModel = -not $SkipModel
    $startServer   = $true
    if (-not $scan.Python_Path) { $installPython = $true }
    Write-Info "Force mode: will reinstall everything / מצב כוח: מתקין הכל מחדש"
}
elseif ($scan.Whisper_OK -and $scan.CUDA_OK) {
    # Case B: Both exist
    Write-Host ""
    Write-Host "  נמצאו Whisper ו-CUDA! / Both Whisper and CUDA found!" -ForegroundColor Green
    if (Ask-YesNo "להפעיל את השרת? / Start the server?") {
        $startServer = $true
    } else {
        Write-Host "  OK, exiting." -ForegroundColor Gray
        exit 0
    }
}
elseif ($scan.Whisper_OK -and -not $scan.CUDA_OK) {
    # Case C: Whisper only
    Write-Host ""
    Write-Host "  נמצא Whisper אבל בלי CUDA (GPU) / Whisper found but no CUDA" -ForegroundColor Yellow
    if (-not $CpuOnly -and $scan.GPU_Name) {
        if (Ask-YesNo "להתקין PyTorch עם CUDA? (מומלץ לביצועים) / Install PyTorch with CUDA?") {
            $installCuda = $true
            $startServer = $true
        } else {
            Write-Info "Continuing with CPU mode / ממשיך במצב CPU"
            $startServer = $true
        }
    } else {
        $startServer = $true
    }
}
elseif (-not $scan.Whisper_OK -and $scan.CUDA_OK) {
    # Case D: CUDA only
    Write-Host ""
    Write-Host "  נמצא PyTorch עם CUDA אבל בלי Whisper / PyTorch+CUDA found but no Whisper" -ForegroundColor Yellow
    if (Ask-YesNo "להתקין Whisper ולהפעיל? / Install Whisper and start?") {
        $installWhisper = $true
        $installDeps = $true
        $downloadModel = -not $SkipModel
        $startServer = $true
    }
}
else {
    # Case E: Nothing
    Write-Host ""
    Write-Host "  לא נמצאו כלים מותקנים / No existing tools found" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  מה צריך:" -ForegroundColor White
    Write-Host "    - Python 3.10+" -ForegroundColor Gray
    if ($scan.GPU_Name -and -not $CpuOnly) {
        Write-Host "    - PyTorch + CUDA (for $($scan.GPU_Name))" -ForegroundColor Gray
    } else {
        Write-Host "    - PyTorch (CPU mode)" -ForegroundColor Gray
    }
    Write-Host "    - faster-whisper + Flask server" -ForegroundColor Gray
    Write-Host "    - Hebrew model (~3 GB)" -ForegroundColor Gray
    Write-Host ""

    if (Ask-YesNo "להתקין הכל? / Install everything?") {
        if (-not $scan.Python_Path) { $installPython = $true }
        $installVenv   = $true
        $installCuda   = (-not $CpuOnly -and $scan.GPU_Name -ne $null)
        $installWhisper= $true
        $installDeps   = $true
        $downloadModel = -not $SkipModel
        $startServer   = $true
    } else {
        Write-Host "  Cancelled. / בוטל." -ForegroundColor Gray
        exit 0
    }
}

# ============================================================
#  Phase 2: Installation Steps
# ============================================================

$stepNum = 2

# --- Step: Install Python ---
if ($installPython) {
    Write-Step "$stepNum" "Installing Python..." "מתקין Python..."
    $stepNum++

    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if ($winget) {
        Write-Info "Installing via winget..."
        & winget install --id Python.Python.3.12 --accept-package-agreements --accept-source-agreements 2>$null
        # Refresh PATH
        $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH", "User")
    }

    # Re-check
    $scan.Python_Path = $null
    foreach ($cmd in @("python", "python3", "py")) {
        $found = Get-Command $cmd -ErrorAction SilentlyContinue
        if ($found) {
            $ver = & $cmd --version 2>&1 | Out-String
            if ($ver -match "Python\s+(3\.\d+)") {
                $scan.Python_Path = $found.Source
                $scan.Python_Version = $Matches[1]
                break
            }
        }
    }

    if (-not $scan.Python_Path) {
        Write-Err "Python installation failed. Install manually: https://www.python.org/downloads/"
        Write-Err "ודא שמסמן 'Add Python to PATH' בהתקנה!"
        exit 1
    }
    Write-Ok "Python $($scan.Python_Version) installed"
}

# --- Step: Create venv ---
if ($installVenv -or (-not (Test-Path $venvPython) -and ($installCuda -or $installWhisper -or $installDeps))) {
    Write-Step "$stepNum" "Creating virtual environment (.venv)..." "יוצר סביבה וירטואלית..."
    $stepNum++

    if (Test-Path $venvPath) {
        if ($Force) {
            Write-Info "Removing old .venv..."
            Remove-Item -Recurse -Force $venvPath
        } else {
            Write-Ok ".venv already exists, reusing"
        }
    }

    if (-not (Test-Path $venvPath)) {
        & $scan.Python_Path -m venv $venvPath
        if (-not (Test-Path $venvPython)) {
            Write-Err "Failed to create virtual environment"
            exit 1
        }
    }

    # Upgrade pip
    & $venvPython -m pip install --upgrade pip 2>&1 | Out-Null
    Write-Ok "Virtual environment ready: .venv"
}

# --- Step: Install PyTorch + CUDA ---
if ($installCuda) {
    Write-Step "$stepNum" "Installing PyTorch with CUDA..." "מתקין PyTorch עם CUDA..."
    $stepNum++

    $cudaIndex = Get-PyTorchCudaIndex -CudaDriverVersion $scan.CUDA_Driver
    if (-not $cudaIndex) {
        Write-Warn "Could not determine CUDA version. Using cu128 as default."
        $cudaIndex = "cu128"
    }
    Write-Info "PyTorch CUDA wheel: $cudaIndex (CUDA driver: $($scan.CUDA_Driver))"

    $indexUrl = "https://download.pytorch.org/whl/$cudaIndex"
    Write-Info "Installing torch + torchaudio from $indexUrl ..."
    & $venvPip install torch torchaudio --index-url $indexUrl 2>&1 | ForEach-Object {
        if ($_ -match "Successfully installed") { Write-Ok $_ }
        elseif ($_ -match "already satisfied") { Write-Info "Already up to date" }
    }

    # Verify CUDA
    $cudaCheck = & $venvPython -c "import torch; print('CUDA' if torch.cuda.is_available() else 'CPU')" 2>&1 | Out-String
    if ($cudaCheck -match "CUDA") {
        $gpuName = & $venvPython -c "import torch; print(torch.cuda.get_device_name(0))" 2>&1 | Out-String
        Write-Ok "PyTorch CUDA verified! GPU: $($gpuName.Trim())"
    } else {
        Write-Warn "PyTorch installed but CUDA not available. Will use CPU mode."
    }
}

# --- Step: Install server deps ---
if ($installWhisper -or $installDeps) {
    Write-Step "$stepNum" "Installing server dependencies..." "מתקין חבילות שרת..."
    $stepNum++

    if ($installWhisper) {
        Write-Info "Installing faster-whisper..."
        & $venvPip install faster-whisper 2>&1 | ForEach-Object {
            if ($_ -match "Successfully installed") { Write-Ok $_ }
        }
    }

    Write-Info "Installing Flask + server packages..."
    & $venvPip install flask flask-cors flask-compress waitress 2>&1 | ForEach-Object {
        if ($_ -match "Successfully installed") { Write-Ok $_ }
    }

    Write-Ok "Server dependencies installed"
}

# --- Step: Download Hebrew model ---
if ($downloadModel) {
    Write-Step "$stepNum" "Downloading Hebrew model (~3 GB)..." "מוריד מודל עברית (~3 ג'יגה)..."
    $stepNum++
    Write-Info "Model: ivrit-ai/whisper-large-v3-turbo-ct2"
    Write-Info "This may take a few minutes depending on your internet speed..."
    Write-Info "זה עלול לקחת כמה דקות בהתאם למהירות האינטרנט..."

    & $venvPython -c @"
from faster_whisper import WhisperModel
import sys
print('Downloading model... / מוריד מודל...')
sys.stdout.flush()
model = WhisperModel('ivrit-ai/whisper-large-v3-turbo-ct2', device='cpu', compute_type='int8')
print('Model downloaded and cached!')
del model
"@ 2>&1 | ForEach-Object { Write-Host "  $_" -ForegroundColor Gray }

    Write-Ok "Hebrew model downloaded / מודל עברית הורד בהצלחה"
}

# --- Step: Verify + Start ---
if ($startServer -or $installWhisper -or $installDeps) {
    Write-Step "$stepNum" "Verifying installation..." "מאמת התקנה..."
    $stepNum++

    # Find the right Python
    $serverPython = if (Test-Path $venvPython) { $venvPython }
                    elseif (Test-Path $oldVenvPython) { $oldVenvPython }
                    else { $null }

    if (-not $serverPython) {
        Write-Err "No virtual environment found! Cannot start server."
        exit 1
    }

    # Verify components
    $verifyScript = @"
import sys
errors = []
try:
    import faster_whisper
    print('  [OK] faster-whisper')
except: errors.append('faster-whisper')
try:
    import flask
    print('  [OK] Flask')
except: errors.append('flask')
try:
    import flask_compress
    print('  [OK] flask-compress')
except: errors.append('flask-compress')
try:
    import waitress
    print('  [OK] waitress')
except: errors.append('waitress')
try:
    import torch
    cuda = torch.cuda.is_available()
    dev = torch.cuda.get_device_name(0) if cuda else 'CPU'
    print(f'  [OK] PyTorch ({dev})')
except: errors.append('torch')
if errors:
    print(f'  [X] Missing: {", ".join(errors)}')
    sys.exit(1)
"@
    & $serverPython -c $verifyScript 2>&1 | ForEach-Object { Write-Host $_ -ForegroundColor Green }
    if ($LASTEXITCODE -ne 0) {
        Write-Err "Some components are missing. Try running with -Force"
        exit 1
    }

    Write-Ok "All components verified! / כל הרכיבים מותקנים!"
}

if ($startServer) {
    Write-Host ""
    Write-Host "============================================" -ForegroundColor Green
    Write-Host "  Installation Complete! / ההתקנה הושלמה!" -ForegroundColor Green
    Write-Host "============================================" -ForegroundColor Green
    Write-Host ""

    if (Ask-YesNo "להפעיל את השרת עכשיו? / Start the server now?") {
        Write-Host ""
        Write-Host "  Starting Whisper server on port $Port..." -ForegroundColor Cyan
        Write-Host "  מפעיל שרת Whisper בפורט ${Port}..." -ForegroundColor DarkCyan
        Write-Host "  Press Ctrl+C to stop / לעצירה: Ctrl+C" -ForegroundColor Gray
        Write-Host ""
        Push-Location $projectRoot
        & $serverPython server/transcribe_server.py --port $Port
        Pop-Location
    } else {
        Write-Host ""
        Write-Host "  To start the server later:" -ForegroundColor Yellow
        Write-Host "    .\scripts\start-whisper-server.ps1" -ForegroundColor White
        Write-Host ""
        Write-Host "  Or: .\.venv\Scripts\python.exe server\transcribe_server.py" -ForegroundColor White
        Write-Host ""
    }
} else {
    Write-Host ""
    Write-Host "============================================" -ForegroundColor Green
    Write-Host "  Done! / סיום!" -ForegroundColor Green
    Write-Host "============================================" -ForegroundColor Green
    Write-Host ""
}
