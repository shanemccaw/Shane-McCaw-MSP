---
name: Engine-scoped signal rule import/export
description: How to scope signal_derivation_rules/signal_rule_groups import & export to one intelligence engine only
---

Rules/groups are shared tables (`signal_derivation_rules`, `signal_rule_groups`) tagged with a `category` column like `<categoryPrefix>:...`. To add per-engine export/import (as opposed to the global bundle importer in `admin-signal-rules.ts`), scope every read/delete/insert by `category LIKE '<prefix>:%'` rather than touching the whole table.

**Why:** Multiple engines (priority, pricing, health, drift, forecasting, crm, msp) share the same underlying rule tables via `EngineDef.categoryPrefix`. A naive import that mirrors the global "replace everything" endpoint would wipe out every other engine's rules too.

**How to apply:** When adding scoped import, (1) validate every row's `category` starts with the engine's prefix before touching the DB, (2) `DELETE ... WHERE category LIKE prefix || '%'` instead of `DELETE FROM table`, (3) take a full-DB snapshot via `saveSnapshot()` first for recovery, (4) reference groups by their own `signalKey` (not numeric DB id) since ids aren't stable across export/import round-trips. Reuse `parseIntelligenceFields`/`saveSnapshot`/`getAllRules`/`getAllGroups` exported from `admin-signal-rules.ts` rather than duplicating the 20+ intelligence-field SQL columns.
