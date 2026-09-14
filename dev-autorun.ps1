# ============================================================================
#  Terra Sales Dashboard - auto build & restart watcher
#
#  Start this ONCE (via start-autorun.bat) and leave the window open. It builds
#  and starts the dashboard, then watches a small trigger file. Whenever the
#  trigger changes it copies the latest source from the shared drive, rebuilds,
#  and restarts the server automatically - so you never have to Ctrl-C and
#  restart by hand again.
#
#  Claude updates "RESTART.trigger" after delivering new code, which is what
#  makes the watcher rebuild. You can also trigger a rebuild yourself by saving
#  any change to that file (or just run this script again).
#
#  If a build fails, the currently running dashboard is left untouched, so the
#  site never goes down because of a bad build.
# ============================================================================

$ErrorActionPreference = 'Continue'
$Src     = $PSScriptRoot
$Dest    = Join-Path $env:LOCALAPPDATA 'terra-sales-dashboard'
$Trigger = Join-Path $Src 'RESTART.trigger'
$BuildLog = Join-Path $Src 'build.log'      # written to the shared drive so it can be inspected remotely
$Status   = Join-Path $Src 'build-status.txt'
$Port    = 8080
$script:proc = $null

function Log($m) {
  $line = ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $m)
  Write-Host $line
  try { Add-Content -Path $BuildLog -Value $line -ErrorAction SilentlyContinue } catch {}
}

function Copy-Source {
  foreach ($d in @("$Dest\server\src", "$Dest\web\src", "$Dest\web\public", "$Dest\web\scripts")) {
    New-Item -ItemType Directory -Force -Path $d | Out-Null
  }
  # /PURGE mirrors deletions; the build counter (web\.buildcounter.json) is NOT
  # under any of these folders, so it is preserved and keeps counting.
  robocopy "$Src\server\src"  "$Dest\server\src"  /E /PURGE /NFL /NDL /NJH /NJS /NP | Out-Null
  robocopy "$Src\web\src"     "$Dest\web\src"     /E /PURGE /NFL /NDL /NJH /NJS /NP | Out-Null
  robocopy "$Src\web\public"  "$Dest\web\public"  /E /NFL /NDL /NJH /NJS /NP | Out-Null
  robocopy "$Src\web\scripts" "$Dest\web\scripts" /E /PURGE /NFL /NDL /NJH /NJS /NP | Out-Null
  Copy-Item "$Src\server\package.json"  "$Dest\server\" -Force
  Copy-Item "$Src\server\tsconfig.json" "$Dest\server\" -Force
  Copy-Item "$Src\web\package.json"     "$Dest\web\" -Force
  Copy-Item "$Src\web\tsconfig.json"    "$Dest\web\" -Force
  Copy-Item "$Src\web\vite.config.ts"   "$Dest\web\" -Force
  Copy-Item "$Src\web\index.html"       "$Dest\web\" -Force
  if (Test-Path "$Src\.env") { Copy-Item "$Src\.env" "$Dest\" -Force }
}

function Run($label, $cmd) {
  Add-Content -Path $BuildLog -Value ("--- {0} ---" -f $label) -ErrorAction SilentlyContinue
  # send stdout+stderr of the native build to the log file only, so vite's stderr
  # warnings don't render as scary red PowerShell errors in this window.
  & cmd /c $cmd *>> "$BuildLog"
  return $LASTEXITCODE
}

function Invoke-Build {
  Push-Location "$Dest\server"
  if ((Run 'server: npm install' 'npm install') -ne 0) { Pop-Location; return $false }
  if ((Run 'server: build'       'npm run build') -ne 0) { Pop-Location; return $false }
  Pop-Location
  Push-Location "$Dest\web"
  if ((Run 'web: npm install' 'npm install') -ne 0) { Pop-Location; return $false }
  if ((Run 'web: build'       'npm run build') -ne 0) { Pop-Location; return $false }
  Pop-Location
  if (Test-Path "$Dest\server\web-dist") { Remove-Item "$Dest\server\web-dist" -Recurse -Force }
  Copy-Item "$Dest\web\dist" "$Dest\server\web-dist" -Recurse
  return $true
}

function Stop-Server {
  if ($script:proc -and -not $script:proc.HasExited) {
    try { Stop-Process -Id $script:proc.Id -Force -ErrorAction SilentlyContinue } catch {}
  }
  # also free the port from any orphaned node process (e.g. after closing the window)
  try {
    Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
      ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
  } catch {}
  $script:proc = $null
}

function Start-Server {
  $startArgs = @{
    FilePath               = 'node'
    ArgumentList           = 'dist/index.js'
    WorkingDirectory       = "$Dest\server"
    PassThru               = $true
    WindowStyle            = 'Hidden'
    RedirectStandardOutput = "$Dest\server.out.log"
    RedirectStandardError  = "$Dest\server.err.log"
  }
  $script:proc = Start-Process @startArgs
  Log ("Dashboard running on http://localhost:{0}  (pid {1})" -f $Port, $script:proc.Id)
}

function Invoke-Rebuild {
  # start a fresh build log each rebuild so it always reflects the latest attempt
  try { Set-Content -Path $BuildLog -Value ("=== Rebuild started {0} ===" -f (Get-Date)) -ErrorAction SilentlyContinue } catch {}
  Copy-Source
  if (Invoke-Build) {
    Stop-Server
    Start-Server
    Log '=== Rebuild done (OK) ==='
    try { Set-Content -Path $Status -Value ("OK  {0}" -f (Get-Date)) -ErrorAction SilentlyContinue } catch {}
  } else {
    Log '*** BUILD FAILED - keeping the current server running. See build.log for the error. ***'
    try { Set-Content -Path $Status -Value ("FAILED  {0}" -f (Get-Date)) -ErrorAction SilentlyContinue } catch {}
  }
}

Write-Host ''
Write-Host '============================================================'
Write-Host '  Terra Sales Dashboard - auto build & restart watcher'
Write-Host '  Leave this window open. Press Ctrl+C to stop everything.'
Write-Host '============================================================'
Write-Host ''

# first build + start
Invoke-Rebuild

# make sure the trigger exists, then remember its timestamp
if (-not (Test-Path $Trigger)) { Set-Content -Path $Trigger -Value 'init' -Force }
$last = (Get-Item $Trigger).LastWriteTimeUtc

Log 'Watching for restart triggers... (you can leave this running all day)'
while ($true) {
  Start-Sleep -Seconds 3
  try {
    $now = (Get-Item $Trigger).LastWriteTimeUtc
    if ($now -ne $last) {
      $last = $now
      Log 'Restart trigger detected'
      Invoke-Rebuild
      Log 'Watching for restart triggers...'
    }
  } catch {}
}
