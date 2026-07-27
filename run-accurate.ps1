# ============================================================
#  Smart Hebrew Transcriber - MAX ACCURACY mode
#  Runs the full ivrit-ai/whisper-large-v3-ct2 model (most accurate
#  Hebrew model on the ivrit.ai leaderboard, ~8.8% WER).
#  Slower than the turbo model but the highest quality available.
#  Use for hard audio: noise, multiple speakers, unclear recordings.
# ============================================================
$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

Write-Host "Starting in MAX-ACCURACY mode: ivrit-ai/whisper-large-v3-ct2" -ForegroundColor Cyan
& "$PSScriptRoot\run-dev.ps1" -Model "ivrit-ai/whisper-large-v3-ct2"
