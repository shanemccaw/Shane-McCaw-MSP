ALTER TABLE "config_pack_templates" ALTER COLUMN "template_id" DROP NOT NULL;
ALTER TABLE "config_pack_templates" ADD COLUMN "check_key" text REFERENCES "monitor_checks"("key");
ALTER TABLE "config_pack_templates" ADD COLUMN "parameter_mapping" jsonb;
CREATE INDEX IF NOT EXISTS "config_pack_templates_check_key_idx" ON "config_pack_templates"("check_key");

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-07-26-add-config-pack-check-key.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
