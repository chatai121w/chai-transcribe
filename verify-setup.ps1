# ============================================================
#  Full health check: GPU, ctranslate2, model, inference, frontend.
#  Shows a PASS/FAIL report and writes verify-log.txt.
# ============================================================
Set-Location -Path $PSScriptRoot
$log = Join-Path $PSScriptRoot "verify-log.txt"
Remove-Item $log -Force -ErrorAction SilentlyContinue

function Log($m) { $m | Tee-Object -FilePath $log -Append | Out-Host }

# --- Frontend deps ---
Log "=== Frontend check ==="
if (Test-Path (Join-Path $PSScriptRoot "node_modules")) {
    Log "[node] node_modules present: OK"
} else {
    Log "[node] node_modules MISSING -> run 'npm install'"
}

# --- Ports info (just informational) ---
foreach ($p in 3000, 8080) {
    $inUse = Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue
    if ($inUse) { Log "[port] $p is already IN USE (a server may already be running)" }
    else        { Log "[port] $p is free: OK" }
}

# --- Backend / GPU / model (heavy check via python) ---
Log ""
$py = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
& $py "$PSScriptRoot\verify-setup.py" 2>&1 | Tee-Object -FilePath $log -Append | Out-Host

Log ""
Log "Log saved to: $log"
Read-Host "Done - press Enter to close"
