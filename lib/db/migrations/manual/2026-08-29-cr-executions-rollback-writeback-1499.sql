-- 2026-08-29-cr-executions-rollback-writeback-1499.sql
--
-- #1499 — Change Control: the EXECUTION record, rollback-as-inverse-CR, and the
-- authorizing `crRef` writeback.
--
-- A CR authorizes a change; it does not execute one. Before this, the only trace
-- of execution was `msp_change_requests.executed_at` — one timestamp, no
-- implementer, no bound executor, no planned-vs-actual, no rollback verification.
--
-- Adds:
--   1. `msp_change_requests.rollback_of_change_request_id` — the self-link that
--      makes "a rollback is itself an inverse CR" representable. NULL on every
--      forward change.
--   2. `cr_executions` — one row per time an authorized change is carried out,
--      binding the CR to whichever executor (runbook run, write action, or an
--      attested human action) actually did it, capturing the planOnly plan and
--      diffing it against the real outcome, and carrying the crRef writeback and
--      rollback verification.
--
-- Additive and reversible: one nullable column + one new table + indexes. No data
-- is rewritten. The `wf_run_id` link is SOFT (no FK) — same discipline as
-- `msp_change_requests.executor_run_id` — so a pruned wf_run never cascades an
-- execution record away.

BEGIN;

-- 1. The inverse-CR self-link. `set null` on delete: an inverse CR is a real
--    historical change in its own right and must survive the original it reversed
--    being pruned.
ALTER TABLE msp_change_requests
  ADD COLUMN IF NOT EXISTS rollback_of_change_request_id integer
  REFERENCES msp_change_requests(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS msp_change_requests_rollback_of_idx
  ON msp_change_requests (rollback_of_change_request_id);

-- 2. The execution record.
CREATE TABLE IF NOT EXISTS cr_executions (
  id                     serial PRIMARY KEY,
  change_request_id      integer NOT NULL REFERENCES msp_change_requests(id) ON DELETE CASCADE,
  msp_id                 integer NOT NULL REFERENCES msps(id) ON DELETE CASCADE,
  tenant_id              text NOT NULL,
  executor_kind          text NOT NULL,                 -- runbook_run | write_action | human_action
  wf_run_id              integer,                        -- SOFT link to wf_runs.id (no FK)
  pack_key               text,
  implementer            text,                           -- microsoft | customer | msp
  outcome                text NOT NULL DEFAULT 'pending',-- pending | succeeded | failed | rolled_back

  -- planned-vs-actual
  planned_plan           jsonb,
  actual_outcome         jsonb,
  plan_matched           boolean,
  plan_diff              jsonb,

  -- crRef writeback
  cr_ref                 text,
  written_back_at        timestamptz,

  -- human-action attestation
  attested_by            text,
  attested_by_person_id  text,
  attested_at            timestamptz,
  attestation_note       text,

  -- rollback verification (only set on an execution of an inverse/rollback CR)
  rollback_verified_at   timestamptz,
  rollback_outcome       text,                           -- pending | verified | failed

  executed_at            timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cr_executions_change_request_id_idx ON cr_executions(change_request_id);
CREATE INDEX IF NOT EXISTS cr_executions_msp_tenant_idx ON cr_executions(msp_id, tenant_id);
CREATE INDEX IF NOT EXISTS cr_executions_wf_run_id_idx ON cr_executions(wf_run_id);

-- Self-mark so Simulator Studio's Migrations tree reflects DB reality regardless
-- of which console ran the file (Git #497).
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-29-cr-executions-rollback-writeback-1499.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
