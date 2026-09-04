# --notGit n — Scaffold ShanesSurvival WPF app (standalone, not in this repo)

- **Status:** ✅ DONE 2026-09-04T01:00:00Z
- **Scope:** other (standalone external project — C:\Source\ShanesSurvival, own git history, not pushed)
- **Started:** 2026-09-04
- **Commit(s):** ShanesSurvival@9fa72ce ("Initial scaffold: WPF shell, Npgsql connection check,
  Settings dialog, schema migration") — in the standalone repo at C:\Source\ShanesSurvival, not
  this repo. This repo's own commit for the bookend file itself: 9d9b577b9.

## Log
- 2026-09-04T00:00:00Z ⏳ IN FLIGHT — Scaffolding a new standalone WPF (.NET 8) app, ShanesSurvival,
  at `C:\Source\ShanesSurvival`. Real Plaid-connected personal financial survival tracker. NOT part
  of Shane-McCaw-MSP or Finance-Tracker — separate folder, separate git init, separate Postgres
  database (`shanessurvival` on the local Postgres 18 instance), no shared code/schema/conventions.
  This build's scope is schema + skeleton only: WPF shell, Npgsql connection test, hand-written
  migrations/001_init.sql (plaid_items, accounts, transactions, debts, survival_snapshots), a real
  Settings dialog for the connection string, and a README. No Plaid Link/OAuth/sync/MCP yet — those
  are separate, later dispatches. This build-journal entry exists only to record the BuildConsole
  session (buildId 1627, tracked issue #-31); the actual deliverable is the standalone repo, which
  is intentionally never pushed anywhere from this session.
- 2026-09-04T01:00:00Z ✅ DONE — Standalone repo scaffolded and committed at
  `C:\Source\ShanesSurvival` (git init, real local history, not pushed — by design). Real
  WPF (.NET 8) shell (App.xaml/MainWindow) compiling clean via `dotnet build` (0 warnings,
  0 errors). Added Npgsql (v10.0.3) via `dotnet add package`. Hand-written
  `migrations/001_init.sql` creating `plaid_items`, `accounts`, `transactions`, `debts`,
  `survival_snapshots` — ran it myself with psql against a real new local Postgres database
  (`shanessurvival`, same local Postgres 18 install as this repo's own `shanemccawmsp` DB,
  created fresh for this project) and confirmed all 5 tables exist via `\dt`. Settings are
  never hardcoded/logged: `SettingsService` reads/writes
  `%AppData%\ShanesSurvival\settings.json` (outside the repo, gitignored even if it were
  inside it), and a real `SettingsWindow` dialog edits the Postgres connection string plus
  placeholder Plaid fields for a later dispatch. `DatabaseConnectionTester` gives four
  distinct, explicit startup states (not configured / unreachable / schema missing /
  connected) — no silent failure. Verified live: launched the built exe, it showed a real
  window titled "Shane's Survival" with the live "no Postgres connection configured" status
  (gray), matching the fresh, unconfigured settings file. (One honest caveat: the same
  launch also picked up an unrelated, already-open Settings-dialog-like window with a
  clipboard-sourced connection string on the shared live desktop mid-test — a real-desktop
  side effect unrelated to this app's code, not something this session typed in; noted here
  rather than silently ignored. No settings.json was ever written by that.) README.md
  documents run steps, the full schema, and explicitly what's NOT built yet (Plaid
  Link/OAuth, sync, MCP server — separate later dispatches). This repo's own bookend commit
  is 9d9b577b9, pushed to origin/main; branch verified merged via
  `verify-branch-merged.mjs`. `git status --porcelain` clean in this worktree.
