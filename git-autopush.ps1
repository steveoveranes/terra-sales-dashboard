# ============================================================================
#  Terra Sales Dashboard - auto-push watcher
#
#  Start this ONCE (via start-autopush.bat) and leave the window open. It watches
#  a small trigger file (PUSH.trigger). Whenever that file changes, it commits ALL
#  changes and pushes to GitHub automatically.
#
#  Claude writes PUSH.trigger (with the commit message as its contents) when you
#  say something like "github commit go!". So you never touch git yourself: you
#  tell Claude, Claude drops the trigger, and this watcher does the push.
#
#  You can also trigger a push by hand: just save any change to PUSH.trigger.
#
#  .env, build logs and the trigger files are skipped automatically (.gitignore).
# ============================================================================

$ErrorActionPreference = 'Continue'
$Src     = $PSScriptRoot
$Trigger = Join-Path $Src 'PUSH.trigger'
$Log     = Join-Path $Src 'push.log'
$Status  = Join-Path $Src 'push-status.txt'

function Log($m) {
  $line = ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $m)
  Write-Host $line
  try { Add-Content -Path $Log -Value $line -ErrorAction SilentlyContinue } catch {}
}

function Invoke-Push {
  try { Set-Content -Path $Log -Value ("=== Push started {0} ===" -f (Get-Date)) -ErrorAction SilentlyContinue } catch {}

  # Commit message = first non-empty line of the trigger file (Claude puts it there).
  $msg = ''
  try {
    $msg = (Get-Content -Path $Trigger -ErrorAction SilentlyContinue |
            Where-Object { $_ -match '\S' } | Select-Object -First 1)
  } catch {}
  if ([string]::IsNullOrWhiteSpace($msg)) { $msg = 'Update Terra Sales Dashboard (auto-push)' }
  # strip a trailing timestamp token Claude may append, keep it readable
  $msg = $msg.Trim()

  Push-Location $Src
  Log "git add -A"
  & cmd /c "git add -A" *>> $Log
  Log ("git commit -m ""{0}""" -f $msg)
  & cmd /c "git commit -m ""$msg"" -m ""Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"" -m ""Claude-Session: https://claude.ai/code/session_01QQwUvoZQken6e3k9BnMeNW""" *>> $Log
  Log "git push"
  & cmd /c "git push" *>> $Log
  $code = $LASTEXITCODE
  Pop-Location

  if ($code -eq 0) {
    Log '=== Push done (OK) ==='
    try { Set-Content -Path $Status -Value ("OK  {0}" -f (Get-Date)) -ErrorAction SilentlyContinue } catch {}
  } else {
    Log ("*** git push returned {0} - see push.log (could be 'nothing to commit' or an auth error) ***" -f $code)
    try { Set-Content -Path $Status -Value ("FAILED  {0}" -f (Get-Date)) -ErrorAction SilentlyContinue } catch {}
  }
}

Write-Host ''
Write-Host '============================================================'
Write-Host '  Terra Sales Dashboard - auto-push watcher'
Write-Host '  Leave this window open. Press Ctrl+C to stop.'
Write-Host '  Say "github commit go!" to Claude to trigger a push.'
Write-Host '============================================================'
Write-Host ''

where.exe git *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Host 'Git is not installed or not on PATH. Install Git for Windows and run this again.'
  pause
  exit 1
}

# make sure the trigger exists, then remember its timestamp (do NOT push on startup)
if (-not (Test-Path $Trigger)) { Set-Content -Path $Trigger -Value 'init' -Force }
$last = (Get-Item $Trigger).LastWriteTimeUtc

Log 'Watching for push triggers... (leave this running)'
while ($true) {
  Start-Sleep -Seconds 2
  try {
    $now = (Get-Item $Trigger).LastWriteTimeUtc
    if ($now -ne $last) {
      $last = $now
      Log 'Push trigger detected'
      Invoke-Push
      Log 'Watching for push triggers...'
    }
  } catch {}
}
