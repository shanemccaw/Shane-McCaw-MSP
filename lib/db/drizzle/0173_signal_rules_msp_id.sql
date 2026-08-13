-- 0173_signal_rules_msp_id
-- Adds nullable msp_id FK to signal_rule_groups and signal_derivation_rules.
-- null = platform-owned (default); non-null = MSP override row scoped to that MSP.
-- All existing rows remain platform-owned (msp_id = NULL) — no data migration needed.
ALTER TABLE "signal_rule_groups" ADD COLUMN IF NOT EXISTS "msp_id" integer REFERENCES "msps"("id") ON DELETE SET NULL;
ALTER TABLE "signal_derivation_rules" ADD COLUMN IF NOT EXISTS "msp_id" integer REFERENCES "msps"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "signal_rule_groups_msp_id_idx" ON "signal_rule_groups" ("msp_id");
CREATE INDEX IF NOT EXISTS "signal_derivation_rules_msp_id_idx" ON "signal_derivation_rules" ("msp_id");
