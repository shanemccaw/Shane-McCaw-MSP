-- Git #3607 — bt_build_queue soft-archive: same real archived/archived_at pattern
-- bt_chats already uses (see 2026-08-24-bt-chats-archive.sql). NOT a delete: the row
-- and its full history stay real and queryable; this only flags a stale/resolved
-- 'canceled' row out of the default Canceled board view. Set by
-- FalseDoneReconciler's new auto-archive pass (see Services/FalseDoneReconciler.cs)
-- on a terminal 'canceled' row whose real GitHub issue is confirmed closed (Rule A),
-- or that has no real GitHub issue at all — a "local #N" build (Rule B).

ALTER TABLE bt_build_queue
  ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-10-bt-build-queue-archive-3607.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
