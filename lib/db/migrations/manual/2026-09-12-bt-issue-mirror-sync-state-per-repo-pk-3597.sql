-- ─────────────────────────────────────────────────────────────────────────────
-- Git #3597 — bt_issue_mirror_sync_state: real per-repo PK, drop id/CHECK singleton
-- ─────────────────────────────────────────────────────────────────────────────
-- Target database: BuildConsole's OWN database (BUILD_DATABASE_URL) — bt_* tables
-- moved there in #3651 and were dropped from the product database in #3653. The
-- guard below refuses to run anywhere that doesn't already have this table.
--
-- Why: #3579 found (and deliberately left out of its own scope) that
-- bt_issue_mirror_sync_state is a hardcoded singleton row (`id integer PRIMARY KEY
-- DEFAULT 1`, `CHECK (id = 1)`) tracking exactly one GitHub sync job's bookkeeping.
-- A second real repo (shanes-git's own MCP server source, being split out of this
-- monorepo) is about to be registered, and GitHubIssueMirror.cs's
-- RecordSyncStateAsync / RecordIncrementalSyncStateAsync / RecordClosedBackfillAsync
-- (and their readers) all hardcode `WHERE id = 1` — a second repo's sync would
-- either collide with or silently reuse the Main repo's row.
--
-- Real fix — option (a) from #3597's own body: change the PK to
-- (repo_owner, repo_name) and drop the id/CHECK singleton pattern entirely, one
-- real row per repo. This matches the real per-repo pattern #3579 already
-- established on bt_issue_mirror / bt_build_queue.
--
-- Additive-safe: adds the two new columns, backfills the existing singleton row
-- with the Main repo's real identity (RepoIdentity.DefaultOwner/DefaultName),
-- preserving every existing last_full_sync_at / last_incremental_sync_at /
-- last_closed_backfill_at / closed_backfill_* value untouched, THEN swaps the PK.
-- No row is dropped, no timestamp is lost — the table is simply re-keyed.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.bt_issue_mirror_sync_state') IS NULL THEN
    RAISE EXCEPTION
      'Refusing: % has no public.bt_issue_mirror_sync_state — this is not BuildConsole''s own database. Run this against BUILD_DATABASE_URL, not DATABASE_URL.',
      current_database();
  END IF;
END $$;

-- 1. Add the new per-repo identity columns (nullable for now — backfilled next).
ALTER TABLE bt_issue_mirror_sync_state
  ADD COLUMN IF NOT EXISTS repo_owner TEXT,
  ADD COLUMN IF NOT EXISTS repo_name  TEXT;

-- 2. Backfill every existing row (today, only the old id=1 singleton) with the
--    Main repo's real identity (RepoIdentity.DefaultOwner / DefaultName in
--    desktop/BuildConsole/Services/RepoIdentity.cs) — its own real
--    last_full_sync_at / last_incremental_sync_at / last_closed_backfill_at /
--    closed_backfill_* values are untouched by this UPDATE.
UPDATE bt_issue_mirror_sync_state
   SET repo_owner = 'shanemccaw',
       repo_name  = 'Shane-McCaw-MSP'
 WHERE repo_owner IS NULL OR repo_name IS NULL;

-- 3. Now that every row has a real identity, make the columns mandatory.
ALTER TABLE bt_issue_mirror_sync_state
  ALTER COLUMN repo_owner SET NOT NULL,
  ALTER COLUMN repo_name  SET NOT NULL;

-- 4. Swap the PK: drop the old id/CHECK singleton, add the real per-repo PK.
ALTER TABLE bt_issue_mirror_sync_state
  DROP CONSTRAINT IF EXISTS bt_issue_mirror_sync_state_singleton;
ALTER TABLE bt_issue_mirror_sync_state
  DROP CONSTRAINT IF EXISTS bt_issue_mirror_sync_state_pkey;
ALTER TABLE bt_issue_mirror_sync_state
  DROP COLUMN IF EXISTS id;
ALTER TABLE bt_issue_mirror_sync_state
  ADD CONSTRAINT bt_issue_mirror_sync_state_pkey PRIMARY KEY (repo_owner, repo_name);

-- Self-marking run record (CLAUDE.md). BuildConsole's own database has no
-- simulator_migration_runs table (that lives in the product database), so this is
-- conditional rather than unconditional — the marker is recorded where it exists.
DO $$
BEGIN
  IF to_regclass('public.simulator_migration_runs') IS NOT NULL THEN
    INSERT INTO simulator_migration_runs (filename, ran_at)
    VALUES ('2026-09-12-bt-issue-mirror-sync-state-per-repo-pk-3597.sql', now())
    ON CONFLICT (filename) DO UPDATE SET ran_at = now();
  END IF;
END $$;

COMMIT;
