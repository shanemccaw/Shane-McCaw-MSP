Done in code (`20697a0c`). Capture mechanism + history-read API only, per the issue's scope — no frontend chart work, no backfill.

**Shane To-Do — run the manual migration** (schema change, not auto-applied):
`lib/db/migrations/manual/2026-08-17-tenant-pillar-snapshots-1106.sql`

Creates `tenant_pillar_snapshots`. Until it's run, the table doesn't exist, so the capture write + `GET /api/portal/assessment/pillar-history` can't be exercised against real data (that's why this isn't live-verified end-to-end yet). After it runs, snapshots begin accruing on the next sufficient-coverage scan per tenant.

**What shipped:**
- `tenant_pillar_snapshots` table (deliberately separate from the raw-score `tenant_engine_snapshots`; #1101). Columns: customerId, mspId, pillarKey, score, previousScore, delta, trendDirection, packageKey, runId, capturedAt.
- `capturePillarDisplaySnapshots()` (`artifacts/api-server/src/lib/pillar-snapshot.ts`, channel `engine.health`) invoked fire-and-forget at the **existing** `diagnostics.run_completed` emit moment in `diagnostics-runner.ts` — no new scheduler, no wrapping `runForTenant`, no workflow-graph node. Gated on `coverageSufficient` (same honesty gate `/status` applies); per-pillar previousScore/delta via prior-row lookup, mirroring `writeEngineSnapshot`.
- `GET /api/portal/assessment/pillar-history` (`portal-assessment.ts`, `requireRole("Assessment")`) — per-pillar series oldest→newest, honest-empty `pillars` when no history.

Chose a focused endpoint over extending `/api/dashboard/resolve` `includeHistory` because pillar display scores aren't registered dashboard metrics.

`tsc --noEmit` (api-server): 76 errors = exact pre-existing baseline (byte-identical to #1098's), 0 in any touched file.
