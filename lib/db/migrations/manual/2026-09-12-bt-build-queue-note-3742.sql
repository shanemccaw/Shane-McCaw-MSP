-- Git #3742 — right-click "Add Note" (any status): a real, additive per-row
-- annotation column on bt_build_queue. Nullable text, no default beyond NULL —
-- most rows never get a note. Lives on the same row as everything else, so it
-- survives Mark Complete (Hide) and every other status transition automatically
-- (no special-case code needed, same reasoning as the archived/archived_at
-- pattern in 2026-09-10-bt-build-queue-archive-3607.sql).
--
-- Post-#3651/#3652 split: bt_build_queue itself lives ONLY in BUILD_DATABASE_URL
-- (its own dedicated database) — the ALTER below runs there. simulator_migration_runs
-- (the self-marking table Simulator Studio's Migrations tree reads) lives ONLY in the
-- product DATABASE_URL, a separate physical database — the INSERT below runs there
-- instead. Same split every bt_build_queue migration since #3651 has followed (see
-- 2026-09-10-bt-build-queue-archive-3607.sql).

-- Run against BUILD_DATABASE_URL:
ALTER TABLE bt_build_queue
  ADD COLUMN IF NOT EXISTS note TEXT;

-- Run against DATABASE_URL (product db):
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-12-bt-build-queue-note-3742.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
