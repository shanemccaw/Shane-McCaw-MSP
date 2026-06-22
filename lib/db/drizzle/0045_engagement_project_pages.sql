ALTER TABLE "engagement_projects" ADD COLUMN IF NOT EXISTS "pages" jsonb NOT NULL DEFAULT '[]'::jsonb;
