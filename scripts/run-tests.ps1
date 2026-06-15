<#
.SYNOPSIS
  מריץ את מערכת הבדיקות (Playwright E2E Tests)

.DESCRIPTION
  סקריפט זה מריץ את כל בדיקות Playwright.
  הוא מוודא ש-Vite dev server רץ (או מפעיל אותו אוטומטית).

.PARAMETER Headed
  הרצה עם דפדפן גלוי (לא headless)

.PARAMETER UI
  פתיחת Playwright UI Mode (ממשק גרפי)

.PARAMETER Filter
  סינון בדיקות לפי שם קובץ (למשל: "auth" או "navigation")

.PARAMETER Report
  פתיחת דוח HTML אחרי ההרצה

.EXAMPLE
  .\scripts\run-tests.ps1
  .\scripts\run-tests.ps1 -Headed
  .\scripts\run-tests.ps1 -UI
  .\scripts\run-tests.ps1 -Filter "auth"
  .\scripts\run-tests.ps1 -Report
#>

param(
  [switch]$Headed,
  [switch]$UI,
  [string]$Filter,
  [switch]$Report
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot

Push-Location $ProjectRoot

Write-Host ""
Write-Host "======================================" -ForegroundColor Cyan
Write-Host "  Playwright E2E Tests Runner" -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan
Write-Host ""

# Check if Vite dev server is already running on port 8080
$viteRunning = $false
try {
  $conn = Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue
  if ($conn) { $viteRunning = $true }
} catch {}

if (-not $viteRunning) {
  Write-Host "[*] Vite dev server not running. Starting..." -ForegroundColor Yellow
  $viteJob = Start-Job -ScriptBlock {
    Set-Location $using:ProjectRoot
    npx vite --port 8080 2>&1
  }
  Write-Host "[*] Waiting for Vite to start..." -ForegroundColor Yellow
  Start-Sleep -Seconds 5

  # Verify it started
  $retries = 0
  while ($retries -lt 10) {
    try {
      $response = Invoke-WebRequest -Uri "http://localhost:8080" -TimeoutSec 2 -ErrorAction SilentlyContinue
      if ($response.StatusCode -eq 200) {
        Write-Host "[+] Vite dev server ready!" -ForegroundColor Green
        break
      }
    } catch {}
    $retries++
    Start-Sleep -Seconds 2
  }

  if ($retries -ge 10) {
    Write-Host "[!] Could not start Vite. Run 'npm run dev' manually." -ForegroundColor Red
    Stop-Job $viteJob -ErrorAction SilentlyContinue
    Remove-Job $viteJob -ErrorAction SilentlyContinue
    Pop-Location
    exit 1
  }
} else {
  Write-Host "[+] Vite dev server already running on port 8080" -ForegroundColor Green
}

# Build Playwright command
$cmd = "npx playwright test"

if ($UI) {
  $cmd = "npx playwright test --ui"
} elseif ($Headed) {
  $cmd += " --headed"
}

if ($Filter) {
  $cmd += " $Filter"
}

Write-Host ""
Write-Host "[>] Running: $cmd" -ForegroundColor Magenta
Write-Host ""

# Run tests
Invoke-Expression $cmd
$exitCode = $LASTEXITCODE

# Show report if requested
if ($Report -or ($exitCode -ne 0)) {
  Write-Host ""
  if ($exitCode -ne 0) {
    Write-Host "[!] Some tests failed. Opening report..." -ForegroundColor Yellow
  } else {
    Write-Host "[+] All tests passed!" -ForegroundColor Green
  }
  if ($Report) {
    npx playwright show-report
  }
}

# Cleanup Vite if we started it
if ($viteJob) {
  Write-Host "[*] Stopping Vite dev server..." -ForegroundColor Yellow
  Stop-Job $viteJob -ErrorAction SilentlyContinue
  Remove-Job $viteJob -ErrorAction SilentlyContinue
}

Pop-Location
exit $exitCode
