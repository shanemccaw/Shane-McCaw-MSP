-- ============================================================================
-- #3974 — customer_feature_role_mapping gating audit for RetainerNoConsent
--         (+ RetainerConsented infrastructure), part of #3970 step 4 of 4
-- ============================================================================
-- Part of #1696 (RBAC Role Model Redesign). #3971 (step 1) added the two new
-- `msp_role` enum values and the `users_role_scope_check` branch that lets
-- `RetainerNoConsent` hold no tenant — but it did NOT seed the role/capability
-- rows the rest of the model needs to resolve them. Confirmed live before this
-- file was written: `msp_roles` and `customer_roles` had no `RetainerNoConsent`
-- / `RetainerConsented` row, `rbac_capabilities` had no `ladder.retainer-*` row,
-- and no `msp_feature_role_mapping` ladder floor existed for either. Without
-- those, `readPlatformRoleId()` (rbac-capability-source.ts) resolves the rung to
-- null for BOTH systems, `resolveRoleIds()` returns an empty role-id set, and
-- EVERY capability check for a RetainerNoConsent/RetainerConsented principal
-- denies — including the ones the real product decision says must be allowed
-- (billing). That is a missing seed, not a permission decision, exactly the
-- "unseeded, not unauthorized" failure mode ./rbac-capability.ts's header
-- describes for the seven original rungs.
--
-- ── The real product decision (Shane, via #3970's investigation, 2026-09-13) ──
--   RetainerNoConsent — no tenant, ever, while in this state:
--     Allow: billing, documents/SOW, engagement scope/hours, account settings
--     Deny:  anything tenant-scoped — scans, diagnostics, findings,
--            config-state, any page that reads a tenant that doesn't exist
--   RetainerConsented — has a tenant, same requirement shape as Customer
--     (#3971's own words). #3974's title and #3970's step framing are about
--     RetainerNoConsent's gating specifically, so no NEW customer_feature_role_
--     mapping decision is made for it beyond what parity with Customer already
--     implies: it gets the seed rows this file adds (needed to function at all
--     — #3973 wires the actual NoConsent -> Consented role swap), the same
--     marketplace.browse-full parity Customer already has (below), and
--     inherits the SAME default-deny-by-omission that plain `Customer` already
--     gets on team.manage/changes.approve — nothing here widens or narrows
--     that, it is simply not yet granted anything beyond what a bare Customer
--     already isn't.
--
-- ── Checked against the real routes before writing a row (per #3974's own
--    instruction: "confirm each against the real nav, do not assume") ───────
--   * billing.view / billing.manage (portal-billing.ts, portal-retainer-
--     billing.ts) — #3629 narrowed both to the `Billing` role + Customer Admin
--     + MSP staff, granted automatically to whoever an invoice or
--     client_services row is addressed to (the billed-party trigger, live
--     since #3629), independent of msp_role. A Retainer purchase creates
--     exactly that row (#1310-#1317's purchase-account-flow), so a billed
--     RetainerNoConsent user already gets Billing through that trigger with
--     ZERO change needed here. Deliberately NOT adding RetainerNoConsent to
--     either allow array: deny-wins means putting it in `deny` would override
--     the very Billing grant retainer clients need (a held Billing role in
--     `allow` plus the rung in `deny` on the SAME capability denies), and
--     putting it in unconditional `allow` would grant billing to a
--     RetainerNoConsent user who has not been billed yet, which is not the
--     model any other rung gets either.
--   * team.manage (portal-team.ts) — manages the company's own team, which
--     requires a tenant. RetainerNoConsent has none. Already denied by
--     omission (Free/Customer are not on this list either — only
--     cap.team.manage/Customer Admin/MSP staff are); made explicit below per
--     #3974's "no unguarded capability falls through by omission" instruction.
--   * changes.approve (portal-change-control.ts) — "Approve or reject a
--     Change Request against the customer's own LIVE TENANT." Explicitly
--     tenant-scoped by its own catalog description. Same as team.manage:
--     already denied by omission, made explicit below.
--   * marketplace.browse-full (portal-marketplace.ts, portal-customer-
--     search.ts, lib/marketplace-catalog-scope.ts) — controls catalog BREADTH
--     for an already-paying principal, not a tenant-scoped data read (no
--     `tenantId`/`tenant_id` reference in portal-marketplace.ts at all). Both
--     Retainer tiers are paying customers exactly like `Customer` is (the tier
--     this list already allows) — both allowed below, parity with Customer.
--   * documents/SOW, engagement scope/hours, account settings — none of these
--     are gated through `customer_feature_role_mapping` today (no capability
--     key exists for them); they sit behind plain `requireAuth` /
--     `ladder.free`. Granting RetainerNoConsent the `ladder.free` floor (below,
--     via the ladder rebuild) is what "Allow" means for these — there is no
--     separate row to add because there is no separate capability gating them.
--
-- ── Why the ladder rows are rebuilt wholesale, not patched in place ─────────
-- `LEGACY_ROLE_ORDER` (lib/db/src/rbac/legacy-ladder.ts) now reads:
--   Free, RetainerNoConsent, RetainerConsented, Customer, ServiceAccount,
--   MSPOperator, MSPAdmin, PlatformAdmin
-- Inserting the two new rungs strictly BETWEEN Free and Customer means every
-- floor at Customer or above is byte-for-byte unchanged (RetainerNoConsent/
-- RetainerConsented are both below Customer), and only `ladder.free` gains the
-- two new ids. Recomputing every `ladder.*` mapping row from the current,
-- complete ladder (rather than hand-patching `ladder.free` and inserting two
-- new rows) means this file cannot silently miss a floor, and is idempotent —
-- re-running it lands on the same correct state (`ON CONFLICT ... DO UPDATE`,
-- same discipline every prior RBAC seed file in this directory uses).
--
-- Additive only: two new role values in two tables (data, not DDL), two new
-- catalog rows, six ladder mapping rows recomputed (2 new + 4 already existed,
-- unchanged in content, refreshed defensively), three customer mapping rows
-- edited in place (their existing entries survive — `jsonb_set` /
-- distinct-union style, matching #3629's own edit style). Run against the
-- local dev DATABASE_URL in-session per CLAUDE.md's Database section.
-- Replit/Staging is on #1630.
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'users_role_scope_check'
       AND pg_get_constraintdef(oid) LIKE '%RetainerNoConsent%'
  ) THEN
    RAISE EXCEPTION 'REFUSING: #3971 has not run — users_role_scope_check has no RetainerNoConsent branch yet.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM customer_roles WHERE tenant_id IS NULL AND key = 'Customer') THEN
    RAISE EXCEPTION 'REFUSING: the platform Customer rung is missing — run #2457/#3590 first.';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 1. Catalogue the two new ladder capabilities (mirrors #2457 section 1)
-- ----------------------------------------------------------------------------
INSERT INTO rbac_capabilities (system, key, category, label, description, is_active)
VALUES
  ('msp', 'ladder.retainer-no-consent', 'legacy-ladder',
   'Passes requireRole("RetainerNoConsent")',
   'Transitional transcription of the ROLE_ORDER ladder, extended by #3971/#3974 with the '
     || 'RetainerNoConsent rung (a Retainer purchaser who has not connected a tenant). True '
     || 'exactly when roleIndex(effective role) >= roleIndex("RetainerNoConsent"). Seeded as '
     || 'data by #3974, read by #2458 when requireRole''s decision source moves onto the '
     || 'evaluator, retired with MSP_ROLES by #2460.',
   true),
  ('msp', 'ladder.retainer-consented', 'legacy-ladder',
   'Passes requireRole("RetainerConsented")',
   'Transitional transcription of the ROLE_ORDER ladder, extended by #3971/#3974 with the '
     || 'RetainerConsented rung (a Retainer purchaser who has connected a tenant; same '
     || 'requirement shape as Customer). True exactly when roleIndex(effective role) >= '
     || 'roleIndex("RetainerConsented"). Seeded as data by #3974, read by #2458 when '
     || 'requireRole''s decision source moves onto the evaluator, retired with MSP_ROLES by #2460.',
   true)
ON CONFLICT (system, key) DO UPDATE
  SET category = EXCLUDED.category,
      label = EXCLUDED.label,
      description = EXCLUDED.description,
      is_active = true,
      updated_at = now();

-- ----------------------------------------------------------------------------
-- 2. The two new rungs as roles, in both systems (mirrors #2457 section 2)
-- ----------------------------------------------------------------------------
INSERT INTO msp_roles (msp_id, key, name, description, is_system) VALUES
  (NULL, 'RetainerNoConsent', 'RetainerNoConsent',
   'Retainer purchase, consent skipped (#1311 checkout_sessions.consent_skipped_at) — no '
     || 'tenant, ever, while in this state (#3971''s users_role_scope_check branch). Seeded by '
     || '#3974 so the rung can be resolved by readPlatformRoleId(); sits between Free and '
     || 'RetainerConsented in LEGACY_ROLE_ORDER.',
   true),
  (NULL, 'RetainerConsented', 'RetainerConsented',
   'Retainer purchaser who has connected a tenant — same tenant requirement shape as Customer '
     || '(#3971). Seeded by #3974; sits between RetainerNoConsent and Customer in '
     || 'LEGACY_ROLE_ORDER.',
   true)
ON CONFLICT (key) WHERE msp_id IS NULL DO UPDATE
  SET name = EXCLUDED.name, description = EXCLUDED.description, is_system = true, updated_at = now();

INSERT INTO customer_roles (tenant_id, key, name, description, is_system) VALUES
  (NULL, 'RetainerNoConsent', 'RetainerNoConsent',
   'Mirrored into the customer system by #3974, same reason #2457 mirrored the original seven: '
     || 'customer-side capability decisions (customer_feature_role_mapping) branch on MSP tier '
     || 'and cannot see MSP-system roles. No tenant, ever, while in this state.',
   true),
  (NULL, 'RetainerConsented', 'RetainerConsented',
   'Mirrored into the customer system by #3974. Same tenant requirement shape as Customer.',
   true)
ON CONFLICT (key) WHERE tenant_id IS NULL DO UPDATE
  SET name = EXCLUDED.name, description = EXCLUDED.description, is_system = true, updated_at = now();

-- ----------------------------------------------------------------------------
-- 3. The ladder itself, recomputed wholesale (mirrors #2457 section 4)
-- ----------------------------------------------------------------------------
-- Every floor's allow set is "every rung whose index is >= this floor's index",
-- computed from the CURRENT, complete LEGACY_ROLE_ORDER — not just the two new
-- floors — so a ladder change can never leave one floor stale relative to the
-- others. Nothing is denied: the ladder has no concept of a deny.
WITH ladder(role_key, idx, cap_key) AS (
  VALUES ('Free', 0, 'ladder.free'),
         ('RetainerNoConsent', 1, 'ladder.retainer-no-consent'),
         ('RetainerConsented', 2, 'ladder.retainer-consented'),
         ('Customer', 3, 'ladder.customer-user'),
         ('ServiceAccount', 4, 'ladder.service-account'),
         ('MSPOperator', 5, 'ladder.msp-operator'),
         ('MSPAdmin', 6, 'ladder.msp-admin'),
         ('PlatformAdmin', 7, 'ladder.platform-admin')
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
-- 4. rbac_sync_user_roles() (#3408, updated by #3590) — add the two new rungs
-- ----------------------------------------------------------------------------
-- Found live while building this file: the function's `rungs` array was updated
-- by #3590 for the CustomerUser->Customer rename but was never told about #3971's
-- two new rungs. Production route gates (rbac-capability.ts's resolveRoleIds)
-- don't depend on this — they resolve the rung from the JWT claim, deliberately,
-- exactly because this table can lag. But anything using the plain
-- `loadRbacContext`/`loadRbacEvaluator` path (AdminV2's read views, this file's
-- own test) reads `*_user_roles` directly, and a RetainerNoConsent/
-- RetainerConsented user would show as holding no rung there without this fix.
-- Same rule, same shape as #3590's own update — only the rung list changes.
CREATE OR REPLACE FUNCTION rbac_sync_user_roles(p_user_id integer) RETURNS void AS $$
DECLARE
  -- LEGACY_ROLE_ORDER (lib/db/src/rbac/legacy-ladder.ts) as of #3971/#3974:
  -- RetainerNoConsent and RetainerConsented added between Free and Customer.
  rungs  CONSTANT text[] := ARRAY['Free', 'RetainerNoConsent', 'RetainerConsented', 'Customer',
                                  'ServiceAccount', 'MSPOperator', 'MSPAdmin', 'PlatformAdmin'];
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

  IF rung IS NULL OR NOT (rung = ANY (purchase_rungs)) THEN
    DELETE FROM msp_user_roles ur
     USING msp_roles r
     WHERE ur.role_id = r.id
       AND ur.user_id = p_user_id
       AND r.msp_id IS NULL
       AND r.key = 'cap.purchases.approve';
  END IF;

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

-- Catch up any real user already carrying RetainerNoConsent/RetainerConsented
-- (there should be none yet — #3971 only just landed the enum values — but this
-- is the same re-convergence pass #3408/#3590 both run for exactly this reason).
SELECT rbac_sync_user_roles(id) FROM users WHERE msp_role IN ('RetainerNoConsent', 'RetainerConsented');

-- ----------------------------------------------------------------------------
-- 5. customer_feature_role_mapping — the explicit RetainerNoConsent decisions
-- ----------------------------------------------------------------------------
-- 4a. marketplace.browse-full — ALLOW both Retainer rungs, parity with Customer
--     (all three are paying tiers; the capability is catalog breadth, not a
--     tenant-scoped read — see the header). RetainerConsented included too, not
--     just RetainerNoConsent: leaving it out while Customer and RetainerNoConsent
--     both have it would be an arbitrary asymmetry the real product decision
--     gives no basis for ("same requirement shape as Customer").
UPDATE customer_feature_role_mapping m
   SET roles = jsonb_set(
         m.roles, '{allow}',
         (SELECT COALESCE(jsonb_agg(DISTINCT x ORDER BY x), '[]'::jsonb)
            FROM (SELECT e AS x FROM jsonb_array_elements_text(m.roles -> 'allow') e
                  UNION ALL
                  SELECT r.id::text FROM customer_roles r
                   WHERE r.tenant_id IS NULL AND r.key IN ('RetainerNoConsent', 'RetainerConsented')) s)),
       updated_at = now()
 WHERE m.tenant_id IS NULL
   AND m.capability_key = 'marketplace.browse-full'
   AND NOT ((m.roles -> 'allow') ?& ARRAY(
     SELECT id::text FROM customer_roles WHERE tenant_id IS NULL AND key IN ('RetainerNoConsent', 'RetainerConsented')
   ));

-- 4b. team.manage and changes.approve — explicit DENY. Both were already
--     denied by omission (Free/Customer aren't on either allow list either);
--     this makes the decision mechanically visible per #3974's "no unguarded
--     capability falls through by omission" instruction, rather than relying
--     on the absence of a row to mean the same thing.
UPDATE customer_feature_role_mapping m
   SET roles = jsonb_set(
         m.roles, '{deny}',
         (SELECT COALESCE(jsonb_agg(DISTINCT x ORDER BY x), '[]'::jsonb)
            FROM (SELECT e AS x FROM jsonb_array_elements_text(m.roles -> 'deny') e
                  UNION ALL
                  SELECT r.id::text FROM customer_roles r
                   WHERE r.tenant_id IS NULL AND r.key = 'RetainerNoConsent') s)),
       updated_at = now()
 WHERE m.tenant_id IS NULL
   AND m.capability_key IN ('team.manage', 'changes.approve')
   AND NOT ((m.roles -> 'deny') ? (SELECT id::text FROM customer_roles WHERE tenant_id IS NULL AND key = 'RetainerNoConsent'));

-- billing.view / billing.manage — deliberately untouched. See the header:
-- adding RetainerNoConsent to `deny` here would override the Billing role's
-- own `allow` entry (deny wins) and strand every retainer client who has
-- actually been billed; adding it to `allow` would grant billing to one who
-- has not. The billed-party trigger (#3629) is the correct, already-live
-- mechanism and needs no change.

-- ----------------------------------------------------------------------------
-- Run tracking (Git #497) — Simulator Studio's Migrations tree reads this.
-- ----------------------------------------------------------------------------
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-14-rbac-retainer-noconsent-gating-3974.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
