-- #1557 — SOPs/Runbooks: recurrence is a schedule that spawns runs, not a row
-- that gets wiped.
--
-- Before this, `portal_runbooks` carried `started_on` + `cycle_days` as if a
-- runbook had exactly one run, and `portal_runbook_steps` (checked / checked_at
-- / checked_by_user_id) was keyed straight off the runbook. Resetting a
-- recurring procedure for its next cycle had nowhere to put the last cycle's
-- completion except overwrite it in place — there was no run history, and no
-- way to answer "did we do the guest access review last quarter, and who
-- signed it off".
--
-- Settled shape: a runbook is the SCHEDULE. Recurrence (`recurring`) is a
-- property of it. Each cycle is its own row in the new `portal_runbook_runs`,
-- and `portal_runbook_steps` is now keyed off the RUN, not the schedule, so a
-- fresh cycle is a new run + a fresh set of step rows rather than a reset of
-- the old ones.
--
-- Additive and reversible throughout — no column is dropped:
--   * `portal_runbooks` gains `recurring boolean NOT NULL DEFAULT false`. Every
--     runbook seeded before this migration keeps behaving exactly as it does
--     today (a one-shot procedure) unless explicitly opted into recurrence.
--   * New table `portal_runbook_runs`, one row per cycle.
--   * `portal_runbook_steps` gains `run_id` (the new required parent going
--     forward). The old `runbook_id` column is relaxed to nullable rather than
--     dropped — nothing writes or reads it after this migration, but dropping
--     it is a destructive change this migration does not make. Both
--     `portal_runbooks` and `portal_runbook_steps` are empty in every
--     environment this has been run against (verified: 0 rows, local dev DB —
--     the execution hook that would populate them is #1559, not yet
--     connected), so there is no data to backfill either way.
--   * The old (runbook_id, position) uniqueness moves to (run_id, position) —
--     a step's slot is now unique per cycle, not per schedule, since every
--     cycle starts its own position-1..N sequence.

ALTER TABLE portal_runbooks
  ADD COLUMN IF NOT EXISTS recurring boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS portal_runbook_runs (
  id SERIAL PRIMARY KEY,
  runbook_id integer NOT NULL REFERENCES portal_runbooks(id) ON DELETE CASCADE,
  customer_id integer NOT NULL,
  cycle_number integer NOT NULL,
  started_on date NOT NULL,
  status text NOT NULL DEFAULT 'active',
  completed_at timestamptz,
  completed_by_user_id integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS portal_runbook_runs_customer_id_idx ON portal_runbook_runs(customer_id);
CREATE INDEX IF NOT EXISTS portal_runbook_runs_runbook_id_idx ON portal_runbook_runs(runbook_id);
CREATE UNIQUE INDEX IF NOT EXISTS portal_runbook_runs_runbook_cycle_idx ON portal_runbook_runs(runbook_id, cycle_number);

ALTER TABLE portal_runbook_steps
  ADD COLUMN IF NOT EXISTS run_id integer REFERENCES portal_runbook_runs(id) ON DELETE CASCADE;

-- Both tables are verified empty (see note above), so this NOT NULL can be
-- applied directly with no backfill.
ALTER TABLE portal_runbook_steps
  ALTER COLUMN run_id SET NOT NULL;

-- The old parent is no longer required or written — relaxed, not dropped.
ALTER TABLE portal_runbook_steps
  ALTER COLUMN runbook_id DROP NOT NULL;

DROP INDEX IF EXISTS portal_runbook_steps_runbook_position_idx;
DROP INDEX IF EXISTS portal_runbook_steps_runbook_id_idx;
CREATE INDEX IF NOT EXISTS portal_runbook_steps_run_id_idx ON portal_runbook_steps(run_id);
CREATE UNIQUE INDEX IF NOT EXISTS portal_runbook_steps_run_position_idx ON portal_runbook_steps(run_id, position);

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-30-runbook-cycles-1557.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
