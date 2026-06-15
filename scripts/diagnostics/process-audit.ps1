param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
  [switch]$CleanupStale,
  [switch]$IncludeExternal,
  [int]$MinStaleMinutes = 30
)

$ErrorActionPreference = "SilentlyContinue"
Set-StrictMode -Version Latest

function Get-ListenPortsByPid {
  $map = @{}
  try {
    $listens = Get-NetTCPConnection -State Listen
    foreach ($c in $listens) {
      $pid = [int]$c.OwningProcess
      if (-not $map.ContainsKey($pid)) {
        $map[$pid] = New-Object System.Collections.Generic.List[int]
      }
      $map[$pid].Add([int]$c.LocalPort)
    }
  } catch {}
  return $map
}

function Get-CommandLineMap {
  $map = @{}
  try {
    $procs = Get-CimInstance Win32_Process
    foreach ($p in $procs) {
      $map[[int]$p.ProcessId] = @{
        CommandLine = [string]$p.CommandLine
        ParentProcessId = [int]$p.ParentProcessId
        CreationDate = $p.CreationDate
      }
    }
  } catch {}
  return $map
}

$listenMap = Get-ListenPortsByPid
$cmdMap = Get-CommandLineMap

$now = Get-Date
$target = Get-Process | Where-Object { $_.ProcessName -in @("node", "python", "pythonw") }

$rows = @()
foreach ($p in $target) {
  $procId = [int]$p.Id
  $cmdInfo = $cmdMap[$procId]
  $cmd = ""
  $ppid = 0
  $created = $p.StartTime

  if ($cmdInfo) {
    $cmd = [string]$cmdInfo.CommandLine
    $ppid = [int]$cmdInfo.ParentProcessId
    if ($cmdInfo.CreationDate) {
      try {
        if ($cmdInfo.CreationDate -is [datetime]) {
          $created = [datetime]$cmdInfo.CreationDate
        } else {
          $created = [Management.ManagementDateTimeConverter]::ToDateTime([string]$cmdInfo.CreationDate)
        }
      } catch {}
    }
  }

  $cmdLower = $cmd.ToLower()
  $isProjectRelated = $false
  if ($cmdLower.Contains($ProjectRoot.ToLower())) { $isProjectRelated = $true }
  if ($cmdLower.Contains("playwright.config.ts") -or $cmdLower.Contains("transcribe_server.py") -or $cmdLower.Contains("npx vite") -or $cmdLower.Contains("vite --port")) { $isProjectRelated = $true }

  $ports = @()
  if ($listenMap.ContainsKey($procId)) {
    $ports = $listenMap[$procId] | Sort-Object -Unique
  }

  $runtimeMin = [math]::Round(($now - $created).TotalMinutes, 1)
  $cpuSec = [math]::Round($p.CPU, 2)
  $wsMB = [math]::Round($p.WorkingSet64 / 1MB, 1)

  $status = "External"
  $recommendation = "Ignore"

  if ($isProjectRelated) {
    if ($ports.Count -gt 0 -or $runtimeMin -lt 10 -or $cpuSec -ge 10) {
      $status = "ActiveLikely"
      $recommendation = "Keep"
    } elseif ($runtimeMin -ge $MinStaleMinutes -and $cpuSec -lt 5 -and $ports.Count -eq 0) {
      $status = "StaleLikely"
      $recommendation = "CanStop"
    } else {
      $status = "ProjectRelated"
      $recommendation = "Review"
    }
  }

  $rows += [pscustomobject]@{
    pid = $procId
    name = $p.ProcessName
    runtimeMin = $runtimeMin
    cpuSec = $cpuSec
    wsMB = $wsMB
    parentPid = $ppid
    ports = ($ports -join ",")
    status = $status
    recommendation = $recommendation
    projectRelated = $isProjectRelated
    commandLine = $cmd
  }
}

$view = $rows
if (-not $IncludeExternal) {
  $view = $rows | Where-Object { $_.projectRelated }
}

Write-Host "=== Process Audit (Node/Python) ===" -ForegroundColor Cyan
if ($view.Count -eq 0) {
  Write-Host "No matching processes found." -ForegroundColor Yellow
} else {
  $view |
    Sort-Object status, runtimeMin -Descending |
    Select-Object pid,name,status,recommendation,runtimeMin,cpuSec,wsMB,ports,parentPid |
    Format-Table -AutoSize
}

$stale = $rows | Where-Object { $_.status -eq "StaleLikely" -and $_.projectRelated }
if ($stale.Count -gt 0) {
  Write-Host "`nStale candidates:" -ForegroundColor Yellow
  $stale | Select-Object pid,name,runtimeMin,cpuSec,wsMB,commandLine | Format-List
}

if ($CleanupStale -and $stale.Count -gt 0) {
  foreach ($s in $stale) {
    try {
      Stop-Process -Id $s.pid -Force
      Write-Host "Stopped stale process PID $($s.pid) ($($s.name))" -ForegroundColor Green
    } catch {
      Write-Host "Failed stopping PID $($s.pid): $($_.Exception.Message)" -ForegroundColor Red
    }
  }
}

$logRoot = Join-Path $env:LOCALAPPDATA "SmartTranscriber\monitor"
if (Test-Path $logRoot) {
  $auditDir = Join-Path $logRoot "audit"
  New-Item -ItemType Directory -Path $auditDir -Force | Out-Null
  $stamp = (Get-Date).ToString("yyyyMMdd_HHmmss")
  $outPath = Join-Path $auditDir "process_audit_$stamp.json"
  $rows | ConvertTo-Json -Depth 6 | Set-Content -Path $outPath -Encoding UTF8
  Write-Host "`nSaved audit: $outPath" -ForegroundColor Cyan
}
