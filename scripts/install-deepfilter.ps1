param(
    [string]$Python312 = "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe"
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$Venv = Join-Path $RepoRoot ".venv-deepfilter"
$VenvPython = Join-Path $Venv "Scripts\python.exe"

if (-not (Test-Path -LiteralPath $Python312)) {
    throw "Python 3.12 was not found at $Python312"
}

if (-not (Test-Path -LiteralPath $VenvPython)) {
    & $Python312 -m venv $Venv
}

& $VenvPython -m pip install --upgrade pip
& $VenvPython -m pip install deepfilternet==0.5.6 soundfile
& $VenvPython -m pip install torch==2.8.0+cu128 torchaudio==2.8.0+cu128 `
    --index-url https://download.pytorch.org/whl/cu128

& $VenvPython -c "import df, torch; assert torch.cuda.is_available(); print(torch.cuda.get_device_name(0))"
Write-Host "DeepFilterNet is ready in $Venv" -ForegroundColor Green
