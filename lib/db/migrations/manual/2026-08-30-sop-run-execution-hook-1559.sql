-- #1559 — SOPs/Runbooks: connect the execution hook.
--
-- Two additive columns on the surviving run record (`msp_sop_runs`, #1556) so a
-- real fired run can cite what actually executed it and be reconciled later:
--
--   wf_run_id          — the real Workflow Engine run (wf_runs.id) executing this
--                        run's automated steps. Plain nullable integer, no FK —
--                        the same no-DB-CHECK convention msp_change_requests's
--                        own executor_run_id already follows for the identical
--                        relationship.
--   automated_step_map — the node-id -> step-index map snapshotted at fire time,
--                        so the reconciliation sweep never drifts onto a step the
--                        SOP definition has since edited or removed.
--
-- Additive, reversible: both are nullable/defaulted, so every existing row (there
-- are none today per #1559 — nothing wrote this table before this) and any writer
-- that predates this still reads cleanly.

ALTER TABLE msp_sop_runs
  ADD COLUMN IF NOT EXISTS wf_run_id integer,
  ADD COLUMN IF NOT EXISTS automated_step_map jsonb NOT NULL DEFAULT '[]';

CREATE INDEX IF NOT EXISTS msp_sop_runs_wf_run_id_idx ON msp_sop_runs (wf_run_id);

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-30-sop-run-execution-hook-1559.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
