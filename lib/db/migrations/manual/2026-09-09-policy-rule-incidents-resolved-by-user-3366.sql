-- #3366 — Alerts (MSP Console): real acknowledge/dismiss action for
-- policy_rule_incidents, the first of GET /api/msp/alerts's two source tables.
--
-- Real audit before this migration (see build-journal/3366.md): the policy
-- engine (artifacts/api-server/src/lib/policy-engine.ts, evaluateAllPolicies)
-- already owns a real resolution mechanism for this table — it auto-sets
-- status='resolved' + resolved_at=now() the moment a rule's condition stops
-- firing. No manual, operator-triggered transition exists yet, and the status
-- enum already carries exactly the value ("resolved") a manual acknowledge
-- needs — so this does NOT add a third status value or a parallel table. It
-- adds one column so the source-of-truth row itself can tell "the engine
-- auto-resolved this because the condition cleared" (NULL) apart from "MSP
-- staff manually acknowledged/dismissed this" (this user's id) — the same
-- resolved_by_user_id shape already used elsewhere in this codebase (see
-- msp-active-directory.ts's activeDirectoryOuAssignmentRequestsTable) for a
-- record that can be closed either automatically or by a person.
--
-- POST /api/msp/alerts/:alertId/acknowledge (artifacts/api-server/src/routes/
-- msp-alerts.ts) is the real write this column serves.
--
-- The second source table GET /api/msp/alerts reads, msp_diagnostic_findings,
-- genuinely has no resolution mechanism anywhere in the codebase (individual
-- finding rows are immutable historical scan output) — flagged as a separate
-- finding rather than building an ad hoc lifecycle for it here, per this
-- issue's own explicit instruction not to invent one silently.

BEGIN;

ALTER TABLE policy_rule_incidents
  ADD COLUMN IF NOT EXISTS resolved_by_user_id integer;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-09-policy-rule-incidents-resolved-by-user-3366.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
