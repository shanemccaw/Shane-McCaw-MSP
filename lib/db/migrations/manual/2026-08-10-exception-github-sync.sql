-- Exception tracker -> GitHub auto-filing (production only, Epic #530).
-- Adds three columns to exception_groups so a group is filed as a GitHub
-- issue at most once: github_issue_number/url record the filed issue,
-- github_last_notified_at throttles "this happened again" comments so a
-- hot-looping error can't spam the issue.
-- Run via Shane's SQL console; do NOT run drizzle-kit push against this.

BEGIN;

ALTER TABLE exception_groups ADD COLUMN IF NOT EXISTS github_issue_number INTEGER;
ALTER TABLE exception_groups ADD COLUMN IF NOT EXISTS github_issue_url TEXT;
ALTER TABLE exception_groups ADD COLUMN IF NOT EXISTS github_last_notified_at TIMESTAMPTZ;

-- ── self-marking record ───────────────────────────────────────────────────────

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-10-exception-github-sync.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
