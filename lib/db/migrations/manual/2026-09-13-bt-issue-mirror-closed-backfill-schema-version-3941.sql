-- ─────────────────────────────────────────────────────────────────────────────
-- Git #3941 — closed-issue backfill row-schema version
-- ─────────────────────────────────────────────────────────────────────────────
-- Target database: BuildConsole's OWN database (BUILD_DATABASE_URL), not the product
-- database — bt_* lives there since #3651. The guard below refuses to run anywhere else.
--
-- Why this exists. Home's "historical data not yet fully synced for this milestone —
-- 317 of 2233" never cleared. Live state read from this database on 2026-09-13:
--
--   closed backfill:  complete = true, last completed 2026-09-12 19:24 EDT,
--                     note "reconciled: 3362 mirrored closed vs 3362 real"
--   #3712 added bt_issue_mirror.own_milestone_number at 2026-09-12 21:19 EDT
--   closed rows:      3460, of which only 33 have own_milestone_number set
--   milestone #5:     real 288 open + 1949 closed; mirrored own-milestone 289 open + 33 closed
--
-- The backfill was not slow or stuck — it had finished before the column existed, and its
-- steady-state check compares only the closed ROW count, which was already equal. It would
-- never re-walk, so the closed rows' own_milestone_number stayed NULL forever and #3577's
-- milestone gate could never pass.
--
-- This column records which row shape (GitHubIssueMirror.ClosedBackfillRowSchemaVersion) the
-- last completed walk wrote. Default 0 means "predates versioning", so the first sync after
-- this runs re-walks the closed set once and records the current version on completion.
--
-- Additive only (one defaulted column). No data rewrite.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.bt_issue_mirror_sync_state') IS NULL THEN
    RAISE EXCEPTION
      'Refusing: % has no public.bt_issue_mirror_sync_state — this is not BuildConsole''s own database. Run this against BUILD_DATABASE_URL, not DATABASE_URL.',
      current_database();
  END IF;
END $$;

ALTER TABLE bt_issue_mirror_sync_state
  ADD COLUMN IF NOT EXISTS closed_backfill_schema_version INTEGER NOT NULL DEFAULT 0;

-- Self-marking run record (CLAUDE.md), conditional because BuildConsole's own database has no
-- simulator_migration_runs table.
DO $$
BEGIN
  IF to_regclass('public.simulator_migration_runs') IS NOT NULL THEN
    INSERT INTO simulator_migration_runs (filename, ran_at)
    VALUES ('2026-09-13-bt-issue-mirror-closed-backfill-schema-version-3941.sql', now())
    ON CONFLICT (filename) DO UPDATE SET ran_at = now();
  END IF;
END $$;

COMMIT;
