<#
.SYNOPSIS
  One-time Windows setup so the Build Tracker browser extension's "Send to
  Builder" button (on a claude.ai copy block) can hand a build prompt off
  to a local Claude Code session via a custom mybuilder:// URL.

.DESCRIPTION
  1. Creates C:\Source\run-claude.ps1 if it does not already exist - the
     script Windows invokes whenever a mybuilder:// link is opened, which
     parses the URL's query string and launches claude.exe with the
     decoded prompt.
  2. Registers the mybuilder:// protocol under HKCU (current user only -
     no admin elevation required) so the OS knows to hand mybuilder://
     links to that script.

  Safe to re-run: the registry keys are overwritten idempotently, and
  C:\Source\run-claude.ps1 is only created if it's missing, so hand edits
  you've made to it after the fact aren't clobbered by re-running this.

.NOTES
  claude.exe's actual CLI flags for --model/--effort are a best guess
  (--prefill is the one flag Shane specified directly) - check
  `claude --help` and adjust run-claude.ps1 if these aren't right.
#>

$ErrorActionPreference = "Stop"

$runnerPath = "C:\Source\run-claude.ps1"

if (-not (Test-Path $runnerPath)) {
  $runnerContent = @'
<#
.SYNOPSIS
  Invoked by Windows when a mybuilder:// link is opened (registered by
  scripts/setup-extension-host.ps1). Receives the full URI as the first
  positional argument, parses its query string, and launches Claude CLI
  with the decoded prompt.

.PARAMETER Uri
  The full mybuilder://open?q=...&title=...&model=...&effort=...&cwd=...
  string, passed verbatim as %1 by the registered registry command.
#>
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$Uri
)

Add-Type -AssemblyName System.Web

$queryString = ($Uri -split '\?', 2)[1]
if (-not $queryString) {
  Write-Error "No query string found in URI: $Uri"
  exit 1
}
$params = [System.Web.HttpUtility]::ParseQueryString($queryString)

$prompt = $params["q"]
$title  = $params["title"]
$model  = $params["model"]
$effort = $params["effort"]
$cwd    = $params["cwd"]

if (-not $prompt) {
  Write-Error "No prompt (q=) found in URI: $Uri"
  exit 1
}

$claudeExe = Join-Path $env:USERPROFILE ".local\bin\claude.exe"
if (-not (Test-Path $claudeExe)) {
  Write-Error "claude.exe not found at $claudeExe"
  exit 1
}

if ($cwd -and (Test-Path $cwd)) {
  Set-Location $cwd
} elseif ($cwd) {
  Write-Warning "cwd '$cwd' does not exist - launching from the current directory instead."
}

# No confirmed claude.exe flag carries a session title, so this just labels
# the window itself (e.g. "656") - lets Shane tell multiple builder windows
# apart at a glance rather than guessing from generic terminal titles.
if ($title) { $Host.UI.RawUI.WindowTitle = $title }

# --model/--effort flag names are unconfirmed - adjust if `claude --help`
# shows something different.
$claudeArgs = @("--prefill", $prompt)
if ($model)  { $claudeArgs += @("--model", $model) }
if ($effort) { $claudeArgs += @("--effort", $effort) }

& $claudeExe @claudeArgs
'@
  Set-Content -Path $runnerPath -Value $runnerContent -Encoding utf8
  Write-Host "Created $runnerPath" -ForegroundColor Green
} else {
  Write-Host "$runnerPath already exists - leaving it as-is." -ForegroundColor Yellow
}

# ── Register the mybuilder:// protocol (HKCU — no admin elevation needed) ──

$protocolKey = "HKCU:\Software\Classes\mybuilder"
$commandKey  = "$protocolKey\shell\open\command"
$command     = 'cmd.exe /k powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\Source\run-claude.ps1 "%1"'

New-Item -Path $protocolKey -Force | Out-Null
Set-ItemProperty -Path $protocolKey -Name "(Default)" -Value "URL:MyBuilder Protocol"
New-ItemProperty -Path $protocolKey -Name "URL Protocol" -Value "" -PropertyType String -Force | Out-Null

New-Item -Path $commandKey -Force | Out-Null
Set-ItemProperty -Path $commandKey -Name "(Default)" -Value $command

Write-Host ""
Write-Host "mybuilder:// protocol registered successfully." -ForegroundColor Green
Write-Host "  Registry key: $commandKey"
Write-Host "  Command:      $command"
Write-Host ""
Write-Host "Test it with:  Start-Process 'mybuilder://open?q=hello%20world'"
