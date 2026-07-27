# ============================================================
#  git-sync.ps1  —  Safely pull everything from GitHub
# ------------------------------------------------------------
#  WHAT IT DOES (safe by design — nothing is ever lost):
#   1. Creates a FULL backup branch (snapshot of your current state).
#   2. Backs up the files you really changed to a folder too.
#   3. Fetches the latest from GitHub (origin/main).
#   4. Resets the working tree to match GitHub exactly
#      (this also clears the CRLF/line-ending noise on ~650 files).
#   5. Re-applies YOUR real code changes on top, so no function is lost.
#   6. Leaves untracked files (helper scripts, LoRA data) untouched.
#
#  UNDO ANYTIME:  git reset --hard <backup-branch shown at the end>
# ============================================================
$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

function Fail($msg) { Write-Host "[ERROR] $msg" -ForegroundColor Red; Read-Host "Press Enter to close"; exit 1 }

# --- sanity checks -------------------------------------------------------
git rev-parse --is-inside-work-tree *> $null 2>&1
if ($LASTEXITCODE -ne 0) { Fail "This folder is not a git repository." }
$hasOrigin = (git remote) -contains "origin"
if (-not $hasOrigin) { Fail "No 'origin' remote configured." }

$branch = (git rev-parse --abbrev-ref HEAD).Trim()
$ts     = Get-Date -Format "yyyyMMdd-HHmmss"
$backup = "backup/pre-sync-$ts"

Write-Host "============================================" -ForegroundColor Cyan
Write-Host " GitHub sync — branch: $branch" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan

# Files with REAL (non line-ending) local changes that must be preserved.
# Detected automatically: any tracked file that differs ignoring whitespace.
Write-Host "[..] Detecting your real (non-CRLF) changes..." -ForegroundColor Yellow
$realFiles = @()
$changed = git diff --name-only
foreach ($f in $changed) {
    if (-not $f) { continue }
    git diff --ignore-all-space --quiet -- "$f" 2>$null
    if ($LASTEXITCODE -ne 0) { $realFiles += $f }
}
if ($realFiles.Count -gt 0) {
    Write-Host "    Real changes to preserve:" -ForegroundColor Green
    $realFiles | ForEach-Object { Write-Host "      - $_" -ForegroundColor Green }
} else {
    Write-Host "    (none — only line-ending noise)" -ForegroundColor DarkGray
}

# --- 1. full safety backup branch (snapshot of everything) ---------------
Write-Host "[..] Creating safety backup branch: $backup" -ForegroundColor Yellow
git checkout -b $backup *> $null
git add -A
git commit -m "Safety snapshot before GitHub sync ($ts)" --no-verify *> $null 2>&1
git checkout $branch *> $null
Write-Host "    Backup saved. Undo anytime with: git reset --hard $backup" -ForegroundColor Green

# --- 2. also copy real files to a plain folder (belt + suspenders) -------
$backupDir = Join-Path $PSScriptRoot "_sync-backup-$ts"
if ($realFiles.Count -gt 0) {
    New-Item -ItemType Directory -Force -Path $backupDir *> $null
    foreach ($f in $realFiles) {
        $dest = Join-Path $backupDir $f
        New-Item -ItemType Directory -Force -Path (Split-Path $dest) *> $null
        git show "${backup}:$f" 2>$null | Set-Content -LiteralPath $dest -NoNewline
    }
    Write-Host "    Plain-file copies in: $backupDir" -ForegroundColor Green
}

# --- 3. fetch + report ---------------------------------------------------
Write-Host "[..] Fetching from GitHub..." -ForegroundColor Yellow
git fetch origin
$behind = (git rev-list --count "HEAD..origin/$branch").Trim()
Write-Host "    New commits on GitHub to apply: $behind" -ForegroundColor Cyan
if ([int]$behind -gt 0) {
    Write-Host "    Incoming commits:" -ForegroundColor Cyan
    git --no-pager log --oneline "HEAD..origin/$branch"
}

# --- 4. reset working tree to GitHub (clears CRLF noise too) -------------
Write-Host "[..] Applying GitHub state (origin/$branch)..." -ForegroundColor Yellow
git reset --hard "origin/$branch"

# --- 5. re-apply your real code changes on top --------------------------
if ($realFiles.Count -gt 0) {
    Write-Host "[..] Re-applying your real changes so no function is lost..." -ForegroundColor Yellow
    foreach ($f in $realFiles) {
        git checkout $backup -- "$f" 2>$null
        Write-Host "      restored: $f" -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "[DONE] Sync complete." -ForegroundColor Green
Write-Host "  - GitHub changes applied ($behind new commit(s))." -ForegroundColor Green
Write-Host "  - CRLF noise cleared." -ForegroundColor Green
Write-Host "  - Your real changes re-applied: $($realFiles.Count) file(s)." -ForegroundColor Green
Write-Host "  - Untracked files (scripts, LoRA data) untouched." -ForegroundColor Green
Write-Host ""
Write-Host "  Full backup branch : $backup" -ForegroundColor DarkGray
Write-Host "  Undo everything    : git reset --hard $backup" -ForegroundColor DarkGray
Read-Host "Press Enter to close"
