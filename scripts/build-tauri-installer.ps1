param(
    [switch]$SkipTests
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$requiredResources = @(
    'server/transcribe_server.py',
    'server/transcript_quality.py',
    'server/config.py',
    'server/gpu_utils.py',
    'server/ai_enhance.py',
    'server/harmony_engine.py',
    'server/nikud_engine.py',
    'server/training_routes.py',
    'server/train_lora.py',
    'server/lk_data.db'
)

$missing = $requiredResources | Where-Object { -not (Test-Path -LiteralPath $_) }
if ($missing.Count -gt 0) {
    throw "Missing desktop resources: $($missing -join ', ')"
}

if (-not $SkipTests) {
    Write-Host 'Validating TypeScript...'
    & npx tsc --noEmit
    if ($LASTEXITCODE -ne 0) { throw 'TypeScript validation failed.' }

    Write-Host 'Running Rust tests...'
    & cargo test --manifest-path src-tauri/Cargo.toml
    if ($LASTEXITCODE -ne 0) { throw 'Rust tests failed.' }
}

Write-Host 'Building Windows installers...'
& npm run tauri:build
if ($LASTEXITCODE -ne 0) { throw 'Tauri installer build failed.' }

$bundleRoot = Join-Path $repoRoot 'src-tauri/target/release/bundle'
$artifacts = Get-ChildItem -LiteralPath $bundleRoot -Recurse -File -ErrorAction Stop |
    Where-Object { $_.Extension -eq '.exe' } |
    Sort-Object FullName

if ($artifacts.Count -eq 0) {
    throw "No NSIS EXE installer was produced under $bundleRoot"
}

Write-Host ''
Write-Host 'Installers created:'
$artifacts | ForEach-Object {
    $sizeMb = [math]::Round($_.Length / 1MB, 1)
    Write-Host "  $($_.FullName) ($sizeMb MB)"
}
