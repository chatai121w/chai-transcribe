<# 
.SYNOPSIS
  Smart Hebrew Transcriber - Unified Launcher Setup
.DESCRIPTION
  One script: install deps, create desktop shortcut, auto-start, status dashboard.
.EXAMPLE
  .\scripts\launcher-setup.ps1              # Interactive menu
  .\scripts\launcher-setup.ps1 -Install     # Full install
  .\scripts\launcher-setup.ps1 -Status      # Show status only
  .\scripts\launcher-setup.ps1 -Start       # Start tray now
  .\scripts\launcher-setup.ps1 -Stop        # Stop tray
  .\scripts\launcher-setup.ps1 -Uninstall   # Remove everything
#>

param(
    [switch]$Install,
    [switch]$Status,
    [switch]$Start,
    [switch]$Stop,
    [switch]$Uninstall
)

$ErrorActionPreference = 'Continue'
$projectRoot = Split-Path -Parent $PSScriptRoot
$taskName = 'SmartTranscriberLauncher'

# ── Pretty Output ───────────────────────────────────────

function Write-OK    { param([string]$T) Write-Host "  [V] $T" -ForegroundColor Green }
function Write-Fail  { param([string]$T) Write-Host "  [X] $T" -ForegroundColor Red }
function Write-Alert { param([string]$T) Write-Host "  [!] $T" -ForegroundColor Yellow }
function Write-Note  { param([string]$T) Write-Host "      $T" -ForegroundColor Gray }

function Write-Banner {
    param([string]$T)
    $bar = '=' * 46
    Write-Host ''
    Write-Host "  $bar" -ForegroundColor Cyan
    Write-Host "    $T" -ForegroundColor Cyan
    Write-Host "  $bar" -ForegroundColor Cyan
    Write-Host ''
}

function Write-Section {
    param([string]$T)
    Write-Host ''
    Write-Host "  -- $T --" -ForegroundColor White
}

# ── Path Discovery ──────────────────────────────────────

function Find-VenvPython {
    foreach ($d in @('.venv','venv-whisper')) {
        $p = Join-Path $projectRoot "$d\Scripts\python.exe"
        if (Test-Path $p) { return $p }
    }
    return $null
}

function Find-VenvPythonW {
    foreach ($d in @('.venv','venv-whisper')) {
        $p = Join-Path $projectRoot "$d\Scripts\pythonw.exe"
        if (Test-Path $p) { return $p }
    }
    return $null
}

function Find-VenvPip {
    foreach ($d in @('.venv','venv-whisper')) {
        $p = Join-Path $projectRoot "$d\Scripts\pip.exe"
        if (Test-Path $p) { return $p }
    }
    return $null
}

function Find-VenvDir {
    foreach ($d in @('.venv','venv-whisper')) {
        $p = Join-Path $projectRoot $d
        if (Test-Path $p) { return $p }
    }
    return $null
}

# ── Service Checks ──────────────────────────────────────

function Test-Endpoint {
    param([string]$Url, [int]$Sec = 3)
    try {
        $null = Invoke-RestMethod -Uri $Url -TimeoutSec $Sec -ErrorAction Stop
        return $true
    } catch { return $false }
}

function Get-WhisperHealth {
    try {
        $r = Invoke-RestMethod -Uri 'http://localhost:8765/health' -TimeoutSec 3 -ErrorAction Stop
        return @{ Running = $true; Gpu = $r.gpu; Model = $r.current_model; Device = $r.device }
    } catch {
        return @{ Running = $false }
    }
}

function Get-OllamaInfo {
    try {
        $r = Invoke-RestMethod -Uri 'http://localhost:11434/api/tags' -TimeoutSec 3 -ErrorAction Stop
        $cnt = ($r.models | Measure-Object).Count
        return @{ Running = $true; Models = $cnt }
    } catch {
        return @{ Running = $false; Models = 0 }
    }
}

function Test-Launcher  { return (Test-Endpoint 'http://localhost:8764/health') }
function Test-Vite      { return (Test-Endpoint 'http://localhost:8080') }
function Test-AutoStart { return (Test-Path (Get-AutoStartPath)) }
function Test-Desktop   { return (Test-Path (Get-DesktopPath)) }

function Get-AutoStartPath {
    $s = [Environment]::GetFolderPath('Startup')
    return (Join-Path $s 'SmartTranscriber.lnk')
}
function Get-DesktopPath {
    $d = [Environment]::GetFolderPath('Desktop')
    return (Join-Path $d 'Smart Transcriber.lnk')
}

