-- 2026-09-03-cr-pirs-1502.sql
--
-- #1502 — Post-Implementation Review: close codes, a PIR record with
-- verification evidence, and the drift re-scan that confirms a change landed.
--
-- Before this, a closed CR carried only `status` — no review of whether the
-- authorized change actually happened as intended, no close code, no evidence.
-- `cr_pirs` is that review, one row per `cr_executions` row (#1499). It ATTACHES
-- to the execution — the execution and its parent CR stay exactly as immutable
-- as before; this is a new, append-only table, never an edit to either.
--
-- Also widens `cr_events.event_type`'s TS-level vocabulary with `pir_recorded`
-- (see lib/db/src/schema/msp.ts) — no DDL needed for that: `cr_events.event_type`
-- is plain `text` with no CHECK constraint (verified live via `\d cr_events` /
-- `pg_constraint`), same as `msp_change_requests.category`'s own note above it.
--
-- Additive and reversible: one new table + indexes. No data is rewritten.

BEGIN;

CREATE TABLE IF NOT EXISTS cr_pirs (
  id                                serial PRIMARY KEY,
  execution_id                      integer NOT NULL UNIQUE REFERENCES cr_executions(id) ON DELETE CASCADE,
  change_request_id                 integer NOT NULL REFERENCES msp_change_requests(id) ON DELETE CASCADE,
  msp_id                            integer NOT NULL REFERENCES msps(id) ON DELETE CASCADE,
  tenant_id                         text NOT NULL,

  close_code                        text NOT NULL,  -- successful | successful_with_issues | failed | rolled_back
  summary                           text NOT NULL,
  issues_noted                      text,

  reviewed_by                       text NOT NULL,
  reviewed_by_person_id             text,
  reviewed_at                       timestamptz NOT NULL DEFAULT now(),

  -- drift re-scan
  drift_rescan_applicable           boolean NOT NULL DEFAULT false,
  drift_rescan_domain_key           text,
  drift_rescan_check_key            text,
  drift_rescan_status               text NOT NULL DEFAULT 'not_applicable', -- not_applicable | ran | error
  drift_rescan_events_inserted_count integer,
  drift_rescan_attributed_count     integer,
  drift_rescan_other_open_drift_count integer,
  drift_rescan_note                 text,
  drift_rescan_ran_at               timestamptz,

  created_at                        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cr_pirs_change_request_id_idx ON cr_pirs(change_request_id);
CREATE INDEX IF NOT EXISTS cr_pirs_msp_tenant_idx ON cr_pirs(msp_id, tenant_id);

-- Self-mark so Simulator Studio's Migrations tree reflects DB reality regardless
-- of which console ran the file (Git #497).
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-03-cr-pirs-1502.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
