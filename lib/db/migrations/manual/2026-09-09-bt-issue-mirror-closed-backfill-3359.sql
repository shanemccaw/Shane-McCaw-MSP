-- ─────────────────────────────────────────────────────────────────────────────
-- Git #3359 — closed-issue backfill bookkeeping for the local issue mirror
-- ─────────────────────────────────────────────────────────────────────────────
-- Home's dashboard (GitHubIssueTimeSeriesService) is the third live-fetch path
-- #3113/#3134/#3358 never migrated: GetAllIssuesAsync fires its OWN live
-- ListBoardIssuesAsync(GitHubIssueState.All) walk (open + closed, every issue's
-- real created_at/closed_at) every 5 minutes while Home is open, to reconstruct
-- the burndown / open-close-rate / ETA series. That is real, recurring pressure
-- on exactly the secondary-rate-limit budget the mirror exists to protect.
--
-- The mirror's full walk only ever fetches the OPEN set (ListBoardIssuesAsync(Open)),
-- so it holds essentially no historical CLOSED-issue data: a live snapshot of this
-- DB showed 500 open / 273 closed rows, of which only 31 carried a real closed_at
-- (the other 242 were marked-closed by the full walk WITHOUT a timestamp), and every
-- closed_at present was from a single day. A burndown built off that would be badly
-- wrong — worse than today's honest fail-closed. bt_milestone_mirror's per-milestone
-- open/closed counts can't help either: a daily time series needs per-issue
-- created_at/closed_at timestamps, which a header count does not carry.
--
-- The fix (this migration + GitHubIssueMirror/GitHubIssueTimeSeriesService changes):
-- populate the CLOSED set into bt_issue_mirror with real timestamps via a
-- rate-limit-conscious backfill — ONE ListBoardIssuesAsync(All) walk, gated to run at
-- most once per ClosedBackfillInterval (~24h) from inside the periodic full sync, NOT
-- per UI tick — so Home's own per-5-min All walk is retired entirely. The mirror
-- already carries every column the time series needs (created_at, closed_at,
-- milestone_number, parent_number, sub_issue_count, child_issue_numbers — all added by
-- #3358), so NO new bt_issue_mirror columns are required here. The only new state is a
-- single bookkeeping timestamp so the backfill can gate itself (and so a reader can
-- tell whether the closed set is genuinely present yet vs. not-yet-backfilled — the
-- HasClosedBackfillAsync gate that keeps the time series reading LIVE until the closed
-- history is real, exactly the same fail-closed discipline every other #3113 read uses).
--
-- Additive; safe to run against a live mirror.

ALTER TABLE bt_issue_mirror_sync_state
  ADD COLUMN IF NOT EXISTS last_closed_backfill_at TIMESTAMP WITH TIME ZONE;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-09-bt-issue-mirror-closed-backfill-3359.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
