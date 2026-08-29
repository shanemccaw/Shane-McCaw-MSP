<#
.SYNOPSIS
  Invoked by Windows when a mybuilder:// link is opened (registered by
  scripts/setup-extension-host.ps1). Receives the full URI as the first
  positional argument, parses its query string, and launches Claude CLI
  with the decoded prompt.

.PARAMETER Uri
  The full mybuilder://open?q=...&title=...&model=...&effort=...&cwd=...&mode=...
  string, passed verbatim as %1 by the registered registry command.
#>
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$Uri
)

# Git #767 fix - Shane: even after #766's --prefill fix, a prompt with an
# embedded quote still truncated exactly at that quote character ("Steps 24
# (\"Move..." cut off right after "(Move"). #763's $PSNativeCommandArgumentPassing
# = 'Standard' fix never actually took effect - that setting only exists in
# PowerShell 7.3+ (pwsh.exe), but the registered mybuilder:// command
# launches plain `powershell.exe` (Windows PowerShell 5.1), which silently
# ignores it, exactly as #763's own comment warned it might. Rather than bet
# on pwsh.exe being installed, this now does the Win32 argv escaping itself
# (the standard C-runtime quoting algorithm - double backslashes before a
# quote, escape the quote, wrap the whole argument in quotes) and hands
# Start-Process a single pre-escaped command-line string via -ArgumentList,
# bypassing PowerShell's own (version-dependent, unreliable here) automatic
# argument conversion entirely.
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

Add-Type -AssemblyName System.Web

$queryString = ($Uri -split '\?', 2)[1]
if (-not $queryString) {
  Write-Error "No query string found in URI: $Uri"
  exit 1
}
$params = [System.Web.HttpUtility]::ParseQueryString($queryString)

$prompt  = $params["q"]
$title   = $params["title"]
$model   = $params["model"]
$effort  = $params["effort"]
$cwd     = $params["cwd"]
$mode    = $params["mode"]
# Git #1638 — the real bt_build_queue row id BuildConsole inserted (status 'external')
# before launching this, passed through so this run's real stdout/stderr can be
# captured under that id's own log file, and its real exit code written back to that
# exact row when it finishes. Absent entirely for any OLDER/manual mybuilder:// launch
# not opened through BuildConsole's tracked path — everything below is a no-op then,
# so this stays fully backward compatible with an untracked launch.
$queueIdRaw = $params["queueId"]
$queueId = $null
if ($queueIdRaw -and ($queueIdRaw -match '^\d+$')) { $queueId = [int]$queueIdRaw }

if (-not $prompt) {
  Write-Error "No prompt (q=) found in URI: $Uri"
  exit 1
}

$claudeExe = Join-Path $env:USERPROFILE ".local\bin\claude.exe"
if (-not (Test-Path $claudeExe)) {
  Write-Error "claude.exe not found at $claudeExe"
  exit 1
}

# Git #765 fix - Shane: "now the default folder when it launches is
# C:\Windows\System32 instead of the repo." His previous hand-maintained
# runner (the one #764 replaced) had a hardcoded
# `Set-Location "C:\...\Shane-McCaw-MSP"` line that was never part of the
# shared template, so it got dropped along with everything else when the
# runner moved into the repo - and the cwd= URI param is apparently never
# actually populated (no Options-page default configured), so nothing took
# its place. Default to THIS repo's own root (computed from where this
# script lives, so it isn't hardcoded to one machine's path) whenever no
# usable cwd= was passed, instead of falling through to whatever directory
# Windows happened to start cmd.exe in.
$repoRoot = Split-Path $PSScriptRoot -Parent
if ($cwd -and (Test-Path $cwd)) {
  $effectiveCwd = $cwd
} else {
  if ($cwd) { Write-Warning "cwd '$cwd' does not exist - falling back to the repo root instead." }
  $effectiveCwd = $repoRoot
}
Set-Location $effectiveCwd

# Also labels the terminal window itself, in addition to --name below - lets
# Shane tell multiple builder windows apart at a glance.
if ($title) { $Host.UI.RawUI.WindowTitle = $title }

# Git #766 fix - Shane: "I seen the prompt fill the prompt thing... then it
# went away and one was sent." `claude --help` confirms there IS NO
# --prefill flag at all - `prompt` is a plain POSITIONAL argument
# (`claude [options] [prompt]`), and --model/--effort/--name (-n) are all
# real documented flags. Passing the prompt via a nonexistent --prefill flag
# was being mishandled by claude.exe's own arg parser this whole time -
# that's the real root cause, not (only) the PowerShell quoting bug #763
# fixed. Options must come BEFORE the positional prompt.
$claudeArgs = @()
if ($title)  { $claudeArgs += @("--name", $title) }
if ($model)  { $claudeArgs += @("--model", $model) }
if ($effort) { $claudeArgs += @("--effort", $effort) }
# Git #768 - Shane: "is there a switch we can use to set the mode to auto
# mode on so I do not have to confirm everything it does." --permission-mode
# is a real, confirmed-safe claude.exe flag (distinct from the much riskier
# --dangerously-skip-permissions) - defaults to "auto" for anything launched
# through this button, since the whole point of Send to Builder is a
# hands-off launch. A mode= URI param (from a leading --mode flag on the
# prompt itself) still overrides it when Shane wants a stricter mode for one
# specific prompt.
$permissionMode = if ($mode) { $mode } else { "auto" }
$claudeArgs += @("--permission-mode", $permissionMode)
# Git #820 — defense in depth: claude.exe's commander.js-based parser
# treats ANY positional argument starting with "--" as an attempted
# (unrecognized) option, not plain text - a real "unknown option" failure
# happened exactly this way when an upstream bug (content.js's
# extractLeadingFlags, fixed separately) failed to strip a leading flags
# line off a prompt before it ever reached here. A literal "--" is
# commander's standard end-of-options marker: everything after it is
# always positional, never re-parsed as a flag, regardless of what the
# prompt text itself looks like.
$claudeArgs += "--"
$claudeArgs += $prompt

