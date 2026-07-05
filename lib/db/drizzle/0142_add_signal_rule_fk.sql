ALTER TABLE "signal_derivation_rules"
  ADD CONSTRAINT "signal_derivation_rules_group_id_fkey"
  FOREIGN KEY ("group_id") REFERENCES "signal_rule_groups"("id") ON DELETE SET NULL;
