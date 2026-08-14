<#
.SYNOPSIS
  Trigger the dev server's real "build landed → git pull → restart" deploy step,
  then WAIT until the restart genuinely completed with the new code live —
  proving it, not just that the request was accepted.

.DESCRIPTION
  This is the convenient shell trigger for the server-side deploy pipeline step
  that already exists but had no one-command caller. It does exactly what a
  finished build should do after it has pushed to origin/main:

    1. GET  /api/internal/deploy-status  (Git #805) — record the CURRENT commit
       hash the running server reports, BEFORE triggering anything.
    2. POST /api/admin/deploy/build-complete (Git #911) with the SAME auth every
       other admin-deploy-console call uses (Bearer BUILD_TRACKER_INGEST_TOKEN,
       via requireAdminOrIngestToken). That endpoint does the real
       git pull --ff-only then schedules the server restart so the pulled commit
       is actually loaded into the running process.
    3. Because #911's restart is deliberately DEFERRED + DETACHED (it kills PID 1
       behind a short sleep so the HTTP response can flush first), the connection
       drops — the endpoint does NOT wait for the server to come back. So this
       script POLLS GET /api/internal/deploy-status until the reported commitHash
       CHANGES from the one captured in step 1 — that flip is the real proof the
       new process is up on the new code. Connection failures while the server is
       down are expected and simply retried until the timeout.
    4. Prints a clear final confirmation: old hash, new hash, real elapsed time.

  If schema-changing SQL needs to land as part of the deploy, pass -SchemaSqlFile
  (or -SchemaSql). #911 hard-filters it: every statement must be CREATE/ALTER/
  INSERT or the WHOLE request is rejected and nothing runs. Per this repo's rule,
  Claude never writes to the live DB on its own — only Shane supplies this SQL.

.PARAMETER ApiBaseUrl
  Base URL of the dev api-server, e.g. https://your-app-domain.example.com .
  Defaults to the "apiBaseUrl" field in scripts/build-queue-watcher.config.json
  (the same config BuildConsole itself reads).

.PARAMETER IngestToken
  The BUILD_TRACKER_INGEST_TOKEN value. Defaults to, in order: the "ingestToken"
  field in scripts/build-queue-watcher.config.json, then the
  $env:BUILD_TRACKER_INGEST_TOKEN environment variable.

.PARAMETER SchemaSqlFile
  Optional path to a .sql file of CREATE/ALTER/INSERT statements to apply (in one
  transaction) before the pull+restart. Mutually exclusive with -SchemaSql.

.PARAMETER SchemaSql
  Optional inline CREATE/ALTER/INSERT SQL string. Mutually exclusive with
  -SchemaSqlFile.

.PARAMETER TimeoutSeconds
  How long to wait for the commit hash to flip before giving up. Default 300.

.PARAMETER PollIntervalSeconds
  Seconds between deploy-status polls. Default 3 (matches BuildConsole's own
  #805 DispatcherTimer cadence).

.EXAMPLE
  # After pushing your build to origin/main:
  .\trigger-deploy-and-wait.ps1

.EXAMPLE
  .\trigger-deploy-and-wait.ps1 -SchemaSqlFile ..\..\lib\db\migrations\manual\0042-add-thing.sql

.NOTES
  Endpoints (both under /api): POST /api/admin/deploy/build-complete (#911,
  artifacts/api-server/src/routes/admin-deploy-console.ts) and
  GET /api/internal/deploy-status (#805, artifacts/api-server/src/routes/version.ts).
  Server-side logging is already wired by those routes (admin.deploy /
  testing.deploy-poll channels) — this script adds none.
#>
[CmdletBinding()]
param(
  [string]$ApiBaseUrl,
  [string]$IngestToken,
  [string]$SchemaSqlFile,
  [string]$SchemaSql,
  [int]$TimeoutSeconds = 300,
  [int]$PollIntervalSeconds = 3
)

$ErrorActionPreference = "Stop"

# ── Resolve config (apiBaseUrl / ingestToken) from the same file BuildConsole uses ──
$configPath = Join-Path $PSScriptRoot "..\..\scripts\build-queue-watcher.config.json"
$config = $null
if (Test-Path $configPath) {
  try { $config = Get-Content $configPath -Raw | ConvertFrom-Json } catch { $config = $null }
}

if (-not $ApiBaseUrl) { $ApiBaseUrl = $config.apiBaseUrl }
if (-not $ApiBaseUrl) {
  throw "No -ApiBaseUrl given and none found in $configPath (apiBaseUrl). Pass -ApiBaseUrl https://<dev-server>."
}
$ApiBaseUrl = $ApiBaseUrl.TrimEnd('/')

if (-not $IngestToken) { $IngestToken = $config.ingestToken }
if (-not $IngestToken) { $IngestToken = $env:BUILD_TRACKER_INGEST_TOKEN }
if (-not $IngestToken) {
  throw "No -IngestToken given and none found in $configPath (ingestToken) or `$env:BUILD_TRACKER_INGEST_TOKEN."
}

# ── Optional schema SQL ──
if ($SchemaSqlFile -and $SchemaSql) {
  throw "Pass only one of -SchemaSqlFile or -SchemaSql, not both."
}
if ($SchemaSqlFile) {
  if (-not (Test-Path $SchemaSqlFile)) { throw "Schema SQL file not found: $SchemaSqlFile" }
  $SchemaSql = Get-Content $SchemaSqlFile -Raw
}

$headers = @{ Authorization = "Bearer $IngestToken" }
$statusUrl = "$ApiBaseUrl/api/internal/deploy-status"
$buildCompleteUrl = "$ApiBaseUrl/api/admin/deploy/build-complete"

function Get-DeployCommitHash {
  # Returns the commitHash the running server currently reports, or $null if the
  # server is unreachable (expected while it is restarting).
  try {
    $r = Invoke-RestMethod -Method Get -Uri $statusUrl -TimeoutSec 10
    return $r.commitHash
  } catch {
    return $null
  }
}

# ── Step 1: capture the CURRENT commit hash before triggering anything ──
Write-Host "Reading current deploy-status from $statusUrl ..." -ForegroundColor Cyan
$oldHash = Get-DeployCommitHash
if (-not $oldHash) {
  throw "Could not reach $statusUrl to read the current commit hash — is the dev server up and the ApiBaseUrl correct?"
}
Write-Host "  Current server commit: $oldHash" -ForegroundColor Cyan

# ── Step 2: trigger the real build-complete pipeline (pull + restart) ──
$body = @{}
if ($SchemaSql -and $SchemaSql.Trim()) { $body.schemaSql = $SchemaSql }
$bodyJson = $body | ConvertTo-Json -Depth 5

Write-Host ""
Write-Host "POST $buildCompleteUrl  (git pull --ff-only + restart) ..." -ForegroundColor Cyan
$triggeredAt = Get-Date

try {
  $resp = Invoke-RestMethod -Method Post -Uri $buildCompleteUrl -Headers $headers `
            -ContentType "application/json" -Body $bodyJson -TimeoutSec 120
  # The endpoint flushes this response BEFORE the deferred restart kills the
  # process, so we normally get a real JSON body here.
  if ($resp.ok -eq $false -and -not $resp.restarting) {
    # A real failure (e.g. git pull diverged, or schema SQL rolled back). No
    # restart was scheduled — report and stop rather than poll forever.
    Write-Host ""
    Write-Host "build-complete reported FAILURE — no restart was scheduled:" -ForegroundColor Red
    if ($resp.error) { Write-Host "  $($resp.error)" -ForegroundColor Red }
    if ($resp.steps) { $resp.steps | ForEach-Object { Write-Host ("  [{0}] {1}" -f ($(if ($_.ok) {'ok'} else {'FAIL'})), $_.label) } }
    exit 1
  }
  Write-Host "  Accepted — restart scheduled. $($resp.note)" -ForegroundColor DarkGray
} catch {
  # #911 documents the connection dropping on restart; if the response never came
  # back cleanly that's consistent with the process going down. Note it and poll
  # anyway — the commit-hash flip below is the real source of truth either way.
  Write-Host "  Request did not return cleanly (`"$($_.Exception.Message)`") — consistent with the server restarting. Proceeding to poll." -ForegroundColor DarkYellow
}

# ── Step 3: poll deploy-status until the commit hash flips (or we time out) ──
Write-Host ""
Write-Host "Polling $statusUrl every ${PollIntervalSeconds}s until commit changes from $oldHash (timeout ${TimeoutSeconds}s) ..." -ForegroundColor Cyan

$deadline = $triggeredAt.AddSeconds($TimeoutSeconds)
$newHash = $null
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds $PollIntervalSeconds
  $h = Get-DeployCommitHash
  if (-not $h) {
    Write-Host "  ... server unreachable (restarting)" -ForegroundColor DarkGray
    continue
  }
  if ($h -ne $oldHash) {
    $newHash = $h
    break
  }
  Write-Host "  ... still $h (unchanged)" -ForegroundColor DarkGray
}

$elapsed = (Get-Date) - $triggeredAt
$elapsedStr = "{0:N1}s" -f $elapsed.TotalSeconds

Write-Host ""
if ($newHash) {
  Write-Host "=======================================================" -ForegroundColor Green
  Write-Host " DEPLOY CONFIRMED — the dev server is live on new code." -ForegroundColor Green
  Write-Host "   Old commit : $oldHash" -ForegroundColor Green
  Write-Host "   New commit : $newHash" -ForegroundColor Green
  Write-Host "   Elapsed    : $elapsedStr" -ForegroundColor Green
  Write-Host "=======================================================" -ForegroundColor Green
  exit 0
} else {
  Write-Host "=======================================================" -ForegroundColor Red
  Write-Host " TIMED OUT — commit hash never changed from $oldHash." -ForegroundColor Red
  Write-Host "   Waited     : $elapsedStr (limit ${TimeoutSeconds}s)" -ForegroundColor Red
  Write-Host "   This means EITHER there was nothing new on origin/main to pull," -ForegroundColor Red
  Write-Host "   OR the restart did not complete. The server is NOT confirmed on" -ForegroundColor Red
  Write-Host "   new code — do not assume your push is live before running tests." -ForegroundColor Red
  Write-Host "=======================================================" -ForegroundColor Red
  exit 1
}
