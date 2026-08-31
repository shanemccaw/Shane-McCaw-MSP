-- #1513 — Risk Register: overdue review alerting to the MSP.
--
-- Settled architecture (#1513): when a review lapses and nobody acts, it
-- alerts the MSP — not the customer — and it does NOT change the
-- acceptance's validity (the acceptance is a signed fact; only the review,
-- #1507's separate operational clock, is overdue).
--
-- Built entirely on the existing msp_alert_rules / msp_alert_events
-- infrastructure — no new tables. `condition_type` and `severity` are plain
-- TEXT columns (no DB CHECK constraint, enforced at the application layer by
-- MSP_ALERT_CONDITION_TYPES / MSP_ALERT_SEVERITIES in lib/db/src/schema/msp.ts),
-- so this migration's only job is to seed the actual rule CONFIG row —
-- ensureAlertEngineReady() deliberately never auto-populates msp_alert_rules
-- (see alert-engine.ts), so without this row the new `risk_review_overdue`
-- evaluator would exist in code but never fire for lack of an enabled rule.
--
-- Deliberately a DISTINCT severity ('review_lapsed', not 'warning'/'critical')
-- — a lapsed review is a different failure from a threshold breach: the
-- customer believes a risk is being actively managed and nobody has looked.
--
-- Threshold 1 (any overdue review is alert-worthy — there is no "acceptable
-- count" of lapsed reviews). Cooldown 1440 minutes (24h): this condition
-- persists for as long as nobody acts, so unlike a one-off breach it should
-- keep nagging once a day until resolved, not fire once and go silent.
-- deep_link_path left NULL — no admin-panel Risk Register view exists yet
-- (artifacts/admin-panel has no risk-register page); a fabricated path would
-- be worse than none.
--
-- Live data at authoring time (local shanemccawmsp, verified with psql):
-- msp_alert_rules has 7 existing rows, none for this condition_type — this
-- INSERT adds exactly one new row and touches nothing else.

BEGIN;

INSERT INTO msp_alert_rules
  (rule_key, label, description, condition_type, threshold, window_minutes,
   severity, enabled, delivery_email, delivery_push, cooldown_minutes, deep_link_path)
VALUES
  ('risk_review_overdue',
   'Risk acceptance review overdue',
   'One or more accepted-risk reviews (msp_risk_decisions) have passed their scheduled review_due_at with nobody acting. The acceptance itself remains active and valid — only the review is overdue.',
   'risk_review_overdue',
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
 WHERE rule_key = 'risk_review_overdue';

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-31-risk-review-overdue-alert-1513.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
