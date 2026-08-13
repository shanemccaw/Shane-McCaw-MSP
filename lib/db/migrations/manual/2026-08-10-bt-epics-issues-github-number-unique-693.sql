-- Git #693: GitHub sync used to delete every bt_epics/bt_issues row with a
-- github_number and reinsert fresh ones on every sync. bt_chats.epic_id/
-- issue_id are foreign keys with ON DELETE SET NULL, so that delete silently
-- unlinked every chat that had been linked to a synced epic/issue on every
-- single sync. Fix (admin-build-tracker.ts) upserts by github_number instead
-- — this unique index is what makes that ON CONFLICT (github_number) possible.
--
-- If this fails with a uniqueness violation, it means duplicate github_number
-- values already exist (shouldn't happen under the old delete-then-reinsert
-- flow, but check first if it does):
--   SELECT github_number, COUNT(*) FROM bt_epics  WHERE github_number IS NOT NULL GROUP BY 1 HAVING COUNT(*) > 1;
--   SELECT github_number, COUNT(*) FROM bt_issues WHERE github_number IS NOT NULL GROUP BY 1 HAVING COUNT(*) > 1;
-- Resolve duplicates (keep the newest row, null out github_number on the
-- others so they don't collide) before re-running this file.

CREATE UNIQUE INDEX IF NOT EXISTS bt_epics_github_number_uniq  ON bt_epics  (github_number);
CREATE UNIQUE INDEX IF NOT EXISTS bt_issues_github_number_uniq ON bt_issues (github_number);

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-10-bt-epics-issues-github-number-unique-693.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
