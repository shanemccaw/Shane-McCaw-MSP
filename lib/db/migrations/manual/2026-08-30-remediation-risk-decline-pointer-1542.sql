-- #1542 — Remediation: Items exit to the risk register when the customer declines.
--
-- The same rejection-to-risk path as #1514, arriving from the Remediation Tracker
-- rather than Change Control (see m365-change-router.ts's
-- createAcceptedRiskFromDecline() for that shipped precedent, which this migration's
-- companion, remediation-tracker-risk-decline.ts, mirrors).
--
-- Adds the back-pointer from a risk decision to the remediation_tracker_steps row
-- whose decline created it, matching spawned_by_change_request_id's existing shape.
-- Discharge reuses discharged_by_change_request_id already on the table — a
-- remediation-declined risk is, like a CR-declined one, only ever discharged by a
-- fresh CR (#1514's lifecycle), so no second discharge column is needed.
--
-- accepted_risk (remediation_tracker_steps.status) needs NO DDL — that column is
-- plain text with no CHECK constraint (Phase B/#731 already widened it once in code
-- alone), matching the convention its own schema comment documents.
--
-- Additive, nullable, reversible. Safe to re-run (IF NOT EXISTS).

BEGIN;

ALTER TABLE msp_risk_decisions
  ADD COLUMN IF NOT EXISTS spawned_by_remediation_step_id integer;

CREATE INDEX IF NOT EXISTS msp_risk_decisions_spawned_by_remediation_step_idx
  ON msp_risk_decisions (spawned_by_remediation_step_id);

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-30-remediation-risk-decline-pointer-1542.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