function Test-PyModule {
    param([string]$Py, [string]$Mod)
    try {
        & $Py -c "import $Mod" 2>$null
        return ($LASTEXITCODE -eq 0)
    } catch { return $false }
}

# ── Status Dashboard ────────────────────────────────────

function Show-Status {
    Write-Banner 'Smart Hebrew Transcriber - Status'

    Write-Section 'System Requirements'

    # Python / venv
    $py = Find-VenvPython
    if ($py) {
        $ver = (& $py --version 2>&1).ToString().Trim()
        Write-OK "Python: $ver"
        Write-Note "venv: $py"
    } elseif (Get-Command python -ErrorAction SilentlyContinue) {
        $ver = (& python --version 2>&1).ToString().Trim()
        Write-Alert "Python: $ver - no venv, install needed"
    } else {
        Write-Fail 'Python: not found'
    }

    # GPU
    $nv = Get-Command 'nvidia-smi' -ErrorAction SilentlyContinue
    if ($nv) {
        try {
            $gi = (& nvidia-smi --query-gpu=name,memory.total --format=csv,noheader 2>&1).ToString().Trim()
            Write-OK "GPU: $gi"
        } catch { Write-Fail 'GPU: nvidia-smi error' }
    } else {
        Write-Fail 'GPU: nvidia-smi not found'
    }

    # Python packages
    if ($py) {
        $mods = @(
            @{ Name = 'PyTorch';         Mod = 'torch' },
            @{ Name = 'faster-whisper';  Mod = 'faster_whisper' },
            @{ Name = 'Flask';           Mod = 'flask' },
            @{ Name = 'pystray';         Mod = 'pystray' }
        )
        foreach ($m in $mods) {
            if (Test-PyModule $py $m.Mod) {
                Write-OK "$($m.Name): installed"
            } else {
                Write-Fail "$($m.Name): missing"
            }
        }
    }

    # Node
    $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
    if ($nodeCmd) {
        $nv2 = (& node --version 2>&1).ToString().Trim()
        Write-OK "Node.js: $nv2"
    } else {
        Write-Fail 'Node.js: not found'
    }

    # Ollama binary
    if (Get-Command ollama -ErrorAction SilentlyContinue) {
        Write-OK 'Ollama: installed'
    } else {
        Write-Alert 'Ollama: not installed - optional'
    }

    # npm
    $nm = Join-Path $projectRoot 'node_modules'
    if (Test-Path $nm) { Write-OK 'npm packages: installed' }
    else               { Write-Fail 'npm packages: missing' }

    Write-Section 'Running Services'

    # Launcher
    if (Test-Launcher) { Write-OK 'Launcher Tray :8764 = ON' }
    else               { Write-Fail 'Launcher Tray :8764 = OFF' }

    # Whisper
    $wh = Get-WhisperHealth
    if ($wh.Running) {
        $info = 'ON'
        if ($wh.Gpu)   { $info += " | GPU: $($wh.Gpu)" }
        if ($wh.Model) { $short = ($wh.Model -split '/')[-1]; $info += " | $short" }
        Write-OK "CUDA Whisper :8765 = $info"
    } else {
        Write-Fail 'CUDA Whisper :8765 = OFF'
    }

    # Ollama
    $ol = Get-OllamaInfo
    if ($ol.Running) {
        $modelCount = $ol.Models
        Write-OK "Ollama :11434 = ON - $modelCount models"
    } else {
        Write-Fail 'Ollama :11434 = OFF'
    }

    # Vite
    if (Test-Vite) { Write-OK 'Vite Dev :8080 = ON' }
    else           { Write-Fail 'Vite Dev :8080 = OFF' }

    Write-Section 'Shortcuts'

    if (Test-Desktop)   { Write-OK 'Desktop shortcut: exists' }
    else                { Write-Fail 'Desktop shortcut: none' }

    if (Test-AutoStart) { Write-OK 'Auto-start with Windows: ON' }
    else                { Write-Fail 'Auto-start with Windows: OFF' }

    Write-Host ''
}

# ── Install ─────────────────────────────────────────────

