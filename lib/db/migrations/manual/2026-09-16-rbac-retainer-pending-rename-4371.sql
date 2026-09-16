-- ============================================================================
-- #4371 (issue 1 of #4370) — RetainerNoConsent -> RetainerPending; four new
--         Monitoring/Pack Pending/Consented rungs seeded into the RBAC model
-- ============================================================================
-- Part of Feature #4370 (Product-Scoped Pending/Consented Ladder Rungs), on top of
-- #3971 (the Retainer rungs + users_role_scope_check branch) and #3974 (their
-- role/capability/mapping seed). Same shape as #3590's CustomerUser -> Customer.
--
-- ── The product decision (Shane, 2026-09-16, recorded on #4370) ──────────────
--   * Per-product rung pairs, not one shared generic rung.
--   * `RetainerNoConsent` is renamed `RetainerPending`. Test data only today, so this
--     is a clean rewrite — but still a real, reviewable migration.
--   * LEGACY_ROLE_ORDER (lib/db/src/rbac/legacy-ladder.ts) now reads:
--       Free, MonitoringPending, MonitoringConsented, PackPending, PackConsented,
--       RetainerPending, RetainerConsented, Customer, ServiceAccount, MSPOperator,
--       MSPAdmin, PlatformAdmin
--     Every pre-existing rung keeps its relative order; the four new rungs sit
--     between Free and RetainerPending, so every floor at RetainerPending or above
--     keeps exactly the allow set it had, and only `ladder.free` gains four ids.
--
-- ── What this does, in order ─────────────────────────────────────────────────
--   1. Replaces rbac_sync_user_roles() (#3408/#3590/#3974) with the twelve-rung
--      ladder FIRST, so the users UPDATE in step 5 re-converges each row onto the
--      renamed rung rather than onto a rung list that no longer names it.
--   2. Renames the platform `RetainerNoConsent` role to `RetainerPending`, in both
--      systems. The role UUID does not change, so every mapping row that allows or
--      denies it (#3974's ladder floors, marketplace.browse-full allow, team.manage /
--      changes.approve deny) keeps pointing at it — #1696 requirement 2.
--   3. `ladder.retainer-no-consent` KEEPS its key (capability keys are immutable
--      once shipped — capabilities.ts; #3590 precedent with ladder.customer-user).
--      Only its label/description follow the rename, rebuilt with the same formula
--      ladderCapabilityLabel()/ladderCapabilityDescription() produce, so the TS
--      catalog and the table agree string-for-string.
--   4. Lifts users_role_scope_check (its tenant-less branch names the old value).
--   5. Rewrites the stored values: users.msp_role and msp_invites.msp_role
--      RetainerNoConsent -> RetainerPending. UPDATE with WHERE, not DROP.
--   6. Restores users_role_scope_check with `RetainerPending` in that branch —
--      identical in meaning. NOT VALID -> verify -> VALIDATE, the #3608/#3971
--      pattern for this exact constraint. The four new rungs are deliberately NOT
--      admitted here; widening the check for them is #4372.
--   7. Catalogues the four new ladder capabilities (ladder.monitoring-pending,
--      ladder.monitoring-consented, ladder.pack-pending, ladder.pack-consented).
--   8. Seeds the four new rungs as platform roles in both systems.
--   9. Recomputes every `ladder.*` mapping row wholesale from the twelve-rung
--      ladder (#3974's discipline — a ladder change can never leave one floor stale).
--  10. customer_feature_role_mapping — the new rungs take exactly the decisions
--      #3974 made for the Retainer pair they are modelled on (#4370: "extends the
--      RetainerNoConsent/RetainerConsented pattern ... to Monitoring and Packs"):
--        * marketplace.browse-full: ALLOW all four (parity with both Retainer rungs).
--        * team.manage, changes.approve: explicit DENY for MonitoringPending and
--          PackPending (no tenant — same as RetainerPending).
--        * MonitoringConsented / PackConsented: no deny row; team.manage is denied
--          by omission exactly as RetainerConsented and a bare Customer are, and
--          changes.approve follows the cap.changes.approve / Customer Admin roles.
--        * billing.view / billing.manage: untouched — the #3629 billed-party
--          trigger is the mechanism, independent of msp_role (see #3974's header).
--      The narrower "*Pending may reach only the resume-purchase stub" portal gate
--      is #4375's route-level work, not a mapping row here.
--  11. Re-runs the #3408 convergence over every user on a Retainer rung.
--
-- ── Deliberately NOT rewritten ───────────────────────────────────────────────
--   msp_audit_logs.actor_role and the other audit/event actor_role columns keep
--   whatever was recorded — history, per #3590. None carries 'RetainerNoConsent'
--   locally today (resolveAuditActorRole maps retainer rungs to 'customer').
--
-- ── Safety ───────────────────────────────────────────────────────────────────
-- One transaction; idempotent (every rename step is keyed on the old value still
-- being present; inserts are ON CONFLICT; CREATE OR REPLACE). Additive apart from
-- the value rewrite. Run against the local dev DATABASE_URL in-session per
-- CLAUDE.md's Database section. Replit/Staging is on #1630 — and must ship WITH the
-- #4371 code: the code looks the rung up by `RetainerPending`, so code without this
-- migration resolves no rung for a retainer-pending principal (fail closed).
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('rbac_sync_user_roles(integer)') IS NULL THEN
    RAISE EXCEPTION 'REFUSING: #3408''s rbac_sync_user_roles() is missing. Run 2026-09-10-rbac-user-roles-maintained-3408.sql first.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM msp_roles WHERE msp_id IS NULL AND key IN ('RetainerNoConsent', 'RetainerPending')) THEN
    RAISE EXCEPTION 'REFUSING: #3974 has not run — no platform RetainerNoConsent/RetainerPending role exists yet.';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 1. rbac_sync_user_roles() on the twelve-rung ladder
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rbac_sync_user_roles(p_user_id integer) RETURNS void AS $$
DECLARE
  -- LEGACY_ROLE_ORDER (lib/db/src/rbac/legacy-ladder.ts) as of #4371: four
  -- Monitoring/Pack rungs added between Free and RetainerPending, and
  -- RetainerNoConsent renamed RetainerPending.
  rungs  CONSTANT text[] := ARRAY['Free', 'MonitoringPending', 'MonitoringConsented',
                                  'PackPending', 'PackConsented',
                                  'RetainerPending', 'RetainerConsented', 'Customer',
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

-- ----------------------------------------------------------------------------
-- 2. RetainerNoConsent -> RetainerPending, same role id, both systems
-- ----------------------------------------------------------------------------
UPDATE msp_roles
   SET key = 'RetainerPending', name = 'RetainerPending',
       description = replace(description, 'RetainerNoConsent', 'RetainerPending'), updated_at = now()
 WHERE msp_id IS NULL AND key = 'RetainerNoConsent';

UPDATE customer_roles
   SET key = 'RetainerPending', name = 'RetainerPending',
       description = replace(description, 'RetainerNoConsent', 'RetainerPending'), updated_at = now()
 WHERE tenant_id IS NULL AND key = 'RetainerNoConsent';

-- RetainerConsented's own description names its neighbour.
UPDATE msp_roles
   SET description = replace(description, 'RetainerNoConsent', 'RetainerPending'), updated_at = now()
 WHERE msp_id IS NULL AND key = 'RetainerConsented' AND description LIKE '%RetainerNoConsent%';

UPDATE customer_roles
   SET description = replace(description, 'RetainerNoConsent', 'RetainerPending'), updated_at = now()
 WHERE tenant_id IS NULL AND key = 'RetainerConsented' AND description LIKE '%RetainerNoConsent%';

-- ----------------------------------------------------------------------------
-- 3 + 7. Ladder catalog rows: the renamed rung's label, and the four new rungs
-- ----------------------------------------------------------------------------
-- Label and description are ladderCapabilityLabel()/ladderCapabilityDescription()
-- (legacy-ladder.ts) character for character.
WITH ladder(role_key, cap_key) AS (
  VALUES ('MonitoringPending',   'ladder.monitoring-pending'),
         ('MonitoringConsented', 'ladder.monitoring-consented'),
         ('PackPending',         'ladder.pack-pending'),
         ('PackConsented',       'ladder.pack-consented'),
         ('RetainerPending',     'ladder.retainer-no-consent')
)
INSERT INTO rbac_capabilities (system, key, category, label, description, is_active)
SELECT 'msp', cap_key, 'legacy-ladder',
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
-- 4. Lift users_role_scope_check
-- ----------------------------------------------------------------------------
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_scope_check;

-- ----------------------------------------------------------------------------
-- 5. The stored values (the #3408 trigger re-converges each users row as it goes)
-- ----------------------------------------------------------------------------
UPDATE users       SET msp_role = 'RetainerPending', updated_at = now() WHERE msp_role = 'RetainerNoConsent';
UPDATE msp_invites SET msp_role = 'RetainerPending'                     WHERE msp_role = 'RetainerNoConsent';

-- ----------------------------------------------------------------------------
-- 6. Restore users_role_scope_check (same meaning, renamed value)
-- ----------------------------------------------------------------------------
ALTER TABLE users ADD CONSTRAINT users_role_scope_check CHECK (
  (msp_role IN ('Customer', 'Free', 'RetainerConsented') AND tenant_id IS NOT NULL)
  OR
  (msp_role = 'RetainerPending')
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
    (msp_role = 'RetainerPending')
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
-- 8. The four new rungs as platform roles, both systems
-- ----------------------------------------------------------------------------
INSERT INTO msp_roles (msp_id, key, name, description, is_system) VALUES
  (NULL, 'MonitoringPending', 'MonitoringPending',
   'Monitoring purchaser who has not yet consented to tenant access (#4370). Seeded by #4371 '
     || 'so the rung can be resolved by readPlatformRoleId(); sits between Free and '
     || 'MonitoringConsented in LEGACY_ROLE_ORDER.',
   true),
  (NULL, 'MonitoringConsented', 'MonitoringConsented',
   'Monitoring purchaser who has connected a tenant (#4370). Seeded by #4371; sits between '
     || 'MonitoringPending and PackPending in LEGACY_ROLE_ORDER.',
   true),
  (NULL, 'PackPending', 'PackPending',
   'Pack purchaser who has not yet given read consent to tenant access (#4370; write consent '
     || 'stays a post-payment Customer-tier action). Seeded by #4371; sits between '
     || 'MonitoringConsented and PackConsented in LEGACY_ROLE_ORDER.',
   true),
  (NULL, 'PackConsented', 'PackConsented',
   'Pack purchaser who has given read consent and connected a tenant (#4370). Seeded by #4371; '
     || 'sits between PackPending and RetainerPending in LEGACY_ROLE_ORDER.',
   true)
ON CONFLICT (key) WHERE msp_id IS NULL DO UPDATE
  SET name = EXCLUDED.name, description = EXCLUDED.description, is_system = true, updated_at = now();

INSERT INTO customer_roles (tenant_id, key, name, description, is_system) VALUES
  (NULL, 'MonitoringPending', 'MonitoringPending',
   'Mirrored into the customer system by #4371, same reason #2457 mirrored the original rungs. '
     || 'No tenant while in this state.',
   true),
  (NULL, 'MonitoringConsented', 'MonitoringConsented',
   'Mirrored into the customer system by #4371. Has a tenant.',
   true),
  (NULL, 'PackPending', 'PackPending',
   'Mirrored into the customer system by #4371. No tenant while in this state.',
   true),
  (NULL, 'PackConsented', 'PackConsented',
   'Mirrored into the customer system by #4371. Has a tenant.',
   true)
ON CONFLICT (key) WHERE tenant_id IS NULL DO UPDATE
  SET name = EXCLUDED.name, description = EXCLUDED.description, is_system = true, updated_at = now();

-- ----------------------------------------------------------------------------
-- 9. The ladder, recomputed wholesale from the twelve-rung order
-- ----------------------------------------------------------------------------
WITH ladder(role_key, idx, cap_key) AS (
  VALUES ('Free', 0, 'ladder.free'),
         ('MonitoringPending', 1, 'ladder.monitoring-pending'),
         ('MonitoringConsented', 2, 'ladder.monitoring-consented'),
         ('PackPending', 3, 'ladder.pack-pending'),
         ('PackConsented', 4, 'ladder.pack-consented'),
         ('RetainerPending', 5, 'ladder.retainer-no-consent'),
         ('RetainerConsented', 6, 'ladder.retainer-consented'),
         ('Customer', 7, 'ladder.customer-user'),
         ('ServiceAccount', 8, 'ladder.service-account'),
         ('MSPOperator', 9, 'ladder.msp-operator'),
         ('MSPAdmin', 10, 'ladder.msp-admin'),
         ('PlatformAdmin', 11, 'ladder.platform-admin')
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
-- 10. customer_feature_role_mapping — the #3974 decisions, applied to the new rungs
-- ----------------------------------------------------------------------------
-- 10a. marketplace.browse-full — ALLOW all four (parity with both Retainer rungs).
UPDATE customer_feature_role_mapping m
   SET roles = jsonb_set(
         m.roles, '{allow}',
         (SELECT COALESCE(jsonb_agg(DISTINCT x ORDER BY x), '[]'::jsonb)
            FROM (SELECT e AS x FROM jsonb_array_elements_text(m.roles -> 'allow') e
                  UNION ALL
                  SELECT r.id::text FROM customer_roles r
                   WHERE r.tenant_id IS NULL
                     AND r.key IN ('MonitoringPending', 'MonitoringConsented', 'PackPending', 'PackConsented')) s)),
       updated_at = now()
 WHERE m.tenant_id IS NULL
   AND m.capability_key = 'marketplace.browse-full'
   AND NOT ((m.roles -> 'allow') ?& ARRAY(
     SELECT id::text FROM customer_roles
      WHERE tenant_id IS NULL
        AND key IN ('MonitoringPending', 'MonitoringConsented', 'PackPending', 'PackConsented')
   ));

-- 10b. team.manage and changes.approve — explicit DENY for the two Pending rungs
--      (no tenant), exactly as #3974 did for RetainerNoConsent (now RetainerPending).
UPDATE customer_feature_role_mapping m
   SET roles = jsonb_set(
         m.roles, '{deny}',
         (SELECT COALESCE(jsonb_agg(DISTINCT x ORDER BY x), '[]'::jsonb)
            FROM (SELECT e AS x FROM jsonb_array_elements_text(m.roles -> 'deny') e
                  UNION ALL
                  SELECT r.id::text FROM customer_roles r
                   WHERE r.tenant_id IS NULL AND r.key IN ('MonitoringPending', 'PackPending')) s)),
       updated_at = now()
 WHERE m.tenant_id IS NULL
   AND m.capability_key IN ('team.manage', 'changes.approve')
   AND NOT ((m.roles -> 'deny') ?& ARRAY(
     SELECT id::text FROM customer_roles WHERE tenant_id IS NULL AND key IN ('MonitoringPending', 'PackPending')
   ));

-- ----------------------------------------------------------------------------
-- 11. Re-converge every user on a Retainer rung
-- ----------------------------------------------------------------------------
SELECT rbac_sync_user_roles(id) FROM users WHERE msp_role IN ('RetainerPending', 'RetainerConsented');

-- ----------------------------------------------------------------------------
-- Run tracking (Git #497) — Simulator Studio's Migrations tree reads this.
-- ----------------------------------------------------------------------------
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-16-rbac-retainer-pending-rename-4371.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
