ALTER TABLE "wf_definitions" ADD COLUMN IF NOT EXISTS "metadata" jsonb DEFAULT '{}' NOT NULL;
ALTER TABLE "wf_versions" ADD COLUMN IF NOT EXISTS "is_default" boolean DEFAULT false NOT NULL;