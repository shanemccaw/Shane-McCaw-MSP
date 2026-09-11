-- Git #3608: users_role_scope_check is declared in the Drizzle schema
-- (lib/db/src/schema/index.ts:175-181) but was absent from the live local
-- database. Live-verified pre-migration (2026-09-11):
--   select conname from pg_constraint where conrelid='users'::regclass and contype='c';
--   -> (none)
--
-- Confirmed no existing row would violate it before adding:
--   select count(*) filter (where msp_role in ('Customer','Free') and tenant_id is null),
--          count(*) filter (where msp_role in ('MSPAdmin','MSPOperator','ServiceAccount') and msp_id is null)
--   from users;
--   -> 0, 0 (9 total rows)
--
-- Added NOT VALID -> verify -> VALIDATE per the repo's established real
-- pattern for this exact constraint (see
-- lib/db/migrations/manual/2026-07-28-tenant-user-refactor-phase0-schema-wipe.sql
-- steps 3/5). No existing-row violations were found here, so NOT VALID is
-- belt-and-suspenders rather than strictly required, but it keeps this file
-- consistent with the established safe-add pattern for this table.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_role_scope_check' AND conrelid = 'users'::regclass) THEN
    ALTER TABLE users ADD CONSTRAINT users_role_scope_check CHECK (
      (msp_role IN ('Customer', 'Free') AND tenant_id IS NOT NULL)
      OR
      (msp_role IN ('MSPAdmin', 'MSPOperator', 'ServiceAccount') AND msp_id IS NOT NULL)
      OR
      (msp_role = 'PlatformAdmin')
    ) NOT VALID;
  END IF;
END $$;

DO $$
DECLARE
  n_bad integer;
BEGIN
  SELECT count(*) INTO n_bad FROM users WHERE NOT (
    (msp_role IN ('Customer', 'Free') AND tenant_id IS NOT NULL)
    OR
    (msp_role IN ('MSPAdmin', 'MSPOperator', 'ServiceAccount') AND msp_id IS NOT NULL)
    OR
    (msp_role = 'PlatformAdmin')
  );
  IF n_bad > 0 THEN
    RAISE EXCEPTION 'users_role_scope_check: % existing row(s) would violate the constraint — aborting VALIDATE', n_bad;
  END IF;
END $$;

ALTER TABLE users VALIDATE CONSTRAINT users_role_scope_check;

-- ----------------------------------------------------------------------------
-- Run tracking (Git #497) — Simulator Studio's Migrations tree reads this.
-- ----------------------------------------------------------------------------
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-11-users-role-scope-check-drift-3608.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
