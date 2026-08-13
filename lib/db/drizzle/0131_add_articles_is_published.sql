-- Add is_published flag to articles so AI-generated drafts can be reviewed
-- before they appear on the public site.
--
-- Safety note: the backfill UPDATE is correct and safe to run unconditionally.
-- This migration is tracked in __drizzle_migrations and executes exactly once per
-- environment. At the time it runs, the draft concept does not yet exist in any
-- running code — the workflow executor only writes is_published=false for new rows
-- after this migration has already been applied. Therefore every row with
-- is_published=false at migration time is a legacy published article that needs
-- to be backfilled, not a deliberate draft.
ALTER TABLE articles ADD COLUMN IF NOT EXISTS is_published BOOLEAN NOT NULL DEFAULT false;
UPDATE articles SET is_published = true WHERE is_published = false;
