-- ============================================================================
-- #3408 — keep msp_user_roles / customer_user_roles live, not a one-time snapshot
-- ============================================================================
-- Part of #1696 (RBAC Role Model Redesign). Sits on top of #2455's foundation and
-- #2457's seed (2026-09-09-rbac-seed-current-model-2457.sql).
--
-- ── The defect ───────────────────────────────────────────────────────────────
-- #2457 granted every user their rung, in both systems, from the real `users` rows.
-- That was a snapshot. Nothing in the running product wrote either table after it:
-- signup (auth.ts), MSP staff and customer team invite acceptance (msp-team.ts,
-- portal-team.ts), onboarding, billing-webhook account creation, workflow-created
-- clients, direct tenant provisioning and its CustomerUser re-role, and the Active
-- Directory role reassignment all insert or re-role a `users` row and leave the
-- RBAC tables untouched. So a user created after the seed held no rung row at all,
-- and a re-roled user kept their old one.
--
-- ── Why a trigger, not ten call sites ───────────────────────────────────────
-- Wiring each writer to call assignUserRole/removeUserRole fixes the ten writers
-- that exist today and none of the ones added tomorrow — which is exactly how this
-- gap opened. A trigger on `users` also covers raw SQL, seeds, tests and the
-- Simulator Studio SQL Runner, and runs in the same transaction as the write, so a
-- user can never exist, even briefly, without their rung row. The rule lives in one
-- place: rbac_sync_user_roles() below.
--
-- ── What is converged, and from where ───────────────────────────────────────
-- Each role is converged from whatever is ACTUALLY its source of truth today. That
-- differs per role, since #2460 moved two of them onto rows:
--
--   * The seven rungs, in BOTH systems — from `users.role` / `users.msp_role`,
--     using the same `role = 'admin' ? 'PlatformAdmin' : msp_role` promotion the
--     seed (step 6) and `effectiveLegacyRole` use. A value that is not one of the
--     seven holds no rung, matching the seed and `roleIndex()`'s -1. `msp_role` is
--     plain text with no CHECK, so that filter is load-bearing: without it, setting
--     `msp_role = 'cap.team.manage'` would grant a capability role.
--
--   * `cap.changes.approve` — from `users.can_approve_changes`. That column is still
--     what portal-change-control.ts and portal-settings-change-control.ts read, so it
--     is still the source of truth, and the role follows it both ways.
--
--   * `cap.purchases.approve` — NOT converged from `can_approve_purchases`. #2460
--     retired that column: msp-settings.ts now grants the role directly, so the
--     column is dead and converging from it would revoke real grants. One rung-driven
--     rule is enforced instead. The old column only ever granted anything on the
--     MSPOperator branch (msp-v1.ts), and the seed carried it forward for
--     MSPOperators alone. So a user whose rung falls below MSPOperator loses the role.
--     Otherwise an MSPOperator re-roled to CustomerUser would keep a
--     purchase-approval grant the old model would have stopped honouring the moment
--     the role changed. It is kept on MSPAdmin/PlatformAdmin, where it is inert, so
--     demoting back to MSPOperator gives the same answer the column did.
--
--   * `cap.team.manage` — NOT touched. #2460 made the row the source of truth, and
--     the old rule honoured the flag for every rung, so no re-role changes it.
--
-- Only PLATFORM-scoped roles (msp_id / tenant_id IS NULL) are touched. An org's
-- own custom roles, and any grant an admin made through AdminV2 (admin-rbac.ts),
-- are left alone — except a hand-granted extra RUNG, which the next convergence
-- removes. That is the seed's own rule (a user holds exactly their effective rung),
-- and today's readers ignore held rung rows anyway (rbac-capability.ts — the JWT
-- claim decides the rung).
--
-- ── What this does NOT change ───────────────────────────────────────────────
-- No authorization decision moves. requireCapability still reads the rung from the
-- verified JWT claim (rbac-ladder.ts) and rbac-capability.ts still ignores held rung
-- rows; this migration makes the rows TRUE so that the step which finally reads them
-- can land on data that is correct.
--
-- ── Retirement ──────────────────────────────────────────────────────────────
-- Transitional, like the columns it reads. When `users.msp_role` stops being the
-- source of the rung, drop both triggers and the function. The UPDATE trigger names
-- `can_approve_changes` in its column list, so a future `DROP COLUMN
-- can_approve_changes` fails loudly on the dependency instead of silently leaving a
-- function that references a column that no longer exists.
--
-- ── Safety ──────────────────────────────────────────────────────────────────
-- Additive DDL (a function and two triggers) plus a convergence pass over existing
-- rows, which is what re-running #2457's seed already does. Idempotent: CREATE OR
-- REPLACE, DROP TRIGGER IF EXISTS before each CREATE. If #2457's roles are absent
-- the function inserts nothing and raises nothing, so a signup can never fail
-- because the RBAC model is unseeded. Run against the local dev DATABASE_URL
-- in-session, per CLAUDE.md's Database section. Replit/Staging is on #1630.
--
-- Verified by: pnpm --filter @workspace/db test  (src/rbac/user-role-sync.test.ts,
-- real database, rolled back) and pnpm --filter @workspace/db run check-rbac-parity
-- (its maintenance pass fails on any user whose rows disagree with this function).
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.msp_user_roles') IS NULL OR to_regclass('public.customer_user_roles') IS NULL THEN
    RAISE EXCEPTION 'REFUSING: #2455''s RBAC tables are missing. Run 2026-09-09-rbac-foundation-2455.sql first.';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 1. The rule, in one place