function Invoke-Install {
    Write-Banner 'Installing Smart Transcriber'

    $total = 6

    # 1 - Python venv
    Write-Host "  [1/$total] Checking Python venv..." -ForegroundColor Yellow
    $vDir = Find-VenvDir
    if (-not $vDir) {
        if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
            Write-Fail 'Python not found! Install Python 3.10+ from python.org'
            return
        }
        Write-Alert 'No venv found - creating .venv ...'
        $newV = Join-Path $projectRoot '.venv'
        & python -m venv $newV
        if ($LASTEXITCODE -ne 0) { Write-Fail 'venv creation failed'; return }
        Write-OK "venv created: $newV"
    } else {
        Write-OK "venv: $vDir"
    }

    $py  = Find-VenvPython
    $pip = Find-VenvPip

    # 2 - Python packages
    Write-Host "  [2/$total] Installing Python packages..." -ForegroundColor Yellow
    $needed = @()
    if (-not (Test-PyModule $py 'flask'))   { $needed += 'flask','flask-cors' }
    if (-not (Test-PyModule $py 'pystray')) { $needed += 'pystray','Pillow' }

    if ($needed.Count -gt 0) {
        Write-Note "Installing: $($needed -join ', ')"
        & $pip install @needed --quiet 2>$null
        Write-OK 'Flask + pystray installed'
    } else {
        Write-OK 'Flask + pystray already present'
    }

    if (-not (Test-PyModule $py 'torch') -or -not (Test-PyModule $py 'faster_whisper')) {
        Write-Alert 'GPU packages (torch, faster-whisper) missing'
        Write-Note 'Run: .\scripts\install-whisper-server.ps1'
    } else {
        Write-OK 'PyTorch + faster-whisper present'
    }

    # 3 - npm
    Write-Host "  [3/$total] Checking npm..." -ForegroundColor Yellow
    $nm = Join-Path $projectRoot 'node_modules'
    if (-not (Test-Path $nm)) {
        if (Get-Command node -ErrorAction SilentlyContinue) {
            Write-Note 'Running npm install...'
            Push-Location $projectRoot
            npm install --silent 2>$null
            Pop-Location
            Write-OK 'npm packages installed'
        } else {
            Write-Alert 'Node.js not found - skipped'
        }
    } else {
        Write-OK 'npm packages present'
    }

    # 4 - Desktop shortcut
    Write-Host "  [4/$total] Creating desktop shortcut..." -ForegroundColor Yellow
    $bat  = Join-Path $projectRoot 'start-launcher.bat'
    $ico  = Join-Path $projectRoot 'public\favicon.ico'
    $desk = Get-DesktopPath

    if (Test-Path $bat) {
        $sh = New-Object -ComObject WScript.Shell
        $sc = $sh.CreateShortcut($desk)
        $sc.TargetPath = $bat
        $sc.WorkingDirectory = $projectRoot
        $sc.WindowStyle = 7
        $sc.Description = 'Smart Hebrew Transcriber'
        if (Test-Path $ico) { $sc.IconLocation = "$ico,0" }
        $sc.Save()
        Write-OK 'Desktop shortcut created'
    } else {
        Write-Fail 'start-launcher.bat not found'
    }

    # 5 - Auto-start
    Write-Host "  [5/$total] Registering auto-start..." -ForegroundColor Yellow
    if (Test-AutoStart) {
        Write-OK 'Already registered'
    } else {
        $startupPath = Get-AutoStartPath
        if (Test-Path $bat) {
            $sh = New-Object -ComObject WScript.Shell
            $sc = $sh.CreateShortcut($startupPath)
            $sc.TargetPath = $bat
            $sc.WorkingDirectory = $projectRoot
            $sc.WindowStyle = 7
            $sc.Description = 'Smart Hebrew Transcriber Auto Start'
            if (Test-Path $ico) { $sc.IconLocation = "$ico,0" }
            $sc.Save()
            Write-OK 'Auto-start registered'
        } else {
            Write-Fail 'start-launcher.bat not found'
        }
    }

    # 6 - Start tray
    Write-Host "  [6/$total] Starting Launcher Tray..." -ForegroundColor Yellow
    if (Test-Launcher) {
        Write-OK 'Launcher Tray already running'
    } else {
        Start-Tray
    }

    Write-Host ''
    Write-Host '  ============================================' -ForegroundColor Green
    Write-Host '    DONE - Installation complete!' -ForegroundColor Green
    Write-Host '  ============================================' -ForegroundColor Green
    Write-Host ''
    Show-Status
}

# ── Start / Stop ────────────────────────────────────────

