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
       down are expected and simply retried.
    4. Prints a clear final confirmation: old hash, new hash, real elapsed time.

  WAITING IS PROGRESS-AWARE, NOT A FLAT TIMEOUT. `kill 1` reboots the whole Repl
  container, which re-runs the Run button — git pull, install, and a FULL rebuild
  before the server listens again. A large change (e.g. an app-wide retheme) makes
  that take many minutes: a flat 300s cap used to print "TIMED OUT" over a deploy
  that had genuinely succeeded, which is worse than no check at all. So the wait
  is driven by the server's OBSERVED state, not just the clock:

    • Server unreachable  → the restart/rebuild is in progress. Keep waiting (up to
      the -TimeoutSeconds hard ceiling, which is now generous by design) and print
      a heartbeat with real elapsed time so a long rebuild never looks hung.
    • Server reachable, commit FLIPPED → done, the new process is live. Success.
    • Server reachable and still on the OLD commit for -StallSeconds straight →
      stop EARLY and say so precisely. If it never went down, the restart never
      took effect; if it went down and came back on the same commit, it restarted
      but there was nothing new to pull. Both are real answers, reached in minutes
      rather than by burning the whole ceiling.

  So a genuinely failed deploy is reported FASTER than before, while a genuinely
  slow one is allowed to finish instead of being called a failure.

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
  HARD CEILING on the whole wait, measured from the moment build-complete is
  triggered. Default 1800 (30 min) — deliberately generous, because `kill 1`
  reboots the container and a full reinstall+rebuild of a large change routinely
  runs past ten minutes, and the old 300s default reported those real successes
  as "TIMED OUT". This is a backstop, not the normal way the wait ends: a deploy
  that genuinely isn't happening is caught by -StallSeconds long before this.

.PARAMETER StallSeconds
  How long the server may stay REACHABLE on the OLD commit before we stop and
  report it isn't deploying. Default 180. This — not -TimeoutSeconds — is what
  ends a failed run: it means the server is up and answering, so it is NOT
  mid-restart, and it is still running the old code. Any unreachable poll resets
  this window, so a rebuild that bounces the server never trips it.

