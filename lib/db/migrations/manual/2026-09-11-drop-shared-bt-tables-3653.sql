-- Git #3653 — drop BuildConsole's 13 stale tables from the shared product database.
--
-- @migration-gate: manual
-- @gate-reason: DESTRUCTIVE (DROP TABLE x13). #3651 moved these tables into BuildConsole's
--   own database (BUILD_DATABASE_URL); the copies here have been frozen since the 2026-09-11
--   cutover. Preconditions re-verified 2026-09-11 before the local run: #3652 disconnected
--   /admin/build-tracker/* (no DB access left in the api-server), #3660 deleted
--   desktop/ShaneBuilder (the last DATABASE_URL reader), and no row here is missing from or
--   newer than the BuildConsole database (the only shared-only rows were 36
--   bt_chat_mentioned_issues mentions of closed/non-existent issues that BuildConsole's
--   PruneClosedChatIssueMentionsAsync had already removed from the live copy).
--
-- Safety snapshot taken immediately before the local run (outside git):
--   %USERPROFILE%\BuildConsole-db-snapshots\3653\shanemccawmsp-bt-tables-20260911T190045Z.dump  (pg_dump -Fc)
--   %USERPROFILE%\BuildConsole-db-snapshots\3653\shanemccawmsp-bt-tables-20260911T190045Z.sql   (plain)
-- Restore: pg_restore --dbname="$DATABASE_URL" <the .dump>
--
-- NEVER run this against the BuildConsole database (BUILD_DATABASE_URL) — it holds the live
-- copies. The guard below refuses any database without the product `users` table.
--
-- One DROP statement, no CASCADE: the only foreign keys into these tables come from inside
-- the set, so anything outside it that still depended on them would make this fail rather
-- than silently cascade. IF EXISTS keeps it safe on an environment that never had some of them.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.users') IS NULL THEN
    RAISE EXCEPTION 'Refusing: % has no public.users table — this is not the shared product database (is it BuildConsole''s own BUILD_DATABASE_URL?)', current_database();
  END IF;
END $$;

DROP TABLE IF EXISTS
  public.bt_build_queue,
  public.bt_chat_issues,
  public.bt_chat_mentioned_issues,
  public.bt_chats,
  public.bt_dispatch_claims,
  public.bt_epics,
  public.bt_issue_mirror,
  public.bt_issue_mirror_sync_state,
  public.bt_issues,
  public.bt_milestone_mirror,
  public.bt_test_pad_notes,
  public.build_dispatch_log,
  public.chat_pinned_questions;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-11-drop-shared-bt-tables-3653.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
