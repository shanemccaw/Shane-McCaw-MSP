-- Git #1839 — Adopt live builds by pid when BuildConsole restarts.
--
-- Store the launched build process's pid AND its process-creation time so a
-- fresh BuildConsole instance can safely re-attach (adopt) a build that is still
-- running after the app was closed, instead of falsely marking every 'running'
-- row failed -2 (RecoverOrphanedRunningItemsAsync). The creation time is the
-- fingerprint that makes the pid match safe — Windows reuses pids, so a stored
-- pid alone would eventually match some unrelated process and we would adopt (or
-- on Stop, KILL) a stranger. Both columns are cleared on completion so a stale
-- pid never outlives its build.
--
-- Additive, nullable columns. Idempotent (IF NOT EXISTS). Run against local
-- DATABASE_URL in-session; recorded on #1630 for Replit/staging release.

ALTER TABLE bt_build_queue ADD COLUMN IF NOT EXISTS build_pid integer;
ALTER TABLE bt_build_queue ADD COLUMN IF NOT EXISTS build_pid_started_at timestamptz;

-- Self-mark so Simulator Studio's Migrations tree reflects DB reality (Git #497).
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-30-build-queue-pid-1839.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
