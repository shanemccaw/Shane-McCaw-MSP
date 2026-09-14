-- Git #3971 (step 1 of #3970): add the two Retainer msp_role tiers to
-- users_role_scope_check.
--
-- `msp_role` is a TEXT column with an app-level Drizzle enum (LEGACY_ROLE_ORDER),
-- NOT a Postgres ENUM type, so there is no `ALTER TYPE ... ADD VALUE` here — the
-- new values become legal the moment LEGACY_ROLE_ORDER lists them
-- (lib/db/src/rbac/legacy-ladder.ts). The only live DB object that constrains the
-- column is this CHECK, which #3608 added and which must now widen:
--
--   RetainerConsented — has a tenant (same requirement shape as Customer/Free)
--   RetainerNoConsent — no tenant, ever, while in this state (own branch, no scope
--                       column required)
--
-- `Free`'s own requirement is untouched — still strictly tenant-required.
--
-- Live-verified pre-migration (2026-09-14, local shanemccawmsp):
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--     where conname='users_role_scope_check' and conrelid='users'::regclass;
--   -> the #3608 definition (Customer/Free tenant, MSP* msp_id, PlatformAdmin)
--   select msp_role, count(*) from users group by msp_role;
--   -> Customer 7, Free 3, MSPAdmin 1, MSPOperator 2, PlatformAdmin 2, ServiceAccount 1
--      (no RetainerConsented/RetainerNoConsent rows exist yet — the widened predicate
--       is a strict superset of the #3608 one, so no existing row can newly violate it)
--
-- The live constraint already exists, so this DROPs and re-adds it with the widened
-- predicate, following the repo's established NOT VALID -> verify -> VALIDATE pattern
-- for this exact constraint (#3608, and the tenant-user-refactor phase0 schema file it
-- cites). Idempotent: safe to re-run.

BEGIN;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_scope_check;

ALTER TABLE users ADD CONSTRAINT users_role_scope_check CHECK (
  (msp_role IN ('Customer', 'Free', 'RetainerConsented') AND tenant_id IS NOT NULL)
  OR
  (msp_role = 'RetainerNoConsent')
  OR
  (msp_role IN ('MSPAdmin', 'MSPOperator', 'ServiceAccount') AND msp_id IS NOT NULL)
  OR
  (msp_role = 'PlatformAdmin')
) NOT VALID;

DO $$
DECLARE
  n_bad integer;
BEGIN
  SELECT count(*) INTO n_bad FROM users WHERE NOT (
    (msp_role IN ('Customer', 'Free', 'RetainerConsented') AND tenant_id IS NOT NULL)
    OR
    (msp_role = 'RetainerNoConsent')
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
VALUES ('2026-09-13-users-role-scope-check-retainer-roles-3971.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
