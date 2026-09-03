-- #1505 — Replace msp_change_requests.linked_finding free text with real FK edges
--
-- Five real edges, verified live against the running code before writing this:
--   1. msp_change_requests -> the finding that raised it. `linked_finding` stays
--      free text (a finding genuinely is not one row in one table — see that
--      column's own comment in lib/db/src/schema/msp.ts) but its three real
--      writers each get a real FK sitting beside it:
--        - m365-change-router.ts            -> source_interpretation_id / source_resolution_id
--        - portal-runbooks.ts (hold window)  -> linked_hold_window_id (NEW column)
--        - msp-change-execution-store.ts (rollback) -> rollback_of_change_request_id (already FK'd, #1499)
--   2. portal_hold_window_events.change_request_id -> msp_change_requests(id)
--   3. drift_events.baseline_snapshot_id -> drift_baseline_snapshots(id), and a
--      NEW change_request_id column as the real FK behind the display-text crRef
--   4. msp_risk_decisions.spawned_by_change_request_id / discharged_by_change_request_id
--      -> msp_change_requests(id) — the forward/back pointers the issue asks for.
--      (checkKey / registerRef are NOT FK'd here — see the schema comments on
--      those two columns for why: checkKey's value space is a documented union
--      that a hard FK would reject real values from, and registerRef has no
--      writer/consumer at all today, so there is nothing to point it at.)
--   5. msp_sop_runs.psa_ticket_id <-> msp_change_requests.psa_ticket_id — both
--      free text (no local psa_tickets table exists; the ticket lives in the
--      external PSA system), indexed on both sides so the shared-ticket join is
--      real and performant rather than two unindexed strings that sometimes match.
--
-- DATA MIGRATION: queried live before writing this file. Every one of these
-- tables is empty or effectively empty in local dev:
--   msp_change_requests: 0 rows · portal_hold_window_events: 0 rows ·
--   drift_events: 0 rows · msp_sop_runs: 0 rows ·
--   msp_risk_decisions: 1 row, with check_key / register_ref /
--   spawned_by_change_request_id / discharged_by_change_request_id all NULL.
-- There is no free-text data anywhere to backfill onto the new columns — 0
-- rows had a value, 0 matched, 0 did not. Nothing below performs an UPDATE.
--
-- linked_finding itself is NOT dropped (destructive; out of scope — see the
-- issue) and is untouched by this file.

-- ── 1. msp_change_requests — three new/newly-FK'd columns ─────────────────────

ALTER TABLE msp_change_requests
  ADD COLUMN IF NOT EXISTS linked_hold_window_id INTEGER REFERENCES portal_hold_windows(id) ON DELETE SET NULL;

-- source_interpretation_id / source_resolution_id already exist (#1534) as bare
-- integers with no FK. Adding the constraints now that #1505 has verified both
-- target tables and every live writer.
ALTER TABLE msp_change_requests DROP CONSTRAINT IF EXISTS msp_change_requests_source_interpretation_id_fkey;
ALTER TABLE msp_change_requests
  ADD CONSTRAINT msp_change_requests_source_interpretation_id_fkey
  FOREIGN KEY (source_interpretation_id) REFERENCES m365_change_interpretations(id) ON DELETE SET NULL;

ALTER TABLE msp_change_requests DROP CONSTRAINT IF EXISTS msp_change_requests_source_resolution_id_fkey;
ALTER TABLE msp_change_requests
  ADD CONSTRAINT msp_change_requests_source_resolution_id_fkey
  FOREIGN KEY (source_resolution_id) REFERENCES m365_change_resolutions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS msp_change_requests_source_interpretation_id_idx ON msp_change_requests (source_interpretation_id);
CREATE INDEX IF NOT EXISTS msp_change_requests_source_resolution_id_idx ON msp_change_requests (source_resolution_id);
CREATE INDEX IF NOT EXISTS msp_change_requests_linked_hold_window_id_idx ON msp_change_requests (linked_hold_window_id);
CREATE INDEX IF NOT EXISTS msp_change_requests_psa_ticket_id_idx ON msp_change_requests (psa_ticket_id);

-- ── 2. portal_hold_window_events.change_request_id — was a bare int ───────────

ALTER TABLE portal_hold_window_events DROP CONSTRAINT IF EXISTS portal_hold_window_events_change_request_id_fkey;
ALTER TABLE portal_hold_window_events
  ADD CONSTRAINT portal_hold_window_events_change_request_id_fkey
  FOREIGN KEY (change_request_id) REFERENCES msp_change_requests(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS portal_hold_window_events_change_request_id_idx ON portal_hold_window_events (change_request_id);

-- ── 3. drift_events — new change_request_id column + FK on baseline_snapshot_id ─

ALTER TABLE drift_events
  ADD COLUMN IF NOT EXISTS change_request_id INTEGER REFERENCES msp_change_requests(id) ON DELETE SET NULL;

ALTER TABLE drift_events DROP CONSTRAINT IF EXISTS drift_events_baseline_snapshot_id_fkey;
ALTER TABLE drift_events
  ADD CONSTRAINT drift_events_baseline_snapshot_id_fkey
  FOREIGN KEY (baseline_snapshot_id) REFERENCES drift_baseline_snapshots(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS drift_events_change_request_id_idx ON drift_events (change_request_id);
CREATE INDEX IF NOT EXISTS drift_events_baseline_snapshot_id_idx ON drift_events (baseline_snapshot_id);

-- ── 4. msp_risk_decisions — the risk <-> CR forward/back pointers ─────────────

ALTER TABLE msp_risk_decisions DROP CONSTRAINT IF EXISTS msp_risk_decisions_spawned_by_change_request_id_fkey;
ALTER TABLE msp_risk_decisions
  ADD CONSTRAINT msp_risk_decisions_spawned_by_change_request_id_fkey
  FOREIGN KEY (spawned_by_change_request_id) REFERENCES msp_change_requests(id) ON DELETE SET NULL;

ALTER TABLE msp_risk_decisions DROP CONSTRAINT IF EXISTS msp_risk_decisions_discharged_by_change_request_id_fkey;
ALTER TABLE msp_risk_decisions
  ADD CONSTRAINT msp_risk_decisions_discharged_by_change_request_id_fkey
  FOREIGN KEY (discharged_by_change_request_id) REFERENCES msp_change_requests(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS msp_risk_decisions_spawned_by_change_request_idx ON msp_risk_decisions (spawned_by_change_request_id);
CREATE INDEX IF NOT EXISTS msp_risk_decisions_discharged_by_change_request_idx ON msp_risk_decisions (discharged_by_change_request_id);

-- ── 5. msp_sop_runs.psa_ticket_id — shared free-text PSA ticket key ───────────

CREATE INDEX IF NOT EXISTS msp_sop_runs_psa_ticket_id_idx ON msp_sop_runs (psa_ticket_id);

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-03-change-control-referential-edges-1505.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
