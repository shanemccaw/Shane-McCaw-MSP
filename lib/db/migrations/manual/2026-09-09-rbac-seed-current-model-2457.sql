-- ============================================================================
-- #2457 — express today's roles and capability columns as data
-- ============================================================================
-- Part of #1696 (RBAC Role Model Redesign), migration step 2 of 5, on top of
-- #2455's foundation (lib/db/migrations/manual/2026-09-09-rbac-foundation-2455.sql).
--
-- DATA ONLY. This file creates no table, drops nothing, and alters no column. It
-- seeds the rows that make the new model say exactly what the old one says, so
-- that step 3 (#2458) can swap the decision source underneath `requireRole`'s
-- signature without changing a single answer.
--
-- ── What "as data" means here ───────────────────────────────────────────────
-- Today's model is two mechanisms bolted together:
--
--   1. A privilege LADDER — `ROLE_ORDER` in
--      artifacts/api-server/src/middlewares/requireAuth.ts:115-123, 135-138 as of
--      3dddd4b26^ (pre-#2460) — where
--      `requireRole(min)` is `roleIndex(effective) >= roleIndex(min)`.
--   2. THREE per-user boolean columns bolted on beside it, because the ladder
--      structurally cannot express a sideways permission: `can_approve_purchases`,
--      `can_manage_team`, and `can_approve_changes` (#1496 — the issue body names
--      only the first two; the third is real, live, and enforced, so leaving it
--      out would be exactly the gap the issue's own contract forbids).
--
-- Both become rows:
--
--   * Each rung becomes a ROLE (`msp_roles`/`customer_roles`, platform-scoped,
--     `is_system`), and each `requireRole(X)` floor becomes a CAPABILITY
--     `ladder.X` whose allow set is every rung at or above X. That set is
--     computed below by joining the ladder to itself on `idx >= idx`, which is
--     the index comparison itself, enumerated rather than evaluated.
--   * Each boolean column becomes a ROLE holding exactly one capability, granted
--     to exactly the users the column grants it to TODAY — not to everyone who
--     carries the column. `can_approve_purchases` on a CustomerUser grants
--     nothing today (msp-v1.ts:337-351 only consults it on the MSPOperator
--     branch), so seeding it as a grant would be a privilege escalation dressed
--     up as a transcription.
--
-- ── Why the seven roles are seeded into BOTH systems ────────────────────────
-- #1696's decision is that MSP identity and customer identity are separate
-- systems sharing one mechanism. But TODAY one enum governs both surfaces: the
-- customer-side rules genuinely branch on MSP tier — portal-team.ts lets MSP
-- staff manage a customer's roster by role, portal-change-control.ts lets them
-- approve by role. A customer-system evaluation cannot see MSP-system roles (by
-- design — that separation is the point), so the rungs are seeded into both role
-- tables and every user holds their rung in each. The two capability CATALOGS
-- stay separate: `ladder.*` exists only in the msp system, because `requireRole`
-- is one gate and must be answerable from one evaluator.
--
-- ── Converging, not just idempotent ─────────────────────────────────────────
-- Re-running this file is safe and brings the data back into agreement with the
-- `users` table: stale ladder grants are deleted before current ones are
-- inserted, and a capability role is revoked from anyone whose column no longer
-- grants it. #3408's triggers on `users`
-- (2026-09-10-rbac-user-roles-maintained-3408.sql) keep the rung and
-- cap.changes.approve rows in sync automatically from then on. Before that
-- migration, nothing did, and this note wrongly credited #2458.
--
-- Verified by: pnpm --filter @workspace/db run check-rbac-parity
--   — old decision (lib/db/src/rbac/legacy-ladder.ts, transcribed from the live
--     route code with file:line citations) vs new decision (#2455's evaluator
--     against these rows), for every real user and every catalogued capability.
--
-- Run against the local dev DATABASE_URL in-session, per CLAUDE.md's Database
-- section (additive, reversible, no destructive statement in the file).
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Catalogue the seven ladder rungs
-- ----------------------------------------------------------------------------
-- Mirrors lib/db/src/rbac/capabilities.ts, which stays the source of truth (it is
-- what makes the set compile-time enumerable, #1696 requirement 3). The label and
-- description are built from the same formula `ladderCapabilityLabel()` /
-- `ladderCapabilityDescription()` use, so the table and the TS catalog cannot
-- disagree about what a rung means — and `syncCapabilityCatalog()` re-asserts it.

WITH ladder(role_key, idx, cap_key) AS (
  -- ROLE_ORDER from requireAuth.ts:80-88, in order, paired with the capability key
  -- each rung is catalogued under. The keys are the lowercase-kebab spellings held
  -- in LADDER_CAPABILITY_KEYS (lib/db/src/rbac/legacy-ladder.ts) — written out on
  -- both sides rather than derived, because 'MSPAdmin' has no unambiguous
  -- mechanical lowercasing and two spellings of one authority is how a catalog rots.
  VALUES ('Assessment', 0, 'ladder.assessment'), ('Free', 1, 'ladder.free'),
         ('CustomerUser', 2, 'ladder.customer-user'), ('ServiceAccount', 3, 'ladder.service-account'),
         ('MSPOperator', 4, 'ladder.msp-operator'), ('MSPAdmin', 5, 'ladder.msp-admin'),
         ('PlatformAdmin', 6, 'ladder.platform-admin')
)
INSERT INTO rbac_capabilities (system, key, category, label, description, is_active)
SELECT 'msp',
       cap_key,
       'legacy-ladder',
       'Passes requireRole("' || role_key || '")',
       'Transitional transcription of the ROLE_ORDER ladder in '
         || 'artifacts/api-server/src/middlewares/requireAuth.ts:115-123, 135-138 as of 3dddd4b26^ '
         || '(ROLE_ORDER, roleIndex, pre-#2460) — true exactly when '
         || 'roleIndex(effective role) >= roleIndex("' || role_key || '"). Seeded as data by #2457, read by '
         || '#2458 when requireRole''s decision source moves onto the evaluator, retired with '
         || 'MSP_ROLES by #2460.',
       true
FROM ladder
ON CONFLICT (system, key) DO UPDATE
  SET category = EXCLUDED.category,
      label = EXCLUDED.label,
      description = EXCLUDED.description,
      is_active = true,
      updated_at = now();

-- ----------------------------------------------------------------------------
-- 2. The seven rungs as roles, in both systems
-- ----------------------------------------------------------------------------
-- Platform-scoped (`msp_id`/`tenant_id` NULL) because every org's users hold
-- them, and `is_system` because an org admin may grant them but must not be able
-- to delete a role the whole enforcement path depends on. `key` is the exact
-- MSP_ROLES value — the stable handle this migration and #2458 look a rung up by.
-- `name` is display only and free to be renamed; nothing stores it.

WITH ladder(role_key, idx, cap_key) AS (
  VALUES ('Assessment', 0, 'ladder.assessment'), ('Free', 1, 'ladder.free'),
         ('CustomerUser', 2, 'ladder.customer-user'), ('ServiceAccount', 3, 'ladder.service-account'),
         ('MSPOperator', 4, 'ladder.msp-operator'), ('MSPAdmin', 5, 'ladder.msp-admin'),
         ('PlatformAdmin', 6, 'ladder.platform-admin')
)
INSERT INTO msp_roles (msp_id, key, name, description, is_system)
SELECT NULL, role_key, role_key,
       'MSP_ROLES rung ' || idx || ' of 6 (requireAuth.ts ROLE_ORDER). Seeded by #2457 as the '
         || 'data form of today''s privilege ladder; every rung at or above it allows a '
         || 'requireRole("' || role_key || '") check.',
       true
FROM ladder
ON CONFLICT (key) WHERE msp_id IS NULL DO UPDATE
  SET name = EXCLUDED.name, description = EXCLUDED.description, is_system = true, updated_at = now();

WITH ladder(role_key, idx, cap_key) AS (
  VALUES ('Assessment', 0, 'ladder.assessment'), ('Free', 1, 'ladder.free'),
         ('CustomerUser', 2, 'ladder.customer-user'), ('ServiceAccount', 3, 'ladder.service-account'),
         ('MSPOperator', 4, 'ladder.msp-operator'), ('MSPAdmin', 5, 'ladder.msp-admin'),
         ('PlatformAdmin', 6, 'ladder.platform-admin')
)
INSERT INTO customer_roles (tenant_id, key, name, description, is_system)
SELECT NULL, role_key, role_key,
       'MSP_ROLES rung ' || idx || ' of 6, mirrored into the customer system by #2457 because '
         || 'today''s customer-side rules (portal-team.ts, portal-change-control.ts) branch on '
         || 'MSP tier, and a customer-system evaluation cannot see MSP-system roles.',
       true
FROM ladder
ON CONFLICT (key) WHERE tenant_id IS NULL DO UPDATE
  SET name = EXCLUDED.name, description = EXCLUDED.description, is_system = true, updated_at = now();

-- ----------------------------------------------------------------------------
-- 3. One role per capability column
-- ----------------------------------------------------------------------------
-- The column IS the role's membership: a set of users, one capability. Naming
-- them `cap.<capability>` keeps them in a visibly different namespace from the
-- rungs. Once #2460 drops the columns these stay as ordinary roles, editable —
-- which is the thing a boolean column can never be.

INSERT INTO msp_roles (msp_id, key, name, description, is_system) VALUES
  (NULL, 'cap.purchases.approve', 'Purchase Approver',
   'Carries users.can_approve_purchases. Granted by #2457 to the users that column actually '
     || 'grants today — MSPOperators only, since msp-v1.ts:337-351 consults the flag on that '
     || 'branch alone (MSPAdmin/PlatformAdmin already decide by rung).',
   true)
ON CONFLICT (key) WHERE msp_id IS NULL DO UPDATE
  SET name = EXCLUDED.name, description = EXCLUDED.description, is_system = true, updated_at = now();

INSERT INTO customer_roles (tenant_id, key, name, description, is_system) VALUES
  (NULL, 'cap.team.manage', 'Team Manager',
   'Carries users.can_manage_team (Git #1142) — the elevated-customer distinction '
     || 'portal-team.ts:40-54 requires of a customer-tier caller on top of tenant isolation.',
   true),
  (NULL, 'cap.changes.approve', 'Change Approver',
   'Carries users.can_approve_changes (Git #1496) — the live per-user authority '
     || 'portal-change-control.ts:493-506 requires to approve or reject a change against the '
     || 'customer''s own tenant.',
   true)
ON CONFLICT (key) WHERE tenant_id IS NULL DO UPDATE
  SET name = EXCLUDED.name, description = EXCLUDED.description, is_system = true, updated_at = now();

-- ----------------------------------------------------------------------------
-- 4. The ladder itself, as feature→role mappings
-- ----------------------------------------------------------------------------
-- `ladder.X` allows every rung whose index is >= X's index. The self-join below
-- IS `roleIndex(held) >= roleIndex(required)` — the same comparison requireRole
-- makes, evaluated once here instead of on every request. Nothing is denied: the
-- ladder has no concept of a deny, so every deny array is empty and the
-- deny-wins rule is inert on this data by construction.

WITH ladder(role_key, idx, cap_key) AS (
  VALUES ('Assessment', 0, 'ladder.assessment'), ('Free', 1, 'ladder.free'),
         ('CustomerUser', 2, 'ladder.customer-user'), ('ServiceAccount', 3, 'ladder.service-account'),
         ('MSPOperator', 4, 'ladder.msp-operator'), ('MSPAdmin', 5, 'ladder.msp-admin'),
         ('PlatformAdmin', 6, 'ladder.platform-admin')
)
INSERT INTO msp_feature_role_mapping (msp_id, system, capability_key, roles)
SELECT NULL, 'msp', floor.cap_key,
       jsonb_build_object(
         'allow', COALESCE(jsonb_agg(r.id::text ORDER BY holder.idx), '[]'::jsonb),
         'deny',  '[]'::jsonb)
FROM ladder floor
JOIN ladder holder ON holder.idx >= floor.idx
JOIN msp_roles r ON r.msp_id IS NULL AND r.key = holder.role_key
GROUP BY floor.cap_key
ON CONFLICT (capability_key) WHERE msp_id IS NULL DO UPDATE
  SET roles = EXCLUDED.roles, updated_at = now();

-- ----------------------------------------------------------------------------
-- 5. The capability columns, as feature→role mappings
-- ----------------------------------------------------------------------------
-- Each allow set is the exact role list the live code tests, plus the column's
-- own role. These are transcriptions of four specific functions — read them
-- alongside lib/db/src/rbac/legacy-ladder.ts, which cites the same lines.

-- msp:purchases.approve — msp-v1.ts:337-351.
-- "MSPAdmin and PlatformAdmin (legacy role: admin) can always decide. MSPOperator
-- needs canApprovePurchases = true."
INSERT INTO msp_feature_role_mapping (msp_id, system, capability_key, roles)
SELECT NULL, 'msp', 'purchases.approve',
       jsonb_build_object(
         'allow', COALESCE((SELECT jsonb_agg(id::text ORDER BY key) FROM msp_roles
                   WHERE msp_id IS NULL AND key IN ('MSPAdmin', 'PlatformAdmin', 'cap.purchases.approve')), '[]'::jsonb),
         'deny',  '[]'::jsonb)
ON CONFLICT (capability_key) WHERE msp_id IS NULL DO UPDATE
  SET roles = EXCLUDED.roles, updated_at = now();

-- msp:team.manage — msp-settings.ts, every /msp/settings/users/* and
-- /msp/settings/invites* route is requireRole("MSPAdmin") with no column beside
-- it. So this allow set is deliberately identical to ladder.MSPAdmin's.
INSERT INTO msp_feature_role_mapping (msp_id, system, capability_key, roles)
SELECT NULL, 'msp', 'team.manage',
       jsonb_build_object(
         'allow', COALESCE((SELECT jsonb_agg(id::text ORDER BY key) FROM msp_roles
                   WHERE msp_id IS NULL AND key IN ('MSPAdmin', 'PlatformAdmin')), '[]'::jsonb),
         'deny',  '[]'::jsonb)
ON CONFLICT (capability_key) WHERE msp_id IS NULL DO UPDATE
  SET roles = EXCLUDED.roles, updated_at = now();

-- customer:team.manage — portal-team.ts:40-54. A customer-tier caller
-- (CustomerUser/Free/Assessment) needs the flag; anyone else passes by role.
-- "Anyone else" really does include ServiceAccount: the live test is
-- `isCustomerTier`, which names three roles, not a rung comparison.
INSERT INTO customer_feature_role_mapping (tenant_id, system, capability_key, roles)
SELECT NULL, 'customer', 'team.manage',
       jsonb_build_object(
         'allow', COALESCE((SELECT jsonb_agg(id::text ORDER BY key) FROM customer_roles
                   WHERE tenant_id IS NULL
                     AND key IN ('ServiceAccount', 'MSPOperator', 'MSPAdmin', 'PlatformAdmin', 'cap.team.manage')), '[]'::jsonb),
         'deny',  '[]'::jsonb)
ON CONFLICT (capability_key) WHERE tenant_id IS NULL DO UPDATE
  SET roles = EXCLUDED.roles, updated_at = now();

-- customer:changes.approve — portal-change-control.ts:493-506. An explicit
-- three-role list, then the flag for everyone else. Note ServiceAccount is NOT on
-- this list although it IS on team.manage's: the two columns look symmetrical in
-- the schema and are not symmetrical in the code.
INSERT INTO customer_feature_role_mapping (tenant_id, system, capability_key, roles)
SELECT NULL, 'customer', 'changes.approve',
       jsonb_build_object(
         'allow', COALESCE((SELECT jsonb_agg(id::text ORDER BY key) FROM customer_roles
                   WHERE tenant_id IS NULL
                     AND key IN ('MSPOperator', 'MSPAdmin', 'PlatformAdmin', 'cap.changes.approve')), '[]'::jsonb),
         'deny',  '[]'::jsonb)
ON CONFLICT (capability_key) WHERE tenant_id IS NULL DO UPDATE
  SET roles = EXCLUDED.roles, updated_at = now();

-- customer:billing.view — portal-billing.ts, requireAuth and nothing else, so
-- today every authenticated principal passes. Transcribed as "every rung," which
-- is the honest statement of the present, not a recommendation: narrowing it is
-- the real product change #1696 was filed for, and it belongs to the step that
-- moves the route onto the evaluator.
INSERT INTO customer_feature_role_mapping (tenant_id, system, capability_key, roles)
SELECT NULL, 'customer', 'billing.view',
       jsonb_build_object(
         'allow', COALESCE((SELECT jsonb_agg(id::text ORDER BY key) FROM customer_roles
                   WHERE tenant_id IS NULL
                     AND key IN ('Assessment', 'Free', 'CustomerUser', 'ServiceAccount',
                                 'MSPOperator', 'MSPAdmin', 'PlatformAdmin')), '[]'::jsonb),
         'deny',  '[]'::jsonb)
ON CONFLICT (capability_key) WHERE tenant_id IS NULL DO UPDATE
  SET roles = EXCLUDED.roles, updated_at = now();

-- ----------------------------------------------------------------------------
-- 6. Grant every real user the rung they hold today
-- ----------------------------------------------------------------------------
-- Derived from the real `users` rows, never from a list of ids. The effective
-- role is `role = 'admin' ? 'PlatformAdmin' : msp_role` — requireAuth.ts:210-212's
-- legacy promotion, which #1696 says must be "carried across deliberately rather
-- than inherited by accident." Carrying it here is that deliberate act.
--
-- A user whose `msp_role` is not one of the seven joins to nothing and holds no
-- rung, which matches `roleIndex()` returning -1 and failing every floor.
--
-- `is_active` is deliberately NOT filtered on: requireRole does not consult it
-- either (it reads the JWT claim only), and inventing a gate the old model does
-- not have would break the equality this step exists to prove.

DELETE FROM msp_user_roles ur
USING msp_roles r, users u
WHERE ur.role_id = r.id
  AND ur.user_id = u.id
  AND r.msp_id IS NULL
  AND r.key IN ('Assessment', 'Free', 'CustomerUser', 'ServiceAccount', 'MSPOperator', 'MSPAdmin', 'PlatformAdmin')
  AND r.key IS DISTINCT FROM (CASE WHEN u.role = 'admin' THEN 'PlatformAdmin' ELSE u.msp_role END);

INSERT INTO msp_user_roles (user_id, role_id)
SELECT u.id, r.id
FROM users u
JOIN msp_roles r
  ON r.msp_id IS NULL
 AND r.key = (CASE WHEN u.role = 'admin' THEN 'PlatformAdmin' ELSE u.msp_role END)
ON CONFLICT (user_id, role_id) DO NOTHING;

DELETE FROM customer_user_roles ur
USING customer_roles r, users u
WHERE ur.role_id = r.id
  AND ur.user_id = u.id
  AND r.tenant_id IS NULL
  AND r.key IN ('Assessment', 'Free', 'CustomerUser', 'ServiceAccount', 'MSPOperator', 'MSPAdmin', 'PlatformAdmin')
  AND r.key IS DISTINCT FROM (CASE WHEN u.role = 'admin' THEN 'PlatformAdmin' ELSE u.msp_role END);

INSERT INTO customer_user_roles (user_id, role_id)
SELECT u.id, r.id
FROM users u
JOIN customer_roles r
  ON r.tenant_id IS NULL
 AND r.key = (CASE WHEN u.role = 'admin' THEN 'PlatformAdmin' ELSE u.msp_role END)
ON CONFLICT (user_id, role_id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 7. Carry the capability-column grants forward, without a gap and without a gain
-- ----------------------------------------------------------------------------
-- Each block revokes first, then grants, so the role's membership converges on
-- the column rather than only ever growing.

-- can_approve_purchases — only an MSPOperator's flag actually grants anything
-- today (msp-v1.ts:337-351), so only an MSPOperator's flag is carried forward.
-- A flag on any other role grants nothing now and must not start granting here.
DELETE FROM msp_user_roles ur
USING msp_roles r, users u
WHERE ur.role_id = r.id AND ur.user_id = u.id
  AND r.msp_id IS NULL AND r.key = 'cap.purchases.approve'
  AND NOT (u.can_approve_purchases
           AND (CASE WHEN u.role = 'admin' THEN 'PlatformAdmin' ELSE u.msp_role END) = 'MSPOperator');

INSERT INTO msp_user_roles (user_id, role_id)
SELECT u.id, r.id
FROM users u
JOIN msp_roles r ON r.msp_id IS NULL AND r.key = 'cap.purchases.approve'
WHERE u.can_approve_purchases
  AND (CASE WHEN u.role = 'admin' THEN 'PlatformAdmin' ELSE u.msp_role END) = 'MSPOperator'
ON CONFLICT (user_id, role_id) DO NOTHING;

-- can_manage_team — portal-team.ts consults the flag for a customer-tier caller
-- and ignores it for everyone else, so the flag is carried forward for whoever
-- holds it; on a non-customer-tier user the grant is simply redundant with the
-- rung, exactly as the column is today.
DELETE FROM customer_user_roles ur
USING customer_roles r, users u
WHERE ur.role_id = r.id AND ur.user_id = u.id
  AND r.tenant_id IS NULL AND r.key = 'cap.team.manage'
  AND NOT u.can_manage_team;

INSERT INTO customer_user_roles (user_id, role_id)
SELECT u.id, r.id
FROM users u
JOIN customer_roles r ON r.tenant_id IS NULL AND r.key = 'cap.team.manage'
WHERE u.can_manage_team
ON CONFLICT (user_id, role_id) DO NOTHING;

-- can_approve_changes (#1496) — the flag path is open to every role that is not
-- already on the explicit list, so it is carried forward for whoever holds it.
DELETE FROM customer_user_roles ur
USING customer_roles r, users u
WHERE ur.role_id = r.id AND ur.user_id = u.id
  AND r.tenant_id IS NULL AND r.key = 'cap.changes.approve'
  AND NOT u.can_approve_changes;

INSERT INTO customer_user_roles (user_id, role_id)
SELECT u.id, r.id
FROM users u
JOIN customer_roles r ON r.tenant_id IS NULL AND r.key = 'cap.changes.approve'
WHERE u.can_approve_changes
ON CONFLICT (user_id, role_id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- Run tracking (Git #497) — Simulator Studio's Migrations tree reads this.
-- ----------------------------------------------------------------------------
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-09-rbac-seed-current-model-2457.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
