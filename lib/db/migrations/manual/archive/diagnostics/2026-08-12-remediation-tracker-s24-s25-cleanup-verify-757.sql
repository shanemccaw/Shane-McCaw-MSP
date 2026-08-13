-- READ-ONLY diagnostic (Git #925 / #792) — confirm the #757 Step 24/25 orphaned-row
-- cleanup actually ran on this database.
--
-- Context: #757 removed steps s24/s25 from the Remediation Guide catalogue (GAP, not
-- renumber). The app can only prove the ids are REJECTED (the 792 manifest asserts
-- PUT /api/portal/remediation-tracker/steps/s24 -> 400); it cannot see whether any
-- pre-existing remediation_tracker_steps rows keyed to s24/s25 were actually deleted.
-- That is a DB fact, so it lives here as read-only SQL for Shane to run in his console.
--
-- This file is pure SELECT — no DDL/DML — so per CLAUDE.md it is a diagnostic and is
-- deliberately EXEMPT from the trailing self-marking simulator_migration_runs INSERT
-- (that marker belongs only to files that change data/schema). Do NOT run drizzle-kit
-- against it.
--
-- Expected results after a successful #757 cleanup:
--   Query 1 (orphan rows)        -> ZERO rows.
--   Query 2 (migration recorded) -> exactly ONE row, ran_at set.

-- ── Query 1: any orphaned s24/s25 tracker rows still present? (want: 0 rows) ─────────
SELECT
  step_id,
  count(*)            AS orphan_rows,
  min(customer_id)    AS example_customer_id
FROM remediation_tracker_steps
WHERE step_id IN ('s24', 's25')
GROUP BY step_id
ORDER BY step_id;

-- ── Query 2: did the #757 migration mark itself as run? (want: 1 row) ────────────────
SELECT
  filename,
  ran_at
FROM simulator_migration_runs
WHERE filename = '2026-08-11-remediation-tracker-remove-steps-24-25-757.sql';
