param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
  [string]$LogRoot = "$env:LOCALAPPDATA\SmartTranscriber\monitor",
  [int]$IntervalSec = 5,
  [int]$RetentionDays = 14
)

$ErrorActionPreference = "SilentlyContinue"
Set-StrictMode -Version Latest

function New-LogLine {
  param([hashtable]$Data)
  return ($Data | ConvertTo-Json -Compress -Depth 6)
}

function Append-JsonLine {
  param(
    [string]$Path,
    [hashtable]$Data
  )
  Add-Content -Path $Path -Value (New-LogLine -Data $Data)
}

function Safe-GetCommandLineMap {
  $map = @{}
  $procs = Get-CimInstance Win32_Process
  foreach ($p in $procs) {
    $map[[int]$p.ProcessId] = @{
      CommandLine = [string]$p.CommandLine
      ParentProcessId = [int]$p.ParentProcessId
      Name = [string]$p.Name
      CreationDate = [string]$p.CreationDate
    }
  }
  return $map
}

function Get-NodePythonSnapshot {
  param(
    [hashtable]$CmdMap,
    [string]$ProjectRoot
  )

  $interesting = Get-Process | Where-Object { $_.ProcessName -in @("node", "python", "pythonw") }
  $rows = @()
  foreach ($p in $interesting) {
    $procId = [int]$p.Id
    $cmdInfo = $CmdMap[$procId]
    $cmd = ""
    $ppid = 0
    if ($cmdInfo) {
      $cmd = [string]$cmdInfo.CommandLine
      $ppid = [int]$cmdInfo.ParentProcessId
    }

    $isProjectRelated = $false
    if ($cmd) {
      $cmdLower = $cmd.ToLower()
      if ($cmdLower.Contains($ProjectRoot.ToLower())) {
        $isProjectRelated = $true
      }
      if ($cmdLower.Contains("playwright.config.ts") -or $cmdLower.Contains("node_modules\\@playwright") -or $cmdLower.Contains("transcribe_server.py")) {
        $isProjectRelated = $true
      }
    }

    $rows += @{
      pid = $procId
      name = $p.ProcessName
      cpuSec = [math]::Round($p.CPU, 2)
      wsMB = [math]::Round($p.WorkingSet64 / 1MB, 1)
      start = $p.StartTime.ToString("s")
      parentPid = $ppid
      projectRelated = $isProjectRelated
      commandLine = $cmd
    }
  }
  return $rows
}

function Get-TopCpuSnapshot {
  $top = Get-Process | Sort-Object CPU -Descending | Select-Object -First 10
  $rows = @()
  foreach ($p in $top) {
    $rows += @{
      pid = [int]$p.Id
      name = $p.ProcessName
      cpuSec = [math]::Round($p.CPU, 2)
      wsMB = [math]::Round($p.WorkingSet64 / 1MB, 1)
    }
  }
  return $rows
}

function Get-SystemSummary {
  $os = Get-CimInstance Win32_OperatingSystem
  $bootRaw = $os.LastBootUpTime
  if ($bootRaw -is [datetime]) {
    $boot = [datetime]$bootRaw
  } else {
    try {
      $boot = [Management.ManagementDateTimeConverter]::ToDateTime([string]$bootRaw)
    } catch {
      $boot = (Get-Date)
    }
  }
  $totalMemMB = [math]::Round(([double]$os.TotalVisibleMemorySize) / 1024, 0)
  $freeMemMB = [math]::Round(([double]$os.FreePhysicalMemory) / 1024, 0)

  return @{
    host = $env:COMPUTERNAME
    user = $env:USERNAME
    bootTime = $boot.ToString("s")
    uptimeSec = [math]::Round(((Get-Date) - $boot).TotalSeconds, 0)
    totalMemMB = $totalMemMB
    freeMemMB = $freeMemMB
    usedMemPct = if ($totalMemMB -gt 0) { [math]::Round((($totalMemMB - $freeMemMB) / $totalMemMB) * 100, 1) } else { 0 }
  }
}

function Get-Health {
  $health = @{}
  $targets = @(
    @{ key = "web8091"; url = "http://localhost:8091" },
    @{ key = "web8080"; url = "http://localhost:8080" },
    @{ key = "whisper3000"; url = "http://localhost:3000/health" }
  )

  foreach ($t in $targets) {
    try {
      $r = Invoke-WebRequest -UseBasicParsing -Uri $t.url -TimeoutSec 3
      $health[$t.key] = @{
        ok = $true
        status = [int]$r.StatusCode
      }
    } catch {
      $health[$t.key] = @{
        ok = $false
        status = 0
        error = $_.Exception.Message
      }
    }
  }

  return $health
}