# Overwritten every run - so if the prompt still doesn't land right, this
# shows exactly what PowerShell thought the prompt was (length + preview)
# without digging through claude.exe's own output for it.
"[$(Get-Date -Format o)] prompt length=$($prompt.Length) preview=$($prompt.Substring(0, [Math]::Min(120, $prompt.Length)))" |
  Set-Content -Path (Join-Path $env:TEMP "mybuilder-last-run.log") -Encoding utf8

$escapedArgString = ($claudeArgs | ForEach-Object { ConvertTo-Win32EscapedArgument $_ }) -join ' '
# Passed explicitly rather than relying on Start-Process inheriting the
# Set-Location above - confirmed correct either way on Shane's PS 5.1
# (tested directly), but explicit beats implicit for something this easy to
# get wrong on a different machine/PowerShell version.
if ($queueId) {
  # Git #1638 — a BuildConsole-tracked launch (a real bt_build_queue row, status
  # 'external', already inserted before this script ran): redirect stdout/stderr into
  # the exact same %TEMP%\bt-build-queue-logs\queue-{id}.log convention
  # BuildLogPaths.cs/build-queue-watcher.ps1 already use, so the app can tail this run
  # the same way it tails a normal queued build. This replaces the visible-console
  # output an untracked launch (no queueId) still gets below - the real content lands
  # in the log file instead, per the locked decision on issue #1638.
  $buildLogDir = Join-Path $env:TEMP "bt-build-queue-logs"
  if (-not (Test-Path $buildLogDir)) { New-Item -ItemType Directory -Path $buildLogDir | Out-Null }
  $logPath = Join-Path $buildLogDir "queue-$queueId.log"
  $errPath = "$logPath.err"
  # Truncate any stale log from a previous item that reused this id (ids aren't
  # reused in practice, but cheap insurance - mirrors build-queue-watcher.ps1).
  Set-Content -Path $logPath -Value "" -NoNewline

  $proc = Start-Process -FilePath $claudeExe -ArgumentList $escapedArgString -WorkingDirectory $effectiveCwd `
    -NoNewWindow -PassThru -Wait -RedirectStandardOutput $logPath -RedirectStandardError $errPath
  $exitCode = $proc.ExitCode

  # Fold stderr into the same log the app tails (build-queue-watcher.ps1's own
  # convention), so a failure's error text shows up in one place, not a second file
  # no one's looking at.
  if ((Test-Path $errPath) -and (Get-Item $errPath).Length -gt 0) {
    Add-Content -Path $logPath -Value "`n--- stderr ---`n"
    Add-Content -Path $logPath -Value (Get-Content $errPath -Raw)
  }
  if (Test-Path $errPath) { Remove-Item $errPath -Force -ErrorAction SilentlyContinue }

  # Git #1638 — write the real completion back directly via psql: this script runs
  # standalone outside the C# app, so it can't call
  # BuildQueuePostgresClient.MarkCompleteAsync itself - same "connect directly, report
  # the real result" manual-SQL convention the rest of this repo uses for local
  # Postgres (see CLAUDE.md's Database section). Best-effort/non-fatal: a missing
  # psql.exe or DATABASE_URL leaves the row visibly stuck showing "external" (findable
  # via the Build Queue panel's External filter) rather than failing this launch.
  try {
    $databaseUrl = $null
    $envLocalPath = Join-Path $repoRoot ".env.local"
    if (Test-Path $envLocalPath) {
      foreach ($line in Get-Content $envLocalPath) {
        $t = $line.Trim()
        if ($t.StartsWith('#') -or -not $t.StartsWith('DATABASE_URL=')) { continue }
        $databaseUrl = $t.Substring('DATABASE_URL='.Length).Trim().Trim('"').Trim("'")
        break
      }
    }
    $psqlCmd = Get-Command psql -ErrorAction SilentlyContinue
    if ($databaseUrl -and $psqlCmd) {
      $newStatus = if ($exitCode -eq 0) { 'done' } else { 'failed' }
      $sql = "UPDATE bt_build_queue SET status = '$newStatus', exit_code = $exitCode, completed_at = NOW(), updated_at = NOW() WHERE id = $queueId;"
      & $psqlCmd.Source $databaseUrl -v "ON_ERROR_STOP=1" -q -c $sql | Out-Null
    } else {
      Write-Warning "Couldn't write queue #$queueId completion back - psql.exe or DATABASE_URL not found. Row will stay showing 'external'."
    }
  } catch {
    Write-Warning "Couldn't write queue #$queueId completion back: $_"
  }
} else {
  Start-Process -FilePath $claudeExe -ArgumentList $escapedArgString -WorkingDirectory $effectiveCwd -NoNewWindow -Wait
}
