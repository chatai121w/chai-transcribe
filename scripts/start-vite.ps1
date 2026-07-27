param(
    [int]$PreferredPort = 8080,
    [switch]$NoOpen
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot "port-utils.ps1")

$port = Resolve-AvailablePort -PreferredPort $PreferredPort
$url = "http://localhost:$port"

if ($port -ne $PreferredPort) {
    Write-Host "[Port] $PreferredPort is occupied; starting Smart Hebrew Transcriber on $port." -ForegroundColor Yellow
} else {
    Write-Host "[Port] Starting Smart Hebrew Transcriber on $port." -ForegroundColor Green
}

Write-Host "[App] $url" -ForegroundColor Cyan
if (-not $NoOpen) {
    Start-Process $url
}

Set-Location $projectRoot
npm run dev:vite -- --host 127.0.0.1 --port $port --strictPort
