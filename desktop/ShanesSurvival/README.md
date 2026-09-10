# Shane's Survival

A standalone WPF (.NET 8) desktop app, own local Postgres database. **Not part of, and has no
dependency on, the Shane-McCaw-MSP or Finance-Tracker repos** — no shared code, schema, or
conventions with either.

> **Why this lives under `desktop/` in Shane-McCaw-MSP:** this is Shane's personal project, not
> MSP business code. It started life in its own standalone local repo
> (`C:\Source\ShanesSurvival`); it was copied in here purely for real, convenient tracking
> alongside the rest of Shane's work (issue/build-journal history, one place to find it) — not
> because it's part of the MSP product. The statement above still holds: nothing here shares
> code, schema, or conventions with the rest of this repo.

## Status — real, narrowed role (#3296, 2026-09-10)

**This app's real financial core (accounts, bills, debts, income, the GATE/shortfall math,
Plaid Link/Sync, pay-period plans, the local MCP server exposing all of it) has been fully
removed.** That was a real, phased, multi-issue decision — #3293 (Feature: ShanesSurvival/
shanes-life financial-core unification, Option C): the financial core migrates fully into
[`web/shanes-life`](../../web/shanes-life/), which becomes the sole hosted source of truth for
money, and this WPF app narrows to the ad synthesizer plus any future genuinely
browser-automation-only work. The phases:

1. **#3294 — Phase 1, schema/drift audit.** Confirmed zero compatibility risk between this
   app's schema and shanes-life's own migrations.
2. **#3295 — Phase 2, the real data migration.** `web/shanes-life/bin/migrate-financial-core-data.mjs`
   copied all 1298 real rows across the 11 financial-core tables into shanes-life's real
   production Postgres — Shane ran the actual `--execute` himself (the issue's own hard gate:
   an agent session never runs this against his real live financial data without his explicit
   go-ahead). Real, verified row-count parity confirmed 2026-09-09.
3. **#3296 (this document) — Phase 3, WPF narrowing.** Every financial read/write code path is
   gone from this app — see "What was removed" below.
4. **#3297 — Phase 4, live cutover verification** (Shane's own manual confirmation that
   shanes-life's Money room shows the real, correctly-migrated data) is separate, later work,
   not part of this narrowing.

**What this app is now, concretely:**

