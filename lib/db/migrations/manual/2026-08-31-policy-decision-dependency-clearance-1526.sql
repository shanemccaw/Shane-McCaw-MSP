-- #1526 — Policy Decisions: dependency-based clearance, a third clock.
--
-- Settled architecture (#1526): a decision like "Guest access reviews deferred
-- until the Entra P2 licences land" clears when a DEPENDENCY resolves, not
-- when a date arrives. `policy_decisions` (the real, own-table Policy
-- Decisions object split out by #1528, replacing the earlier
-- msp_risk_decisions.decision_state discriminator this issue's body was
-- originally written against) had review_cadence/review_state/review_due_at —
-- all date-based — and nowhere to record a condition. Adding it here rather
-- than to msp_risk_decisions, which #1528 already superseded for this object.
--
-- A dependency-based decision has no meaningful lapse: it is correct until the
-- dependency resolves, however long that takes. Assigning it an arbitrary
-- review date would manufacture a false overdue state, so review_cadence
-- becomes nullable rather than forcing a fabricated cadence onto it, and the
-- new clearance columns are the alternative, mutually-exclusive clock.
--
-- Two ways a dependency clears:
--   'license_sku' — observable. The platform already collects /subscribedSkus
--                   into tenant_check_item_details (cost:entra-license-tier-
--                   distribution, cost:license-count-by-sku, cost:unused-
--                   unassigned-licenses, license:sku-utilization); a scheduled
--                   check (advancePolicyClearances() in alert-engine.ts) reads
--                   the latest such row for the tenant and flips
--                   clearance_resolved_at the moment the watched SKU appears —
--                   no new Graph call, reusing data already on hand.
--   'manual'      — not observable by the platform. Only a human mark-resolved
--                   (PATCH /api/portal/policy-register/:id/clearance/resolve)
--                   can clear it.
--
-- clearance_trigger_type/clearance_condition are plain TEXT (no DB CHECK on
-- the enum), matching this schema's house convention of enforcing enums at
-- the application layer (CLEARANCE_TRIGGER_TYPES in lib/db/src/schema/msp.ts)
-- — see e.g. msp_alert_rules.condition_type for the identical precedent.
--
-- The CHECK constraint below IS added at the DB level (not just convention)
-- because this is the one invariant #1526 explicitly calls out: the two
-- clocks must never both be populated on the same row. policy_decisions is
-- empty at authoring time (verified with psql: 0 rows), so this is a pure
-- additive/structural change with nothing to backfill or violate.
--
-- Also seeds the msp_alert_rules config row for the new 'policy_clearance_resolved'
-- condition type — ensureAlertEngineReady() never auto-populates msp_alert_rules,
-- so without this row the evaluator would exist in code but never fire.

BEGIN;

ALTER TABLE policy_decisions ALTER COLUMN review_cadence DROP NOT NULL;
ALTER TABLE policy_decisions ALTER COLUMN review_state DROP NOT NULL;
ALTER TABLE policy_decisions ALTER COLUMN review_state DROP DEFAULT;

ALTER TABLE policy_decisions ADD COLUMN IF NOT EXISTS clearance_condition text;
ALTER TABLE policy_decisions ADD COLUMN IF NOT EXISTS clearance_trigger_type text;
ALTER TABLE policy_decisions ADD COLUMN IF NOT EXISTS clearance_trigger_sku_part_number text;
ALTER TABLE policy_decisions ADD COLUMN IF NOT EXISTS clearance_resolved_at timestamptz;
ALTER TABLE policy_decisions ADD COLUMN IF NOT EXISTS clearance_resolved_note text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'policy_decisions_review_xor_clearance_chk'
  ) THEN
    ALTER TABLE policy_decisions
      ADD CONSTRAINT policy_decisions_review_xor_clearance_chk
      CHECK (NOT (review_cadence IS NOT NULL AND clearance_condition IS NOT NULL));
  END IF;
END $$;

INSERT INTO msp_alert_rules
  (rule_key, label, description, condition_type, threshold, window_minutes,
   severity, enabled, delivery_email, delivery_push, cooldown_minutes, deep_link_path)
VALUES
  ('policy_clearance_resolved',
   'Policy decision dependency cleared',
   'A dependency-based policy decision (policy_decisions.clearance_condition, #1526) had its watched licence SKU appear in the tenant and is now actionable — no scheduled review to wait for.',
   'policy_clearance_resolved',
   1,
   60,
   'info',
   true,
   true,
   true,
   60,
   NULL)
ON CONFLICT (rule_key) DO NOTHING;

SELECT column_name, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_name = 'policy_decisions'
   AND column_name IN ('review_cadence', 'review_state', 'clearance_condition',
                        'clearance_trigger_type', 'clearance_trigger_sku_part_number',
                        'clearance_resolved_at', 'clearance_resolved_note')
 ORDER BY column_name;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-31-policy-decision-dependency-clearance-1526.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
