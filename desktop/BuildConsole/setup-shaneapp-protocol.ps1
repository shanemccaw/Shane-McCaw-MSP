<#
.SYNOPSIS
  One-time Windows setup so a local agent can trigger SQL execution inside the
  already-running BuildConsole via a custom shaneapp://executeSql URL.

.DESCRIPTION
  Registers the shaneapp:// protocol under HKCU (current user only — no admin
  elevation) so the OS hands shaneapp:// links straight to BuildConsole.exe.

  Deliberately DIFFERENT from scripts/setup-extension-host.ps1 (the mybuilder://
  registration):
    • mybuilder:// launches a fresh Claude Code session via a PowerShell runner —
      so it points at a repo script (`git pull` keeps the runner current).
    • shaneapp:// must reach the ALREADY-RUNNING BuildConsole (SQL runs on that
      app's own DIRECT LOCAL Postgres connection — Services/LocalSqlExecutor — with
      zero round-trip to the deployed api-server). The handler IS the app, so the
      registry command points at the deployed BuildConsole.exe itself. A WPF app
      has no console, so there is NO `cmd.exe /k` wrapper — a protocol launch
      never flashes a window: a running instance forwards the URI over a named
      pipe and exits (see Services/ShaneAppProtocol.cs + App.OnStartup).

  Because the command points at the deployed binary (not a repo script), re-run
  this ONLY if the deploy path changes — a normal `git pull` + redeploy keeps the
  same path, so it doesn't need re-running for code fixes.

  Safe to re-run: the registry key is overwritten idempotently.

  PREREQUISITE — the local DB connection string:
    executeSql runs SQL through BuildConsole's OWN Postgres connection, so it needs
    a connection string. Set ONE of these to the same value the dev api-server uses:
      • a "databaseUrl" field in scripts/build-queue-watcher.config.json, or
      • the DATABASE_URL environment variable.
    A postgres://user:pass@host/db?sslmode=require URI is accepted as-is. Until one
    is set, executeSql returns an ok:false result explaining exactly that (it never
    silently no-ops). This registration step itself does NOT need the DB string.

.PARAMETER ExePath
  Full path to the BuildConsole.exe the protocol should launch. Defaults to the
  ShanesBuild deploy location beside this script (bin\ShanesBuild\BuildConsole.exe).

.NOTES
  The confirmation prompt ("Allow this app to open this link?") is imposed by a
  BROWSER when a web page triggers a custom protocol — NOT by Windows for a
  ShellExecute/Start-Process launch. An agent invoking shaneapp:// via
  `Start-Process 'shaneapp://executeSql?ref=...'` therefore gets NO per-invocation
  prompt at all (same as BuildConsole already firing mybuilder:// via
  Process.Start(UseShellExecute=true) with no prompt). In a browser, the prompt is
  one-time per origin once "Always allow" is checked. See AGENT_PROTOCOLS.md.
#>
param(
  [string]$ExePath
)

$ErrorActionPreference = "Stop"

if (-not $ExePath -or $ExePath -eq "") {
  $ExePath = Join-Path $PSScriptRoot "bin\ShanesBuild\BuildConsole.exe"
}

if (-not (Test-Path $ExePath)) {
  Write-Warning "BuildConsole.exe not found at $ExePath — registering anyway; deploy (deploy-shanesbuild.cmd) before using the protocol, or re-run with -ExePath pointing at your real exe."
}

# ── Register the shaneapp:// protocol (HKCU — no admin elevation needed) ──

$protocolKey = "HKCU:\Software\Classes\shaneapp"
$commandKey  = "$protocolKey\shell\open\command"
# Git #1889 — every shaneapp:// launch is by definition a build/agent-context trigger
# (report-progress.mjs's pipe-fallback, and every executeSql/runTest/executeScan/
# executeCmdlet/reportProgress invocation in AGENT_PROTOCOLS.md), never Shane opening
# the app himself — his own always-open instance is a plain no-arg launch that never
# goes through this registry command. A literal trailing --dev makes App.OnStartup
# treat any cold start this command produces as a passive, non-interrupting instance
# (see App.xaml.cs / Services/AppMode.cs) instead of a full autonomous, focus-stealing
# one, without requiring every individual caller to remember to pass it.
$command     = "`"$ExePath`" `"%1`" --dev"

New-Item -Path $protocolKey -Force | Out-Null
Set-ItemProperty -Path $protocolKey -Name "(Default)" -Value "URL:ShaneApp Protocol"
New-ItemProperty -Path $protocolKey -Name "URL Protocol" -Value "" -PropertyType String -Force | Out-Null

New-Item -Path $commandKey -Force | Out-Null
Set-ItemProperty -Path $commandKey -Name "(Default)" -Value $command

Write-Host ""
Write-Host "shaneapp:// protocol registered successfully." -ForegroundColor Green
Write-Host "  Registry key: $commandKey"
Write-Host "  Command:      $command"
Write-Host ""
Write-Host "Test it (BuildConsole should already be running):"
Write-Host '  $sql = "SELECT 1 AS ok;"'
Write-Host '  $ref = Join-Path $env:TEMP ("shaneapp-sql-" + [guid]::NewGuid() + ".sql")'
Write-Host '  Set-Content -Path $ref -Value $sql -Encoding utf8'
Write-Host '  Start-Process ("shaneapp://executeSql?src=manual-test&ref=" + [uri]::EscapeDataString($ref))'
Write-Host '  # then read "$ref.result.json" for the outcome, and watch the'
Write-Host '  # "sql-runner.protocol" channel in BuildConsole''s Activity log.'
Write-Host ""
