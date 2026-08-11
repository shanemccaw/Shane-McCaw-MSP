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
        $claudeArgs = @()
        if ($item.title)  { $claudeArgs += @("--name", $item.title) }
        if ($item.model)  { $claudeArgs += @("--model", $item.model) }
        if ($item.effort) { $claudeArgs += @("--effort", $item.effort) }
        $claudeArgs += @("--permission-mode", "auto")
        $claudeArgs += $item.prompt
        $escapedArgString = ($claudeArgs | ForEach-Object { ConvertTo-Win32EscapedArgument $_ }) -join ' '

        $effectiveCwd = if ($item.cwd -and (Test-Path $item.cwd)) { $item.cwd } else { $repoRoot }

        # Each queued build gets its OWN visible window (unlike run-claude.ps1's
        # -NoNewWindow) - with up to $MaxConcurrent running at once, sharing
        # this watcher's own console would make them unreadable and
        # impossible to tell apart.
        $proc = Start-Process -FilePath $claudeExe -ArgumentList $escapedArgString `
          -WorkingDirectory $effectiveCwd -PassThru
        $running[$item.id] = @{ Process = $proc; Title = $item.title }
        Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Started: $($item.title)" -ForegroundColor Cyan
      }
    } catch {
      Write-Warning "Couldn't poll/claim next queue item(s): $_"
    }
  }

  Write-Host "[$(Get-Date -Format 'HH:mm:ss')] $($running.Count)/$MaxConcurrent running" -ForegroundColor DarkGray
  Start-Sleep -Seconds $PollSeconds
}
