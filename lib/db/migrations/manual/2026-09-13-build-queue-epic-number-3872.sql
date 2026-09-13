-- Git #3872 — optional `--epic <N>` dispatch-header override: an explicit, real column so a
-- build can declare its own real Epic directly at dispatch time, bypassing EpicResolver's
-- DB-inferred parent_number walk entirely for a build whose real Epic the local mirror hasn't
-- resolved yet (#3871 is the real sync-gap root-cause fix; this is the independent,
-- explicit-declaration safety net, not a replacement for it). Nullable, no default — the
-- overwhelming majority of rows never declare an override and fall back to real DB inference
-- unchanged, exactly as before.
--
-- Post-#3651/#3652 split: bt_build_queue itself lives ONLY in BUILD_DATABASE_URL (its own
-- dedicated database) — the ALTER below runs there. simulator_migration_runs (the self-marking
-- table Simulator Studio's Migrations tree reads) lives ONLY in the product DATABASE_URL, a
-- separate physical database — the INSERT below runs there instead. Same split every
-- bt_build_queue migration since #3651 has followed (see
-- 2026-09-12-bt-build-queue-note-3742.sql).

-- Run against BUILD_DATABASE_URL:
ALTER TABLE bt_build_queue
  ADD COLUMN IF NOT EXISTS epic_number INTEGER;

-- Run against DATABASE_URL (product db):
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-13-build-queue-epic-number-3872.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