function Start-Tray {
    if (Test-Launcher) {
        Write-OK 'Launcher Tray already running'
        return
    }
    $exeW = Find-VenvPythonW
    $exe  = Find-VenvPython
    $tray = Join-Path $projectRoot 'server\launcher_tray.py'

    if (-not (Test-Path $tray)) { Write-Fail 'launcher_tray.py not found'; return }
    $run = if ($exeW) { $exeW } else { $exe }
    if (-not $run) { Write-Fail 'Python not found'; return }

    Start-Process -FilePath $run -ArgumentList "`"$tray`"" -WorkingDirectory $projectRoot -WindowStyle Hidden
    Write-Note 'Waiting for Launcher Tray...'
    Start-Sleep -Seconds 3

    if (Test-Launcher) {
        Write-OK 'Launcher Tray is running! Check your System Tray icon.'
    } else {
        Write-Alert 'Launcher Tray not responding yet - give it a moment'
    }
}

function Stop-Tray {
    if (-not (Test-Launcher)) {
        Write-Note 'Launcher Tray is already off'
        return
    }

    # Graceful stop via API
    try {
        $null = Invoke-RestMethod -Uri 'http://localhost:8764/stop' -Method Post `
            -ContentType 'application/json' -Body '{"target":"all"}' -TimeoutSec 5 -ErrorAction Stop
    } catch { }

    # Kill pythonw/python running launcher_tray
    foreach ($procName in @('pythonw','python')) {
        $procs = Get-Process -Name $procName -ErrorAction SilentlyContinue
        foreach ($p in $procs) {
            try {
                $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId = $($p.Id)" -ErrorAction SilentlyContinue).CommandLine
                if ($cmd -and $cmd -match 'launcher_tray') {
                    Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
                }
            } catch { }
        }
    }
    Write-OK 'Launcher Tray stopped'
}

# ── Uninstall ───────────────────────────────────────────

function Invoke-Uninstall {
    Write-Banner 'Uninstalling Smart Transcriber'

    Write-Host '  [1/4] Stopping Launcher Tray...' -ForegroundColor Yellow
    Stop-Tray

    Write-Host '  [2/4] Removing desktop shortcut...' -ForegroundColor Yellow
    $dp = Get-DesktopPath
    if (Test-Path $dp) { Remove-Item $dp -Force; Write-OK 'Removed' }
    else { Write-Note 'Not found' }

    Write-Host '  [3/4] Removing auto-start...' -ForegroundColor Yellow
    $ap = Get-AutoStartPath
    if (Test-Path $ap) { Remove-Item $ap -Force; Write-OK 'Removed' }
    else { Write-Note 'Not found' }

    Write-Host '  [4/4] Removing scheduled task (legacy)...' -ForegroundColor Yellow
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-OK 'Done'

    Write-Host ''
    Write-Host '  ============================================' -ForegroundColor Yellow
    Write-Host '    Uninstall complete - files NOT deleted' -ForegroundColor Yellow
    Write-Host '  ============================================' -ForegroundColor Yellow
    Write-Host ''
}

# ── Interactive Menu ────────────────────────────────────