- **Weekly Ad (Publix) scraper** (#3288) — real WebView2 automation reading a store's real
  rendered weekly-ad page and pushing extracted deals/coupons through shanes-life's own MCP
  pipeline (`push_deals`/`push_coupons`). See "Weekly Ad" below — unchanged by this narrowing.
- **Local Postgres connection + migration runner infrastructure** — kept (see "Local database"
  below), even though no current feature reads or writes financial data through it.
- Everything else — Dashboard, GATE/shortfall, bills/debts UI, Plaid Link/Sync/Backfill, income
  tracking, pay-period plans, expected one-time events, and the local `ShanesSurvival.Mcp`
  server that exposed all of it — is **removed**. shanes-life is the real, sole place for all of
  that now.

### What was removed (#3296)

Every file under these paths, plus the `AssignRolesButton`/`OpenDashboardButton`/
`LinkBankAccountButton`/`SyncNowButton`/`BackfillNamesButton` UI and their handlers in
`MainWindow`, plus the Plaid section of `SettingsWindow` (Client ID/Secret/Environment/
`PlaidClientUserId` — all removed from `AppSettings` too):

- `src/ShanesSurvival.App/Accounts/` (`AccountRoleWindow`)
- `src/ShanesSurvival.App/Dashboard/` (`DashboardWindow`)
- `src/ShanesSurvival.App/Plaid/` (all of it — `IPlaidClient`, `PlaidClient`,
  `PlaidCredentials`, `PlaidJsonModels`, `PlaidLinkService`, `PlaidLinkWindow`,
  `PlaidSyncService`, `PlaidBackfillService`)
- `src/ShanesSurvival.Core/Accounts/` (`AccountRepository`, `AccountRole`)
- `src/ShanesSurvival.Core/Dashboard/` (`DashboardModels`/`DashboardService`,
  `PayPeriodDueModels`/`PayPeriodDueService`, `PayPeriodForecastModels`/`PayPeriodForecastService`)
- `src/ShanesSurvival.Core/Debts/` (`DebtRepository`)
- `src/ShanesSurvival.Core/ExpectedEvents/` (`ExpectedEventRepository`)
- `src/ShanesSurvival.Core/Income/` (`IncomeModels`, `IncomeRepository`)
- `src/ShanesSurvival.Core/PayPeriodPlans/` (`PayPeriodPlanModels`, `PayPeriodPlanRepository`)
- `src/ShanesSurvival.Core/Transactions/` (`TransactionRepository`, `TransactionTagRepository`)
- **`src/ShanesSurvival.Mcp/` — the entire project**, removed from `ShanesSurvival.sln`. All 4
  read tools (`gate_status`/`bill_status`/`spend_bleed`/`recent_transactions`) and all 4
  Pay-Period Plan write tools were built entirely on top of the repositories above — with those
  gone, the server had no non-financial purpose left to expose. If Claude Desktop needs
  grounded access to Shane's real financial data going forward, that's shanes-life's own
  existing MCP server (already used by the weekly-ad pipeline), not a second local one.

**Migration files under `migrations/` were left untouched** — history isn't rewritten, and the
real financial tables in this app's own local `finances` Postgres database were **not dropped**.
They're inert now (nothing in this app reads or writes them, and shanes-life's production
database is the real source of truth), kept only as a harmless, already-migrated local copy.
Dropping them is a separate, genuinely destructive decision (out of this issue's real scope,
which was about removing *code* read/write paths) — Shane's call if/when he wants that cleanup.

### Local database — what it's actually needed for now (real scoping, not a guess)

Traced directly from the code that's left, not assumed: the Weekly Ad scraper does **not** read
or write this app's own local Postgres at all — `WeeklyAdScraperWindow` → `PublixAdParser` (pure
text parsing, no I/O) → `ShanesLifeMcpClient`, which pushes straight to shanes-life's remote MCP
endpoint. Nothing else remains in the app.

**Real, honest conclusion: as of this narrowing, no feature in this app reads or writes its own
local Postgres database.** The connection string field, `DatabaseConnectionTester`, and
`MigrationRunner` are kept because removing local database *infrastructure* wasn't part of this
issue's real scope (which was financial read/write removal + scoping, not "does WPF need a
database at all") and because it's cheap, harmless standing infrastructure for whatever the
app's next real browser-automation feature turns out to need (e.g. #3245, deferred — DOM
injection for NFCU/Capital One transfer automation, which itself is unlikely to need local
storage either, since it acts directly against a live bank site). If Shane wants this
connection/migration UI removed entirely rather than kept dormant, that's a real product call
for him to make — not guessed at here.

## Running it

Requirements:
- .NET 8 SDK
- A reachable Postgres server (any Postgres 13+; developed against a local Postgres 18 install)
  — only needed for the connection/migration status UI; no current feature writes to it (see
  above)
- [Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)
  for the Weekly Ad scraper window (pre-installed on current Windows 10/11; only matters on an
  older or locked-down machine)

Steps:

