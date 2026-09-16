-- Git #4372 (Issue 2 of Feature #4370): widen users_role_scope_check for the four
-- Monitoring/Pack rungs #4371 added to LEGACY_ROLE_ORDER.
--
-- `msp_role` is a TEXT column with an app-level Drizzle enum (LEGACY_ROLE_ORDER), NOT a
-- Postgres ENUM type, so the new values are already legal as text — the only live DB
-- object that constrains them is this CHECK. #4371 deliberately left them out of it, so
-- until this runs every MonitoringPending/MonitoringConsented/PackPending/PackConsented
-- insert is refused regardless of tenant_id.
--
--   MonitoringConsented, PackConsented — have a tenant (joins the tenant-required branch
--                                        with Customer/Free/RetainerConsented)
--   MonitoringPending, PackPending     — no tenant, ever, while in this state (join
--                                        RetainerPending's tenant-less branch)
--
-- Before:
--   (msp_role IN ('Customer','Free','RetainerConsented') AND tenant_id IS NOT NULL)
--   OR (msp_role = 'RetainerPending')
--   OR (msp_role IN ('MSPAdmin','MSPOperator','ServiceAccount') AND msp_id IS NOT NULL)
--   OR (msp_role = 'PlatformAdmin')
--
-- `Free`'s own requirement is untouched, and a *Consented row with no tenant is still
-- refused. The widened predicate is a strict superset of the #4371 one, so no existing
-- row can newly violate it.
--
-- Live-verified pre-migration (2026-09-16, local shanemccawmsp):
--   select pg_get_constraintdef(oid) from pg_constraint
--     where conname='users_role_scope_check' and conrelid='users'::regclass;
--   -> the #4371 definition above
--   INSERT INTO users (email, role, msp_role, tenant_id)
--     VALUES ('zz-test-4372-pre@example.invalid','client','MonitoringPending',NULL);
--   -> ERROR: new row for relation "users" violates check constraint "users_role_scope_check"
--
-- Same shape as #3971's constraint-only file: DROP + re-add NOT VALID -> verify ->
-- VALIDATE. Idempotent: safe to re-run.

BEGIN;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_scope_check;

ALTER TABLE users ADD CONSTRAINT users_role_scope_check CHECK (
  (msp_role IN ('Customer', 'Free', 'RetainerConsented', 'MonitoringConsented', 'PackConsented') AND tenant_id IS NOT NULL)
  OR
  (msp_role IN ('RetainerPending', 'MonitoringPending', 'PackPending'))
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
    (msp_role IN ('Customer', 'Free', 'RetainerConsented', 'MonitoringConsented', 'PackConsented') AND tenant_id IS NOT NULL)
    OR
    (msp_role IN ('RetainerPending', 'MonitoringPending', 'PackPending'))
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
VALUES ('2026-09-16-users-role-scope-check-pending-rungs-4372.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