function Show-Menu {
    while ($true) {
        # Gather live status
        $lOk = Test-Launcher
        $wh  = Get-WhisperHealth
        $ol  = Get-OllamaInfo
        $vOk = Test-Vite

        $lTag = if ($lOk)          { '[V]' } else { '[X]' }
        $wTag = if ($wh.Running)   { '[V]' } else { '[X]' }
        $oTag = if ($ol.Running)   { '[V]' } else { '[X]' }
        $vTag = if ($vOk)          { '[V]' } else { '[X]' }
        $lClr = if ($lOk)          { 'Green' } else { 'Red' }
        $wClr = if ($wh.Running)   { 'Green' } else { 'Red' }
        $oClr = if ($ol.Running)   { 'Green' } else { 'Red' }
        $vClr = if ($vOk)          { 'Green' } else { 'Red' }

        Write-Host ''
        Write-Host '  ==============================================' -ForegroundColor Cyan
        Write-Host '     Smart Hebrew Transcriber  Launcher' -ForegroundColor Cyan
        Write-Host '  ==============================================' -ForegroundColor Cyan
        Write-Host ''
        Write-Host '   ' -NoNewline
        Write-Host $lTag -ForegroundColor $lClr -NoNewline
        Write-Host ' Launcher  ' -NoNewline
        Write-Host $wTag -ForegroundColor $wClr -NoNewline
        Write-Host ' CUDA  ' -NoNewline
        Write-Host $oTag -ForegroundColor $oClr -NoNewline
        Write-Host ' Ollama  ' -NoNewline
        Write-Host $vTag -ForegroundColor $vClr -NoNewline
        Write-Host ' Vite'
        Write-Host ''
        Write-Host '  ----------------------------------------------' -ForegroundColor DarkGray
        Write-Host '   1. Full Install  (deps + shortcut + tray)' -ForegroundColor White
        Write-Host '   2. Status        (detailed check)' -ForegroundColor White
        Write-Host '   3. Start Tray    (launcher only)' -ForegroundColor White
        Write-Host '   4. Start CUDA    (whisper server)' -ForegroundColor White
        Write-Host '   5. Start ALL     (CUDA + Ollama + Vite)' -ForegroundColor White
        Write-Host '   6. Stop ALL' -ForegroundColor White
        Write-Host '   7. Uninstall     (remove shortcuts)' -ForegroundColor White
        Write-Host '   8. Open Website' -ForegroundColor White
        Write-Host '   0. Exit' -ForegroundColor DarkGray
        Write-Host '  ----------------------------------------------' -ForegroundColor DarkGray
        Write-Host ''

        $c = Read-Host '  Choose'

        switch ($c) {
            '1' { Invoke-Install }
            '2' { Show-Status }
            '3' {
                if ($lOk) { Write-OK 'Launcher Tray already running' }
                else      { Start-Tray }
            }
            '4' {
                if ($wh.Running) {
                    Write-OK 'CUDA server already running'
                } elseif ($lOk) {
                    Write-Note 'Starting CUDA via Launcher...'
                    try {
                        $null = Invoke-RestMethod -Uri 'http://localhost:8764/start' -Method Post `
                            -ContentType 'application/json' -Body '{"target":"whisper"}' -TimeoutSec 10
                        Write-OK 'CUDA server starting - may take a few seconds'
                    } catch { Write-Fail 'Error starting via Launcher' }
                } else {
                    Write-Alert 'Launcher not running - starting CUDA directly...'
                    $p = Find-VenvPython
                    $s = Join-Path $projectRoot 'server\transcribe_server.py'
                    if ($p -and (Test-Path $s)) {
                        Start-Process -FilePath $p -ArgumentList "`"$s`" --port 8765" `
                            -WorkingDirectory $projectRoot -WindowStyle Minimized
                        Write-OK 'CUDA server starting on port 8765'
                    } else { Write-Fail 'Python or server script not found' }
                }
            }
            '5' {
                if (-not $lOk) {
                    Write-Alert 'Launcher not running - starting it first...'
                    Start-Tray
                    Start-Sleep -Seconds 2
                    $lOk = Test-Launcher
                }
                if ($lOk) {
                    Write-Note 'Starting all services...'
                    try {
                        $null = Invoke-RestMethod -Uri 'http://localhost:8764/start' -Method Post `
                            -ContentType 'application/json' -Body '{"target":"all"}' -TimeoutSec 10
                        Write-OK 'All services starting'
                    } catch { Write-Fail 'Error starting services' }
                } else {
                    Write-Fail 'Could not start Launcher'
                }
            }
            '6' {
                Write-Note 'Stopping all services...'
                Stop-Tray
                try {
                    $null = Invoke-WebRequest -Uri 'http://localhost:8765/shutdown' -Method Post `
                        -TimeoutSec 5 -ErrorAction SilentlyContinue
                } catch { }
                Write-OK 'All stopped'
            }
            '7' { Invoke-Uninstall }
            '8' {
                if ($vOk) { Start-Process 'http://localhost:8080' }
                else {
                    Write-Alert 'Vite not running - opening Lovable...'
                    Start-Process 'https://a1add912-bd72-490b-949a-bf5fe8ed03b5.lovable.app'
                }
            }
            '0' { return }
            default { Write-Alert 'Invalid option' }
        }

        Write-Host ''
        Write-Host '  Press Enter to continue...' -ForegroundColor DarkGray
        $null = Read-Host
    }
}

# ── Entry Point ─────────────────────────────────────────

if ($Install)   { Invoke-Install; exit 0 }
if ($Status)    { Show-Status; exit 0 }
if ($Start)     { Start-Tray; exit 0 }
if ($Stop)      { Stop-Tray; exit 0 }
if ($Uninstall) { Invoke-Uninstall; exit 0 }

Show-Menu
