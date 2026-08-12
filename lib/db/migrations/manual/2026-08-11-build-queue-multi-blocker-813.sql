-- Git #813 — Shane tried "--blocked-by 807,808,809" to queue one build that
-- waits on THREE prior phases finishing; the queue only ever supported a
-- single blocked_by_number column, so the comma list silently failed to
-- parse and the item queued as unblocked. This adds real multi-blocker
-- support: blocked_by_numbers holds ALL of them, and every one must clear
-- before the watcher will claim the row.
ALTER TABLE bt_build_queue ADD COLUMN IF NOT EXISTS blocked_by_numbers integer[];

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-11-build-queue-multi-blocker-813.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
