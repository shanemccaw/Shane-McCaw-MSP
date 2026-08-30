-- 2026-08-29-cr-authorization-gate-1497.sql
--
-- #1497 — Change Control as the AUTHORIZATION GATE on the tenant write path.
--
-- Adds the link from an approved Change Request to the wf_run that executes the
-- write it authorized. The config-pack write path claims an approved CR
-- (pending_approval/scheduled -> in_progress) and stamps the executing run here;
-- the reconciliation sweep then closes the CR to `completed` when that run
-- finishes, which is what lets monitor-executor attribute the resulting drift to
-- CR-<id> (read as `approved` rather than unauthorized drift).
--
-- Additive, reversible: one nullable column + one index. No data is rewritten.
-- Soft link (no FK) — same discipline as msp_change_requests.tenant_id.

ALTER TABLE msp_change_requests
  ADD COLUMN IF NOT EXISTS executor_run_id integer;

CREATE INDEX IF NOT EXISTS msp_change_requests_executor_run_id_idx
  ON msp_change_requests (executor_run_id);

-- Self-marking so Simulator Studio's Migrations tree reflects DB reality
-- regardless of which console ran the file (Git #497).
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-29-cr-authorization-gate-1497.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
