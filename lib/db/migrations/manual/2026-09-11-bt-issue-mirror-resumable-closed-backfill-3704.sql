-- ─────────────────────────────────────────────────────────────────────────────
-- Git #3704 — resumable closed-issue backfill bookkeeping for the local issue mirror
-- ─────────────────────────────────────────────────────────────────────────────
-- Target database: BuildConsole's OWN database (BUILD_DATABASE_URL), not the shared
-- product database — bt_* moved there in #3651 and was dropped from the product DB in
-- #3653. The guard below refuses to run anywhere that has no bt_issue_mirror_sync_state.
--
-- Why this exists. #3359 added `last_closed_backfill_at` so the mirror could gate a
-- once-a-day ALL-states walk that populated the CLOSED half of bt_issue_mirror (the real
-- created_at/closed_at history Home's burndown/rate/ETA cards read). That walk was then
-- gutted to a no-op — GitHubIssueMirror.MaybeBackfillClosedIssuesAsync recorded the
-- timestamp and fetched NOTHING — because an unthrottled ~37-page GraphQL burst tripped
-- GitHub's secondary rate limit. The bookkeeping column stayed, so the mirror reported
-- "backfilled" while holding almost no closed history at all. Live state before this fix,
-- read straight from this database:
--
--   total rows 1121  (513 open / 608 closed, only 191 with a real closed_at)
--   real repo:       513 open / 3180 closed  -> 2,572 closed issues never mirrored
--   milestone #5:    674 rows mirrored vs 2080 real   (363 open + 1717 closed)
--   milestones 4/6/11/12/13/14/16/18: ZERO rows tagged to them
--
-- #3577's completeness gate (GitHubIssueTimeSeriesService.CheckMilestoneCompletenessAsync /
-- CheckEpicCompleteness) therefore fails closed for every scope in real use, and the Home
-- dashboard renders its honest empty state indefinitely. That is what #3704 fixes.
--
-- The fix keeps the same total work but spends it safely: the backfill now walks the closed
-- set ONE page at a time with a real delay between pages, a bounded number of pages per
-- chunk, and the GraphQL cursor persisted between chunks — so it resumes across ticks and
-- across BuildConsole restarts instead of being one damaging burst. These columns are that
-- persisted walk state. Once the walk finishes, the daily re-check is a single 1-point
-- GraphQL totalCount compared against this table's own closed row count, and the walk is
-- skipped entirely unless they genuinely disagree.
--
-- Additive only (six nullable/defaulted columns). Safe to run against a live mirror; a
-- fresh install starts with cursor NULL / complete false, which is exactly "walk from the
-- beginning", so no seeding is required.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.bt_issue_mirror_sync_state') IS NULL THEN
    RAISE EXCEPTION
      'Refusing: % has no public.bt_issue_mirror_sync_state — this is not BuildConsole''s own database. Run this against BUILD_DATABASE_URL, not DATABASE_URL.',
      current_database();
  END IF;
END $$;

-- GraphQL endCursor to resume the CLOSED walk from. NULL = start at the beginning.
ALTER TABLE bt_issue_mirror_sync_state
  ADD COLUMN IF NOT EXISTS closed_backfill_cursor TEXT;

-- True once a walk reached hasNextPage=false — i.e. the whole closed set has been seen at
-- least once. Drives the cheap steady-state path (count probe instead of a re-walk).
ALTER TABLE bt_issue_mirror_sync_state
  ADD COLUMN IF NOT EXISTS closed_backfill_complete BOOLEAN NOT NULL DEFAULT false;

-- When the CURRENT (possibly still in-progress) walk began, and when its last chunk ran —
-- the latter is the short resume interval's gate, distinct from last_closed_backfill_at
-- which only advances on a genuinely COMPLETED walk.
ALTER TABLE bt_issue_mirror_sync_state
  ADD COLUMN IF NOT EXISTS closed_backfill_started_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE bt_issue_mirror_sync_state
  ADD COLUMN IF NOT EXISTS closed_backfill_chunk_at TIMESTAMP WITH TIME ZONE;

-- Real progress counters for the current walk (pages fetched, closed rows upserted), so a
-- half-finished backfill is diagnosable from SQL alone rather than only from the log.
ALTER TABLE bt_issue_mirror_sync_state
  ADD COLUMN IF NOT EXISTS closed_backfill_pages INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bt_issue_mirror_sync_state
  ADD COLUMN IF NOT EXISTS closed_backfill_rows INTEGER NOT NULL DEFAULT 0;

-- Last chunk's honest outcome (ok / stopped-on-rate-limit / error text).
ALTER TABLE bt_issue_mirror_sync_state
  ADD COLUMN IF NOT EXISTS closed_backfill_note TEXT;

-- #3359's own column recorded "a backfill ran" for a backfill that fetched nothing, so every
-- existing row's last_closed_backfill_at and complete flag are meaningless. Clear them once
-- so the first run after this migration genuinely walks instead of trusting that stale claim.
UPDATE bt_issue_mirror_sync_state
   SET last_closed_backfill_at  = NULL,
       closed_backfill_cursor   = NULL,
       closed_backfill_complete = false,
       closed_backfill_pages    = 0,
       closed_backfill_rows     = 0,
       closed_backfill_note     = 'reset by 2026-09-11-bt-issue-mirror-resumable-closed-backfill-3704.sql — #3359''s recorded backfill never fetched any issues';

-- Self-marking run record (CLAUDE.md). BuildConsole's own database has no
-- simulator_migration_runs table (that lives in the product database), so this is
-- conditional rather than unconditional — the marker is recorded where it exists.
DO $$
BEGIN
  IF to_regclass('public.simulator_migration_runs') IS NOT NULL THEN
    INSERT INTO simulator_migration_runs (filename, ran_at)
    VALUES ('2026-09-11-bt-issue-mirror-resumable-closed-backfill-3704.sql', now())
    ON CONFLICT (filename) DO UPDATE SET ran_at = now();
  END IF;
END $$;

COMMIT;