.PARAMETER PollIntervalSeconds
  Seconds between deploy-status polls. Default 3 (matches BuildConsole's own
  #805 DispatcherTimer cadence).

.PARAMETER HeartbeatSeconds
  Minimum gap between "still waiting" progress lines during a long rebuild, so a
  3s poll doesn't emit hundreds of identical lines. Default 15. Real state
  changes (server going down, coming back, hash flipping) always print
  immediately regardless of this.

.EXAMPLE
  # After pushing your build to origin/main:
  .\trigger-deploy-and-wait.ps1

.EXAMPLE
  .\trigger-deploy-and-wait.ps1 -SchemaSqlFile ..\..\lib\db\migrations\manual\0042-add-thing.sql

.EXAMPLE
  # An unusually heavy deploy (dependency changes on top of a large rebuild):
  # raise the ceiling only. The stall window stays small, so a deploy that never
  # starts is still reported in ~3 minutes rather than after the full hour.
  .\trigger-deploy-and-wait.ps1 -TimeoutSeconds 3600

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
  [int]$TimeoutSeconds = 1800,
  [int]$StallSeconds = 180,
  [int]$PollIntervalSeconds = 3,
  [int]$HeartbeatSeconds = 15
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

function Get-TargetHashFromPullOutput {
  # Best-effort: read the commit the server's own `git pull` step says it moved
  # TO, so the final report can state whether the live hash is the expected one.
  # #911's git-pull step is `git pull --ff-only || (git fetch && git reset --hard
  # origin/main)`, so either shape can appear:
  #   "Updating 4766df9..63dfaf4"      (fast-forward)
  #   "HEAD is now at 63dfaf4 subject" (hard-reset fallback)
  # A NULL result is normal and NOT an error — notably "Already up to date." is
  # printed whenever the checkout was ALREADY advanced by the SSH pull pre-step
  # (see PostBuildDeployPipeline's hybrid), while the running process is still on
  # the old code and the restart genuinely will flip the hash. So this is only
  # ever used for reporting; the poll never gates on it.
  param([string]$PullOutput)
  if (-not $PullOutput) { return $null }
  $m = [regex]::Match($PullOutput, '(?m)^Updating\s+[0-9a-f]+\.\.([0-9a-f]{7,40})')
  if ($m.Success) { return $m.Groups[1].Value }
  $m = [regex]::Match($PullOutput, '(?m)^HEAD is now at\s+([0-9a-f]{7,40})')
  if ($m.Success) { return $m.Groups[1].Value }
  return $null
}

function Test-HashesMatch {
  # deploy-status reports `git rev-parse --short HEAD`, whose abbreviation length
  # is adaptive, and pull output abbreviates independently — so compare on the
  # shorter of the two rather than demanding equal length.
  param([string]$A, [string]$B)
  if (-not $A -or -not $B) { return $false }
  $n = [Math]::Min($A.Length, $B.Length)
  return $A.Substring(0, $n).Equals($B.Substring(0, $n), [StringComparison]::OrdinalIgnoreCase)
}

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
if ($oldHash -eq "unknown") {
  # version.ts reports "unknown" when it can resolve neither git nor a
  # deployed_version_stamp row. It would then keep reporting "unknown" after the
  # restart too, so a hash FLIP can never happen and this script cannot prove a
  # deploy either way — say that now rather than let it look like a failed one.
  Write-Host "  WARNING: the server reports commit 'unknown', so it cannot resolve its own commit." -ForegroundColor Yellow
  Write-Host "  A hash flip can never be observed in that state — this run will not be able to" -ForegroundColor Yellow
  Write-Host "  confirm the deploy no matter how long it waits. Fix deploy-status first." -ForegroundColor Yellow
}

# ── Step 2: trigger the real build-complete pipeline (pull + restart) ──
$body = @{}
if ($SchemaSql -and $SchemaSql.Trim()) { $body.schemaSql = $SchemaSql }
$bodyJson = $body | ConvertTo-Json -Depth 5

Write-Host ""
Write-Host "POST $buildCompleteUrl  (git pull --ff-only + restart) ..." -ForegroundColor Cyan
$triggeredAt = Get-Date

$expectedHash = $null

try {
  # 240s, not 120s: #911 can spend up to 120s on the schema-SQL transaction plus
  # 60s on the git pull before it ever replies, so a 120s client timeout could
  # abandon a request that was still legitimately working.
  $resp = Invoke-RestMethod -Method Post -Uri $buildCompleteUrl -Headers $headers `
            -ContentType "application/json" -Body $bodyJson -TimeoutSec 240
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

  # Report-only: what commit did the server's own pull land the CHECKOUT on?
  $pullStep = $resp.steps | Where-Object { $_.label -like "git pull*" } | Select-Object -First 1
  $expectedHash = Get-TargetHashFromPullOutput -PullOutput $pullStep.output
  if ($expectedHash) {
    Write-Host "  Server checkout pulled to: $expectedHash — that is the hash the restart should bring up." -ForegroundColor DarkGray
  } elseif ($pullStep.output -match "Already up to date") {
    Write-Host "  git pull reported 'Already up to date' — the CHECKOUT had nothing new (often because an SSH pull already advanced it). The running process can still be on older code, so the poll below is what decides." -ForegroundColor DarkGray
  }
} catch {
  # #911 documents the connection dropping on restart; if the response never came
  # back cleanly that's consistent with the process going down. Note it and poll
  # anyway — the commit-hash flip below is the real source of truth either way.
  Write-Host "  Request did not return cleanly (`"$($_.Exception.Message)`") — consistent with the server restarting. Proceeding to poll." -ForegroundColor DarkYellow
}

# ── Step 3: wait on the server's OBSERVED state until the commit hash flips ──
# The wait ends on evidence, not on the clock. See the progress-aware section of
# the header comment: unreachable means "still coming back" and is waited out;
# reachable-and-unchanged means "not deploying" and stops early. -TimeoutSeconds
# is only the backstop for the case where neither ever resolves.
Write-Host ""
Write-Host "Polling $statusUrl every ${PollIntervalSeconds}s until the live commit changes from $oldHash." -ForegroundColor Cyan
Write-Host "  Unreachable        = still restarting/rebuilding; waited out (hard ceiling ${TimeoutSeconds}s)." -ForegroundColor DarkGray
Write-Host "  Up but unchanged   = not deploying; stops early after ${StallSeconds}s straight." -ForegroundColor DarkGray

$deadline = $triggeredAt.AddSeconds($TimeoutSeconds)
$newHash = $null
$outcome = "ceiling"           # ceiling | flipped | stalled
$sawUnreachable = $false       # did the server ever actually go down?
$oldHashRunStartedAt = $null   # start of the current UNBROKEN reachable-on-old-hash run
$lastHeartbeatAt = $triggeredAt
$lastState = ""                # "up" / "down", so real transitions always print

