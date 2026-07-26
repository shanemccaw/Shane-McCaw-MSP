ALTER TABLE "config_pack_templates" ALTER COLUMN "template_id" DROP NOT NULL;
ALTER TABLE "config_pack_templates" ADD COLUMN "check_key" text REFERENCES "monitor_checks"("key");
ALTER TABLE "config_pack_templates" ADD COLUMN "parameter_mapping" jsonb;
CREATE INDEX IF NOT EXISTS "config_pack_templates_check_key_idx" ON "config_pack_templates"("check_key");
