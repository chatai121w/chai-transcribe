param(
  [string]$LogRoot = "$env:LOCALAPPDATA\SmartTranscriber\monitor",
  [int]$Hours = 24
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $LogRoot)) {
  throw "Log root not found: $LogRoot"
}

$cutoff = (Get-Date).AddHours(-1 * $Hours)

$heartbeats = Get-ChildItem -Path $LogRoot -Filter heartbeat.jsonl -Recurse |
  Where-Object { $_.LastWriteTime -ge $cutoff }

$alerts = Get-ChildItem -Path $LogRoot -Filter alerts.jsonl -Recurse |
  Where-Object { $_.LastWriteTime -ge $cutoff }

Write-Host "Heartbeat files:" $heartbeats.Count
Write-Host "Alert files:" $alerts.Count

$allRows = @()
foreach ($f in $heartbeats) {
  Get-Content $f.FullName | ForEach-Object {
    if ([string]::IsNullOrWhiteSpace($_)) { return }
    try {
      $obj = $_ | ConvertFrom-Json
      $allRows += $obj
    } catch {}
  }
}

if ($allRows.Count -eq 0) {
  Write-Host "No heartbeat data found in last $Hours hours." -ForegroundColor Yellow
  exit 0
}

$maxMem = $allRows | Sort-Object { [double]$_.system.usedMemPct } -Descending | Select-Object -First 1
Write-Host "Peak memory usage:" ([double]$maxMem.system.usedMemPct) "% at" $maxMem.ts

$npRows = @()
foreach ($row in $allRows) {
  foreach ($p in $row.nodePython) {
    $npRows += [pscustomobject]@{
      ts = $row.ts
      pid = $p.pid
      name = $p.name
      wsMB = [double]$p.wsMB
      cpuSec = [double]$p.cpuSec
      projectRelated = [bool]$p.projectRelated
      commandLine = [string]$p.commandLine
    }
  }
}

if ($npRows.Count -gt 0) {
  Write-Host "Top Node/Python by memory:" -ForegroundColor Cyan
  $npRows | Sort-Object wsMB -Descending | Select-Object -First 15 ts,pid,name,wsMB,cpuSec,projectRelated | Format-Table -AutoSize
}

$alertRows = @()
foreach ($f in $alerts) {
  Get-Content $f.FullName | ForEach-Object {
    if ([string]::IsNullOrWhiteSpace($_)) { return }
    try {
      $obj = $_ | ConvertFrom-Json
      $alertRows += $obj
    } catch {}
  }
}

if ($alertRows.Count -gt 0) {
  Write-Host "Recent alerts/events:" -ForegroundColor Cyan
  $alertRows | Select-Object -Last 30 | Format-Table -AutoSize
}

Write-Host "Analysis complete. Log root: $LogRoot" -ForegroundColor Green