-- ----------------------------------------------------------------------------
-- A plain function of a user id (not only a trigger function) so the backfill
-- below, and anyone repairing a database by hand, run exactly the same rule:
--   SELECT rbac_sync_user_roles(id) FROM users;

CREATE OR REPLACE FUNCTION rbac_sync_user_roles(p_user_id integer) RETURNS void AS $$
DECLARE
  -- ROLE_ORDER, as in #2457's seed and LEGACY_ROLE_ORDER (lib/db/src/rbac/legacy-ladder.ts).
  rungs  CONSTANT text[] := ARRAY['Assessment', 'Free', 'CustomerUser', 'ServiceAccount',
                                  'MSPOperator', 'MSPAdmin', 'PlatformAdmin'];
  -- The rungs on which holding cap.purchases.approve is still consistent with the
  -- old column: MSPOperator, where it granted, and the two above it, where it is inert.
  purchase_rungs CONSTANT text[] := ARRAY['MSPOperator', 'MSPAdmin', 'PlatformAdmin'];
  u      record;
  rung   text;
BEGIN
  SELECT role, msp_role, can_approve_changes INTO u FROM users WHERE id = p_user_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  rung := CASE WHEN u.role = 'admin' THEN 'PlatformAdmin' ELSE u.msp_role END;
  IF rung IS NOT NULL AND NOT (rung = ANY (rungs)) THEN
    rung := NULL;
  END IF;

  -- Rung — MSP system.
  DELETE FROM msp_user_roles ur
   USING msp_roles r
   WHERE ur.role_id = r.id
     AND ur.user_id = p_user_id
     AND r.msp_id IS NULL
     AND r.key = ANY (rungs)
     AND r.key IS DISTINCT FROM rung;

  IF rung IS NOT NULL THEN
    INSERT INTO msp_user_roles (user_id, role_id)
    SELECT p_user_id, r.id FROM msp_roles r WHERE r.msp_id IS NULL AND r.key = rung
    ON CONFLICT (user_id, role_id) DO NOTHING;
  END IF;

  -- Rung — customer system (mirrored by #2457; see that file's header for why).
  DELETE FROM customer_user_roles ur
   USING customer_roles r
   WHERE ur.role_id = r.id
     AND ur.user_id = p_user_id
     AND r.tenant_id IS NULL
     AND r.key = ANY (rungs)
     AND r.key IS DISTINCT FROM rung;

  IF rung IS NOT NULL THEN
    INSERT INTO customer_user_roles (user_id, role_id)
    SELECT p_user_id, r.id FROM customer_roles r WHERE r.tenant_id IS NULL AND r.key = rung
    ON CONFLICT (user_id, role_id) DO NOTHING;
  END IF;

  -- cap.purchases.approve — revoked below MSPOperator; never granted here.
  IF rung IS NULL OR NOT (rung = ANY (purchase_rungs)) THEN
    DELETE FROM msp_user_roles ur
     USING msp_roles r
     WHERE ur.role_id = r.id
       AND ur.user_id = p_user_id
       AND r.msp_id IS NULL
       AND r.key = 'cap.purchases.approve';
  END IF;

  -- cap.changes.approve — follows users.can_approve_changes both ways.
  IF u.can_approve_changes THEN
    INSERT INTO customer_user_roles (user_id, role_id)
    SELECT p_user_id, r.id FROM customer_roles r WHERE r.tenant_id IS NULL AND r.key = 'cap.changes.approve'
    ON CONFLICT (user_id, role_id) DO NOTHING;
  ELSE
    DELETE FROM customer_user_roles ur
     USING customer_roles r
     WHERE ur.role_id = r.id
       AND ur.user_id = p_user_id
       AND r.tenant_id IS NULL
       AND r.key = 'cap.changes.approve';
  END IF;
END $$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- 2. The triggers
-- ----------------------------------------------------------------------------
-- AFTER, so the user row exists for the membership FK and the scope-check trigger
-- on *_user_roles. The UPDATE trigger fires only when one of the three source
-- columns actually changes value — a login stamping last_login_at does not touch
-- the RBAC tables.

CREATE OR REPLACE FUNCTION rbac_sync_user_roles_trigger() RETURNS trigger AS $$
BEGIN
  PERFORM rbac_sync_user_roles(NEW.id);
  RETURN NULL;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS users_rbac_sync_on_insert ON users;
CREATE TRIGGER users_rbac_sync_on_insert
  AFTER INSERT ON users
  FOR EACH ROW EXECUTE FUNCTION rbac_sync_user_roles_trigger();

DROP TRIGGER IF EXISTS users_rbac_sync_on_update ON users;
CREATE TRIGGER users_rbac_sync_on_update
  AFTER UPDATE OF role, msp_role, can_approve_changes ON users
  FOR EACH ROW
  WHEN (OLD.role IS DISTINCT FROM NEW.role
        OR OLD.msp_role IS DISTINCT FROM NEW.msp_role
        OR OLD.can_approve_changes IS DISTINCT FROM NEW.can_approve_changes)
  EXECUTE FUNCTION rbac_sync_user_roles_trigger();

-- ----------------------------------------------------------------------------
-- 3. Catch up every user created or re-roled between the seed and now
-- ----------------------------------------------------------------------------
SELECT rbac_sync_user_roles(id) FROM users;

-- ----------------------------------------------------------------------------
-- Run tracking (Git #497) — Simulator Studio's Migrations tree reads this.
-- ----------------------------------------------------------------------------
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-10-rbac-user-roles-maintained-3408.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