function Get-RecentCrashEvents {
  param([datetime]$Since)

  $rows = @()
  try {
    $sys = Get-WinEvent -FilterHashtable @{ LogName = 'System'; StartTime = $Since; Id = 41, 6008 } -ErrorAction Stop
    foreach ($e in $sys) {
      $rows += @{
        source = "System"
        id = [int]$e.Id
        level = [int]$e.Level
        time = $e.TimeCreated.ToString("s")
        provider = $e.ProviderName
        message = ($e.Message -replace "\r|\n", " ").Substring(0, [Math]::Min(800, $e.Message.Length))
      }
    }
  } catch {}

  try {
    $app = Get-WinEvent -FilterHashtable @{ LogName = 'Application'; StartTime = $Since; Id = 1000, 1001 } -ErrorAction Stop
    foreach ($e in $app) {
      $rows += @{
        source = "Application"
        id = [int]$e.Id
        level = [int]$e.Level
        time = $e.TimeCreated.ToString("s")
        provider = $e.ProviderName
        message = ($e.Message -replace "\r|\n", " ").Substring(0, [Math]::Min(800, $e.Message.Length))
      }
    }
  } catch {}

  return $rows
}

function Rotate-OldLogs {
  param(
    [string]$Root,
    [int]$RetentionDays
  )
  $cutoff = (Get-Date).AddDays(-1 * $RetentionDays)
  Get-ChildItem -Path $Root -File -Recurse | Where-Object { $_.LastWriteTime -lt $cutoff } | Remove-Item -Force
}

New-Item -ItemType Directory -Path $LogRoot -Force | Out-Null
$sessionId = (Get-Date).ToString("yyyyMMdd_HHmmss") + "_" + $env:COMPUTERNAME
$sessionDir = Join-Path $LogRoot $sessionId
New-Item -ItemType Directory -Path $sessionDir -Force | Out-Null

$heartbeatLog = Join-Path $sessionDir "heartbeat.jsonl"
$alertsLog = Join-Path $sessionDir "alerts.jsonl"
$stateFile = Join-Path $LogRoot "monitor_state.json"

$startMeta = @{
  event = "monitor_started"
  ts = (Get-Date).ToString("o")
  sessionId = $sessionId
  projectRoot = $ProjectRoot
  intervalSec = $IntervalSec
  logRoot = $LogRoot
}
Append-JsonLine -Path $alertsLog -Data $startMeta

$lastCrashScan = (Get-Date).AddHours(-6)
if (Test-Path $stateFile) {
  try {
    $prevState = Get-Content $stateFile -Raw | ConvertFrom-Json
    if ($prevState.lastHeartbeatTs) {
      $parsed = [datetime]::Parse([string]$prevState.lastHeartbeatTs)
      if ($parsed -lt (Get-Date)) {
        $lastCrashScan = $parsed.AddMinutes(-5)
      }
    }
  } catch {}
}
$tick = 0

try {
  while ($true) {
    $now = Get-Date
    $cmdMap = Safe-GetCommandLineMap
    $sys = Get-SystemSummary
    $np = Get-NodePythonSnapshot -CmdMap $cmdMap -ProjectRoot $ProjectRoot
    $top = Get-TopCpuSnapshot
    $health = Get-Health

    $row = @{
      ts = $now.ToString("o")
      system = $sys
      nodePython = $np
      topCpu = $top
      health = $health
    }
    Append-JsonLine -Path $heartbeatLog -Data $row

    # Mark suspicious processes: high RAM and not project-related
    foreach ($p in $np) {
      if (($p.wsMB -ge 500 -or $p.cpuSec -ge 3600) -and (-not $p.projectRelated)) {
        Append-JsonLine -Path $alertsLog -Data @{
          event = "suspicious_process"
          ts = $now.ToString("o")
          details = $p
        }
      }
    }

    if ($tick % 6 -eq 0) {
      $events = Get-RecentCrashEvents -Since $lastCrashScan
      foreach ($e in $events) {
        Append-JsonLine -Path $alertsLog -Data @{
          event = "windows_crash_event"
          ts = $now.ToString("o")
          details = $e
        }
      }
      $lastCrashScan = $now

      $state = @{
        lastHeartbeatTs = $now.ToString("o")
        sessionId = $sessionId
        heartbeatLog = $heartbeatLog
        alertsLog = $alertsLog
      }
      $state | ConvertTo-Json -Depth 4 | Set-Content -Path $stateFile -Encoding UTF8
      Rotate-OldLogs -Root $LogRoot -RetentionDays $RetentionDays
    }

    $tick++
    Start-Sleep -Seconds $IntervalSec
  }
} catch {
  Append-JsonLine -Path $alertsLog -Data @{
    event = "monitor_crashed"
    ts = (Get-Date).ToString("o")
    error = $_.Exception.Message
  }
  throw
}