1. **Create a database** for the app (optional now — only the connection/migration status UI
   uses it). The real, live database this app historically ran against is named `finances`
   (that's what `%AppData%\ShanesSurvival\settings.json` contains):
   ```
   psql -h localhost -U postgres -c "CREATE DATABASE finances;"
   ```
2. **Build and run the app**:
   ```
   dotnet build ShanesSurvival.sln
   dotnet run --project src/ShanesSurvival.App
   ```
3. On first launch, open **Settings…** and enter the Postgres connection string, e.g.:
   ```
   Host=localhost;Port=5432;Database=finances;Username=postgres;Password=<password>
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

## Project structure

```
ShanesSurvival.sln
migrations/                    — historical schema (financial tables now inert, see above)
src/
  ShanesSurvival.App/            — WPF (net8.0-windows) desktop shell, see below
  ShanesSurvival.Core/           — net8.0 class library: settings + shared repositories

  ShanesSurvival.App/
    App.xaml(.cs)
    MainWindow.xaml(.cs)        — shell window: connection/migration status, Settings,
                                  Weekly Ad (Publix)
    Settings/
      SettingsWindow.xaml(.cs)  — dialog for entering the Postgres connection string and
                                  Shane's Life API base URL / MCP token
    Data/
      DatabaseConnectionTester.cs — real Npgsql connect + required-table check
      MigrationRunner.cs          — applies migrations/*.sql in order, tracked in schema_migrations
    Groceries/                    — (#3288)
      WeeklyAdScraperWindow.xaml(.cs) — real WebView2 window: Shane browses Publix's real weekly-ad
                                         page like a normal browser, then Extract & Push Deals reads
                                         the rendered DOM and pushes through shanes-life's own MCP
                                         pipeline (see Weekly Ad section below)

  ShanesSurvival.Core/
    Settings/
      AppSettings.cs            — settings shape (Postgres connection string, Shane's Life API
                                   base URL + MCP token)
      SettingsService.cs        — load/save %AppData%\ShanesSurvival\settings.json
    Groceries/                      — (#3288)
      ScrapedAdModels.cs            — RawAdCard (raw DOM read), ScrapedDealItem/ScrapedCouponItem
                                       (same shapes push_deals/push_coupons already accept)
      PublixAdParser.cs             — pure text parsing, raw card -> deal/coupon; no I/O, real
                                       unit-testable without a live WebView2 session
      WeeklyAdCredentials.cs        — Shane's Life API base URL + MCP bearer token, from Settings
      ShanesLifeMcpClient.cs        — real JSON-RPC client for shanes-life's own remote MCP
                                       server (POST /mcp) — push_deals/push_coupons, no second
                                       storage path
```

## Weekly Ad — real WebView2 scraping (#3288)

The WPF app's own real, narrowed role (per shanes-life's contract pack, Section 1:
"exploring WebView2 automation to pull real coupon and weekly-ad data") — a real local
automation source for the same cross-store price comparison already built and working in
shanes-life's Shopping room, instead of Shane manually feeding a flyer into a Claude
conversation every week. First real store, per Shane's own confirmation: **Publix** — he
actually shops there (see build-journal/3152.md, 3184.md). Additional stores are separate,
later issues, not assumed to generalize automatically — each store's ad page has its own real
layout.

**How it works**, from **"Weekly Ad (Publix)…"** on the main window:

1. Opens a real WebView2 window navigated to `https://www.publix.com/savings/weekly-ad/view-all`
   — Publix's own real weekly-ad page. Its price data is genuinely client-rendered (confirmed
   live, 2026-09-08 — the raw HTML ships only skeleton-loader markup; real items load via
   Publix's own Vuex-store JS after the page picks up a selected store).
2. This is a real, ordinary browser window — Shane browses it like any browser, confirming/
   picking his real store the first time (persisted in a dedicated WebView2 profile under
   `%AppData%\ShanesSurvival\WebView2WeeklyAd`, so it isn't re-asked every run) and waiting for
   the ad to actually render. No attempt is made to automate Publix's own store-picker UI —
   real steps that genuinely need Shane's own hands, not a scripted guess.
3. **"Extract & Push Deals"** then reads the real rendered DOM (bounded poll, 20s, for the ad
   grid to actually contain cards — never an indefinite wait), parses each card
   (`PublixAdParser`, pure text parsing, no I/O), and pushes what it finds through
   **shanes-life's own existing real MCP pipeline** — `push_deals`/`push_coupons` (Git #3110),
   the same pipeline manual flyer-reading already used. This app is just another real MCP
   client speaking the same JSON-RPC protocol Claude Code/Desktop already speak to that server
   (`POST {base}/mcp`, `Authorization: Bearer slmcp_...`) — not a second, parallel storage path.

**Setup** (Settings… → "Shane's Life"):
- **API base URL** — the real shanes-life deployment's public origin (its `PUBLIC_ORIGIN`).
- **MCP token** — mint one against that real deployment with
  `npm run issue-mcp-token -- --email you@example.com --label "ShanesSurvival Weekly Ad"`
  (see `web/shanes-life/bin/issue-mcp-token.mjs`), or from that app's own Settings screen. Same
  storage rule as everything else here: saved only to `%AppData%\ShanesSurvival\settings.json`,
  never hardcoded, never logged.

**Real, honest maintenance note (from the issue itself):** store ad pages change layout
periodically. `WeeklyAdScraperWindow.ExtractionScript`'s selectors
(`.weekly-ad-card-grids .card-grid`, `.savings-badge`) were read directly off Publix's real, live
page on 2026-09-08 via its own shipped skeleton-loader markup and its `pb_SavingsInitializeComponent`
JS bundle (which also exposes a real, separate `services.publix.com/api/v4/savings` JSON API —
deliberately not used here: it requires a bearer token whose real acquisition flow isn't
reverse-engineered, and DOM extraction over an already-authenticated real browser session is the
same real approach the issue itself asks for). A Publix redesign breaking this is expected
occasional upkeep, not a defect to chase to zero — `PublixAdParser` reports every card it
couldn't parse by name rather than silently dropping or guessing at it, so a layout change shows
up as a real, visible "skipped N card(s)" in the status line instead of a quiet gap.

**Category/ImageUrl (Git #3310):** `push_deals`/`push_coupons` now accept a real `category`,
`imageUrl` and free-form `dealType`, and `item_prices` now carries a `valid_to` alongside its
existing `observed_on`, matching `coupons`' own `valid_from`/`valid_to` pair. The Publix scraper
wires only `imageUrl` through — the same `img[alt]` element `ExtractionScript` already reads the
card's title from also carries a real `src`, so pulling it needed no new selector. No per-card
category grouping was found in Publix's real rendered DOM in this pass (not live-verified — no
interactive WebView2/browser session was available in that headless build); `category`/`dealType`
exist on the pipeline for Claude's own conversational flyer reads and any future store whose ad
page does expose one, not populated by the Publix scraper today.

**What was and wasn't live-verified:** `PublixAdParser`'s real parsing logic (plain price,
"N for $X" multi-buy, "$X off" discount vs. a sale price that happens to contain the same digits,
BOGO, and an unparseable card correctly reported as skipped rather than guessed) was run for real
against representative fixture text in a scratch harness and passed — that harness (and its
temporary project file) was deleted afterward, not committed; it exercises no I/O so there is
nothing left to keep. **Not live-verified:** an actual WebView2 session against Publix's real
live page, a real store pick-and-confirm, and a real end-to-end push into a real Shopping list —
none of this could be exercised without an interactive Windows desktop session to click through
(this build ran headless). Open "Weekly Ad (Publix)…", pick your store, wait for the ad to
render, and click Extract to complete that path for real.

## What's NOT built (later dispatches, if ever)

- Additional stores beyond Publix — each store's ad page has its own real layout; not assumed
  to generalize automatically.
- #3245 (deferred) — WebView2 + DOM injection for NFCU/Capital One transfer automation. Explicitly
  not to be dispatched until Shane confirms auto-fill-only vs. fully-auto-submit.

## Data policy

- No fixture/hardcoded financial data anywhere in this app.
- Postgres connection string is never hardcoded in source and never logged — it lives only in
  `%AppData%\ShanesSurvival\settings.json`.
- Same rule for shanes-life's API base URL and MCP bearer token (#3288) — never hardcoded,
  never logged, live only in `%AppData%\ShanesSurvival\settings.json`.
