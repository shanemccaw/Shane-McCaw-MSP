<#
.SYNOPSIS
  One-time Windows setup so the Build Tracker browser extension's "Send to
  Builder" button (on a claude.ai copy block) can hand a build prompt off
  to a local Claude Code session via a custom mybuilder:// URL.

.DESCRIPTION
  Registers the mybuilder:// protocol under HKCU (current user only - no
  admin elevation required) so the OS hands mybuilder:// links to
  scripts/run-claude.ps1, sitting right next to this script in the repo.

  Git #764 (Shane): the runner used to be copied out to a standalone
  C:\Source\run-claude.ps1 the very first time this ran, and never touched
  again after that - so every later fix to it (Git #762's title support,
  #763's prompt-quoting fix) silently never reached Shane's actual running
  copy, because this script only ever created that file if it was missing.
  The registry command now points directly at the repo's own
  scripts/run-claude.ps1 (resolved via $PSScriptRoot, so it works
  regardless of where the repo is cloned) - a normal `git pull` is now
  enough to pick up any future fix to the runner, same as everything else
  in this repo.

  Safe to re-run: the registry key is overwritten idempotently.

.NOTES
  claude.exe's actual CLI flags for --model/--effort are a best guess
  (--prefill is the one flag Shane specified directly) - check
  `claude --help` and adjust run-claude.ps1 if these aren't right.
#>

$ErrorActionPreference = "Stop"

$runnerPath = Join-Path $PSScriptRoot "run-claude.ps1"
if (-not (Test-Path $runnerPath)) {
  Write-Error "scripts/run-claude.ps1 not found next to this script at $runnerPath - pull the latest repo state first."
  exit 1
}

# ── Register the mybuilder:// protocol (HKCU — no admin elevation needed) ──

$protocolKey = "HKCU:\Software\Classes\mybuilder"
$commandKey  = "$protocolKey\shell\open\command"
$command     = "cmd.exe /k powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$runnerPath`" `"%1`""

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
Write-Host "The runner is now scripts/run-claude.ps1 in this repo - a git pull keeps it current, no re-run of this script needed for future runner fixes."
Write-Host ""
Write-Host "Test it with:  Start-Process 'mybuilder://open?q=hello%20world'"
