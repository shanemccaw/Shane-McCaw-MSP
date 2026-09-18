-- Git #4793 — Verifying→Done is gated on the airplane-driven review, not on the mirror-sync
-- tick. review_requested_at is stamped when Shane's ✈ "landed" send to chat SUCCEEDS for a
-- Verifying row (BuildQueuePostgresClient.MarkReviewRequestedAsync). Every automatic
-- Verifying→Done path (PromoteVerifyingToDoneAsync, PromoteSpecificToDoneAsync, and the
-- board-Done arm of ReconcileQueueAgainstBoardAsync) now requires it to be non-NULL AND the
-- real GitHub issue to be closed, so a row stays visible in Verifying until the chat-driven
-- close after the airplane press. Nullable, additive; NULL = "not yet sent for review".
-- Cleared again whenever a row (re-)lands in Verifying (MarkCompleteAsync) so a re-run
-- build can never inherit an earlier review's signal.
--
-- Post-#3651/#3652 split: bt_build_queue lives ONLY in BUILD_DATABASE_URL (the dedicated
-- BuildConsole database) — the ALTER runs there. simulator_migration_runs lives ONLY in the
-- product DATABASE_URL — the INSERT runs there. Same split as
-- 2026-09-12-bt-build-queue-note-3742.sql.

-- Run against BUILD_DATABASE_URL:
ALTER TABLE bt_build_queue
  ADD COLUMN IF NOT EXISTS review_requested_at TIMESTAMPTZ;

-- Run against DATABASE_URL (product db):
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-18-bt-build-queue-review-requested-4793.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
