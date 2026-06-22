-- Add quiz_type column to quiz_leads table
-- Allows tracking which of the 8 quiz types (copilot, m365-health, sharepoint,
-- power-platform, security, teams, migration, governance) generated the lead.
ALTER TABLE "quiz_leads" ADD COLUMN IF NOT EXISTS "quiz_type" text NOT NULL DEFAULT 'copilot';
