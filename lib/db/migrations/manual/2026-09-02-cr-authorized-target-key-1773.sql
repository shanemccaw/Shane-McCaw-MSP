-- #1773 — the CR write gate authorized on tenant alone; it never verified the
-- CR actually describes the pack/SOP being executed. This adds the optional
-- scoping column `claimChangeRequestForWrite` now enforces an exact match
-- against, when set. NULL preserves #1497's original tenant-granularity model
-- for every pre-existing row and every general, non-catalog CR.
ALTER TABLE msp_change_requests
  ADD COLUMN IF NOT EXISTS authorized_target_key TEXT;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-02-cr-authorized-target-key-1773.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
