-- Git #2103 — Windows toast warning on re-dispatch (threshold 2, before launch).
--
-- New table: every real build dispatch (a fresh claude.exe launch for a queued
-- issue — never a Reply/--resume continuation, which picks back up the same
-- session instead) logs one row here at dispatch time
-- (QueueWatcherService.LaunchItem, via BuildQueuePostgresClient.LogDispatchAsync,
-- right before the process spawns).
--
-- Before firing a build, the launcher counts how many rows exist for that
-- issue_number since it last left the Batter-Up-family board columns (Status
-- field options "Batter Up" / "AI Batter Up") into "Backlog" or "Park", or was
-- closed — via the real GitHub GraphQL project-status timeline
-- (issue.timelineItems(PROJECT_V2_ITEM_STATUS_CHANGED_EVENT / CLOSED_EVENT),
-- confirmed live via `gh api graphql` introspection), not a raw all-time count.
-- If that count is >= 1 (this dispatch would be the 2nd since the issue last
-- left the family), a Windows toast (ToastEngine) fires before the process
-- spawns.
--
-- queue_item_id links back to the exact bt_build_queue row this dispatch came
-- from (nullable FK) so MarkCompleteAsync can fill in session_id/outcome on the
-- SAME row later without a fragile in-memory map that wouldn't survive an app
-- restart mid-build.
--
-- Additive, new table. Idempotent (IF NOT EXISTS). Run against local
-- DATABASE_URL in-session; recorded on #1630 for Replit/staging release.

CREATE TABLE IF NOT EXISTS build_dispatch_log (
  id            serial PRIMARY KEY,
  issue_number  integer NOT NULL,
  queue_item_id integer REFERENCES bt_build_queue(id) ON DELETE SET NULL,
  dispatched_at timestamptz NOT NULL DEFAULT now(),
  session_id    text,
  outcome       text
);

CREATE INDEX IF NOT EXISTS build_dispatch_log_issue_number_dispatched_at_idx
  ON build_dispatch_log (issue_number, dispatched_at);

-- Self-mark so Simulator Studio's Migrations tree reflects DB reality (Git #497).
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-31-build-dispatch-log-2103.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
