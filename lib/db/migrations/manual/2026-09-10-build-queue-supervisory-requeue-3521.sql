-- Git #3521 — loop-safe bound for auto-re-queue of a SUPERVISORY cancel.
--
-- Background: a supervisory cancel is a 'canceled' row with exit_code = 0 — the build
-- ran, exited clean, but landed no work because the false-done/board reconciler
-- (FalseDoneReconciler / MarkFalseDoneReconciledAsync) reset it to 'canceled' (its
-- blocker wasn't actually done, or its issue was still open). Git #3517 auto-re-queued
-- such a row ONLY while it was STILL blocked (row.IsBlocked). That stranded exactly the
-- case #3521 is about: once the real blocker CLOSES, row.IsBlocked flips false, so the
-- one condition meant to catch it (blocker cleared → should launch) now DISQUALIFIES it,
-- and it sits 'canceled' forever (confirmed live for #3459 after its blocker #3493 closed).
--
-- The fix broadens the free-flow re-queue to fire whether or not the row is still blocked
-- (still-blocked → held by the #1600 launch gate; blocker cleared → launches once). To keep
-- that loop-safe (a build that keeps false-done-ing must not re-queue forever — the #1997
-- no-auto-loop guard), each supervisory auto-re-queue increments this counter, and the
-- free-flow path re-queues only while the counter is below its cap (one auto attempt; after
-- that the row stays visible for a manual Queue click). A genuine fresh dispatch inserts a
-- new row (counter defaults 0); a manual re-queue is unaffected by the counter entirely.
--
-- Additive, NOT NULL with a 0 default (every existing row reads 0 = "never auto-re-queued",
-- so #3459's already-stranded row is immediately eligible for its one auto attempt).
-- Idempotent (IF NOT EXISTS). Run against local DATABASE_URL in-session; recorded on #1630
-- for Replit/staging release.

ALTER TABLE bt_build_queue
    ADD COLUMN IF NOT EXISTS supervisory_requeue_count integer NOT NULL DEFAULT 0;

-- Self-mark so Simulator Studio's Migrations tree reflects DB reality (Git #497).
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-10-build-queue-supervisory-requeue-3521.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
