-- ============================================================================
-- #3590 — CustomerUser -> Customer; Assessment folded into Free;
--         customer:marketplace.browse-full
-- ============================================================================
-- Part of #1696 (RBAC Role Model Redesign). Sits on top of #2455's foundation,
-- #2457's seed, #3465's billing.manage and #3408's users -> *_user_roles sync.
--
-- ── The product decision (Shane, 2026-09-11) ─────────────────────────────────
--   1. `CustomerUser` is renamed `Customer` — the one paid-customer rung.
--   2. `Assessment` is folded into `Free` — one pre-payment tier, not two. The two
--      only ever diverged in the marketplace/search catalog scope, and that now asks
--      a capability instead of comparing a role string (step 8 below).
--
-- ── What this does, in order ─────────────────────────────────────────────────
--   1. Lifts users_role_scope_check if this database has it (the Drizzle schema
--      declares it; local dev does not carry it). Its first branch names the
--      retired values, so the rename in step 5 would violate it. Re-added in step 6
--      with the new values, only where it existed — unchanged in meaning.
--   2. Renames the platform `CustomerUser` role to `Customer`, in both systems. The
--      role UUID does not change, so every mapping row that allows it — and any edit
--      made to one through AdminV2 — keeps pointing at it. That is #1696 requirement 2
--      ("a rename must not orphan a reference") doing exactly its job.
--   3. Replaces rbac_sync_user_roles() (#3408) with the six-rung ladder. Same rule,
--      same shape; only the rung list changes.
--   4. Deletes the platform `Assessment` role, in both systems. Its memberships
--      cascade, and #2455's purge trigger strips its id from every mapping's
--      allow/deny arrays in the same transaction. Every mapping that allowed
--      Assessment also allows Free (the ladder is a superset chain, and billing.*
--      allow every rung), so no user's effective permission set changes.
--   5. Rewrites the stored values: users.msp_role CustomerUser -> Customer and
--      Assessment -> Free (the #3408 trigger re-converges each row's memberships as
--      it goes), and the same for msp_invites.msp_role so a pending invite accepts
--      into a rung that exists. UPDATE with WHERE, not DROP.
--   6. Restores users_role_scope_check where step 1 lifted it.
--   7. Retires `msp:ladder.assessment`: its gates now ask `ladder.free`, which
--      admits exactly the set it did once Assessment is Free. The mapping row is
--      deleted (the rung it transcribed no longer exists); the catalog row is
--      flagged inactive rather than deleted, per syncCapabilityCatalog's rule.
--      `ladder.customer-user` KEEPS its key — capability keys are immutable once
--      shipped (capabilities.ts) — and only its label/description follow the rename.
--   8. Adds `customer:marketplace.browse-full`, granted on the platform mapping to
--      Customer and every rung above it (ServiceAccount, MSPOperator, MSPAdmin,
--      PlatformAdmin) — i.e. every rung except the pre-payment Free rung. A prospect
--      gains it the moment payment promotes them Free -> Customer. ON CONFLICT DO
--      NOTHING: once the row exists it may have been narrowed in AdminV2, and a
--      re-run must never widen it back.
--   9. Rewrites the two seeded weekly-rescan triggers whose fan_out_query names
--      'Assessment' (seed-system-workflows.ts only INSERTs a trigger when none exists,
--      so the code change alone never reaches an existing database).
--  10. Re-runs the #3408 convergence over every user.
--
-- ── Deliberately NOT rewritten ───────────────────────────────────────────────
--   msp_audit_logs.actor_role (and the other *_audit/*_events actor_role columns)
--   keep 'CustomerUser'/'Assessment' where they were recorded. They are history —
--   what the actor WAS when they acted — and rewriting an audit trail is falsifying
--   it. The two workflow definition NAMES ("... Free/Assessment Tenants") are the
--   seed's upsert key, so renaming them would fork a duplicate definition.
--
-- ── Safety ───────────────────────────────────────────────────────────────────
-- One transaction; idempotent (every step is keyed on the old value still being
-- present, or is ON CONFLICT DO NOTHING / CREATE OR REPLACE). Run against the local
-- dev DATABASE_URL in-session per CLAUDE.md's Database section. Replit/Staging is on
-- #1630 — and must ship WITH the #3590 code: the code looks the rung up by the new
-- keys, so code without this migration fails closed (503, logged) on every gate.
--
-- Verified by: pnpm --filter @workspace/db run check-rbac-parity, and
-- pnpm --filter @workspace/db test (src/rbac/user-role-sync.test.ts).
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.msp_roles') IS NULL OR to_regclass('public.customer_roles') IS NULL THEN
    RAISE EXCEPTION 'REFUSING: #2455''s RBAC tables are missing. Run 2026-09-09-rbac-foundation-2455.sql first.';
  END IF;
  IF to_regprocedure('rbac_sync_user_roles(integer)') IS NULL THEN
    RAISE EXCEPTION 'REFUSING: #3408''s rbac_sync_user_roles() is missing. Run 2026-09-10-rbac-user-roles-maintained-3408.sql first.';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 1. Lift users_role_scope_check, remembering whether it was there
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  had_check boolean := EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'users'::regclass AND conname = 'users_role_scope_check');
BEGIN
  IF had_check THEN
    ALTER TABLE users DROP CONSTRAINT users_role_scope_check;
  END IF;
  PERFORM set_config('rbac_3590.had_role_scope_check', had_check::text, true);
END $$;

-- ----------------------------------------------------------------------------
-- 2. CustomerUser -> Customer, same role id, both systems
-- ----------------------------------------------------------------------------
UPDATE msp_roles
   SET key = 'Customer', name = 'Customer',
       description = replace(description, 'CustomerUser', 'Customer'), updated_at = now()
 WHERE msp_id IS NULL AND key = 'CustomerUser';

UPDATE customer_roles
   SET key = 'Customer', name = 'Customer',
       description = replace(description, 'CustomerUser', 'Customer'), updated_at = now()
 WHERE tenant_id IS NULL AND key = 'CustomerUser';

-- The rung descriptions carry their ladder position ("rung 2 of 6"); with the bottom
-- rung gone every index moves down by one.
WITH ladder(role_key, idx) AS (
  VALUES ('Free', 0), ('Customer', 1), ('ServiceAccount', 2),
         ('MSPOperator', 3), ('MSPAdmin', 4), ('PlatformAdmin', 5)
)
UPDATE msp_roles r
   SET description = regexp_replace(r.description, 'rung [0-9]+ of 6', 'rung ' || l.idx || ' of 5'),
       updated_at = now()
  FROM ladder l
 WHERE r.msp_id IS NULL AND r.key = l.role_key AND r.description ~ 'rung [0-9]+ of 6';

WITH ladder(role_key, idx) AS (
  VALUES ('Free', 0), ('Customer', 1), ('ServiceAccount', 2),
         ('MSPOperator', 3), ('MSPAdmin', 4), ('PlatformAdmin', 5)
)
UPDATE customer_roles r
   SET description = regexp_replace(r.description, 'rung [0-9]+ of 6', 'rung ' || l.idx || ' of 5'),
       updated_at = now()
  FROM ladder l
 WHERE r.tenant_id IS NULL AND r.key = l.role_key AND r.description ~ 'rung [0-9]+ of 6';

-- ----------------------------------------------------------------------------
-- 3. The #3408 rule, on the six-rung ladder
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rbac_sync_user_roles(p_user_id integer) RETURNS void AS $$
DECLARE
  -- LEGACY_ROLE_ORDER (lib/db/src/rbac/legacy-ladder.ts) as of #3590: CustomerUser
  -- renamed Customer, Assessment folded into Free.
  rungs  CONSTANT text[] := ARRAY['Free', 'Customer', 'ServiceAccount',
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
-- 4. Retire the Assessment rung's role, both systems
-- ----------------------------------------------------------------------------
DELETE FROM msp_roles      WHERE msp_id    IS NULL AND key = 'Assessment';
DELETE FROM customer_roles WHERE tenant_id IS NULL AND key = 'Assessment';

-- ----------------------------------------------------------------------------
-- 5. The stored values
-- ----------------------------------------------------------------------------
UPDATE users SET msp_role = 'Customer', updated_at = now() WHERE msp_role = 'CustomerUser';
UPDATE users SET msp_role = 'Free',     updated_at = now() WHERE msp_role = 'Assessment';

UPDATE msp_invites SET msp_role = 'Customer' WHERE msp_role = 'CustomerUser';
UPDATE msp_invites SET msp_role = 'Free'     WHERE msp_role = 'Assessment';

-- ----------------------------------------------------------------------------
-- 6. Restore users_role_scope_check where step 1 lifted it
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF current_setting('rbac_3590.had_role_scope_check', true) = 'true' THEN
    ALTER TABLE users ADD CONSTRAINT users_role_scope_check CHECK (
      (msp_role IN ('Customer', 'Free') AND tenant_id IS NOT NULL)
      OR
      (msp_role IN ('MSPAdmin', 'MSPOperator', 'ServiceAccount') AND msp_id IS NOT NULL)
      OR
      (msp_role = 'PlatformAdmin')
    );
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 7. The ladder capabilities
-- ----------------------------------------------------------------------------
DELETE FROM msp_feature_role_mapping WHERE capability_key = 'ladder.assessment';

UPDATE rbac_capabilities
   SET is_active = false, updated_at = now()
 WHERE system = 'msp' AND key = 'ladder.assessment' AND is_active;

-- Same strings ladderCapabilityLabel/ladderCapabilityDescription build in TS.
UPDATE rbac_capabilities
   SET label = 'Passes requireRole("Customer")',
       description = 'Transitional transcription of the ROLE_ORDER ladder in '
         || 'artifacts/api-server/src/middlewares/requireAuth.ts:80-93 — true exactly when '
         || 'roleIndex(effective role) >= roleIndex("Customer"). Seeded as data by #2457, read by '
         || '#2458 when requireRole''s decision source moves onto the evaluator, retired with '
         || 'MSP_ROLES by #2460.',
       updated_at = now()
 WHERE system = 'msp' AND key = 'ladder.customer-user';

-- ----------------------------------------------------------------------------
-- 8. customer:marketplace.browse-full
-- ----------------------------------------------------------------------------
INSERT INTO rbac_capabilities (system, key, category, label, description) VALUES
  ('customer', 'marketplace.browse-full', 'marketplace', 'Browse the full marketplace',
   'See the full purchasable catalog in the portal marketplace and in customer search — assessments and the monitoring upsell plus micro-offers, projects and retainers. Without it a caller sees the pre-payment catalog only (assessments + monitoring). Replaces a raw `role === "Assessment"` comparison in artifacts/api-server/src/routes/portal-marketplace.ts and portal-customer-search.ts (#3590): the platform mapping grants it to the paid Customer rung and every rung above it, so a prospect gains it the moment payment promotes them from Free to Customer.')
ON CONFLICT (system, key) DO UPDATE SET
  category    = EXCLUDED.category,
  label       = EXCLUDED.label,
  description = EXCLUDED.description,
  is_active   = true,
  updated_at  = now();

INSERT INTO customer_feature_role_mapping (tenant_id, system, capability_key, roles)
SELECT NULL, 'customer', 'marketplace.browse-full',
       jsonb_build_object(
         'allow', COALESCE((SELECT jsonb_agg(id::text ORDER BY key) FROM customer_roles
                   WHERE tenant_id IS NULL
                     AND key IN ('Customer', 'ServiceAccount', 'MSPOperator', 'MSPAdmin', 'PlatformAdmin')), '[]'::jsonb),
         'deny',  '[]'::jsonb)
ON CONFLICT (capability_key) WHERE tenant_id IS NULL DO NOTHING;

-- ----------------------------------------------------------------------------
-- 9. The seeded weekly-rescan fan-out queries
-- ----------------------------------------------------------------------------
UPDATE wf_triggers
   SET config = jsonb_set(
         config, '{fan_out_query}',
         to_jsonb(replace(replace(config->>'fan_out_query',
                   'u.msp_role IN (''Free'', ''Assessment'')', 'u.msp_role = ''Free'''),
                   'u.msp_role = ''Assessment''', 'u.msp_role = ''Free''')))
 WHERE type = 'schedule' AND config->>'fan_out_query' LIKE '%''Assessment''%';

-- ----------------------------------------------------------------------------
-- 10. Converge every user once more under the new rule
-- ----------------------------------------------------------------------------
SELECT rbac_sync_user_roles(id) FROM users;

-- ----------------------------------------------------------------------------
-- Run tracking (Git #497) — Simulator Studio's Migrations tree reads this.
-- ----------------------------------------------------------------------------
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-11-rbac-customer-free-roles-3590.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
