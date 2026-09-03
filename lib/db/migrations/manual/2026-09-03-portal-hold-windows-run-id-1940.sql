-- #1940 — Runbooks: hold windows have no cycle affinity after #1557's run model
--
-- portal_hold_windows gates a step via runbookId + gatesStepPosition, both of
-- which predate #1557's run model. After #1557, portal_runbook_steps.position
-- restarts at 1 per cycle (portal_runbook_runs), so "gatesStepPosition 4" is
-- ambiguous once a recurring runbook has spawned a second cycle — nothing on
-- the row says which cycle it was raised for.
--
-- Additive, nullable: existing rows (0 in local dev today per the issue body)
-- get run_id = NULL and are matched to a runbook's CURRENT cycle by fallback
-- in application code (see portal-runbooks.ts), same behavior as before this
-- column existed.

ALTER TABLE portal_hold_windows
  ADD COLUMN IF NOT EXISTS run_id INTEGER REFERENCES portal_runbook_runs(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS portal_hold_windows_run_id_idx ON portal_hold_windows (run_id);

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-03-portal-hold-windows-run-id-1940.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
