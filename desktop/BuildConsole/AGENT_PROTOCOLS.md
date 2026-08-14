# Agent → BuildConsole trigger surfaces

How an agent (a local Claude Code session, a script) hands work to the
already‑running BuildConsole. There are **two** surfaces, and the split is
deliberate — one is a local‑machine protocol, the other is plain HTTP.

| Need | Surface | Why this one |
|------|---------|--------------|
| **Run SQL** | `shaneapp://executeSql` local protocol | SQL runs on BuildConsole's **own direct local Postgres connection** (zero round‑trip to the deployed app); a caller that isn't on this machine can't reach it. |
| **Run a UI test manifest + get results** | Git #898 HTTP (`/api/admin/deploy/test-run`) | Already covers it. **No protocol needed** — any HTTP‑capable agent calls it directly. |

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

## 2. UI test execution — use Git #898 HTTP directly (no protocol)

There is **no** `shaneapp://runTest`, and none is needed. Git #898 already exposes
UI‑test execution over plain HTTP, so any HTTP‑capable agent drives it directly
against the dev api‑server. Same bearer token BuildConsole/Build Tracker use
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
