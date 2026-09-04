# --notGit n — Scaffold ShanesSurvival WPF app (standalone, not in this repo)

- **Status:** ⏳ IN FLIGHT 2026-09-04T00:00:00Z
- **Scope:** other (standalone external project — C:\Source\ShanesSurvival, own git history, not pushed)
- **Started:** 2026-09-04
- **Commit(s):** (fill at DONE — commits land in the standalone ShanesSurvival repo, not this one)

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
