-- ============================================================================
-- RBAC foundation: roles / user_roles / feature_role_mapping (Git #2455)
-- Part of #1696 — RBAC Role Model Redesign. Migration step 1 of 5.
-- ============================================================================
-- Manual migration — self-executed against the local Postgres 18 instance per
-- CLAUDE.md. ADDITIVE ONLY: seven brand-new tables, five new functions, six new
-- triggers. Nothing existing is altered, nothing is dropped, `MSP_ROLES`,
-- `requireRole` and the three per-user capability columns are untouched and keep
-- behaving exactly as they do today. Idempotent (CREATE ... IF NOT EXISTS,
-- CREATE OR REPLACE FUNCTION, DROP TRIGGER IF EXISTS before each CREATE) — safe
-- to re-run.
--
-- Real audit done before writing this, against the live local `shanemccawmsp`
-- database (\dt filtered on role/group/capab/permission): no `roles`,
-- `user_roles`, `feature_role_mapping` or `rbac_*` table existed. The only
-- similarly-named table is `msp_plan_capabilities` (service_id + capability_key
-- + enabled), which is the ENTITLEMENT axis — what an MSP bought — and #1696
-- says explicitly to keep entitlement separate from RBAC (#1168/#1280 own that
-- axis). Nothing here touches or duplicates it.
--
-- ── Two systems, one mechanism ─────────────────────────────────────────────
-- #1696's architecture decision (2026-08-29, re-confirmed by Shane 2026-09-09):
-- MSP identity and customer identity are SEPARATE systems with different
-- lifecycles, admins and blast radius, sharing ONE mechanism. So: two parallel
-- sets of three tables with an identical shape, one shared capability catalog,
-- and exactly one evaluation function in code (lib/db/src/rbac/evaluate.ts)
-- serving both. Tables separate so a customer-side mistake cannot reach MSP
-- staff; code shared so the two cannot drift.
--
-- ── Scope convention, used identically by every table below ────────────────
-- msp_id / tenant_id NULL  = platform scope: a role any org's users may hold,
--                            or a mapping that applies to every org.
-- msp_id / tenant_id SET   = that org's own role / override.
-- Precedence is fixed in the evaluator, not here: platform and org rows are
-- merged and DENY WINS, so an org override can grant what the platform left
-- unset but can never un-deny a platform deny.
--
-- ── What the triggers are for ──────────────────────────────────────────────
-- The feature→role mapping is a jsonb column (per #1696), and jsonb has no
-- foreign key. #1696 requirement 2 is explicit that a rename or delete must not
-- orphan a reference. Renames are free — nothing stores a role NAME, only the
-- immutable uuid. Deletes and bad writes are covered by triggers:
--   1. rbac_assert_*_mapping_roles       — every id in allow/deny must be a real
--                                          role, in a scope this row may cite.
--   2. rbac_purge_deleted_*_role         — deleting a role strips its id from
--                                          every mapping, same transaction.
--   3. rbac_assert_*_user_role_scope     — a user may only hold a role from
--                                          their own org's scope or the platform
--                                          scope, never another org's.
-- Everything the schema CAN express as a real constraint is one, including a
-- composite FK from each mapping table onto the capability catalog so an
-- uncatalogued capability key cannot be stored at all.
-- ============================================================================

BEGIN;

-- ── The shared capability catalog ───────────────────────────────────────────
-- Projection of lib/db/src/rbac/capabilities.ts, which is the real source of
-- truth (it is what makes the set compile-time enumerable — #1696 requirement 3,
-- and the precondition for #1698's mechanical route-coverage pass). This table
-- exists so the mapping tables can carry a real FK; keep it in sync with
-- syncCapabilityCatalog(). PRIMARY KEY is the (system, key) PAIR: `team.manage`
-- on the MSP side and `team.manage` on the customer side are different
-- authorities over different people, and must never collide.
CREATE TABLE IF NOT EXISTS rbac_capabilities (
  system      TEXT NOT NULL CHECK (system IN ('msp', 'customer')),
  key         TEXT NOT NULL,
  category    TEXT NOT NULL,
  label       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  -- false = retired from the TS catalog. Retired rows are kept, never deleted:
  -- a mapping may still reference the key, and losing the record of who once
  -- held a permission is not something an audit trail can afford.
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (system, key)
);

CREATE INDEX IF NOT EXISTS rbac_capabilities_system_idx ON rbac_capabilities (system);

-- ── MSP system ─────────────────────────────────────────────────────────────

-- A named permission set belonging to one MSP, or to the platform when msp_id
-- is null. `id` is a uuid on purpose: it is the stable reference stored inside
-- the mapping jsonb, so it must never be reused or sequence-guessable. `name` is
-- display only and free to change; `key` is the stable machine handle a seed or
-- a later migration can look a system role up by.
CREATE TABLE IF NOT EXISTS msp_roles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  msp_id      INTEGER REFERENCES msps(id) ON DELETE CASCADE,
  key         TEXT NOT NULL,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  -- Platform-defined baseline role: an MSP admin may grant it, not delete it.
  is_system   BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS msp_roles_msp_id_idx ON msp_roles (msp_id);
-- Two partial uniques rather than one composite: Postgres treats NULLs as
-- distinct, so a plain UNIQUE (msp_id, key) would let the platform scope hold
-- unlimited duplicates of the same key.
CREATE UNIQUE INDEX IF NOT EXISTS msp_roles_scoped_key_idx   ON msp_roles (msp_id, key) WHERE msp_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS msp_roles_platform_key_idx ON msp_roles (key)          WHERE msp_id IS NULL;

-- Many-to-many: a user holds several roles, a role has many users. This is the
-- table the privilege ladder could not be — holding two rungs of requireAuth's
-- ROLE_ORDER was just the higher rung; holding two rows here genuinely composes
-- two permission sets. granted_by_user_id survives its user being deleted
-- (SET NULL): the audit trail outlives the grantor.
CREATE TABLE IF NOT EXISTS msp_user_roles (
  user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id             UUID    NOT NULL REFERENCES msp_roles(id) ON DELETE CASCADE,
  granted_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  granted_by_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (user_id, role_id)
);

CREATE INDEX IF NOT EXISTS msp_user_roles_role_id_idx ON msp_user_roles (role_id);

-- One capability's allow/deny role sets, for one MSP (or platform-wide).
-- `system` is pinned to 'msp' by a CHECK purely so the composite FK onto
-- rbac_capabilities (system, key) can exist — that FK is what stops a
-- customer-side capability being mapped to an MSP role.
CREATE TABLE IF NOT EXISTS msp_feature_role_mapping (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  msp_id         INTEGER REFERENCES msps(id) ON DELETE CASCADE,
  system         TEXT NOT NULL DEFAULT 'msp',
  capability_key TEXT NOT NULL,
  -- { "allow": [role uuid, ...], "deny": [role uuid, ...] } — ids, never names.
  roles          JSONB NOT NULL DEFAULT '{"allow": [], "deny": []}'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT msp_feature_role_mapping_system_check CHECK (system = 'msp'),
  CONSTRAINT msp_feature_role_mapping_shape_check
    CHECK (jsonb_typeof(roles -> 'allow') = 'array' AND jsonb_typeof(roles -> 'deny') = 'array'),
  CONSTRAINT msp_feature_role_mapping_capability_fk
    FOREIGN KEY (system, capability_key) REFERENCES rbac_capabilities (system, key)
);

CREATE UNIQUE INDEX IF NOT EXISTS msp_feature_role_mapping_scoped_idx   ON msp_feature_role_mapping (msp_id, capability_key) WHERE msp_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS msp_feature_role_mapping_platform_idx ON msp_feature_role_mapping (capability_key)         WHERE msp_id IS NULL;
CREATE INDEX        IF NOT EXISTS msp_feature_role_mapping_capability_idx ON msp_feature_role_mapping (capability_key);

-- ── Customer system ────────────────────────────────────────────────────────
-- Same three tables, same shape, deliberately separate rows and separate FKs.
-- A customer org is a `tenants` row (users.tenant_id -> tenants.id).

CREATE TABLE IF NOT EXISTS customer_roles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
  key         TEXT NOT NULL,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  is_system   BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS customer_roles_tenant_id_idx ON customer_roles (tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS customer_roles_scoped_key_idx   ON customer_roles (tenant_id, key) WHERE tenant_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS customer_roles_platform_key_idx ON customer_roles (key)            WHERE tenant_id IS NULL;

CREATE TABLE IF NOT EXISTS customer_user_roles (
  user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id             UUID    NOT NULL REFERENCES customer_roles(id) ON DELETE CASCADE,
  granted_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  granted_by_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (user_id, role_id)
);

CREATE INDEX IF NOT EXISTS customer_user_roles_role_id_idx ON customer_user_roles (role_id);

CREATE TABLE IF NOT EXISTS customer_feature_role_mapping (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
  system         TEXT NOT NULL DEFAULT 'customer',
  capability_key TEXT NOT NULL,
  roles          JSONB NOT NULL DEFAULT '{"allow": [], "deny": []}'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT customer_feature_role_mapping_system_check CHECK (system = 'customer'),
  CONSTRAINT customer_feature_role_mapping_shape_check
    CHECK (jsonb_typeof(roles -> 'allow') = 'array' AND jsonb_typeof(roles -> 'deny') = 'array'),
  CONSTRAINT customer_feature_role_mapping_capability_fk
    FOREIGN KEY (system, capability_key) REFERENCES rbac_capabilities (system, key)
);

CREATE UNIQUE INDEX IF NOT EXISTS customer_feature_role_mapping_scoped_idx   ON customer_feature_role_mapping (tenant_id, capability_key) WHERE tenant_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS customer_feature_role_mapping_platform_idx ON customer_feature_role_mapping (capability_key)             WHERE tenant_id IS NULL;
CREATE INDEX        IF NOT EXISTS customer_feature_role_mapping_capability_idx ON customer_feature_role_mapping (capability_key);

-- ============================================================================
-- The integrity a jsonb column cannot express on its own
-- ============================================================================

-- 1a. Every role id written into an MSP mapping must be a real role, in a scope
--     this row is allowed to cite. A platform-default mapping (msp_id NULL) may
--     only reference platform roles, because it applies to every MSP; an MSP's
--     own mapping may reference platform roles or its own. The NULL comparison
--     produces exactly that rule without a branch: r.msp_id = NEW.msp_id is NULL
--     (not true) when NEW.msp_id is NULL, leaving only r.msp_id IS NULL.
CREATE OR REPLACE FUNCTION rbac_assert_msp_mapping_roles() RETURNS trigger AS $$
DECLARE
  ref TEXT;
BEGIN
  -- The shape CHECK constraint is evaluated AFTER this BEFORE-trigger, so the
  -- payload cannot be assumed well-formed here. Guard first, or a malformed
  -- write surfaces as an opaque "cannot extract elements from an object".
  IF jsonb_typeof(NEW.roles -> 'allow') <> 'array' OR jsonb_typeof(NEW.roles -> 'deny') <> 'array' THEN
    RAISE EXCEPTION 'msp_feature_role_mapping.roles must be an object with array "allow" and "deny" members, got %', NEW.roles
      USING ERRCODE = 'check_violation';
  END IF;
  FOR ref IN
    SELECT value FROM jsonb_array_elements_text((NEW.roles -> 'allow') || (NEW.roles -> 'deny'))
  LOOP
    IF ref !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'msp_feature_role_mapping.roles contains %, which is not a role uuid (roles are referenced by stable id, never by name)', ref
        USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM msp_roles r
       WHERE r.id = ref::uuid
         AND (r.msp_id IS NULL OR r.msp_id = NEW.msp_id)
    ) THEN
      RAISE EXCEPTION 'msp_feature_role_mapping.roles references msp_roles % which does not exist or is out of scope for msp_id %', ref, NEW.msp_id
        USING ERRCODE = 'foreign_key_violation';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS msp_feature_role_mapping_roles_check ON msp_feature_role_mapping;
CREATE TRIGGER msp_feature_role_mapping_roles_check
  BEFORE INSERT OR UPDATE OF roles, msp_id ON msp_feature_role_mapping
  FOR EACH ROW EXECUTE FUNCTION rbac_assert_msp_mapping_roles();

-- 1b. Same rule, customer side. Identical shape on purpose — the two systems
--     share a mechanism, and a divergence here is exactly the drift #1696 warns
--     about.
CREATE OR REPLACE FUNCTION rbac_assert_customer_mapping_roles() RETURNS trigger AS $$
DECLARE
  ref TEXT;
BEGIN
  IF jsonb_typeof(NEW.roles -> 'allow') <> 'array' OR jsonb_typeof(NEW.roles -> 'deny') <> 'array' THEN
    RAISE EXCEPTION 'customer_feature_role_mapping.roles must be an object with array "allow" and "deny" members, got %', NEW.roles
      USING ERRCODE = 'check_violation';
  END IF;
  FOR ref IN
    SELECT value FROM jsonb_array_elements_text((NEW.roles -> 'allow') || (NEW.roles -> 'deny'))
  LOOP
    IF ref !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'customer_feature_role_mapping.roles contains %, which is not a role uuid (roles are referenced by stable id, never by name)', ref
        USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM customer_roles r
       WHERE r.id = ref::uuid
         AND (r.tenant_id IS NULL OR r.tenant_id = NEW.tenant_id)
    ) THEN
      RAISE EXCEPTION 'customer_feature_role_mapping.roles references customer_roles % which does not exist or is out of scope for tenant_id %', ref, NEW.tenant_id
        USING ERRCODE = 'foreign_key_violation';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS customer_feature_role_mapping_roles_check ON customer_feature_role_mapping;
CREATE TRIGGER customer_feature_role_mapping_roles_check
  BEFORE INSERT OR UPDATE OF roles, tenant_id ON customer_feature_role_mapping
  FOR EACH ROW EXECUTE FUNCTION rbac_assert_customer_mapping_roles();

-- 2a. Deleting an MSP role strips its id out of every mapping, in the same
--     transaction. This is #1696 requirement 2's other half: with no FK on a
--     jsonb column, nothing at the database level would otherwise stop a delete
--     from leaving a dangling reference behind — and a dangling reference in an
--     ACL is how a permission silently becomes unenforceable.
CREATE OR REPLACE FUNCTION rbac_purge_deleted_msp_role() RETURNS trigger AS $$
BEGIN
  UPDATE msp_feature_role_mapping m
     SET roles = jsonb_build_object(
           'allow', COALESCE((SELECT jsonb_agg(e) FROM jsonb_array_elements_text(m.roles -> 'allow') AS e WHERE e <> OLD.id::text), '[]'::jsonb),
           'deny',  COALESCE((SELECT jsonb_agg(e) FROM jsonb_array_elements_text(m.roles -> 'deny')  AS e WHERE e <> OLD.id::text), '[]'::jsonb)
         ),
         updated_at = now()
   WHERE (m.roles -> 'allow') ? OLD.id::text
      OR (m.roles -> 'deny')  ? OLD.id::text;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS msp_roles_purge_mappings ON msp_roles;
CREATE TRIGGER msp_roles_purge_mappings
  BEFORE DELETE ON msp_roles
  FOR EACH ROW EXECUTE FUNCTION rbac_purge_deleted_msp_role();

-- 2b. Same, customer side.
CREATE OR REPLACE FUNCTION rbac_purge_deleted_customer_role() RETURNS trigger AS $$
BEGIN
  UPDATE customer_feature_role_mapping m
     SET roles = jsonb_build_object(
           'allow', COALESCE((SELECT jsonb_agg(e) FROM jsonb_array_elements_text(m.roles -> 'allow') AS e WHERE e <> OLD.id::text), '[]'::jsonb),
           'deny',  COALESCE((SELECT jsonb_agg(e) FROM jsonb_array_elements_text(m.roles -> 'deny')  AS e WHERE e <> OLD.id::text), '[]'::jsonb)
         ),
         updated_at = now()
   WHERE (m.roles -> 'allow') ? OLD.id::text
      OR (m.roles -> 'deny')  ? OLD.id::text;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS customer_roles_purge_mappings ON customer_roles;
CREATE TRIGGER customer_roles_purge_mappings
  BEFORE DELETE ON customer_roles
  FOR EACH ROW EXECUTE FUNCTION rbac_purge_deleted_customer_role();

-- 3a. A user may hold a platform-scoped MSP role, or a role scoped to their own
--     MSP — never another MSP's role. This is a cross-row invariant (users.msp_id
--     vs msp_roles.msp_id), which a CHECK constraint cannot see, so it is a
--     trigger. Granting MSP A's role to MSP B's user is a cross-tenant privilege
--     escalation, which is the single worst thing this model could permit.
CREATE OR REPLACE FUNCTION rbac_assert_msp_user_role_scope() RETURNS trigger AS $$
DECLARE
  role_msp_id INTEGER;
  user_msp_id INTEGER;
BEGIN
  SELECT msp_id INTO role_msp_id FROM msp_roles WHERE id = NEW.role_id;
  SELECT msp_id INTO user_msp_id FROM users     WHERE id = NEW.user_id;

  IF role_msp_id IS NOT NULL AND role_msp_id IS DISTINCT FROM user_msp_id THEN
    RAISE EXCEPTION 'msp_user_roles: user % (msp_id %) may not hold msp_roles % scoped to msp_id %', NEW.user_id, user_msp_id, NEW.role_id, role_msp_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS msp_user_roles_scope_check ON msp_user_roles;
CREATE TRIGGER msp_user_roles_scope_check
  BEFORE INSERT OR UPDATE ON msp_user_roles
  FOR EACH ROW EXECUTE FUNCTION rbac_assert_msp_user_role_scope();

-- 3b. Same, customer side: users.tenant_id vs customer_roles.tenant_id.
CREATE OR REPLACE FUNCTION rbac_assert_customer_user_role_scope() RETURNS trigger AS $$
DECLARE
  role_tenant_id INTEGER;
  user_tenant_id INTEGER;
BEGIN
  SELECT tenant_id INTO role_tenant_id FROM customer_roles WHERE id = NEW.role_id;
  SELECT tenant_id INTO user_tenant_id FROM users          WHERE id = NEW.user_id;

  IF role_tenant_id IS NOT NULL AND role_tenant_id IS DISTINCT FROM user_tenant_id THEN
    RAISE EXCEPTION 'customer_user_roles: user % (tenant_id %) may not hold customer_roles % scoped to tenant_id %', NEW.user_id, user_tenant_id, NEW.role_id, role_tenant_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS customer_user_roles_scope_check ON customer_user_roles;
CREATE TRIGGER customer_user_roles_scope_check
  BEFORE INSERT OR UPDATE ON customer_user_roles
  FOR EACH ROW EXECUTE FUNCTION rbac_assert_customer_user_role_scope();

-- ============================================================================
-- Seed the capability catalog
-- ============================================================================
-- Mirrors lib/db/src/rbac/capabilities.ts exactly. Every entry is backed by a
-- REAL, distinct authorization decision that exists in the running product
-- today; nothing here is a placeholder or an invented vocabulary. Expressing the
-- seven MSP_ROLES values and the boolean columns as role/mapping DATA is #2457,
-- and the full ~480-call-site catalog is #2458/#1698 — this step only proves the
-- catalog is real and enumerable.
INSERT INTO rbac_capabilities (system, key, category, label, description) VALUES
  ('msp', 'purchases.approve', 'billing', 'Approve purchases',
   'Approve or reject a pending purchase-charge approval for the MSP. Today this is the per-user users.can_approve_purchases column, granted from MSP settings (artifacts/api-server/src/routes/msp-settings.ts) and read live, never from the JWT.'),
  ('msp', 'team.manage', 'identity', 'Manage MSP staff',
   'Invite, suspend and re-role the MSP''s own staff members. Today this is not a capability at all — it is the MSPAdmin rung of the requireAuth ROLE_ORDER ladder, which is exactly the ''sideways permission'' problem #1696 records.'),
  ('customer', 'team.manage', 'identity', 'Manage company team',
   'Manage the customer''s own team roster — invite/suspend teammates, force password and MFA resets, unlock accounts, issue emergency MFA bypass codes. Today this is the per-user users.can_manage_team column enforced in artifacts/api-server/src/routes/portal-team.ts:50-54 (Git #1142).'),
  ('customer', 'changes.approve', 'change-control', 'Approve change requests',
   'Approve or reject a Change Request against the customer''s own live tenant. Today this is the per-user users.can_approve_changes column, read live in artifacts/api-server/src/routes/portal-change-control.ts:488-505 (Git #1496).'),
  ('customer', 'billing.view', 'billing', 'View billing',
   'View the customer''s invoices, subscriptions and payment history. The surface is real and live (artifacts/api-server/src/routes/portal-billing.ts) but is gated by requireAuth alone today, so every authenticated customer user can read it — this is the capability #1696 was filed about.')
ON CONFLICT (system, key) DO UPDATE SET
  category    = EXCLUDED.category,
  label       = EXCLUDED.label,
  description = EXCLUDED.description,
  is_active   = true,
  updated_at  = now();

-- ── Self-mark for Simulator Studio's Migrations tree (#497) ──────────────────
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-09-rbac-foundation-2455.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
