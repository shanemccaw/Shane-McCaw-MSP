# Agent → BuildConsole trigger surfaces

How an agent (a local Claude Code session, a script) hands work to the
already‑running BuildConsole. The surfaces below split deliberately along one
line: **a local agent on this machine uses the `shaneapp://` local protocol; a
genuinely remote/CI caller uses plain HTTP.**

| Need | Surface | Why this one |
|------|---------|--------------|
| **Run SQL** | `shaneapp://executeSql` local protocol | SQL runs on BuildConsole's **own direct local Postgres connection** (zero round‑trip to the deployed app); a caller that isn't on this machine can't reach it. |
| **Run a test manifest — local agent** | `shaneapp://runTest` local protocol | Runs the manifest **in‑process** through the same `RunManifestAsync` pipeline Play Test uses (ALL step types, not just uiSteps) — no HTTP hop, since the agent and BuildConsole are the same machine. |
| **Run a test manifest — remote/CI caller** | Git #898 HTTP (`/api/admin/deploy/test-run`) | For a caller **not** on this machine. Any HTTP‑capable agent calls it directly. Unchanged by `runTest`. |
| **Run a tenant scan + get per‑finding results back** | `shaneapp://runScan` local protocol *(landing under local #59)* | Triggers a real diagnostics run, **settles it to completion**, and hands back the full **per‑finding** envelope — so the agent can diff each engine observation against an independent PowerShell ground‑truth read of the same tenant fact, not merely confirm "the scan ran". The whole point is the **comparison** (see **§5** below). |

---

## 1. `shaneapp://executeSql` — local SQL trigger

### Why a protocol and not HTTP
UI test runs (#898) are exposed over HTTP because anything HTTP‑reachable can ask
for one. SQL execution is kept **off** HTTP on purpose. Every agent that runs SQL
(queue‑managed or Send‑to‑Builder) is **already on this machine**, so the SQL runs
through BuildConsole's **own direct local Postgres connection**
(`Services/LocalSqlExecutor`, Npgsql) — **zero round‑trip to the deployed dev
api‑server** (which naps every ~15 min, #931). The connection string comes from
BuildConsole's own local config (see **Connection string** below), so a caller
that isn't on this machine — and doesn't have that config — can't reach it. That's
the local‑context guarantee Shane wants for SQL. So the trigger is a
**local‑machine handoff**, not a network endpoint.

> The manual SQL Runner UI (`SqlRunnerView`, #896/#939) still uses the HTTP
> `POST /api/simulator/sql/execute` path against the configured `apiBaseUrl` — it
> has never held a local DB connection. This protocol is the first thing in
> BuildConsole to talk to Postgres directly.

### Connection string
`LocalSqlExecutor` reads the Postgres connection string from, in order:
1. a **`databaseUrl`** field in `scripts/build-queue-watcher.config.json` (next to
   `apiBaseUrl` / `ingestToken`), or
2. the **`DATABASE_URL`** environment variable.

Use the same connection string the dev api‑server itself uses. A `postgres://` /
`postgresql://` URI (Neon/Replit/Supabase style, with `?sslmode=require`) is
accepted and converted to Npgsql form; an Npgsql key/value string is used as‑is.
When **neither** is set, `executeSql` writes an `ok:false` result whose `error`
says exactly that — it never silently no‑ops.

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

# Poll for the result file, then read it:
$out = "$ref.result.json"
while (-not (Test-Path $out)) { Start-Sleep -Milliseconds 200 }
Get-Content $out -Raw | ConvertFrom-Json
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
  SQL through its own **direct local Postgres connection** (`LocalSqlExecutor`,
  per‑statement, continue‑on‑error) → write the result envelope.
- If **no** instance is running, the launch becomes a real cold start that handles
  the URI itself once it's up.

### Logging
Every invocation lands on the **`sql-runner.protocol`** ActivityLog channel
(watch it live in BuildConsole's Activity log) — the parse, the source/action/ref,
the run (including the log‑safe local‑DB target — host/port/db/user, never the
password), and the real outcome (statements ok/failed, elapsed ms, result path), or
the exact reason it couldn't run (malformed URI, missing/empty/oversized payload,
no `databaseUrl`/`DATABASE_URL` configured, or a connection failure).

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
shaneapp://runTest?file=<manifest filename>&resultRef=<optional out path>&src=<optional caller tag>
```

| Query param | Required | Meaning |
|-------------|----------|---------|
| `file` | **yes** | Manifest to run. A bare `{feature}.json` filename resolved by searching `test-manifests/` recursively (the same resolution #898/#964 use since #960 moved manifests into `{area}/` subdirs); an absolute or repo‑relative existing path is honored directly too. (`ref=` is accepted as a fallback alias for this.) |
| `resultRef` | no | Path to write the JSON result envelope to. Defaults to `%TEMP%\shaneapp-runTest-<file>.result.json` (predictable, so a caller can read it without passing `resultRef`). |
| `src` | no | Free‑text caller tag, logged verbatim as the source (`unknown` when absent). |

The action name is the URI **authority** (`runTest`/`uiTest`); it is case‑insensitive.

### How to invoke it (PowerShell)

```powershell
$file = "hello-world-ui.json"
$out  = Join-Path $env:TEMP "shaneapp-runTest-$file.result.json"
Remove-Item $out -ErrorAction SilentlyContinue   # clear any stale result first

Start-Process ("shaneapp://runTest?src=claude-code&file=" + [uri]::EscapeDataString($file))

# Poll for the fresh result file, then read it:
while (-not (Test-Path $out)) { Start-Sleep -Milliseconds 300 }
$r = Get-Content $out -Raw | ConvertFrom-Json
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
   **changes**, or a timeout.
4. Prints old hash, new hash, and **real elapsed time**, so you know definitively
   the dev server is on your latest push before moving on to tests.

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
.\trigger-deploy-and-wait.ps1 -ApiBaseUrl https://your-dev-server -TimeoutSeconds 240
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
  hash never flipped within the timeout (nothing new to pull, or the restart
  didn't complete). Either way it says plainly the server is **not** confirmed on
  new code, so you don't run tests against stale code by mistake.

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
while (-not (Test-Path $out)) { Start-Sleep -Milliseconds 300 }
$scan = Get-Content $out -Raw | ConvertFrom-Json

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
