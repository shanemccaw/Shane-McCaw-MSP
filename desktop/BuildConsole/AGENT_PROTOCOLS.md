# Agent → BuildConsole trigger surfaces

How an agent (a local Claude Code session, a script) hands work to the
already‑running BuildConsole. The surfaces below split deliberately along one
line: **a local agent on this machine uses the `shaneapp://` local protocol; a
genuinely remote/CI caller uses plain HTTP.**

| Need | Surface | Why this one |
|------|---------|--------------|
| **Run SQL** | `shaneapp://executeSql` local protocol | SQL runs through the **same pipe the manual SQL Runner uses** (`POST /api/simulator/sql/execute` against the configured dev api‑server) — a local‑machine trigger, but the SQL itself goes over that already‑working HTTP path; a caller that isn't on this machine can't reach the trigger. **No local Postgres connection / connection string needed.** |
| **Run a test manifest — local agent** | `shaneapp://runTest` local protocol | Runs the manifest **in‑process** through the same `RunManifestAsync` pipeline Play Test uses (ALL step types, not just uiSteps) — no HTTP hop, since the agent and BuildConsole are the same machine. |
| **Run a test manifest — remote/CI caller** | Git #898 HTTP (`/api/admin/deploy/test-run`) | For a caller **not** on this machine. Any HTTP‑capable agent calls it directly. Unchanged by `runTest`. |
| **Run a tenant scan + get per‑finding results back** | `shaneapp://runScan` local protocol *(landing under local #59)* | Triggers a real diagnostics run, **settles it to completion**, and hands back the full **per‑finding** envelope — so the agent can diff each engine observation against an independent PowerShell ground‑truth read of the same tenant fact, not merely confirm "the scan ran". The whole point is the **comparison** (see **§5** below). |
| **Run ONE individual check + get its observed values back** | `shaneapp://executeScan` local protocol *(local #60)* | Triggers exactly **one** monitor check by its real `monitor_checks` key — Simulator Studio's "M365 Endpoints" per‑check Run — against a **testbed** tenant, settles that single run, and returns the check's own **observed output** (`extractedProperties`, item/page counts, severity, raw captured items). The granular sibling of `runScan` (which runs the whole aggregate scan); same dual‑verification purpose (**§5**), pointed at one check. See **§7**. |
| **Run ONE allowlisted PowerShell cmdlet + get its raw output back** | `shaneapp://executeCmdlet` local protocol *(#1404)* | Runs exactly **one** allowlisted `ps-execution` cmdlet by its **cmdlet‑catalog key** (e.g. `get-connection-info`, `get-cs-online-user`) against a **testbed** tenant, through the **SAME server code path a real scan uses** (`callPsExecution` → the `ca-ps-execution[-dev]` container — the identical call `runPowerShellCheck()` makes). The agent **never holds the raw ps‑execution bearer secret** (the exact gap that blocked #1400/#1389's manual verify) — it's fetched server‑side, just like `executeSql` for DB creds. See **§9**. |
| **Report explicit build progress** | `shaneapp://reportProgress` local protocol | Explicitly reports a running build's current step, total steps, and phase description (`step=N&total=M&label=...`) directly to BuildConsole's Build Watch slots and Progress Tracker. Replaces brittle free-form text inference. See **§8**. |

---

## 0. Waiting for a `shaneapp://` result — foreground + bounded (read before copying any poll loop below)

Every `shaneapp://` action here (executeSql, runTest, executeScan, runScan,
executeCmdlet) is
**fire‑and‑settle**: `Start-Process` triggers it and returns immediately, then the
agent **waits for a result file** BuildConsole writes when the work settles. How you
wait is the whole ballgame — get it wrong and the session hangs forever even though
the work finished. Two rules, both learned from a real hang (**Git #1326**, evidence
from #1286):

**Rule 1 — always wait in the FOREGROUND with an explicit large tool timeout; never
`run_in_background` + wait for a notification.** A real `runTest` with uiSteps takes
5–7 minutes — past the **default 2‑minute** Bash/PowerShell tool timeout. The trap
is to "fix" that by running the poll with `run_in_background: true` and then sitting
idle waiting for a completion notification. That is exactly what hung in #1326: the
run genuinely finished and wrote its result file, but the session kept repeating
"waiting for the background task notification" — a signal it had **already
received**. The harness's `--- done (…ms) ---` line **is** that completion; it means
*"the result is ready, read it now,"* not *"keep waiting."* Instead, run the trigger
+ wait as a **single foreground call** and pass an explicit large tool `timeout`
(e.g. `600000` ms = the 10‑minute max). The call blocks and returns the parsed
envelope **directly in the tool result** — there is no separate notification to wait
on, and nothing to strand on.

**Rule 2 — the wait must be BOUNDED and always return an envelope.** Never copy a
bare `while (-not (Test-Path $out)) { Start-Sleep … }` — that loop **never returns**
if the file is never written (run refused by the busy latch, BuildConsole crashed,
a stale‑result race, a cold start that never completes). Use a hard deadline that
returns a synthetic `{ ok:false, timedOut:true }` envelope, so a stuck run fails
cleanly instead of hanging. Keep the deadline safely **under** the tool `timeout` so
the script exits and prints its envelope before the tool would kill it (leaving you
with no output at all).

Use this one helper for every wait below — it enforces both rules:

```powershell
# Canonical bounded wait. ALWAYS returns a JSON envelope; NEVER hangs.
# Run the trigger + this call as a SINGLE FOREGROUND PowerShell tool call and pass an
# explicit tool timeout >= (DeadlineSec + a margin), e.g. timeout: 600000.
function Wait-ShaneAppResult {
  param([string]$Path, [int]$DeadlineSec = 540, [int]$PollMs = 400)
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  while (-not (Test-Path $Path)) {
    if ($sw.Elapsed.TotalSeconds -ge $DeadlineSec) {
      return [pscustomobject]@{ ok = $false; timedOut = $true; error =
        "no result file at $Path after ${DeadlineSec}s — the run never wrote one (refused/crashed/still running)" }
    }
    Start-Sleep -Milliseconds $PollMs
  }
  # File exists — read it, tolerating a brief partial‑write race.
  for ($i = 0; $i -lt 10; $i++) {
    try { return (Get-Content $Path -Raw -ErrorAction Stop | ConvertFrom-Json) }
    catch { Start-Sleep -Milliseconds 150 }
  }
  return [pscustomobject]@{ ok = $false; error = "result file at $Path is present but not valid JSON yet" }
}
```

Every recipe below clears any stale result, fires the trigger, then calls
`Wait-ShaneAppResult` — do the same in your own calls rather than re‑inventing the
poll loop.

---

## 1. `shaneapp://executeSql` — local SQL trigger

### Why a protocol and not HTTP (for the trigger)
UI test runs (#898) are exposed over HTTP because anything HTTP‑reachable can ask
for one. The `executeSql` **trigger** is kept **off** HTTP on purpose: every agent
that runs SQL (queue‑managed or Send‑to‑Builder) is **already on this machine**, so
handing it the SQL is a **local‑machine handoff** (a named pipe), not a network
endpoint — a caller that isn't on this machine, and doesn't have BuildConsole's
config, can't reach it. That's the local‑context guarantee Shane wants for SQL.

The SQL **itself** then runs through the **exact same pipe the manual SQL Runner
uses**: `LocalSqlExecutor` → `BuildTrackerApiClient.ExecuteSqlAsync` →
`POST /api/simulator/sql/execute` against the configured `apiBaseUrl` dev
api‑server. Shane's design intent, in his own words: *"you send the SQL through the
pipe like the SQL Runner, no postgres needed."*

> **History / correction.** An earlier version of `LocalSqlExecutor` opened its
> **own** direct Npgsql connection and required a `databaseUrl`/`DATABASE_URL` that
> was never configured — so every `executeSql` call failed with *"no local Postgres
> connection string configured."* That deviated from the design. `executeSql` now
> reuses the SQL Runner's one already‑working HTTP path, so it succeeds the moment
> the app is configured with `apiBaseUrl` + `ingestToken` — the same config the
> queue/board/manual SQL Runner already need. Nothing new to set up.

### Configuration
No separate SQL connection string is needed. `executeSql` works whenever the app is
configured with **`apiBaseUrl`** + **`ingestToken`** in
`scripts/build-queue-watcher.config.json` — the same config the manual SQL Runner,
Build Queue, and Git Board already rely on. If the app isn't configured,
`executeSql` writes an `ok:false` result whose `error` says exactly that — it never
silently no‑ops. (A legacy `databaseUrl` key may still exist in the config; it is
**no longer read** by anything.)

### The invocation contract

The URI carries only a **short reference** — never the SQL itself. Write the SQL
to a temp file, then invoke with a `ref=` pointing at it:

```
shaneapp://executeSql?ref=<url-encoded temp .sql path>&resultRef=<optional out path>&src=<optional caller tag>
```

| Query param | Required | Meaning |
|-------------|----------|---------|
| `ref` | **yes** | Path to a temp file containing the SQL to run. (Payload is **never** put inline in the URL — see "design notes".) |
| `resultRef` | no | Path to write the JSON result envelope to. Defaults to `<ref>.result.json`. |
| `src` | no | Free‑text caller tag, logged verbatim as the source (`unknown` when absent). |

The action name is the URI **authority** (`executeSql`); it is case‑insensitive.

### How to invoke it (PowerShell)

```powershell
$sql = "SELECT count(*) AS users FROM public.users;"
$ref = Join-Path $env:TEMP ("shaneapp-sql-" + [guid]::NewGuid() + ".sql")
Set-Content -Path $ref -Value $sql -Encoding utf8

Start-Process ("shaneapp://executeSql?src=claude-code&ref=" + [uri]::EscapeDataString($ref))

# Bounded, foreground wait for the result file, then read it — see §0 for Wait-ShaneAppResult.
# SQL is fast, so a short deadline is fine here.
$out = "$ref.result.json"
Wait-ShaneAppResult -Path $out -DeadlineSec 120
```

### The result envelope

BuildConsole writes JSON to `resultRef` (or `<ref>.result.json`):

```jsonc
{
  "ok": true,               // false if any statement failed / it couldn't run
  "error": null,            // first statement error, or the reason it couldn't run
  "action": "executeSql",
  "source": "claude-code",  // whatever ?src= was
  "ranAtUtc": "2026-08-13T...Z",
  "statementCount": 1,
  "statements": [ /* SqlStatementResult[] — the same shape the SQL Runner renders */ ]
}
```

### What happens under the hood
- `shaneapp://` is registered (see **setup-shaneapp-protocol.ps1**) to launch
  `BuildConsole.exe "%1"`.
- Because the build‑queue instance is already open, that launch is just a
  **courier**: `App.OnStartup` forwards the URI to the running instance over a
  per‑user named pipe (`Services/ShaneAppProtocol.cs`) and exits **without ever
  drawing a window** (WPF app → no console flash either).
- The running instance handles it on the UI thread: read the temp file → run the
  SQL through the **same SQL Runner pipe** (`LocalSqlExecutor` →
  `BuildTrackerApiClient.ExecuteSqlAsync` → `POST /api/simulator/sql/execute`;
  the server splits the script and returns one result per statement,
  continue‑on‑error) → write the result envelope.
- If **no** instance is running, the launch becomes a real cold start that handles
  the URI itself once it's up.

### Logging
Every invocation lands on the **`sql-runner.protocol`** ActivityLog channel
(watch it live in BuildConsole's Activity log) — the parse, the source/action/ref,
the run (including the configured `apiBaseUrl` the SQL Runner pipe targets), and the
real outcome (statements ok/failed, elapsed ms, result path), or the exact reason it
couldn't run (malformed URI, missing/empty/oversized payload, api‑server not
configured, or an HTTP request failure).

### Design notes

1. **Payload never in the URL.** Only a `ref` to a temp file travels in the URI.
   Long or complex SQL (quotes, `$$` blocks, newlines) would otherwise be at the
   mercy of URL length limits and percent‑encoding round‑trips — exactly the
   quoting‑mangling class that plagued `mybuilder://` (#763/#767/#820). A file
   reference sidesteps all of it.

2. **The "Allow this app to open this link?" confirmation.** That prompt is
   imposed by the **calling application** (a browser) as a sandbox gate — it is
   **not** a Windows‑level gate on `ShellExecute`. Findings:
   - Invoked from a local process via `Start-Process 'shaneapp://…'` /
     `ShellExecute` / `explorer.exe` (how an agent invokes it): **no prompt at
     all, ever.** Proof already in this repo — BuildConsole fires `mybuilder://`
     via `Process.Start(new ProcessStartInfo(uri){ UseShellExecute = true })`
     (MainWindow.xaml.cs) and it launches with no prompt.
   - Invoked from a **web page** in Chrome/Edge: prompted once per origin, with an
     "Always allow …" checkbox that suppresses it thereafter.
   So for the agent/CLI path this protocol targets, the confirmation does **not**
   fire per invocation — it effectively never fires.

3. **Sanity logging** of source + action + real outcome — see "Logging" above.

### One‑time setup
Run **setup-shaneapp-protocol.ps1** once (HKCU, no admin). Re‑run only if the
deployed exe path changes (a normal `git pull` + redeploy keeps the same path).

---

## 2. `shaneapp://runTest` — local test-manifest trigger

The local‑agent counterpart to executeSql, for running a whole **test manifest**.
It runs the manifest **in‑process** through the exact same `RunManifestAsync`
pipeline a Play Test / manifest double‑click uses — every step type it supports
(apiTests, graphTests, postGraphApiTests, zohoTests, uiSteps, powerShellVerify),
not just uiSteps. `shaneapp://uiTest` is accepted as an alias and does the same
thing (the name predates realizing it's not UI‑specific).

### Why local and not the #898 HTTP path
Git #898 (section 3 below) exposes test execution over HTTP for a **remote** caller
(a CI box not on this machine): create run → BuildConsole polls `/next` → runs →
POSTs `/complete` → the caller polls `/:runId`. That whole round‑trip through the
deployed api‑server is pure overhead when the agent is a **local** Claude Code
session on the same machine as BuildConsole. `runTest` skips it: the launch is
couriered straight to the running instance (`Services/ShaneAppProtocol.cs`) and
`RunManifestAsync` is invoked directly — no network hop. #898's HTTP endpoint stays
as‑is for the genuinely remote case.

### The invocation contract

```
shaneapp://runTest?file=<manifest filename>&onlyTag=<optional filter tag>&resultRef=<optional out path>&src=<optional caller tag>
```

| Query param | Required | Meaning |
|-------------|----------|---------|
| `file` | **yes** | Manifest to run. A bare `{feature}.json` filename resolved by searching `test-manifests/` recursively (the same resolution #898/#964 use since #960 moved manifests into `{area}/` subdirs); an absolute or repo‑relative existing path is honored directly too. (`ref=` is accepted as a fallback alias for this.) |
| `onlyTag` | no | Scopes execution to only run manifest steps carrying this sessionTag value (case-insensitive). If missing, runs the entire file. |
| `resultRef` | no | Path to write the JSON result envelope to. Defaults to `%TEMP%\shaneapp-runTest-<file>.result.json` (predictable, so a caller can read it without passing `resultRef`). |
| `src` | no | Free‑text caller tag, logged verbatim as the source (`unknown` when absent). |

The action name is the URI **authority** (`runTest`/`uiTest`); it is case‑insensitive.

### How to invoke it (PowerShell)

```powershell
$file = "hello-world-ui.json"
$out  = Join-Path $env:TEMP "shaneapp-runTest-$file.result.json"
Remove-Item $out -ErrorAction SilentlyContinue   # clear any stale result first

Start-Process ("shaneapp://runTest?src=claude-code&file=" + [uri]::EscapeDataString($file))

# Bounded, FOREGROUND wait for the fresh result file — see §0 for Wait-ShaneAppResult.
# A uiSteps manifest can take 5-7 min, so run THIS whole call in the foreground and pass an
# explicit tool timeout of 600000 ms; DeadlineSec 540 keeps the wait under that ceiling and
# always returns an envelope. Do NOT run it in the background and then wait for a completion
# notification — that is the #1326 hang: the run finishes and writes the file, but the session
# sits waiting on a signal it already got.
$r = Wait-ShaneAppResult -Path $out -DeadlineSec 540
"{0}: {1}/{2} steps passed" -f (@{$true='PASS';$false='FAIL'}[$r.ok]), $r.passedCount, $r.stepCount
```

### The result envelope

BuildConsole writes JSON to `resultRef` (or the temp default). A top‑line summary a
CLI agent can branch on immediately, plus the **full `ManifestRunResult`** (the same
shape `test-results/*.json` and #898's HTTP delivery use):

```jsonc
{
  "ok": true,                 // false if any step failed / it couldn't run
  "error": null,              // reason it couldn't run, or the "N of M steps failed" summary
  "action": "runTest",
  "source": "claude-code",    // whatever ?src= was
  "ranAtUtc": "2026-08-13T...Z",
  "manifestFile": "hello-world-ui.json",
  "manifestPath": "test-manifests/smoke/hello-world-ui.json",  // repo-relative, resolved
  "onlyTag": "issue-1263",    // whatever ?onlyTag= was (null if absent)
  "issue": 1011,
  "feature": "...",
  "stepCount": 6,
  "passedCount": 6,
  "failedCount": 0,
  "result": { /* full ManifestRunResult — Steps[] with per-step pass/fail, timings, etc. */ }
}
```

### Concurrency & interactivity
`RunManifestAsync` drives the **one** shared TestRunnerWindow/WebView2, which can't
service two runs at once. A `runTest` therefore takes the **same latch** #898's
remote poll uses (`_testTriggerBusy`): if a remote OR local run is already going it
**refuses** (envelope `ok:false`, "a test run is already in progress — retry
shortly") rather than corrupting the in‑flight run, and while it runs the remote poll
won't claim one. Holding that latch also makes the run **non‑interactive** (no
device‑code / screenshot‑review modals) — correct for an agent polling a result file,
which a blocking modal would otherwise strand.

### Logging
Every invocation lands on the same **`sql-runner.protocol`** ActivityLog channel as
executeSql (source/action/file + the real outcome: manifest resolved, steps
passed/failed, elapsed ms, result path — or the exact reason it couldn't run).

### One‑time setup
The **same** `shaneapp://` registration executeSql uses (setup-shaneapp-protocol.ps1)
already covers `runTest` — the scheme is registered once, all actions ride it. No
extra setup.

---

## 3. Remote/CI test execution — Git #898 HTTP (no local machine required)

When the caller is **not** on this machine (a future CI runner), use Git #898's HTTP
endpoint instead of `runTest`. Any HTTP‑capable agent drives it directly against the
dev api‑server. Same bearer token BuildConsole/Build Tracker use
(`BUILD_TRACKER_INGEST_TOKEN`, via `requireAdminOrIngestToken`).

**Flow** (agent ↔ api‑server; the already‑running BuildConsole is what actually
drives the WebView2 manifest, claiming work off the same server):

1. **Create the run** — name a bare manifest filename under `test-manifests/`:
   ```
   POST /api/admin/deploy/test-run
   Authorization: Bearer <BUILD_TRACKER_INGEST_TOKEN>
   Content-Type: application/json

   { "manifestFile": "hello-world-ui.json" }
   → 201 { "runId": "...", "status": "pending", "manifestFile": "hello-world-ui.json" }
   ```
2. **Poll for the result** until `status` is `done` or `failed`:
   ```
   GET /api/admin/deploy/test-run/<runId>
   Authorization: Bearer <BUILD_TRACKER_INGEST_TOKEN>
   → { "status": "done", "results": { /* full ManifestRunResult JSON */ }, ... }
   ```

BuildConsole's side of this (`GET /api/admin/deploy/test-run/next` claim +
`POST /api/admin/deploy/test-run/:runId/complete`) is internal to the app — agents
never touch those two; they only `POST … /test-run` and `GET … /test-run/:runId`.

Route source: `artifacts/api-server/src/routes/admin-test-trigger.ts`. BuildConsole
side: `TestTriggerTickAsync` in `MainWindow.xaml.cs`, `GetNextTestRunAsync` /
`CompleteTestRunAsync` in `Services/BuildTrackerApiClient.cs`.

---

## 4. Trigger the real deploy (pull + restart) and WAIT for it — `trigger-deploy-and-wait.ps1`

The convenient one-command trigger for the server-side deploy step that already
exists but had no shell caller: **build lands → push → tell the dev server to
`git pull` + restart → confirm the new code is genuinely live** before running
tests against it. This is the missing piece between "I pushed" and "the dev
server is actually running what I pushed".

It wraps two real endpoints (both under `/api`), using the **same bearer token**
every other admin-deploy call uses (`BUILD_TRACKER_INGEST_TOKEN`, via
`requireAdminOrIngestToken`):

| Endpoint | Git # | Source | Role |
|----------|-------|--------|------|
| `POST /api/admin/deploy/build-complete` | #911 | `artifacts/api-server/src/routes/admin-deploy-console.ts` | Does the real `git pull --ff-only` then schedules the server restart so the pulled commit is actually loaded. |
| `GET /api/internal/deploy-status` | #805 | `artifacts/api-server/src/routes/version.ts` | Reports the running server's current `commitHash` — the thing we poll for a change. |

### Why it polls instead of trusting the POST

#911's restart is **deliberately deferred + detached** — it kills PID 1 behind a
short sleep so the HTTP response flushes first, then the connection drops. The
endpoint therefore **never waits** for the server to come back; a `200` only
means "accepted, restart scheduled". The only real proof the new code is live is
the reported `commitHash` **flipping** from what it was before. So the script:

1. `GET /api/internal/deploy-status` → captures the **old** commit hash first.
2. `POST /api/admin/deploy/build-complete` (Bearer token) → triggers pull+restart.
   A dropped/failed connection here is expected and tolerated (per #911).
3. Polls `GET /api/internal/deploy-status` every few seconds — treating the
   server being unreachable (mid-restart) as "keep waiting" — until the hash
   **changes**.
4. Prints old hash, new hash, and **real elapsed time**, so you know definitively
   the dev server is on your latest push before moving on to tests.

### The wait is progress-aware, not a flat timeout

`kill 1` reboots the whole Repl container, which re-runs the Run button: git
pull, install, and a **full rebuild** before the server listens again. A large
change (an app-wide retheme, say) makes that take many minutes. The original flat
**300s** cap printed `TIMED OUT` over a ~10-minute deploy that had genuinely
succeeded — worse than no check at all, because it reports a real success as a
failure. So the wait now ends on the server's **observed state**:

| Observation | Meaning | What the script does |
|---|---|---|
| Server unreachable | Restart/rebuild in progress | Keeps waiting, printing a heartbeat with real elapsed time so a long rebuild never looks hung. Bounded only by the `-TimeoutSeconds` backstop. |
| Reachable, commit **flipped** | New process is live | **Success**, exit 0. |
| Reachable, still the **old** commit for `-StallSeconds` straight | Not deploying | Stops **early** and says which: never went down = the restart never took effect; went down and came back on the same commit = it restarted but there was nothing new to pull. Any unreachable poll resets this window, so a rebuild that bounces the server never trips it. |

Net effect: a genuinely failed deploy is reported **faster** than before (~3 min,
not 5), while a genuinely slow one is allowed to finish instead of being called a
failure.

- `-TimeoutSeconds` — hard ceiling on the whole wait. Default **1800** (30 min),
  deliberately generous; it is a backstop, not the normal way the wait ends.
- `-StallSeconds` — how long the server may stay up on the old commit before we
  conclude it isn't deploying. Default **180**. This is what actually ends a
  failed run.
- `-PollIntervalSeconds` — default 3 (unchanged).
- `-HeartbeatSeconds` — default 15; minimum gap between "still waiting" lines, so
  a 3s poll doesn't emit hundreds of identical lines during a long rebuild. Real
  state changes (down, back up, hash flip) always print immediately.

### How to invoke it (PowerShell)

```powershell
# After your build has pushed to origin/main:
.\trigger-deploy-and-wait.ps1
```

`ApiBaseUrl` and the ingest token default to the **same
`scripts/build-queue-watcher.config.json`** BuildConsole itself reads
(`apiBaseUrl` / `ingestToken`); the token also falls back to
`$env:BUILD_TRACKER_INGEST_TOKEN`. Override either explicitly if needed:

```powershell
.\trigger-deploy-and-wait.ps1 -ApiBaseUrl https://your-dev-server
```

For an unusually heavy deploy (dependency changes on top of a large rebuild),
raise the ceiling only — the stall window stays small, so a deploy that never
starts is still reported in ~3 minutes rather than after the full hour:

```powershell
.\trigger-deploy-and-wait.ps1 -TimeoutSeconds 3600
```

If a schema change must land with the deploy, pass CREATE/ALTER/INSERT-only SQL —
#911 hard-rejects anything else and applies it in one transaction before the
pull. Per this repo's DB rule, **only Shane supplies this SQL**:

```powershell
.\trigger-deploy-and-wait.ps1 -SchemaSqlFile ..\..\lib\db\migrations\manual\0042-add-thing.sql
```

### Exit codes & output

- **Exit 0** — a green `DEPLOY CONFIRMED` block with old hash → new hash → elapsed.
  The dev server is provably on the new code.
- **Exit 1** — either `build-complete` reported a real failure (e.g. `git pull`
  diverged, or the schema SQL rolled back — no restart was scheduled), **or** the
  hash never flipped. In the second case the red block now names *which* of the
  three things happened rather than saying "timed out" for all of them:
  `RESTARTED ON THE OLD COMMIT` (it restarted, nothing new was on origin/main),
  `RESTART NEVER TOOK EFFECT` (the server never went down), or
  `HARD CEILING HIT` (still rebuilding past `-TimeoutSeconds` — re-run with a
  larger one; that ceiling is a backstop, not a verdict). Either way it says
  plainly the server is **not** confirmed on new code, so you don't run tests
  against stale code by mistake.

### Logging
Server-side logging is already wired by both routes (`admin.deploy` and
`testing.deploy-poll` channels) — the script itself adds none.

---

## 5. Dual‑verification — engine observation vs PowerShell ground truth

> **This section is the durable design contract, not a nice‑to‑have.** Two
> triggers exist to make the platform's engines and write‑actions provable:
> `shaneapp://runScan` (a **read/scan** — landing under local #59) and the
> `powerShellVerify` manifest phase (a **write** — already live, Git #900/#901).
> Both are built around the SAME idea, and it is the point of both: **PowerShell,
> signed in as Shane himself, is an independent source of ground truth; the
> engine's finding — or a write action's claimed effect — is checked *against*
> that ground truth, not merely checked for "did it complete without erroring."**

### The principle (Shane's own words)

> "Right and we have PowerShell. So agent could now literally reach into my
> tenant. Get the source of truth from PowerShell. Then make sure the engines are
> grabbing that properly. They can also automate test the api write actions.
> Write runs. Agent PowerShell verify action success."

A scan that returns HTTP 200 and a healthy‑looking score has proven **nothing**
about whether the engine actually *saw the tenant correctly*. A write action that
reports `success: true` has proven nothing about whether the value actually
*landed in the tenant*. The only thing that proves either is reading the SAME
real fact a second time, through a **completely separate identity and code path**
— Shane's delegated `Connect-MgGraph` session, NOT the app's app‑only service
principal — and asserting the two agree. A bug that makes the app misreport
success cannot also make that independent read lie.

### The general model (one shape, two instantiations)

Every dual‑verification test — scan‑side or write‑side, now or future — is the
same three moves:

1. **Trigger** the real action through its real code path (a scan run; a write
   endpoint), and capture the value the **engine/app itself observed or claimed**.
2. **Independently read** the same real tenant fact via a delegated PowerShell
   `Get-*`/`Get-Mg*` cmdlet run as Shane (the #900/#901 auth: `Connect-MgGraph`,
   reusing the locally cached delegated token — never the app's client‑credentials
   identity). This is the **ground truth**.
3. **Assert equality.** A pass means the engine is genuinely seeing reality; a
   *mismatch is a real engine/mapping bug even when the action "succeeded."*
   Never stop at step 1 — "the scan ran" / "the write returned 200" is not a
   verification, it is a precondition for one.

The two halves below are just this model applied to reads and to writes.

---

### 5a. Write actions — the live, canonical example (Git #901)

**This half is already live and is the template every future write‑action test
copies.** `test-manifests/admin/baseline-actions-powershell-verify.json` verifies
all 10 real `baseline_action_templates` write actions, and its shape IS the
general model:

- **`apiTests`** POST `/admin/baseline-templates/:templateId/test` with
  `{ customerId, variables }` → **triggers the real write** (step 1).
- **`graphTests`** read the value back through the app's own Graph integration →
  the **app‑reported** value (still step 1 — what the app *thinks* it did).
- **`powerShellVerify`** (`afterStep` → `cmdlet` → `compareField`) reads the same
  fact as Shane's delegated identity and **diffs it** against the app‑reported
  value → **ground truth + assert** (steps 2–3).

`test-manifests/admin/powershell-verify-example.json` is the minimal one‑step
template of the same thing. The `powerShellVerify` executor
(`desktop/BuildConsole/Services/PowerShellTestExecutor.cs`, Git #900) handles the
delegated auth, the testbed‑tenant guard (#965), and the JSON‑parsed comparison.

**The general rule (applies to ALL write‑action automation, not just these 10):**
a write‑action test is not done when it asserts `result.success === true`. It is
done when it *independently confirms the effect landed* via `powerShellVerify`
(or an equivalent independent read). Copy `baseline-actions-powershell-verify.json`
— don't invent a new shape. Absence/removal actions use the
presence‑probe‑returns‑`''`‑or‑the‑id trick documented in that manifest's notes.

---

### 5b. Scans / reads — `shaneapp://runScan` (local #59), same model

The scanning ("diagnostics") engine is triggered by
`POST /api/msp/customers/:customerId/diagnostics/run`, which is **fire‑and‑forget**:
it returns `202 { runId, status: "pending" }` immediately and runs
`runDiagnostics(...)` asynchronously (see
`artifacts/api-server/src/routes/msp-diagnostics.ts`). The settled result — per
check — is then read from
`GET /api/msp/customers/:customerId/diagnostics/runs/:runId` as `{ run, findings }`.

`shaneapp://runScan`'s job is to make that loop usable by a local agent the same
way `runTest` does: **trigger the run, poll it to a terminal status
(`completed`/`partial`/`failed`) — or consume the run's SSE stream — and only then
write ONE settled result envelope.** A `202 pending` is not a result an agent can
diff; runScan must not return until the scan has genuinely settled (with a hard
timeout backstop so a stuck run fails the envelope cleanly rather than hanging the
agent's poll, exactly like `runTest`).

#### The result envelope contract — per‑finding detail is REQUIRED

The whole reason runScan exists (rather than the agent just POSTing the run) is
that the envelope must carry **enough structured, per‑check detail to be compared
against a separate PowerShell read — not just an overall score.** An aggregate
health number can't tell you *which* check the engine saw wrong; the per‑finding
observed values can. So the envelope MUST include, for **every** check in the run,
the finding's own observed data — grounded in the real `msp_diagnostic_findings`
columns the runs/:runId route already returns:

```jsonc
{
  "ok": true,                    // false ONLY if the scan couldn't run / never settled
  "error": null,                 // reason it couldn't run / settle, else null
  "action": "runScan",
  "source": "claude-code",       // whatever ?src= was
  "ranAtUtc": "2026-08-14T...Z",
  "customerId": 42,
  "runId": "…uuid…",
  "runStatus": "completed",      // the SETTLED terminal status (completed | partial | failed)
  "packageKey": "core:security-baseline",
  "rollup": {                    // the run's own aggregate counters — the REAL msp_diagnostic_runs
                                 // columns: checks_total / checks_ok / checks_error / checks_license_gap
    "checksTotal": 34, "checksOk": 20, "checksError": 11, "checksLicenseGap": 3,
    "compositeScore": 61         // summary.compositeScore — coverage-gated, may be null
  },
  "findings": [                  // REQUIRED: one entry PER CHECK — never collapsed to a score
    {
      "checkKey": "exchange:distribution-list-count",
      "checkLabel": "Distribution list count",
      "checkStatus": "ok",       // ok | error | license_gap | consent_revoked | requires_script | …
      "severity": "info",
      "title": "…",
      "description": "…",
      "extractedProperties": {   // ← THE ENGINE'S OWN OBSERVED VALUES — the thing you diff
        "distributionListCount": 0, "_itemCount": 17
      },
      "classification": null     // #379 triage verdict; null unless a real failure
    }
    // …every other check in the run…
  ]
}
```

`extractedProperties` is the load‑bearing field: it is what the engine *observed*
about the tenant for that check, and it is what a PowerShell read is diffed
against. Dropping it (or only returning `compositeScore`) makes the whole
dual‑verification impossible — that is why it is a hard requirement of the #59
build, not an optional extra.

#### The concrete comparison workflow (this is the reusable pattern)

Trigger the scan, then prove a specific finding against ground truth. The example
below uses a **real** finding observed in this tenant
(`docs/check_key.json`): `exchange:distribution-list-count` reported
`distributionListCount: 0`. That check was `status: "ok"` — and yet, across the
same corpus, this engine returned 1869 `error` findings and only ONE `ok`, so a
bare "0, healthy" is exactly the kind of result that must be checked against
reality before it's trusted. A false clean reads identically to a real clean until
you diff it.

```powershell
# 1) TRIGGER + SETTLE the scan, read the per-finding envelope (runScan does the polling).
$out = Join-Path $env:TEMP "shaneapp-runScan-42.result.json"
Remove-Item $out -ErrorAction SilentlyContinue
Start-Process ("shaneapp://runScan?src=claude-code&customerId=42&resultRef=" + [uri]::EscapeDataString($out))
# Bounded, FOREGROUND wait — see §0. Scans are minutes-scale; run with tool timeout 600000.
$scan = Wait-ShaneAppResult -Path $out -DeadlineSec 540

# 2) Pull the ENGINE'S OBSERVED value for the check under test.
$engineDlCount = ($scan.findings |
  Where-Object { $_.checkKey -eq 'exchange:distribution-list-count' }).extractedProperties.distributionListCount

# 3) Read the SAME fact independently as Shane (delegated Connect-MgGraph — the #900/#901 auth).
#    Distribution lists = mail-enabled, non-security groups; a genuinely separate code path
#    from whatever the engine's check did (which, per the dump, was erroring on an
#    'exchange-online:' Graph segment — precisely the mismatch this catches).
Connect-MgGraph -UseDeviceCode -ContextScope CurrentUser -NoWelcome   # silent reuse of the cached token
$truthDlCount = (Get-MgGroup -All -ConsistencyLevel eventual `
  -Filter "mailEnabled eq true and securityEnabled eq false").Count

# 4) ASSERT the engine matches ground truth — NOT merely that the scan ran.
if ($engineDlCount -eq $truthDlCount) {
  "PASS — engine observed $engineDlCount DLs, PowerShell ground truth confirms $truthDlCount."
} else {
  "FAIL — engine reported $engineDlCount but the tenant actually has $truthDlCount. " +
  "The scan 'succeeded' while the engine's observation is wrong."
}
```

The same shape generalizes to any check whose fact a `Get-Mg*` cmdlet can read
independently (identity/MFA state, a policy value, a count, a specific object's
attribute): pull `extractedProperties.<value>` from the runScan envelope, read the
same fact via delegated PowerShell, assert they agree. Where a manifest is
preferable, once runScan has settled the run you can also drive the comparison
through the existing manifest phases — an `apiTests` GET of `…/diagnostics/runs/:runId`
that `extract`s the finding value, diffed by a `powerShellVerify` step — the exact
#901 shape, pointed at a read instead of a write.

> **Status:** the `runScan` trigger mechanism itself lands under local #59; do not
> invoke `shaneapp://runScan` until that ships (until then the URI has no handler
> and an agent's poll would hang). The **write half (5a) is live today.** This
> section is the contract #59 is built to: settle‑to‑terminal + per‑finding
> `extractedProperties` in the envelope, so the comparison above is possible.

### Logging
Both halves log on their existing channels — the scan engine on `tenant.portal`
(server‑side) and the delegated‑PowerShell verification on
`testing.powershell-verify` (BuildConsole). runScan itself will log on the shared
`sql-runner.protocol` shaneapp channel like `executeSql`/`runTest` (trigger →
settle → per‑finding count → result path, or the exact reason it couldn't run).

---

## 6. `shaneapp://runScan` — the local scan/assessment trigger (as shipped)

The third `shaneapp://` action — the local-agent companion to `executeSql`/`runTest`,
and the concrete handler §5 is built around. It runs the platform's REAL Copilot
Readiness scan/assessment engine (`runDiagnostics` — real per-tenant Microsoft Graph
reads → real findings/scores/pillars) against a **testbed** tenant and writes ONE
settled result envelope, so a build session can exercise and debug the scanning
engine without walking the whole quiz → consent → scan → verdict UI. Shane's
motivation: *"if the agent could execute a scan on their own outside the UI path,
they could help debug and make my scanning engine better."*

### Why HTTP (unlike executeSql/runTest)
`executeSql` runs SQL through the SQL Runner's `POST /api/simulator/sql/execute`
pipe; `runTest` runs a manifest in-process. Neither shape applies here: the scan
engine (`runDiagnostics`) is Node/TS in the deployed api-server and can't run
in-process, and there is no ingest-token SQL/manifest surface for a chosen-tenant
scan. The ONLY way to run the REAL
engine is the same authenticated api-server route the product uses — so runScan is a
deliberate HTTP client (`Services/ScanRunnerClient.cs`) reusing the exact trigger,
never a second scan implementation.

### The trigger route + auth (why a testbed login is required)
runScan posts the assessment UI's own trigger,
**`POST /api/portal/assessment/debug-trigger-scan`** (`portal-assessment.ts`) — the
platform's ONE scan trigger, hard-gated server-side to `tenants.is_testbed = true`
(Git #965). That surface is `requireRole("Assessment")`; BuildConsole's
`BUILD_TRACKER_INGEST_TOKEN` is not a JWT and is rejected there (401), and no
ingest-token endpoint scans a chosen tenant. So runScan does the SAME thing the test
manifests do — logs in as the pre-provisioned testbed Assessment account
(`TEST_PORTAL_EMAIL`/`TEST_PORTAL_PASSWORD` from **Settings → Test Environment
Variables**) via `POST /api/auth/login`, then uses that Assessment JWT for the
trigger and the result reads.

> **Reconciliation with §5b:** §5b sketches the MSP-operator route
> (`/api/msp/customers/:id/diagnostics/run`, `?customerId=`); the shipped action
> instead uses the **assessment UI's own** `debug-trigger-scan` (`?tenantId=`),
> because that is the exact trigger the customer journey calls AND the one carrying
> the #965 isTestbed gate, and it is reachable via the testbed Assessment login
> BuildConsole already uses for manifests (the MSP route needs an MSPOperator JWT
> BuildConsole doesn't hold). The settled per-finding read is the equivalent
> customer-scoped `GET /api/portal/diagnostics/runs/:runId` — same `{ run, findings }`
> shape §5b relies on, reachable with the same Assessment JWT.

### The double testbed gate (#965)
runScan never scans a non-testbed tenant, two independent ways:
1. **Before triggering**, it runs its OWN #965 gate — `Services/TestbedGate`
   (`VerifyTenantIsTestbedAsync`), the SAME enforced isTestbed=true gate
   graphTests/powerShellVerify use — against the server's authoritative testbed
   customer list. Fail-closed: a non-testbed (or unconfirmable) tenant is refused
   with an `ok:false` envelope and never triggered.
2. The **server-side** `debug-trigger-scan` gate refuses (403) if the logged-in
   account's tenant isn't testbed — a second belt.

As a correctness belt, the login's `customerId` claim is confirmed to match the
requested `tenantId`'s testbed customer, so runScan can never silently scan a
DIFFERENT (still-testbed) tenant than asked (surfaced as
`tenantCorrespondenceConfirmed` in the envelope).

### The invocation contract

```
shaneapp://runScan?tenantId=<Entra tenant GUID>&resultRef=<optional out path>&src=<optional caller tag>&timeoutSeconds=<optional>
```

| Query param | Required | Meaning |
|-------------|----------|---------|
| `tenantId` | **yes** | The Entra tenant GUID of a **real testbed tenant** (matched against the server's isTestbed=true customer list). Must be the tenant the configured `TEST_PORTAL_*` account belongs to. |
| `resultRef` | no | Path to write the JSON result envelope to. Defaults to `%TEMP%\shaneapp-runScan-<tenantId>.result.json`. |
| `src` | no | Free-text caller tag, logged verbatim as the source (`unknown` when absent). |
| `timeoutSeconds` | no | How long to wait for the scan to settle. Default 600; clamped to [60, 1800]. |

The action name is the URI authority (`runScan`); it is case-insensitive. As with
`executeSql`/`runTest`, only a short reference travels in the URL — the creds come
from Settings, never inline.

### How to invoke it (PowerShell)

```powershell
$tenantId = "00000000-0000-0000-0000-000000000000"   # a real testbed tenant GUID
$out = Join-Path $env:TEMP "shaneapp-runScan-$tenantId.result.json"
Remove-Item $out -ErrorAction SilentlyContinue        # clear any stale result first

Start-Process ("shaneapp://runScan?src=claude-code&tenantId=" + [uri]::EscapeDataString($tenantId) + "&resultRef=" + [uri]::EscapeDataString($out))

# Scans are minutes-scale (real Graph reads); bounded FOREGROUND wait for the SETTLED result — see §0.
# Run this whole call in the foreground with tool timeout 600000 (never backgrounded — #1326).
$scan = Wait-ShaneAppResult -Path $out -DeadlineSec 540
"{0}: run {1} status={2} ({3} findings, checks {4}/{5} ok)" -f `
  (@{$true='OK';$false='FAIL'}[$scan.ok]), $scan.runId, $scan.scanStatus, `
  $scan.findingsCount, $scan.checksOk, $scan.checksTotal
```

### The result envelope

Written to `resultRef` (or the temp default). Same top-line fields as the other two
actions (`ok`/`error`/`action`/`source`/`ranAtUtc`), plus the real scan result:

```jsonc
{
  "ok": true,                       // false if it couldn't run / never settled / the run 'failed'
  "error": null,                    // the reason it couldn't run/settle, else null
  "action": "runScan",
  "source": "claude-code",          // whatever ?src= was
  "ranAtUtc": "2026-08-14T...Z",
  "tenantId": "…GUID…",
  "testbedCustomer": { "id": 42, "name": "…" },  // resolved from the #965 testbed list
  "runId": "…uuid…",
  "scanStatus": "completed",        // the SETTLED terminal status: completed | partial | failed
  "tenantCorrespondenceConfirmed": true,         // login customerId matched the requested tenant
  "elapsedMs": 84213,
  "checksTotal": 34, "checksOk": 20, "checksError": 11,   // lifted from the real run row
  "findingsCount": 34,
  "copilotGate": { "status": "no_go", "score": 61, "threshold": 82 },   // from /assessment/status
  "run":      { /* the full real msp_diagnostic_runs row: status, checks*, summary, … */ },
  "findings": [ /* the full msp_diagnostic_findings rows — per finding: checkKey, checkLabel,
                   checkStatus, severity, title, description, extractedProperties, recommendation */ ],
  "assessmentStatus": { /* GET /assessment/status: radar/pillars, stats, copilotReadiness, copilotGate */ }
}
```

`findings[]` is the raw per-finding rows straight from `…/diagnostics/runs/:runId`,
**including each finding's `extractedProperties`** — exactly the per-finding detail
§5b requires for dual-verification. The §5b comparison workflow works against this
envelope directly, e.g.:

```powershell
($scan.findings | Where-Object { $_.checkKey -eq 'exchange:distribution-list-count' }).extractedProperties.distributionListCount
```

See **§5** for the full engine-observation-vs-PowerShell-ground-truth methodology.

### Concurrency & timing
runScan is pure HTTP and does NOT touch the shared TestRunnerWindow/WebView2, so
(unlike `runTest`) it needs no `_testTriggerBusy` latch and can run alongside a
manifest run. The trigger is fire-and-forget server-side, so runScan polls
`…/diagnostics/runs/:runId` every few seconds until the run reaches a terminal
status (or `timeoutSeconds`), then reads `/assessment/status` once. On timeout the
envelope is `ok:false` with the last-seen status and the `runId`, so the agent can
re-check later rather than hang.

### Logging
Every stage lands on the shared **`sql-runner.protocol`** ActivityLog channel like
`executeSql`/`runTest` (testbed-gate result, login, trigger + runId, poll progress,
settle, finding/checks counts, result path — or the exact reason it couldn't run);
the testbed gate additionally logs on its own `testing.testbed-gate` channel.

### One-time setup
Two things: (1) the SAME `shaneapp://` registration `executeSql`/`runTest` use
(setup-shaneapp-protocol.ps1) already covers `runScan` — the scheme is registered
once, all actions ride it, no extra setup. (2) Set `TEST_PORTAL_EMAIL` /
`TEST_PORTAL_PASSWORD` (the pre-provisioned testbed Assessment account) in
Settings → Test Environment Variables — the same creds the assessment test
manifests use.

---

## 7. `shaneapp://executeScan` — local SINGLE monitor-check trigger (local #60)

The **granular** sibling of `runScan` (§6 / #59). Where `runScan` triggers the
**whole aggregate** diagnostics scan for a customer, `executeScan` triggers exactly
**ONE** individual monitor check by its real `monitor_checks` **key** — the same
thing Simulator Studio's **"M365 Endpoints"** node does when an operator picks a
single check (e.g. `appgov:stale-app-registrations`, grouped under its `appgov`
key‑prefix domain), leaves the pre‑filled defaults alone, and clicks **Run**
against a testbed tenant. (Note `runScan` and `executeScan` hit **different** real
engines: `runScan` → the Copilot Readiness / diagnostics engine
(`/api/portal/assessment/debug-trigger-scan` → `runDiagnostics`, findings in
`msp_diagnostic_findings`); `executeScan` → the **monitoring** engine
(`monitor_checks` → `executeMonitorCheck`, result in `tenant_monitor_profiles`).)

### Reuse, not reimplementation
`executeScan` calls the **exact same real endpoint** the Simulator Studio canvas
(`SimulatorEndpointCanvas.tsx`) calls — it is a courier, not a second scanner:

| Step | Real endpoint (`artifacts/api-server/src/routes/admin-monitor-check-runs.ts`) |
|------|------------------------------------------------------------------------------|
| trigger | `POST /api/admin/monitor-checks/:key/run` → `202 { runId, status, run }` (fire‑and‑forget) |
| settle  | `GET /api/admin/monitor-check-runs/:runId` → `{ run, classification }` (polled to terminal) |
| detail  | `GET /api/admin/monitor-check-runs/:runId/items` → `{ items, itemCount }` (raw captured Graph objects, best‑effort) |

"Same defaults" is real: BuildConsole sends **only** `{ customerId }`, and the run
route merges every field as `override ?? check.<field>` — so the check runs with
its **own stored** endpoint/method/`$select`/`$filter`/body, exactly as the UI's
Run button does with nothing edited. The Graph request, `@odata.nextLink`
pagination, mapping/extraction, severity classification and the
`tenant_monitor_profiles` write all belong to the server's `executeMonitorCheck`
— none of it is re‑implemented in BuildConsole (`Services/MonitorScanClient.cs` is
a thin HTTP courier; the handler is `MainWindow.ShaneAppExecuteScan.cs`).

> **Server‑side change this shipped with:** those three routes were `requireAdmin`
> (admin session cookie only). They are now `requireAdminOrIngestToken()` — the
> SAME bearer‑token widening `/simulator/sql/execute` (#702) and
> `/admin/baseline-templates/testbed-customers` (#965) already use — so an
> on‑machine headless caller holding `BUILD_TRACKER_INGEST_TOKEN` can reach them
> with no admin cookie. It only widens **who** can reach the route; the run still
> executes exactly as before. **This requires the dev api‑server to be on the new
> code** (deploy) before `executeScan` will authenticate — until then the run
> route answers `403` and the envelope says so honestly. (This differs from
> `runScan`, whose trigger route needs an Assessment JWT via a testbed login;
> `executeScan`'s route takes the ingest token BuildConsole already holds.)

### The #965 testbed gate (never a real customer tenant)
Before any run starts, the caller‑supplied `tenantId` is resolved against the
server's **live isTestbed=true customer list**
(`Services/TestbedGate.ResolveTestbedTargetAsync`, fail‑closed) — the same #965
gate every tenant‑touching action already enforces. That one step **both** refuses
a non‑testbed target **and** yields the numeric `customerId` (= `tenants.id`) the
run endpoint needs. `tenantId` may be passed as the **Entra tenant GUID** or the
**numeric customer id**; either is matched only against the testbed list, so a
value that isn't a confirmed testbed customer can never run.

### The invocation contract

```
shaneapp://executeScan?scan=<monitor_checks key>&tenantId=<testbed tenant GUID or customer id>&resultRef=<optional out path>&src=<optional caller tag>
```

| Query param | Required | Meaning |
|-------------|----------|---------|
| `scan` | **yes** | The `monitor_checks.key` to run, e.g. `appgov:stale-app-registrations`. |
| `tenantId` | **yes** | The **testbed** target — the Entra tenant GUID **or** the numeric customer id (`tenants.id`). Resolved + #965‑gated against the server's live testbed list. |
| `resultRef` | no | Path to write the JSON result envelope to. Defaults to `%TEMP%\shaneapp-executeScan-<scan>.result.json` (scan key filename‑sanitized). |
| `src` | no | Free‑text caller tag, logged verbatim as the source (`unknown` when absent). |

The action name is the URI **authority** (`executeScan`); it is case‑insensitive.

### How to invoke it (PowerShell)

```powershell
$scan   = "appgov:stale-app-registrations"          # a real monitor_checks key
$tenant = "<your-testbed-tenant-GUID-or-customer-id>"
$out    = Join-Path $env:TEMP "shaneapp-executeScan-appgov-stale-app-registrations.result.json"
Remove-Item $out -ErrorAction SilentlyContinue      # clear any stale result first

Start-Process ("shaneapp://executeScan?src=claude-code" +
  "&scan="     + [uri]::EscapeDataString($scan) +
  "&tenantId=" + [uri]::EscapeDataString($tenant) +
  "&resultRef=" + [uri]::EscapeDataString($out))

# Bounded FOREGROUND wait for the settled result file — see §0 (run with tool timeout 600000).
$r = Wait-ShaneAppResult -Path $out -DeadlineSec 540
"{0}: {1} / check {2}" -f (@{$true='OK';$false='FAIL'}[$r.ok]), $r.runStatus, $r.checkStatus
$r.extractedProperties        # ← the engine's OWN observed values, to diff vs PowerShell
```

### The result envelope

Written to `resultRef` (or the temp default). Top‑line `ok`/`error` a CLI agent can
branch on immediately, the resolved testbed target, the settled run status, and the
check's own **observed output** — `extractedProperties` is the load‑bearing
dual‑verification field (see §5):

```jsonc
{
  "ok": true,                      // false if the run failed / couldn't start / never settled / gate refused
  "error": null,                   // the refusal / failure reason, else null
  "action": "executeScan",
  "source": "claude-code",         // whatever ?src= was
  "ranAtUtc": "2026-08-14T...Z",
  "scan": "appgov:stale-app-registrations",
  "tenantId": "<as supplied>",
  "customerId": 42,                // resolved tenants.id (the run target)
  "matchedCustomerName": "…",      // the testbed customer the gate matched
  "runId": "…uuid…",
  "runStatus": "completed",        // the SETTLED terminal status (completed | failed)
  "checkStatus": "ok",             // run.result.status (ok | error | license_gap | consent_revoked | requires_script | partial)
  "severityMatched": null,
  "severityLabel": null,
  "itemCount": 17,                 // engine's fetched item count
  "pageCount": 1,
  "extractedProperties": { … },    // ← THE ENGINE'S OWN OBSERVED VALUES — diff THIS vs a PowerShell read
  "classification": null,          // failure triage, null on a clean run
  "rawItemCount": 17,              // length of the raw captured items (best-effort)
  "itemsError": null,              // why raw items were unavailable (409/failed/too-large), else null
  "items": [ … ],                  // the raw captured Graph objects (fullest ground-truth surface), or null
  "run": { … }                     // the full settled run object (result nested)
}
```

Then diff exactly as §5b: pull `extractedProperties.<value>`, read the same fact
via a delegated `Connect-MgGraph` / `Get-Mg*` call as Shane (the #900/#901 auth),
and assert they agree — a mismatch is a real engine/mapping bug even though the
check "ran". `executeScan` gives you one check's observation to check; `runScan`
gives you the whole run's.

### Settle‑to‑terminal & non‑hang guarantee
The run route is fire‑and‑forget, so `executeScan` polls the run to a terminal
status (`completed`/`failed`) — with a hard timeout backstop
(`ExecuteScanPollTimeoutSeconds`) — and only THEN writes one settled envelope. A
`202 pending` is never handed back. Every failure path (missing `scan`/`tenantId`,
a refused gate, a `403`/`404`/`400` from the run route, a run that never settles, or
any thrown exception) still writes an envelope, so an agent's file poll never hangs.

### Logging
Every invocation lands on the same **`sql-runner.protocol`** ActivityLog channel as
`executeSql`/`runTest`/`runScan` (real scan key, real tenant, real outcome: gate
result, run started, settled status, elapsed ms, result path — or the exact reason
it couldn't run). The #965 gate additionally logs its pass/refuse on
`testing.testbed-gate`.

### One‑time setup
The **same** `shaneapp://` registration `executeSql` uses
(`setup-shaneapp-protocol.ps1`) already covers `executeScan` — the scheme is
registered once, all actions ride it. No extra setup.

---

## 8. `shaneapp://reportProgress` — explicit build progress reporting

### Why explicit reporting and not output parsing
Past iterations attempted to infer progress by regex-parsing transcript output (`- [ ]`, `[x]`, `✓`, `✅`, or Claude's Task tools). Because agent phrasing varies, inferred parsing proved brittle and frequently left UI progress bars and checklists stale. `reportProgress` gives agents a structured, explicit API to publish phase milestones directly to BuildConsole.

### Call it at EVERY checkpoint — not just once (Git #1206)
The single most common failure mode is an agent that reports **once** near the start (e.g. step 1 "Investigation") and then never calls it again as real work advances. Build Watch's per-build panel only moves when a report arrives, so that one-and-done pattern leaves it **frozen on the first phase** — showing "Investigation & Discovery" at 0% while implementation, testing, etc. are actually happening.

Report **again at every meaningful phase transition**, bumping `step` and updating `label` each time — the same milestones you're already tracking in your own free-form checklist. Practically:

- **First** call when you start the first phase (`step=1`).
- **Re-report** each time you move to a new phase (Investigation → Implementation → Verification → …). One call per meaningful checkpoint — more than once, but not per-line spam.
- **Final** call with `step == total` (e.g. `report-progress.mjs <id> <total> <total> "Done"`) so the panel lands at 100% instead of freezing mid-way.

If the panel hasn't advanced in a while, BuildConsole now surfaces a soft **"⚠ No progress update in Xm"** notice on the build's phase card (see below) — a signal that this checkpoint reporting has gone quiet, not that the build is stuck.

### The invocation contract

```
shaneapp://reportProgress?buildId=<int>&step=<int>&total=<int>&label=<url-encoded string>&src=<optional tag>
```

| Query param | Required | Meaning |
|-------------|----------|---------|
| `buildId` (or `queueId`) | **yes** | Numeric ID of the running build / queue item. |
| `step` | **yes** | 1-based index of the active milestone step (e.g. `1`, `2`, `3`). |
| `total` | **yes** | Total count of planned milestones (e.g. `3` or `4`). |
| `label` | **yes** | Human-readable phase label (e.g. "Investigation & Research"). |
| `src` | no | Caller tag, logged in the `build.progress` channel. |

### CLI helper script
Agents can invoke the lightweight helper directly from terminal:

```bash
node scripts/report-progress.mjs <buildId> <step> <total> "<label>"
```

### Visual display & heuristics
- **Build Watch slot panel:** Displays progress percentage (`step/total`), visual progress meter, current phase card, step timestamp history, and heuristic estimated time remaining.
- **Stale-progress notice (Git #1206):** if an in-progress build reports no new step for longer than `BuildProgressReport.StaleThreshold` (3 min), the phase card shows a soft "⚠ No progress update in Xm" line (re-evaluated off wall-clock time by a 10s timer, independent of whether a report arrives). It clears the moment a fresh report lands, and never appears on a completed build (`step == total`). This makes a quiet panel read as honestly-stale rather than looking frozen; it does not force an agent to report.
- **Queue Panel:** Displays queue-wide token & cost usage at a glance (`🪙 Xk tokens · ~$Y.YY`).
- **Activity Log:** Structured trace on `build.progress` channel.

---

## 9. `shaneapp://executeCmdlet` — local SINGLE PowerShell-cmdlet trigger (#1404)

Runs exactly **ONE** allowlisted `ps-execution` PowerShell cmdlet — by its real
**cmdlet‑catalog key** (`services/ps-execution/cmdlet-catalog.ps1`, e.g.
`get-connection-info`, `get-dlp-policies`, `get-cs-online-user`) — against a
**testbed** tenant, and writes ONE result envelope carrying the cmdlet's real
returned output. It is the **raw‑cmdlet** companion to `executeScan` (§7): where
`executeScan` runs a whole `monitor_checks` check (Graph request → mapping →
severity → persistence), `executeCmdlet` runs just the underlying Security &
Compliance / Exchange / Teams cmdlet and hands back its own output — the exact
cmdlets that back the platform's PowerShell scan checks (DLP/labels #212, audit
retention #754, Teams phone #1253).

### Why it exists (Shane's own words)
> *"we need a shaneapp:// or MCP update so the agent can run these… they are part
> of the scan system… the agent should be able to execute them itself using the
> same code path as the scanners."*

#1400/#1389 fixed the ps‑execution container's MSAL assembly conflict
(subprocess‑per‑request isolation), but the live proof — a `get-connection-info`
compliance request immediately followed by a `get-cs-online-user` teams request
against the same warm `ca-ps-execution-dev` replica — was **blocked** because a
Claude Code session's own environment correctly **refused to fetch the raw
`ps-execution-bearer-token` secret** (a reasonable live‑credential guardrail).
`executeCmdlet` is the right fix: it routes through the **same already‑authenticated
server code path the scan system uses**, which fetches/holds that secret
**server‑side** — the agent never sees it, exactly the safety pattern `executeSql`
already uses for DB credentials.

### Reuse, not reimplementation
`executeCmdlet` is a **courier**, not a second ps‑execution client. It calls the
api‑server route **`POST /api/simulator/ps-execution/cmdlet`**
(`artifacts/api-server/src/routes/admin-engines.ts`) via
`Services/CmdletExecutionClient.cs`; that route calls
`lib/ps-execution-client.callPsExecution()` — **the identical function
`monitor-executor.runPowerShellCheck()` calls** for a real PowerShell scan check.
Everything that matters lives server‑side and is therefore inherited unchanged:

- **The raw bearer secret + cert handling** — fetched once from Key Vault by
  `ps-execution-client`, never exposed to the calling agent.
- **Environment‑aware container selection (#1385)** — `getContainerUrl()` picks
  `PS_EXECUTION_CONTAINER_URL_DEV` (the isolated `ca-ps-execution-dev`) whenever
  the api‑server isn't the production tier, and **never** falls back to the
  production container from a dev context. Because `executeCmdlet` targets the
  configured **dev** api‑server (`devBaseUrl`, `http://localhost:8080`), a local
  build session's cmdlet run hits the **dev** container automatically — it cannot
  accidentally touch the production `ca-ps-execution`.
- **The cmdlet allowlist** — `cmdletKey` resolves ONLY to a fixed, code‑owned
  catalog entry container‑side; an unknown key is the container's own 400
  `unknown_cmdlet`, never something the agent can smuggle a script string past.

### The double #965 testbed gate (never a real customer tenant)
A real `Connect-IPPSSession`/`Connect-ExchangeOnline`/`Connect-MicrosoftTeams`
sign‑in against a tenant is a real confidentiality boundary, so it is gated **two
independent ways**:
1. **BuildConsole side**, before any HTTP call — `Services/TestbedGate`
   (`ResolveTestbedTargetAsync`, fail‑closed), the SAME #965 gate
   `executeScan`/`graphTests`/`powerShellVerify` use, resolving the
   caller‑supplied `tenantId` against the server's live `isTestbed=true` list.
2. **Server side**, in the route — it re‑resolves the tenant, **refuses (403)**
   anything that isn't a real `isTestbed=true`, `active` customer, and derives the
   `Organization` handed to `Connect-*` from **that gated testbed tenant's own
   domain** (`tenants.domain`, GUID fallback — exactly how `runPowerShellCheck`
   resolves it). A caller‑supplied `organization` is honored **only if it matches**
   the gated tenant, and `params.Organization` can never override it — so the
   sign‑in can never be pointed at a different org than the one that passed the gate.

### The invocation contract

```
shaneapp://executeCmdlet?cmdletKey=<catalog key>&tenantId=<testbed tenant GUID or customer id>&organization=<optional tenant domain>&resultRef=<optional out path>&src=<optional caller tag>
```

| Query param | Required | Meaning |
|-------------|----------|---------|
| `cmdletKey` | **yes** | The `ps-execution` cmdlet‑catalog key to run, e.g. `get-connection-info`, `get-cs-online-user`. Resolved container‑side against the fixed allowlist. |
| `tenantId` | **yes** | The **testbed** target — the Entra tenant GUID **or** the numeric customer id (`tenants.id`). Resolved + #965‑gated against the server's live testbed list, both client‑ and server‑side. |
| `organization` | no | The tenant **domain** for `Connect-*` (e.g. `mccawsoft2.onmicrosoft.com`). Optional — the server derives it from the gated testbed tenant when omitted; if supplied it MUST match that tenant (else the run is refused). |
| `resultRef` | no | Path to write the JSON result envelope to. Defaults to `%TEMP%\shaneapp-executeCmdlet-<cmdletKey>.result.json` (cmdlet key filename‑sanitized). |
| `src` | no | Free‑text caller tag, logged verbatim as the source (`unknown` when absent). |

The action name is the URI **authority** (`executeCmdlet`); it is case‑insensitive.

### How to invoke it (PowerShell)

```powershell
$cmdlet = "get-connection-info"                       # a real cmdlet-catalog key
$tenant = "<your-testbed-tenant-GUID-or-customer-id>"
$out    = Join-Path $env:TEMP "shaneapp-executeCmdlet-get-connection-info.result.json"
Remove-Item $out -ErrorAction SilentlyContinue        # clear any stale result first

Start-Process ("shaneapp://executeCmdlet?src=claude-code" +
  "&cmdletKey=" + [uri]::EscapeDataString($cmdlet) +
  "&tenantId="  + [uri]::EscapeDataString($tenant) +
  "&resultRef=" + [uri]::EscapeDataString($out))

# A real Connect-* sign-in + per-request child pwsh cold-start (#1400) is seconds-scale.
# Bounded FOREGROUND wait for the settled result file — see §0 (run with tool timeout 600000).
$r = Wait-ShaneAppResult -Path $out -DeadlineSec 240
"{0}: {1} items in {2}ms" -f (@{$true='OK';$false='FAIL'}[$r.ok]), $r.itemCount, $r.elapsedMs
$r.items        # ← the cmdlet's OWN returned output, to diff vs an independent read
```

### The result envelope

Written to `resultRef` (or the temp default). Top‑line `ok`/`error` a CLI agent can
branch on immediately, the resolved testbed target, and the cmdlet's own returned
output (`items` + `rawResponse` are the load‑bearing dual‑verification fields):

```jsonc
{
  "ok": true,                      // false if the gate refused / it couldn't run / the cmdlet errored
  "error": null,                   // the refusal / failure reason, else null
  "action": "executeCmdlet",
  "source": "claude-code",         // whatever ?src= was
  "ranAtUtc": "2026-08-27T...Z",
  "cmdletKey": "get-connection-info",
  "organization": "mccawsoft2.onmicrosoft.com",  // the org the SERVER connected with (gated tenant's domain)
  "tenantId": "<as supplied>",
  "customerId": 1,                 // resolved tenants.id (the gate target)
  "matchedCustomerName": "…",      // the testbed customer the gate matched
  "kind": null,                    // on failure: ps-execution-client's discriminator
                                   //   (unreachable | auth_failed | script_error | cmdlet_unavailable)
  "containerErrorKind": null,      // on failure: the container's own `error` field, when present
  "itemCount": 1,                  // number of items the cmdlet returned
  "items": [ … ],                  // ← THE CMDLET'S OWN RETURNED OUTPUT — diff THIS vs an independent read
  "rawResponse": { … },            // the container's raw JSON body (array or single object), un-normalized
  "elapsedMs": 3120,               // client-side round-trip wall clock (connect handshake INCLUDED)
  "serverElapsedMs": 3010          // server-side time around callPsExecution
}
```

> **Where the real `childElapsedMs` is.** #1400 has each child `pwsh` spawn log its
> own wall‑clock `childElapsedMs` to the **container's** console/Log Analytics — that
> is the pure per‑request cold‑start number. The envelope's `elapsedMs` /
> `serverElapsedMs` are the end‑to‑end round trip (child cold‑start **plus** the
> `Connect-*` handshake **plus** HTTP), a strict upper bound on it; read the
> container log's `childElapsedMs` field for the isolated spawn cost.

### Completing #1400/#1389's live verification (the reason this shipped)
Run the two cmdlets that exercise **different** session types against the **same
warm** `ca-ps-execution-dev` replica — a compliance connect immediately followed by
a teams connect. Both succeeding is the exact proof the subprocess‑per‑request MSAL
fix works (the old single‑process design would fail whichever session type hit a
replica second):

```powershell
$tenant = "<testbed-tenant-GUID>"   # the tenant the ps-execution app cert is registered for
foreach ($c in "get-connection-info","get-cs-online-user") {
  $out = Join-Path $env:TEMP "shaneapp-executeCmdlet-$c.result.json"
  Remove-Item $out -ErrorAction SilentlyContinue
  Start-Process ("shaneapp://executeCmdlet?src=claude-code&cmdletKey=$c&tenantId=" +
    [uri]::EscapeDataString($tenant) + "&resultRef=" + [uri]::EscapeDataString($out))
  $r = Wait-ShaneAppResult -Path $out -DeadlineSec 240
  "{0} → {1} ({2}ms, kind={3})" -f $c, (@{$true='OK';$false='FAIL'}[$r.ok]), $r.elapsedMs, $r.kind
}
```

`get-connection-info` uses the **compliance** session (`Connect-IPPSSession`);
`get-cs-online-user` uses the **teams** session (`Connect-MicrosoftTeams`) — the two
modules whose conflicting `Microsoft.Identity.Client` versions #1389 was about. Two
`OK`s = fix confirmed live.

### Settle & non‑hang guarantee
The route is synchronous (`callPsExecution` returns the cmdlet body directly — no
fire‑and‑forget run to poll), so `executeCmdlet` writes its envelope as soon as the
call returns. **Every** failure path (missing `cmdletKey`/`tenantId`, a refused gate,
a non‑testbed/org‑mismatch 4xx, a `PsExecutionError` from the container, or any thrown
exception) still writes an envelope, so an agent's file poll never hangs.

### Logging
Every invocation lands on the same **`sql-runner.protocol`** ActivityLog channel as
`executeSql`/`runTest`/`runScan`/`executeScan` (real cmdlet key, real tenant, real
outcome: gate result, ok/fail, elapsed ms, result path — or the exact reason it
couldn't run). The #965 gate additionally logs its pass/refuse on
`testing.testbed-gate`, and the server route logs the cmdlet key / org / outcome on
the `integration.ps-execution` channel (the same channel `ps-execution-client` uses).

### One‑time setup
1. The **same** `shaneapp://` registration `executeSql` uses
   (`setup-shaneapp-protocol.ps1`) already covers `executeCmdlet` — the scheme is
   registered once, all actions ride it. No extra setup.
2. The dev api‑server must be on this feature's code and have
   `PS_EXECUTION_CONTAINER_URL_DEV` set (the isolated `ca-ps-execution-dev`
   endpoint, #1385) plus reachability to Key Vault for the bearer secret — the
   same prerequisites a real dev‑tier PowerShell scan check already needs.

