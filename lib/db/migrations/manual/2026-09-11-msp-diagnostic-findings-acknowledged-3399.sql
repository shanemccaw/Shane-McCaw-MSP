-- #3399 — msp_diagnostic_findings has no per-item resolution/acknowledge
-- mechanism (Alerts feed, Git #3366's own audit).
--
-- #3366 built POST /api/msp/alerts/:alertId/acknowledge and wired it to
-- policy_rule_incidents' real status column, but msp_diagnostic_findings (the
-- alerts feed's second source table) genuinely had no resolution mechanism
-- anywhere in the codebase — individual finding rows are immutable historical
-- scan output with no status column and no per-finding lifecycle. #3399's own
-- body asked a real question: give this table its own acknowledge column, or
-- route a "dismiss" through remediation_tracker_steps' existing customer-
-- facing decision lifecycle (keyed by check_key -> stepId)?
--
-- Decision: this table gets its own column, NOT remediation_tracker_steps.
-- Reasons (see the matching schema comment in lib/db/src/schema/msp.ts):
--   - remediation_tracker_steps.status is a customer-facing decision lifecycle
--     with real side effects (accepted_risk spawns a signed msp_risk_decisions
--     row via remediation-tracker-risk-decline.ts) — reusing it purely to
--     silence an MSP-staff alert view would misrepresent that lifecycle.
--   - Only ~30 steps exist, each mapped from a subset of check_keys
--     (REMEDIATION_TRACKER_STEP_CHECK_KEYS). Most msp_diagnostic_findings rows'
--     check_key values map to no step at all, so routing through the tracker
--     would leave most findings with no acknowledge mechanism regardless.
-- Mirrors policy_rule_incidents.resolved_by_user_id's own shape (a nullable
-- timestamp + nullable user id, both null until acted on) rather than a status
-- enum — a finding row never transitions between states; a fresh scan's
-- re-raised finding is a brand new row (fresh finding_id) and starts
-- unacknowledged again, matching the incidents table's own "still firing ->
-- reopens" behavior.
--
-- POST /api/msp/alerts/:alertId/acknowledge's "finding-*" branch
-- (artifacts/api-server/src/routes/msp-alerts.ts) is the real write this
-- serves; GET /api/msp/alerts excludes acknowledged findings from the feed.

BEGIN;

ALTER TABLE msp_diagnostic_findings
  ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz,
  ADD COLUMN IF NOT EXISTS acknowledged_by_user_id integer;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-11-msp-diagnostic-findings-acknowledged-3399.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
