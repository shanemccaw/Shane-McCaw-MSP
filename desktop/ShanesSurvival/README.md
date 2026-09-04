# Shane's Survival

A personal financial survival tracker — real Plaid-connected accounts, transactions, manually
tracked debts, and point-in-time snapshots. Standalone WPF (.NET 8) desktop app, own local
Postgres database. **Not part of, and has no dependency on, the Shane-McCaw-MSP or
Finance-Tracker repos** — no shared code, schema, or conventions with either.

> **Why this lives under `desktop/` in Shane-McCaw-MSP:** this is Shane's personal project, not
> MSP business code. It started life in its own standalone local repo
> (`C:\Source\ShanesSurvival`); it was copied in here purely for real, convenient tracking
> alongside the rest of Shane's work (issue/build-journal history, one place to find it) — not
> because it's part of the MSP product. The statement above still holds: nothing here shares
> code, schema, or conventions with the rest of this repo.

## Status

Schema, connection/migration handling, and real Plaid Link + sync are all built. It is real,
working code — not a mockup — but the feature scope so far is intentionally limited to what's
described below. See ["What's not built yet"](#whats-not-built-yet-later-dispatches).

## Running it

Requirements:
- .NET 8 SDK
- A reachable Postgres server (any Postgres 13+; developed against a local Postgres 18 install)
- [Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)
  for the Plaid Link window (pre-installed on current Windows 10/11; only matters on an older
  or locked-down machine)
- A real Plaid account (sandbox is free) if you want to use Link/Sync — see
  [Plaid setup](#plaid-setup) below

Steps:

1. **Create a database** for the app, e.g.:
   ```
   psql -h localhost -U postgres -c "CREATE DATABASE shanessurvival;"
   ```
2. **Build and run the app**:
   ```
   dotnet build ShanesSurvival.sln
   dotnet run --project src/ShanesSurvival.App
   ```
3. On first launch, open **Settings…** and enter the Postgres connection string, e.g.:
   ```
   Host=localhost;Port=5432;Database=shanessurvival;Username=postgres;Password=<password>
   ```
   Settings are saved to `%AppData%\ShanesSurvival\settings.json` — a per-user file **outside**
   this repo, never hardcoded in source, never logged. The app reads that file on every
   startup/refresh; it is never checked into git (see `.gitignore`).
4. **Schema setup is automatic** — no manual `psql -f` step. After a successful connection
   check (on startup, and every time "Recheck Connection" is clicked), the app reads every
   `migrations/*.sql` file in filename order and applies any that haven't run yet, tracked in
   a real `schema_migrations` table it creates on first use. Re-running is always a safe
   no-op — already-applied files are skipped, never re-executed. You can also trigger this
   manually any time with the **"Apply Migrations"** button.
5. The main window shows real, live connection and migration status:
   - **Gray** — no connection string configured yet (open Settings).
   - **Red** — configured, but Postgres is unreachable (wrong host/creds/port, server down).
     The real Npgsql error text is shown (Npgsql doesn't include the password in that text).
   - **Orange** — connected, but the schema is still missing tables (only possible if
     migrations failed to apply — the migration status box below explains why).
   - **Green** — connected, schema present. Click "Recheck Connection" any time to re-verify.

   The migration status box reports exactly which files ran, which were already applied, and
   — if one fails partway through — the failing filename and the real Postgres error, without
   crashing the app.

There is no silent failure state: every outcome above is a distinct, explicit result the UI
states plainly.

## Plaid setup

1. Create a free [Plaid developer account](https://dashboard.plaid.com/signup) and grab your
   **Client ID** and a **Secret** for the environment you want to use (sandbox is fine to
   start — it uses fake bank logins, no real bank account needed).
2. Open **Settings…** in the app and fill in the **Plaid** section: Client ID, Secret,
   Environment (`sandbox`/`development`/`production`). Same storage rule as the Postgres
   connection string — saved only to `%AppData%\ShanesSurvival\settings.json`, never
   hardcoded, never logged.
   - Plaid retired `development` as its own API host in 2023; the app sends
     `development`/`production` credentials to the same `production.plaid.com` endpoint, only
     `sandbox` gets its own host — this matches Plaid's current setup, not a limitation of
     this app.
3. Click **"Link Bank Account"** on the main window. This opens a real window hosting Plaid's
   own hosted Link flow (embedded via WebView2 — Plaid has no native desktop SDK, so this is
   the standard way to run Link outside a browser). Pick an institution and complete the flow;
   in sandbox, use Plaid's test credentials (`user_good` / `pass_good` works for most sandbox
   institutions).
4. On success, the app exchanges the real `public_token` Link returns for a real
   `access_token` and stores it in `plaid_items` (keyed on Plaid's own Item ID, so relinking
   the same institution updates the existing row instead of duplicating it).
5. Click **"Sync Now"** any time to pull real account balances (`/accounts/balance/get`) and
   real transactions via Plaid's current cursor-based `/transactions/sync` endpoint (not the
   older `/transactions/get`) into `accounts`/`transactions`. The sync cursor is persisted per
   item in `plaid_items.sync_cursor`, so every sync after the first is a real incremental
   pull, not a full re-fetch — and re-clicking "Sync Now" with nothing new from Plaid is a
   real, safe no-op. `plaid_items.last_synced_at` is updated after each successful sync.

The Plaid status box on the main window reports exactly what happened: which institution
linked, account/transaction counts per sync, or — if a step fails — the real error message
from Plaid or Postgres, without crashing the app.

## Schema

Defined in [`migrations/001_init.sql`](migrations/001_init.sql),
[`migrations/002_plaid_sync.sql`](migrations/002_plaid_sync.sql), and
[`migrations/003_account_roles.sql`](migrations/003_account_roles.sql):

| Table | Purpose |
|---|---|
| `plaid_items` | One row per linked Plaid Item (institution connection) — Plaid's own `plaid_item_id` (unique, added in 002), access token, institution name, `sync_cursor` (added in 002 — the `/transactions/sync` cursor), sync timestamps. |
| `accounts` | Bank/credit accounts under a Plaid Item — balances, type/subtype, and (added in 003) `role` (`income_gate` / `bill` / `spend`, Shane-assigned — never inferred from name/type), `target_amount` (the real monthly bill figure, bill accounts only), `is_gate` (marks the GATE-tier bill accounts — mortgage, Tesla — for distinct dashboard treatment). |
| `transactions` | Transactions under an account — amount, date, merchant, category, pending flag. |
| `debts` | **Manually entered by Shane, not sourced from Plaid.** Real debts, collections, and garnishments often don't show up cleanly in Plaid transaction data — creditor, balance, minimum payment, delinquency status, days past due, notes. |
| `survival_snapshots` | A point-in-time manual snapshot Shane can save of his overall position — total cash, total debt, monthly income, monthly fixed costs, notes. |

All tables use `UUID` primary keys (`gen_random_uuid()`, built into Postgres 13+ core — no
extension required) and `TIMESTAMPTZ` for timestamps. Foreign keys cascade on delete
(`accounts.plaid_item_id → plaid_items.id`, `transactions.account_id → accounts.id`).

Future schema changes should follow the same pattern: a new `migrations/00N_<description>.sql`
file, hand-written — never `drizzle-kit`, EF Core migrations, or any other ORM-driven migration
tool. Drop it in `migrations/` and the app picks it up and applies it automatically on next
launch (or via "Apply Migrations"); no manual `psql` step needed. Like `001_init.sql`, keep
new migrations idempotent (`CREATE TABLE/INDEX IF NOT EXISTS`, etc.) — `MigrationRunner`
records a file as applied only after it fully commits, so a migration should be safe to
re-attempt if the app were ever killed in between.

## Project structure

```
ShanesSurvival.sln
migrations/
  001_init.sql
  002_plaid_sync.sql
  003_account_roles.sql
src/
  ShanesSurvival.App/            — WPF (net8.0-windows) desktop shell, see below
  ShanesSurvival.Core/           — net8.0 class library: settings + Dashboard shortfall math +
                                    account/transaction reads, shared by App and Mcp so neither
                                    reimplements the other's queries
  ShanesSurvival.Mcp/            — net8.0 console app: the real local MCP server, see below

  ShanesSurvival.App/
    App.xaml(.cs)
    MainWindow.xaml(.cs)        — shell window: connection/migration status, Link, Sync Now,
                                  Assign Account Roles, Open Dashboard
    Settings/
      SettingsWindow.xaml(.cs)  — dialog for entering connection string + Plaid credentials
                                  (AppSettings/SettingsService now live in ShanesSurvival.Core)
    Data/
      DatabaseConnectionTester.cs — real Npgsql connect + required-table check
      MigrationRunner.cs          — applies migrations/*.sql in order, tracked in schema_migrations
    Plaid/
      PlaidCredentials.cs   — client ID/secret/environment + base URL selection
      IPlaidClient.cs       — Plaid REST boundary interface + domain types (for real testing without live credentials)
      PlaidClient.cs        — real HTTP implementation (link/token/create, exchange, balance/get, transactions/sync)
      PlaidLinkService.cs   — creates a Link token; exchanges public_token and stores the item
      PlaidSyncService.cs   — pulls accounts/balances + paged transactions/sync into Postgres
      PlaidLinkWindow.xaml(.cs) — WebView2 window hosting Plaid's real hosted Link flow
    Accounts/
      AccountRoleWindow.xaml(.cs) — dialog to assign role/target/GATE per synced account
                                     (AccountRole/AccountRepository now live in ShanesSurvival.Core)
    Dashboard/
      DashboardWindow.xaml(.cs) — top-line covered/short, GATE cards, bills, spend bleed by merchant
                                   (DashboardModels/DashboardService now live in ShanesSurvival.Core)

  ShanesSurvival.Core/
    Settings/
      AppSettings.cs            — settings shape (Postgres connection string, Plaid credentials)
      SettingsService.cs        — load/save %AppData%\ShanesSurvival\settings.json
    Accounts/
      AccountRole.cs             — income_gate / bill / spend vocabulary
      AccountRepository.cs       — real read/write of accounts.role / target_amount / is_gate
    Dashboard/
      DashboardModels.cs   — real result shapes (BillStatus, SpendAccountBleed, DashboardResult)
      DashboardService.cs  — real shortfall math computed live off Postgres balances/transactions
                              (the same math both the WPF Dashboard and the MCP server use —
                              never reimplemented a second time)
    Transactions/
      TransactionRepository.cs — real, bounded, most-recent-first transaction reads per account

  ShanesSurvival.Mcp/
    Program.cs             — real local MCP server entry point (stdio transport)
    Tools/FinanceTools.cs  — the 4 real read-only MCP tools, see below
```

## MCP server (Claude Desktop)

`ShanesSurvival.Mcp` is a real local [MCP](https://modelcontextprotocol.io/) server (stdio
transport, built on the official `ModelContextProtocol` .NET SDK) so Claude Desktop can answer
real questions grounded in this app's own real Postgres data — the same connection string from
`%AppData%\ShanesSurvival\settings.json`, never hardcoded or logged. **Read-only in this pass —
no write tools.** All 4 tools reuse `ShanesSurvival.Core`'s `DashboardService`/`AccountRepository`/
`TransactionRepository` directly; none of the GATE shortfall or bleed math is re-derived here.

Real tools exposed:

| Tool | What it returns |
|---|---|
| `gate_status` | Income Gate (Direct Deposit) real balance vs. total real shortfall across every bill account — covered, or short by $X — plus the two GATE-tier bills (mortgage, Tesla). |
| `bill_status` | Every Bill-role account: real target vs. real current Plaid balance and the real shortfall, GATE-tier called out separately, sorted worst-shortfall-first. |
| `spend_bleed` | The 2 spend accounts' real transactions from the last 30 days, grouped and summed by merchant. |
| `recent_transactions` | Bounded, most-recent-first real transactions for one named account (`accountName`, `limit` up to 100). |

Build it:

```
dotnet build ShanesSurvival.sln
```

The server binary lands at `src\ShanesSurvival.Mcp\bin\Debug\net8.0\ShanesSurvival.Mcp.exe`
(or `bin\Release\net8.0\...` after a Release build). It requires no arguments — on launch it
reads the real Postgres connection string from `%AppData%\ShanesSurvival\settings.json` (same
file, same rule as the WPF app: never hardcoded, never logged) and speaks MCP over stdio. All
log output goes to stderr, never stdout, so it never corrupts the JSON-RPC stream.

To point Claude Desktop at it, add an entry to Claude Desktop's `claude_desktop_config.json`
(Windows: `%AppData%\Claude\claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "shanes-survival": {
      "command": "C:\\path\\to\\ShanesSurvival\\src\\ShanesSurvival.Mcp\\bin\\Release\\net8.0\\ShanesSurvival.Mcp.exe"
    }
  }
}
```

(Use the real path to wherever this repo actually lives, and a Release build for day-to-day use.)
Restart Claude Desktop after editing the config — it launches the server as a subprocess per
session, so no separate "start the server" step is needed. `%AppData%\ShanesSurvival\settings.json`
must already have a real Postgres connection string configured (Settings… in the WPF app) for
the tools to return real data instead of a "no connection string configured" message.

**Live-verified, for real:** a real `initialize` → `tools/list` → `tools/call` MCP session driven
over the server's actual stdin/stdout pipes (not a mock) confirmed all 4 tools register with
correct schemas and execute against the real local Postgres database — `gate_status`,
`bill_status`, and `spend_bleed` each returned real, honest "no account assigned this role yet"
warnings (the real current state: no account has Income Gate/Bill/Spend roles assigned yet in
the connected database), and `recent_transactions` correctly reported "no account named ... —
none synced yet" for an unassigned name. This run caught and fixed a real bug in-session:
`InvariantGlobalization` in the project file made `CultureInfo.GetCultureInfo("en-US")` throw at
runtime (surfaced as MCP's generic "An error occurred invoking 'gate_status'"); removed, and all
4 tools were re-verified clean afterward.

## Dashboard — account roles, targets, and shortfall math

Real account structure: exactly one `income_gate` account (Direct Deposit — all income lands
here), ~10+ `bill` accounts (one per real bill), and 2 `spend` accounts (one per household).
Role and `target_amount` are never inferred from a Plaid account's name/type — open
**"Assign Account Roles…"** on the main window (after a real Link + Sync Now) and set them
explicitly, once per account. The two real GATE-tier bills (mortgage, Tesla) get their `GATE`
checkbox checked there too, for distinct always-visible treatment on the dashboard.

**"Open Dashboard"** then shows, computed live off real Plaid balances in Postgres (not
transaction inference — funding happens manually/irregularly, so balances are the honest
signal):

- Per bill account: `shortfall = max(0, target_amount - current_balance)`
- Total shortfall = sum across every bill account (a bill missing its target or balance is
  excluded from the sum and called out under Notes, never silently treated as $0)
- Top line: Income Gate's real balance minus total shortfall — "Covered" or "Short by $X"
- The two GATE cards, always visible, separate from the other bill accounts
- The rest of the bill accounts, sorted worst-shortfall-first
- A spend bleed view scoped to the 2 spend accounts only — real transactions from the last 30
  days, grouped and summed by merchant so a pattern (e.g. many small charges at one merchant)
  is visible at a glance

**Refresh** on the dashboard reuses the existing Sync Now → `PlaidSyncService` path, then
recomputes off the fresh balances. Opening the dashboard itself does not trigger a sync — it
renders current Postgres state; click Refresh to pull fresh Plaid data first.

## What's NOT built yet (later dispatches)

Deliberately out of scope for this build:

- Automatic/background sync — "Sync Now" (and the dashboard's "Refresh") are manual clicks;
  no scheduled sync yet.
- Multi-item UI beyond a plain per-institution status line — no per-account view outside the
  Assign Account Roles dialog, no reconnect/update-mode Link flow for an expired login yet.
- `debts` and `survival_snapshots` (manual entry) have no UI yet — schema only.

## What was and wasn't live-verified

Plaid Link/sync were built and reviewed against Plaid's real, documented REST API shapes (and
cross-checked against `Finance-Tracker`'s proven `plaid.ts` route for the parts it shares —
Link token creation, public_token exchange, and `/accounts/balance/get`; that reference itself
uses the older `/transactions/get`, so the `/transactions/sync` cursor-paging logic here was
built directly from Plaid's API docs, not copied from anywhere). What was and wasn't actually
exercised, honestly:

- **Live-verified, for real:** `dotnet build` clean; the app launching with the new UI and no
  crash; migration 002 applying to a fresh Postgres database; and the full database-writing
  path — item upsert on exchange, account upsert, paged transaction upsert, removed-transaction
  delete, cursor persistence across syncs, and a second sync being a real safe no-op — run
  against a real local Postgres database, with a stand-in for just the Plaid HTTP layer
  (`IPlaidClient`) since no Plaid credentials were configured in `%AppData%\ShanesSurvival\settings.json`
  at the time.
- **Not live-verified:** an actual `/link/token/create` call, an actual completed Link session
  in the WebView2 window (bank selection, sandbox login, `onSuccess`), and an actual
  `/transactions/sync` call against Plaid's real servers. None of this could be exercised
  without real Plaid credentials and Shane present to click through Link's UI. Add a Client
  ID/Secret in Settings and click "Link Bank Account" to complete that path for real.

Dashboard (account roles + shortfall math, added on top of the above):

- **Live-verified, for real:** `dotnet build` clean; migration 003 applying to the real local
  database (`accounts.role` / `target_amount` / `is_gate` confirmed present via `\d accounts`);
  and the exact SQL text `DashboardService`/`AccountRepository` run — the role-scoped account
  queries, the merchant-bleed query, and the joined account-listing query — executed against a
  realistic fixture (one Income Gate account, GATE + non-GATE bills including one with no
  target set, 2 spend accounts, dated transactions including a refund and an out-of-window
  transaction) inside a transaction that was rolled back afterward, leaving the real database
  untouched. The returned rows were hand-traced through the shortfall/top-line/sort logic and
  matched exactly: Mortgage short $1,200, Tesla short $150, Electric short $100, Water covered,
  Cable flagged "target not set" and excluded from the total, total shortfall $1,450, top line
  Covered by $50.00 (income $1,500 − $1,450), GATE cards ordered Mortgage before Tesla, and the
  spend-bleed grouping correctly summed 7-Eleven across 3 charges while excluding the refund and
  the 45-day-old transaction.
- **Not live-verified:** no bank account has actually been linked/synced yet in the real local
  database (`accounts`/`plaid_items` are still empty — Plaid credentials are configured but
  "Link Bank Account" hasn't been run), so the app's own UI has not yet rendered this dashboard
  against real, currently-synced Shane data end-to-end. Link a real account, Sync Now, assign
  roles/targets in "Assign Account Roles…", then open the dashboard to complete that path for
  real.

## Data policy

- No fixture/hardcoded financial data anywhere in this app.
- Every row shown to Shane comes from the database, not from source.
- Postgres connection string and Plaid credentials (Client ID, Secret) are never hardcoded in
  source and never logged — they live only in `%AppData%\ShanesSurvival\settings.json`.
- Real Plaid access tokens (one per linked institution) live only in `plaid_items.access_token`
  in Postgres — never logged, never written anywhere else.
