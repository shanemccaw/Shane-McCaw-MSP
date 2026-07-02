-- Allow "quick_win" as a valid project_type value.
-- The column is plain text with no CHECK constraint, so this migration only
-- documents the intent; the Drizzle enum is updated in the schema.
-- Existing rows are unchanged (they remain "project" or "retainer").
-- No data migration needed.
SELECT 1;
