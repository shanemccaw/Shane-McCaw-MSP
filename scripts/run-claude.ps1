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

# Git #763 fix - Shane: a real prompt (full of embedded double quotes, e.g.
# quoted step names like "Move one real recurring workflow...") came through
# as just the single word "one". PowerShell's LEGACY native-command argument
# passing is a well-known source of exactly this failure mode - it mangles
# long strings containing embedded quotes when handing them to a native exe
# like claude.exe, while quote-free tokens (model/effort/title/cwd) are
# unaffected, matching what Shane saw. 'Standard' mode implements correct
# Win32 argv escaping instead. No-op (silently ignored) on PowerShell < 7.3.
$PSNativeCommandArgumentPassing = 'Standard'

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
  Set-Location $cwd
} else {
  if ($cwd) { Write-Warning "cwd '$cwd' does not exist - falling back to the repo root instead." }
  Set-Location $repoRoot
}

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
$claudeArgs += $prompt

# Overwritten every run - so if the prompt still doesn't land right, this
# shows exactly what PowerShell thought the prompt was (length + preview)
# without digging through claude.exe's own output for it.
"[$(Get-Date -Format o)] prompt length=$($prompt.Length) preview=$($prompt.Substring(0, [Math]::Min(120, $prompt.Length)))" |
  Set-Content -Path (Join-Path $env:TEMP "mybuilder-last-run.log") -Encoding utf8

& $claudeExe @claudeArgs
