-- Git #1957, part of #1489.
--
-- msp_risk_decisions.check_key is a single nullable text column, and the
-- customer-tenant alert engine's accepted-risk suppression only matches this
-- ONE column. Several remediation_tracker_steps map to more than one check
-- (REMEDIATION_TRACKER_STEP_CHECK_KEYS), so declining one such step and
-- accepting the whole step's risk could only suppress re-firing on the first
-- mapped check. additional_check_keys carries the rest.
--
-- Purely additive: check_key is untouched, NULL by default here, and every
-- existing writer (msp-rbd.ts, m365-change-router.ts's #1514 path) keeps
-- working unchanged unless it chooses to populate this column.
ALTER TABLE msp_risk_decisions
  ADD COLUMN IF NOT EXISTS additional_check_keys jsonb;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-03-risk-decisions-additional-check-keys-1957.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
