<#
.SYNOPSIS
  Git #790 — Shane: "if we could really build me a true queued up build...
  that would speed up my development time like mad." A persistent local
  watcher: polls Build Tracker's build queue, and the instant a slot is
  free and an item's real GitHub blocker (if any) has actually cleared,
  launches it as a real Claude Code session — same launch mechanism
  run-claude.ps1 already uses for mybuilder://, just driven by the queue
  instead of a clicked link.

.DESCRIPTION
  Run this in its own terminal window and leave it open — Shane's own
  choice over a scheduled task, for near-instant reaction the moment a
  blocker clears (a scheduled task would only check every few minutes).
  Closing this window stops the watcher; nothing else runs it. Ctrl+C to
  stop cleanly.

  Reads config from build-queue-watcher.config.json next to this script
  (gitignored — copy build-queue-watcher.config.example.json to it and
  fill in your real apiBaseUrl/ingestToken, the same values already in the
  extension's Options page). -MaxConcurrent overrides the config file's
  value for this run only.

.PARAMETER MaxConcurrent
  How many builds this watcher will run at once. Defaults to the config
  file's maxConcurrent, or 8 if that's not set either.

.PARAMETER PollSeconds
  How often to check the queue and running processes. Default 10.
#>
param(
  [int]$MaxConcurrent = 0,
  [int]$PollSeconds = 10
)

$ErrorActionPreference = "Stop"

# Same escaping approach as run-claude.ps1 (Git #767/#790) - duplicated
# rather than dot-sourced from a shared file on purpose, so a change here
# can't accidentally destabilize the already-hard-won-stable mybuilder://
# path, and vice versa.
function ConvertTo-Win32EscapedArgument {
  param([Parameter(Mandatory = $true)][AllowEmptyString()][string]$Value)
  if ($Value -eq '') { return '""' }
  if ($Value -notmatch '[\s"]') { return $Value }
  $sb = [System.Text.StringBuilder]::new()
  [void]$sb.Append('"')
  $backslashes = 0
  foreach ($ch in $Value.ToCharArray()) {
    if ($ch -eq '\') {
      $backslashes++
    } elseif ($ch -eq '"') {
      [void]$sb.Append('\' * (($backslashes * 2) + 1))
      [void]$sb.Append('"')
      $backslashes = 0
    } else {
      if ($backslashes -gt 0) { [void]$sb.Append('\' * $backslashes); $backslashes = 0 }
      [void]$sb.Append($ch)
    }
  }
  if ($backslashes -gt 0) { [void]$sb.Append('\' * ($backslashes * 2)) }
  [void]$sb.Append('"')
  return $sb.ToString()
}

$configPath = Join-Path $PSScriptRoot "build-queue-watcher.config.json"
if (-not (Test-Path $configPath)) {
  Write-Error "Missing $configPath - copy build-queue-watcher.config.example.json to build-queue-watcher.config.json and fill in your real apiBaseUrl/ingestToken first."
  exit 1
}
$config = Get-Content $configPath -Raw | ConvertFrom-Json
$apiBaseUrl = ($config.apiBaseUrl -replace '/$', '')
$ingestToken = $config.ingestToken
if (-not $apiBaseUrl -or -not $ingestToken) {
  Write-Error "$configPath is missing apiBaseUrl or ingestToken."
  exit 1
}
if ($MaxConcurrent -le 0) {
  $MaxConcurrent = if ($config.maxConcurrent) { [int]$config.maxConcurrent } else { 8 }
}

$claudeExe = Join-Path $env:USERPROFILE ".local\bin\claude.exe"
if (-not (Test-Path $claudeExe)) {
  Write-Error "claude.exe not found at $claudeExe"
  exit 1
}
$repoRoot = Split-Path $PSScriptRoot -Parent

# Git #802 - Shane wants queued builds to show up live inside BuildConsole
# (WPF) chat tabs instead of only a separate console window. A separate
# window has no way for anything else to read what's inside it, so each
# build's output is now ALSO teed to a per-item log file the app can poll
# and tail. Path convention is shared with BuildConsole's own
# Services/BuildLogPaths.cs - both sides compute the same path from the
# queue item's id alone, no extra plumbing needed.
$buildLogDir = Join-Path $env:TEMP "bt-build-queue-logs"
if (-not (Test-Path $buildLogDir)) {
  New-Item -ItemType Directory -Path $buildLogDir | Out-Null
}

$headers = @{ Authorization = "Bearer $ingestToken" }

# id -> @{ Process = <System.Diagnostics.Process>; Title = <string> }
$running = @{}

Write-Host "Build queue watcher started - max $MaxConcurrent concurrent, polling every ${PollSeconds}s. Ctrl+C to stop." -ForegroundColor Green
Write-Host "  API: $apiBaseUrl"
Write-Host ""

while ($true) {
  # ── 1. Reap anything that finished since the last poll ──────────────────
  foreach ($id in @($running.Keys)) {
    $entry = $running[$id]
    if ($entry.Process.HasExited) {
      $exitCode = $entry.Process.ExitCode
      Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Finished: $($entry.Title) (exit $exitCode)" -ForegroundColor $(if ($exitCode -eq 0) { "Green" } else { "Red" })
      # Fold stderr into the same log the app tails, so a failure's error
      # text shows up in-tab too instead of only in a second file no one's
      # looking at.
      $errPath = "$($entry.LogPath).err"
      if ((Test-Path $errPath) -and (Get-Item $errPath).Length -gt 0) {
        Add-Content -Path $entry.LogPath -Value "`n--- stderr ---`n"
        Add-Content -Path $entry.LogPath -Value (Get-Content $errPath -Raw)
      }
      if (Test-Path $errPath) { Remove-Item $errPath -Force -ErrorAction SilentlyContinue }
      try {
        Invoke-RestMethod -Method Post -Uri "$apiBaseUrl/api/admin/build-tracker/extension/queue/$id/complete" `
          -Headers $headers -ContentType "application/json" -Body (@{ exitCode = $exitCode } | ConvertTo-Json)
      } catch {
        Write-Warning "Couldn't report completion for queue item $id`: $_"
      }
      $running.Remove($id)
    }
  }

  # ── 2. Claim and launch as many ready items as there are free slots ─────
  $freeSlots = $MaxConcurrent - $running.Count
  if ($freeSlots -gt 0) {
    try {
      $next = Invoke-RestMethod -Method Get -Uri "$apiBaseUrl/api/admin/build-tracker/extension/queue/next?limit=$freeSlots" -Headers $headers
      foreach ($item in $next.items) {
        # Git #800 — Shane: "exit code 0 wont work because right now at
        # least I have to close the window myself... thats just as bad as
        # closing the task." Interactive mode never exits on its own by
        # design (it's a chat session waiting for more input) - --print
        # runs the task to completion and exits for real, with a real exit
        # code, no manual close needed. That's the ACTUAL fix; queued
        # builds were never meant to be interactive in the first place.
        $claudeArgs = @()
        if ($item.title)  { $claudeArgs += @("--name", $item.title) }
        if ($item.model)  { $claudeArgs += @("--model", $item.model) }
        if ($item.effort) { $claudeArgs += @("--effort", $item.effort) }
        $claudeArgs += @("--permission-mode", "auto")
        $claudeArgs += "--print"
        $claudeArgs += $item.prompt
        $escapedArgString = ($claudeArgs | ForEach-Object { ConvertTo-Win32EscapedArgument $_ }) -join ' '

        $effectiveCwd = if ($item.cwd -and (Test-Path $item.cwd)) { $item.cwd } else { $repoRoot }
        $logPath = Join-Path $buildLogDir "queue-$($item.id).log"
        # Truncate any stale log from a previous item that reused this id
        # (ids aren't reused in practice, but cheap insurance).
        Set-Content -Path $logPath -Value "" -NoNewline

        # --print mode (Git #800) just prints text and exits - it doesn't
        # need a real interactive console to render into, so redirecting
        # stdout/stderr straight to a file (like run-claude.ps1's original
        # single-build design) is safe and loses nothing. This REPLACES the
        # old "each build gets its own visible window" behavior: with
        # BuildConsole (Git #802) now able to tail this file live inside the
        # chat tab it belongs to, a separate floating window per build is
        # redundant for anything opened there - and for anything not open in
        # a tab, the log file is still there to open later.
        $proc = Start-Process -FilePath $claudeExe -ArgumentList $escapedArgString `
          -WorkingDirectory $effectiveCwd -NoNewWindow -PassThru `
          -RedirectStandardOutput $logPath -RedirectStandardError "$logPath.err"
        $running[$item.id] = @{ Process = $proc; Title = $item.title; LogPath = $logPath }
        Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Started: $($item.title)" -ForegroundColor Cyan
      }
    } catch {
      Write-Warning "Couldn't poll/claim next queue item(s): $_"
    }
  }

  Write-Host "[$(Get-Date -Format 'HH:mm:ss')] $($running.Count)/$MaxConcurrent running" -ForegroundColor DarkGray
  Start-Sleep -Seconds $PollSeconds
}
