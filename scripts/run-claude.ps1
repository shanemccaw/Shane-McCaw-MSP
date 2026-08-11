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

# Overwritten every run - so if the prompt still doesn't land right after
# the Git #763 quoting fix, this shows exactly what PowerShell thought the
# prompt was (length + preview) without digging through claude.exe's own
# output for it.
"[$(Get-Date -Format o)] prompt length=$($prompt.Length) preview=$($prompt.Substring(0, [Math]::Min(120, $prompt.Length)))" |
  Set-Content -Path (Join-Path $env:TEMP "mybuilder-last-run.log") -Encoding utf8

& $claudeExe @claudeArgs
