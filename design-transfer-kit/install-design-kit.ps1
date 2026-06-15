param(
  [Parameter(Mandatory = $false)]
  [string]$TargetRoot = "."
)

$ErrorActionPreference = "Stop"

$kitRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$targetPath = Resolve-Path $TargetRoot

$stylesDir = Join-Path $targetPath "src/styles"
if (-not (Test-Path $stylesDir)) {
  New-Item -ItemType Directory -Path $stylesDir -Force | Out-Null
}

Copy-Item -Path (Join-Path $kitRoot "tokens.css") -Destination (Join-Path $stylesDir "design-tokens.css") -Force
Copy-Item -Path (Join-Path $kitRoot "tailwind.preset.ts") -Destination (Join-Path $targetPath "design-transfer-kit.tailwind.preset.ts") -Force
Copy-Item -Path (Join-Path $kitRoot "design-kit.json") -Destination (Join-Path $targetPath "design-kit.json") -Force

Write-Host "Design kit files copied successfully." -ForegroundColor Green
Write-Host "Next: import src/styles/design-tokens.css in your main stylesheet." -ForegroundColor Yellow
Write-Host "Next: add design-transfer-kit.tailwind.preset.ts to your Tailwind presets." -ForegroundColor Yellow
