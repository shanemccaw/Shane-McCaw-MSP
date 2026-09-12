-- ============================================================================
-- #3867 — repair a post-#3590 re-run of the #2457 seed
-- ============================================================================
-- Part of #1696 (RBAC Role Model Redesign). Sits on top of #2455, #2457, #3408,
-- #3465, #3590 and #3629.
--
-- ── What happened ────────────────────────────────────────────────────────────
-- 2026-09-12 16:57, #3638 corrected a citation in the ladder capability description
-- and re-ran 2026-09-09-rbac-seed-current-model-2457.sql in full to reseed it. That
-- file still transcribes the SEVEN-rung ladder and overwrites every mapping it
-- touches, so on a database #3590 and #3629 had already moved on it:
--
--   * re-created platform `CustomerUser` and `Assessment` roles, with NEW ids, in
--     both msp_roles and customer_roles (#3590 had renamed / deleted them);
--   * rewrote every ladder.* allow-list from those roles. The live `Customer` role
--     id was on none of them, so every Customer-rung account failed
--     ladder.customer-user AND ladder.free — 403 on 40+ portal routes;
--   * resurrected ladder.assessment (mapping row, and is_active on the catalog row)
--     and reverted ladder.customer-user's label to requireRole("CustomerUser");
--   * put the rung descriptions back to "rung N of 6";
--   * overwrote three customer mappings #3629 had edited: billing.view went back to
--     EVERY rung (widening it to Free/ServiceAccount, and dropping Customer Admin and
--     Billing — so a billed party could pay a bill they could not open), and
--     team.manage / changes.approve lost Customer Admin.
--
-- No membership pointed at the resurrected roles (no users.msp_role or
-- msp_invites.msp_role carries the retired values), and no org-scoped mapping exists.
-- The only foreign keys onto msp_roles / customer_roles are *_user_roles.role_id.
--
-- ── What this does ───────────────────────────────────────────────────────────
--   1. Refuses unless #3590 and #3629 have run, and while any stored value still
--      names a retired rung (that is #3590's job, and deleting the role would
--      silently strip those users of their rung).
--   2. Remembers whether the re-run signature is present — a platform CustomerUser
--      or Assessment role in either system.
--   3. Deletes those roles. Memberships cascade; #2455's purge trigger strips their
--      ids from every mapping array in the same transaction.
--   4. Regenerates the six ladder.* mapping rows from the six-rung ladder, every run.
--      They are a pure transcription of LEGACY_ROLE_ORDER — the same self-join #2457
--      used — and nothing edits them by hand. Retires ladder.assessment again.
--   5. Re-asserts the ladder catalog labels/descriptions (ladderCapabilityLabel /
--      ladderCapabilityDescription in lib/db/src/rbac/legacy-ladder.ts, #3638's
--      citation) and the "rung N of 5" role descriptions — every run, idempotent.
--   6. ONLY when step 2 found the signature: restores the three customer mappings
--      #3629 set. On any other run they are left exactly as they are, so this file
--      can never undo an AdminV2 edit (the #3465/#3590/#3629 rule).
--   7. Re-converges every user's memberships through #3408's rbac_sync_user_roles().
--
-- The #2457 seed itself now refuses to run once #3590 has (same commit), so this
-- class cannot recur by re-running it.
--
-- One transaction; idempotent. The DELETEs are keyed on the retired rung keys at
-- platform scope and remove only rows a mistaken re-run created. Run against the
-- local dev DATABASE_URL in-session per CLAUDE.md's Database section; Replit/Staging
-- is on #1630, where it is a no-op unless the same re-run happened there.
--
-- Verified by: pnpm --filter @workspace/db run check-rbac-parity
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Preconditions
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM msp_roles WHERE msp_id IS NULL AND key = 'Customer')
     OR NOT EXISTS (SELECT 1 FROM customer_roles WHERE tenant_id IS NULL AND key = 'Customer') THEN
    RAISE EXCEPTION 'REFUSING: the platform Customer rung is missing. Run 2026-09-11-rbac-customer-free-roles-3590.sql first.';
  END IF;
  IF (SELECT count(*) FROM customer_roles
       WHERE tenant_id IS NULL AND key IN ('customer-admin', 'billing')) <> 2 THEN
    RAISE EXCEPTION 'REFUSING: the Customer Admin / Billing roles are missing. Run 2026-09-11-rbac-customer-admin-billing-roles-3629.sql first.';
  END IF;
  IF EXISTS (SELECT 1 FROM users       WHERE msp_role IN ('CustomerUser', 'Assessment'))
     OR EXISTS (SELECT 1 FROM msp_invites WHERE msp_role IN ('CustomerUser', 'Assessment')) THEN
    RAISE EXCEPTION 'REFUSING: users or msp_invites still store CustomerUser/Assessment. Rewrite them as #3590 step 5 does before removing the roles.';
  END IF;

  -- 2. The re-run signature.
  PERFORM set_config('rbac_3867.rerun_found',
    (EXISTS (SELECT 1 FROM msp_roles      WHERE msp_id    IS NULL AND key IN ('CustomerUser', 'Assessment'))
     OR EXISTS (SELECT 1 FROM customer_roles WHERE tenant_id IS NULL AND key IN ('CustomerUser', 'Assessment')))::text,
    true);
END $$;

-- ----------------------------------------------------------------------------
-- 3. The resurrected roles
-- ----------------------------------------------------------------------------
DELETE FROM msp_roles      WHERE msp_id    IS NULL AND key IN ('CustomerUser', 'Assessment');
DELETE FROM customer_roles WHERE tenant_id IS NULL AND key IN ('CustomerUser', 'Assessment');

-- ----------------------------------------------------------------------------
-- 4. The ladder, as feature->role mappings, on the six-rung ladder
-- ----------------------------------------------------------------------------
-- LEGACY_ROLE_ORDER + LADDER_CAPABILITY_KEYS (lib/db/src/rbac/legacy-ladder.ts) as of
-- #3590. `ladder.X` allows every rung whose index is >= X's — #2457 section 4's
-- self-join, unchanged.
DO $$
BEGIN
  IF (SELECT count(*) FROM msp_roles WHERE msp_id IS NULL
        AND key IN ('Free', 'Customer', 'ServiceAccount', 'MSPOperator', 'MSPAdmin', 'PlatformAdmin')) <> 6 THEN
    RAISE EXCEPTION 'REFUSING: the six platform rung roles are not all present in msp_roles.';
  END IF;
END $$;

WITH ladder(role_key, idx, cap_key) AS (
  VALUES ('Free', 0, 'ladder.free'), ('Customer', 1, 'ladder.customer-user'),
         ('ServiceAccount', 2, 'ladder.service-account'), ('MSPOperator', 3, 'ladder.msp-operator'),
         ('MSPAdmin', 4, 'ladder.msp-admin'), ('PlatformAdmin', 5, 'ladder.platform-admin')
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
  SET roles = EXCLUDED.roles, updated_at = now()
  WHERE msp_feature_role_mapping.roles IS DISTINCT FROM EXCLUDED.roles;

DELETE FROM msp_feature_role_mapping WHERE capability_key = 'ladder.assessment';

UPDATE rbac_capabilities
   SET is_active = false, updated_at = now()
 WHERE system = 'msp' AND key = 'ladder.assessment' AND is_active;

-- ----------------------------------------------------------------------------
-- 5. Catalog labels/descriptions and rung role descriptions
-- ----------------------------------------------------------------------------
WITH ladder(role_key, cap_key) AS (
  VALUES ('Free', 'ladder.free'), ('Customer', 'ladder.customer-user'),
         ('ServiceAccount', 'ladder.service-account'), ('MSPOperator', 'ladder.msp-operator'),
         ('MSPAdmin', 'ladder.msp-admin'), ('PlatformAdmin', 'ladder.platform-admin')
), wanted AS (
  SELECT cap_key,
         'Passes requireRole("' || role_key || '")' AS label,
         'Transitional transcription of the ROLE_ORDER ladder in '
           || 'artifacts/api-server/src/middlewares/requireAuth.ts:115-123, 135-138 as of 3dddd4b26^ '
           || '(ROLE_ORDER, roleIndex, pre-#2460) — true exactly when '
           || 'roleIndex(effective role) >= roleIndex("' || role_key || '"). Seeded as data by #2457, read by '
           || '#2458 when requireRole''s decision source moves onto the evaluator, retired with '
           || 'MSP_ROLES by #2460.' AS description
    FROM ladder
)
UPDATE rbac_capabilities c
   SET label = w.label, description = w.description, is_active = true, updated_at = now()
  FROM wanted w
 WHERE c.system = 'msp' AND c.key = w.cap_key
   AND (c.label IS DISTINCT FROM w.label OR c.description IS DISTINCT FROM w.description OR NOT c.is_active);

-- #3590 step 2's rung renumbering, re-applied to the descriptions the re-run reset.
WITH ladder(role_key, idx) AS (
  VALUES ('Free', 0), ('Customer', 1), ('ServiceAccount', 2),
         ('MSPOperator', 3), ('MSPAdmin', 4), ('PlatformAdmin', 5)
)
UPDATE msp_roles r
   SET description = regexp_replace(replace(r.description, 'CustomerUser', 'Customer'),
                                    'rung [0-9]+ of 6', 'rung ' || l.idx || ' of 5'),
       updated_at = now()
  FROM ladder l
 WHERE r.msp_id IS NULL AND r.key = l.role_key AND r.description ~ 'rung [0-9]+ of 6';

WITH ladder(role_key, idx) AS (
  VALUES ('Free', 0), ('Customer', 1), ('ServiceAccount', 2),
         ('MSPOperator', 3), ('MSPAdmin', 4), ('PlatformAdmin', 5)
)
UPDATE customer_roles r
   SET description = regexp_replace(replace(r.description, 'CustomerUser', 'Customer'),
                                    'rung [0-9]+ of 6', 'rung ' || l.idx || ' of 5'),
       updated_at = now()
  FROM ladder l
 WHERE r.tenant_id IS NULL AND r.key = l.role_key AND r.description ~ 'rung [0-9]+ of 6';

-- ----------------------------------------------------------------------------
-- 6. The customer mappings #3629 set — only when the re-run overwrote them
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  admin_id text := (SELECT id::text FROM customer_roles WHERE tenant_id IS NULL AND key = 'customer-admin');
BEGIN
  IF current_setting('rbac_3867.rerun_found', true) IS DISTINCT FROM 'true' THEN
    RAISE NOTICE '#3867: no re-run signature found — customer mappings left exactly as they are.';
    RETURN;
  END IF;

  -- billing.view: #3629's decision — Customer Admin, Billing and MSP staff. The re-run
  -- replaced the whole row, so it is replaced back; billing.manage, which the re-run
  -- did not touch, carries the same set.
  UPDATE customer_feature_role_mapping
     SET roles = jsonb_set(roles, '{allow}', COALESCE((
           SELECT jsonb_agg(id::text ORDER BY key) FROM customer_roles
            WHERE tenant_id IS NULL
              AND key IN ('customer-admin', 'billing', 'MSPOperator', 'MSPAdmin', 'PlatformAdmin')), '[]'::jsonb)),
         updated_at = now()
   WHERE tenant_id IS NULL AND capability_key = 'billing.view';

  -- team.manage / changes.approve: #3629 step 2c, appended.
  UPDATE customer_feature_role_mapping m
     SET roles = jsonb_set(m.roles, '{allow}', (m.roles -> 'allow') || to_jsonb(admin_id)),
         updated_at = now()
   WHERE m.tenant_id IS NULL
     AND m.capability_key IN ('team.manage', 'changes.approve', 'marketplace.browse-full')
     AND NOT ((m.roles -> 'allow') ? admin_id);

  RAISE NOTICE '#3867: re-run signature found — resurrected roles removed, billing.view / team.manage / changes.approve restored to #3629.';
END $$;

-- ----------------------------------------------------------------------------
-- 7. Converge every user once more
-- ----------------------------------------------------------------------------
SELECT rbac_sync_user_roles(id) FROM users;

-- ----------------------------------------------------------------------------
-- Run tracking (Git #497) — Simulator Studio's Migrations tree reads this.
-- ----------------------------------------------------------------------------
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-12-rbac-repair-2457-rerun-3867.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
