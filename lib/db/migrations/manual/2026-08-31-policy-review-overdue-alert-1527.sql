-- #1527 — Policy Decisions: extend #1513's overdue-review alerting to
-- Policy Decisions' own table (Git #2024's `policy_decisions`).
--
-- #1513 built `risk_review_overdue` against `msp_risk_decisions` only.
-- `policy_decisions` (Git #2024) landed with the SAME reviewState/reviewDueAt
-- columns for the same operational lane, but post-dates #1513 in the commit
-- graph and was never wired into the alert-engine evaluator — this migration
-- seeds the missing rule config row so `alert-engine.ts`'s now-real
-- `policy_review_overdue` evaluator actually fires (same reasoning as
-- #1513's own migration: `ensureAlertEngineReady()` never auto-populates
-- `msp_alert_rules`, so without this row the evaluator exists in code but
-- never runs for lack of an enabled rule).
--
-- Same distinct 'review_lapsed' severity, same threshold (1 — no acceptable
-- count of lapsed reviews), same 1440-minute (24h) cooldown, same NULL
-- deep_link_path (no admin-panel Policy Decisions view exists yet).
--
-- Live data at authoring time (local shanemccawmsp, verified with psql):
-- msp_alert_rules has 8 existing rows (including risk_review_overdue from
-- #1513), none for this condition_type — this INSERT adds exactly one new
-- row and touches nothing else.

BEGIN;

INSERT INTO msp_alert_rules
  (rule_key, label, description, condition_type, threshold, window_minutes,
   severity, enabled, delivery_email, delivery_push, cooldown_minutes, deep_link_path)
VALUES
  ('policy_review_overdue',
   'Policy decision review overdue',
   'One or more signed policy decisions (policy_decisions) have passed their scheduled review_due_at with nobody acting. The decision itself remains LIVE and valid — only the review is overdue.',
   'policy_review_overdue',
   1,
   60,
   'review_lapsed',
   true,
   true,
   true,
   1440,
   NULL)
ON CONFLICT (rule_key) DO NOTHING;

SELECT rule_key, condition_type, severity, threshold, cooldown_minutes, enabled
  FROM msp_alert_rules
 WHERE rule_key = 'policy_review_overdue';

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-31-policy-review-overdue-alert-1527.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
