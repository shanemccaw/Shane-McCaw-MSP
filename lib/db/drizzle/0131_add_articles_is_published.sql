-- Add is_published flag to articles so AI-generated drafts can be reviewed
-- before they appear on the public site.
-- Backfill: all pre-existing rows are treated as published (they had no draft concept).
ALTER TABLE articles ADD COLUMN IF NOT EXISTS is_published BOOLEAN NOT NULL DEFAULT false;
UPDATE articles SET is_published = true WHERE is_published = false;
