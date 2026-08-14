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
