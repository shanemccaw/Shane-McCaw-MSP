-- ============================================================================
-- Drop 7 duplicate foreign-key constraints to users(id) (Git #3361)
-- ============================================================================
-- Manual migration — DROP CONSTRAINT only. Per CLAUDE.md's destructive-migration
-- gate this is explicitly NOT destructive (reversible, loses no data), so this
-- runs in-session against local DATABASE_URL, not a Shane-runs-it change.
--
-- Found while building #3099 (indexing FK columns referencing users): seven
-- (table, column) pairs each carry TWO foreign-key constraints to users(id) with
-- identical ON DELETE/ON UPDATE actions — one Postgres-default-named `_fkey`
-- (added directly against the DB at some point) and one drizzle-kit-named
-- `_users_id_fk` (what `lib/db/src/schema/index.ts`'s `.references()` calls
-- describe today). Postgres installs a full RI trigger set per constraint, so
-- every DELETE FROM users / INSERT / UPDATE of the column runs the referential-
-- integrity check TWICE for these seven columns.
--
-- Verified live (local PostgreSQL 18.6, shanemccawmsp, 2026-09-09) — see #3361's
-- issue body for the full query + trigger-level evidence. All 7 pairs confirmed
-- identical confdeltype/confupdtype before this file was written:
--
--   table                      | column          | on delete/update (both members)
--   audit_logs                 | actor_user_id   | SET NULL / NO ACTION
--   audit_logs                 | client_id       | SET NULL / NO ACTION
--   client_app_registrations   | client_user_id  | CASCADE  / NO ACTION
--   client_automation_runs     | client_user_id  | CASCADE  / NO ACTION
--   client_callback_tokens     | client_user_id  | CASCADE  / NO ACTION
--   client_documents           | client_user_id  | CASCADE  / NO ACTION
--   client_documents           | uploaded_by     | NO ACTION / NO ACTION
--
-- Kept: the drizzle-named `_users_id_fk` member of each pair — confirmed against
-- lib/db/src/schema/index.ts that every one of these columns is declared via an
-- inline `.references(() => usersTable.id, { onDelete: ... })`, which is what
-- drizzle-kit names `<table>_<column>_users_id_fk`. Keeping that name means the
-- next `drizzle-kit generate` sees a match and does not try to recreate anything.
-- Dropped: the orphaned Postgres-default-named `_fkey` sibling — no schema file
-- describes it, it is pure duplication.
--
-- #3099's new indexes (2026-09-09-index-users-fk-columns-3099.sql) are unaffected:
-- those are freestanding btree indexes on the referencing column, not indexes
-- backing either FK constraint here, so dropping a constraint drops no index.
--
-- ── VERIFYING ─────────────────────────────────────────────────────────────
--   -- expect 0 rows (no more duplicate FK-to-users pairs)
--   select c.conrelid::regclass::text as tbl, a.attname, count(*) as n
--   from pg_constraint c
--   join unnest(c.conkey) k(attnum) on true
--   join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.attnum
--   where c.confrelid='users'::regclass and c.contype='f'
--   group by 1,2 having count(*)>1;
-- ============================================================================

BEGIN;

ALTER TABLE audit_logs
  DROP CONSTRAINT IF EXISTS audit_logs_actor_user_id_fkey;
ALTER TABLE audit_logs
  DROP CONSTRAINT IF EXISTS audit_logs_client_id_fkey;
ALTER TABLE client_app_registrations
  DROP CONSTRAINT IF EXISTS client_app_registrations_client_user_id_fkey;
ALTER TABLE client_automation_runs
  DROP CONSTRAINT IF EXISTS client_automation_runs_client_user_id_fkey;
ALTER TABLE client_callback_tokens
  DROP CONSTRAINT IF EXISTS client_callback_tokens_client_user_id_fkey;
ALTER TABLE client_documents
  DROP CONSTRAINT IF EXISTS client_documents_client_user_id_fkey;
ALTER TABLE client_documents
  DROP CONSTRAINT IF EXISTS client_documents_uploaded_by_fkey;

-- ── Self-mark for Simulator Studio's Migrations tree (#497) ─────────────────
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-10-drop-duplicate-users-fk-constraints-3361.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
