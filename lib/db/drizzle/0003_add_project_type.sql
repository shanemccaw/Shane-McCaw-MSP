ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "project_type" text NOT NULL DEFAULT 'project';
