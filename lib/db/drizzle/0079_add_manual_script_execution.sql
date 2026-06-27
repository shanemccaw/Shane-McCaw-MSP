-- Migration: 0079_add_manual_script_execution
-- Adds manual execution mode columns to script_catalog and
-- manual-upload tracking columns to script_run_results.
-- The status column is a plain text column (Drizzle text enum, not a pg ENUM
-- type), so no ALTER TYPE is needed — new values are accepted automatically.

-- script_catalog: execution mode + manual requirements + PS1 body
ALTER TABLE "script_catalog"
  ADD COLUMN IF NOT EXISTS "execution_mode" text NOT NULL DEFAULT 'automated',
  ADD COLUMN IF NOT EXISTS "manual_requirements" jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "ps_script_body" text;

-- script_run_results: execution source + upload metadata
ALTER TABLE "script_run_results"
  ADD COLUMN IF NOT EXISTS "execution_source" text NOT NULL DEFAULT 'automated',
  ADD COLUMN IF NOT EXISTS "uploaded_by" text,
  ADD COLUMN IF NOT EXISTS "uploaded_at" timestamptz;
