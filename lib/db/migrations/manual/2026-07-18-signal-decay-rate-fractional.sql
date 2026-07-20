-- signal-decay-rate-fractional-migration
-- Manual migration — review and run by hand (do not run drizzle-kit push/push --force).
--
-- Bug: decay_rate was stored as integer on both signal_derivation_rules and
-- signal_rule_groups, but forecasting-engine.ts's decayFactorFor() computes
-- `decayFactor = 1 - decayRate` assuming decayRate is a fraction (0-1).
-- Admin-entered percentages (5, 6, 8, 10, 15) were being fed straight into
-- that formula, producing wildly negative multipliers (1 - 15 = -14) instead
-- of gentle reductions. This converts the column to numeric(4,3) and
-- backfills existing integer-style values into their intended fractional form.

-- 1. Widen both columns from integer to numeric(4,3).
ALTER TABLE "signal_derivation_rules"
  ALTER COLUMN "decay_rate" TYPE numeric(4,3) USING "decay_rate"::numeric(4,3);

ALTER TABLE "signal_rule_groups"
  ALTER COLUMN "decay_rate" TYPE numeric(4,3) USING "decay_rate"::numeric(4,3);

-- 2. Backfill: existing integer-style values (5, 6, 8, 10, 15, meant as
--    percentages) become their intended fractional form (0.05, 0.06, 0.08,
--    0.10, 0.15). Rows already at 0 are left untouched.
UPDATE "signal_derivation_rules"
  SET "decay_rate" = "decay_rate" / 100.0
  WHERE "decay_rate" != 0;

UPDATE "signal_rule_groups"
  SET "decay_rate" = "decay_rate" / 100.0
  WHERE "decay_rate" != 0;

-- 3. Guardrail: prevent this class of bug from recurring by constraining
--    decay_rate to a valid fraction.
ALTER TABLE "signal_derivation_rules" DROP CONSTRAINT IF EXISTS "signal_derivation_rules_decay_rate_check";
ALTER TABLE "signal_derivation_rules"
  ADD CONSTRAINT "signal_derivation_rules_decay_rate_check"
  CHECK ("decay_rate" >= 0 AND "decay_rate" <= 1);

ALTER TABLE "signal_rule_groups" DROP CONSTRAINT IF EXISTS "signal_rule_groups_decay_rate_check";
ALTER TABLE "signal_rule_groups"
  ADD CONSTRAINT "signal_rule_groups_decay_rate_check"
  CHECK ("decay_rate" >= 0 AND "decay_rate" <= 1);