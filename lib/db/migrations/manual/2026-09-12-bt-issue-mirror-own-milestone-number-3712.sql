-- Git #3712 — bt_issue_mirror.milestone_number is the EFFECTIVE (Git #2543 transitively-
-- inherited) milestone: a sub-issue with a blank own milestone field inherits its nearest
-- ancestor's. CheckMilestoneCompletenessAsync (GitHubIssueTimeSeriesService.cs) compared that
-- inherited value against bt_milestone_mirror's own real per-milestone count (which counts only
-- issues whose OWN field is set) — two different sets, so the gate could pass while genuinely
-- missing real issues (measured live: +139 on milestone #5, +132 on #16, +124 on #11).
--
-- This column holds this issue's OWN GitHub milestone field, straight from GraphQL's
-- `milestone.number`, captured BEFORE any inheritance is applied and never mutated by it — the
-- like-for-like side a milestone completeness check needs. milestone_number is unchanged and
-- stays the effective value everything else (board, queue filters) resolves against.
--
-- Existing rows read NULL here until the next sync (full walk, incremental targeted fetch, or
-- closed backfill) repopulates it — the mirror's read/write paths were extended in the same
-- change (GitHubApiClient.cs / GitHubIssueMirror.cs) to populate it going forward. A NULL row
-- undercounts the completeness check (fails closed) rather than overcounting (failing open,
-- the original bug) — the safe direction while historical rows catch up.
--
-- bt_issue_mirror lives in the local `BuildConsole` database (BUILD_DATABASE_URL), NOT the
-- product `shanemccawmsp` database DATABASE_URL points at. Same split every bt_* migration
-- since #3651 has followed (see 2026-09-13-build-queue-epic-number-3872.sql):

-- Run against BUILD_DATABASE_URL:
ALTER TABLE bt_issue_mirror ADD COLUMN IF NOT EXISTS own_milestone_number INTEGER;

-- Run against DATABASE_URL (product db):
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-12-bt-issue-mirror-own-milestone-number-3712.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