while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds $PollIntervalSeconds
  $now = Get-Date
  $sinceTrigger = "{0:N0}s" -f ($now - $triggeredAt).TotalSeconds
  $h = Get-DeployCommitHash

  if (-not $h) {
    # Down — or answering with something that isn't deploy-status JSON, which a
    # proxy's "app is booting" page reads as. Either way it is not up yet.
    $sawUnreachable = $true
    $oldHashRunStartedAt = $null   # any downtime resets the stall window
    if ($lastState -ne "down") {
      Write-Host "  ... server went unreachable at $sinceTrigger — restart/rebuild in progress." -ForegroundColor DarkGray
      $lastState = "down"
      $lastHeartbeatAt = $now
    } elseif (($now - $lastHeartbeatAt).TotalSeconds -ge $HeartbeatSeconds) {
      Write-Host "  ... still down at $sinceTrigger — 'kill 1' reboots the container and re-runs install+build; a large change legitimately takes many minutes." -ForegroundColor DarkGray
      $lastHeartbeatAt = $now
    }
    continue
  }

  if (-not (Test-HashesMatch $h $oldHash)) {
    $newHash = $h
    $outcome = "flipped"
    break
  }

  # Reachable, still on the OLD commit.
  if ($lastState -ne "up") {
    if ($sawUnreachable) {
      Write-Host "  ... server is answering again at $sinceTrigger, still reporting $h." -ForegroundColor DarkGray
    } else {
      Write-Host "  ... server still up at $sinceTrigger reporting $h (the restart kills PID 1 a couple of seconds after the response)." -ForegroundColor DarkGray
    }
    $lastState = "up"
    $lastHeartbeatAt = $now
  }
  if (-not $oldHashRunStartedAt) { $oldHashRunStartedAt = $now }
  $stalledFor = ($now - $oldHashRunStartedAt).TotalSeconds
  if ($stalledFor -ge $StallSeconds) {
    $outcome = "stalled"
    break
  }
  if (($now - $lastHeartbeatAt).TotalSeconds -ge $HeartbeatSeconds) {
    Write-Host ("  ... still {0} (unchanged) — up and answering for {1:N0}s of the {2}s stall limit." -f $h, $stalledFor, $StallSeconds) -ForegroundColor DarkGray
    $lastHeartbeatAt = $now
  }
}

$elapsed = (Get-Date) - $triggeredAt
$elapsedStr = "{0:N1}s" -f $elapsed.TotalSeconds

Write-Host ""
if ($outcome -eq "flipped") {
  Write-Host "=======================================================" -ForegroundColor Green
  Write-Host " DEPLOY CONFIRMED — the dev server is live on new code." -ForegroundColor Green
  Write-Host "   Old commit : $oldHash" -ForegroundColor Green
  Write-Host "   New commit : $newHash" -ForegroundColor Green
  Write-Host "   Elapsed    : $elapsedStr" -ForegroundColor Green
  Write-Host "=======================================================" -ForegroundColor Green
  if ($expectedHash -and -not (Test-HashesMatch $newHash $expectedHash)) {
    Write-Host ""
    Write-Host "NOTE: the live commit ($newHash) is not the one this deploy's own pull" -ForegroundColor Yellow
    Write-Host "landed the checkout on ($expectedHash) — the server IS on new code, but" -ForegroundColor Yellow
    Write-Host "another push probably landed in between. Confirm it contains your commit." -ForegroundColor Yellow
  }
  exit 0
}

Write-Host "=======================================================" -ForegroundColor Red
if ($outcome -eq "stalled") {
  if ($sawUnreachable) {
    Write-Host " RESTARTED ON THE OLD COMMIT — nothing new was deployed." -ForegroundColor Red
    Write-Host "   The server went down and came back still reporting $oldHash," -ForegroundColor Red
    Write-Host "   so the restart itself worked — there was simply no new commit on" -ForegroundColor Red
    Write-Host "   origin/main for it to pull. Check your push actually landed." -ForegroundColor Red
  } else {
    Write-Host " RESTART NEVER TOOK EFFECT — the server never went down." -ForegroundColor Red
    Write-Host "   It stayed up and answering on $oldHash for the whole ${StallSeconds}s" -ForegroundColor Red
    Write-Host "   stall window, so the deferred 'kill 1' did not restart the process" -ForegroundColor Red
    Write-Host "   (or something brought the old process straight back)." -ForegroundColor Red
  }
  Write-Host "   Waited     : $elapsedStr (stopped early on evidence, not the ${TimeoutSeconds}s ceiling)" -ForegroundColor Red
} else {
  Write-Host " HARD CEILING HIT — never saw the commit hash flip from $oldHash." -ForegroundColor Red
  Write-Host "   Waited     : $elapsedStr (ceiling ${TimeoutSeconds}s)" -ForegroundColor Red
  Write-Host "   The server never came back up long enough to confirm a new commit." -ForegroundColor Red
  Write-Host "   If a rebuild is genuinely still running, re-run with a larger" -ForegroundColor Red
  Write-Host "   -TimeoutSeconds — this ceiling is a backstop, not a verdict." -ForegroundColor Red
}
Write-Host "   The server is NOT confirmed on new code — do not assume your push is" -ForegroundColor Red
Write-Host "   live before running tests against it." -ForegroundColor Red
Write-Host "=======================================================" -ForegroundColor Red
exit 1
