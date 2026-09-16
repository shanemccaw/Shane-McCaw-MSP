-- ============================================================================
-- #4384 — repair the customer-side RBAC catalog wiped by #4272's tenant reset
-- ============================================================================
-- Part of #1696 (RBAC Role Model Redesign). Sits on top of #2455, #2457, #3408,
-- #3465, #3590, #3629, #3867, #3974, #4371. Modelled on 2026-09-12's #3867 repair
-- (same "converging, not idempotent-only" discipline), but for a different real
-- incident.
--
-- ── What happened (confirmed live, cross-referenced against #4271/#4272/#4400) ──
-- #4271 (Phase 1, the tenant-reset audit) enumerated every table carrying a
-- `tenant_id` column and split them Reset vs Preserve. `customer_roles` (12 rows
-- at the time) and `customer_feature_role_mapping` (5 rows) both carry `tenant_id`,
-- so both landed on the "Reset" list (#4271's own comment, section 3) — while their
-- msp-side twins `msp_roles`/`msp_feature_role_mapping` (which carry `msp_id`, not
-- `tenant_id`) were correctly recognised as platform RBAC catalog data and placed
-- on "Preserve" (section 4). That asymmetry is the root cause: the platform-default
-- rows in both customer tables (`tenant_id IS NULL` — the RBAC catalog, not
-- per-tenant data) got caught by the same blanket delete as genuine per-tenant
-- rows, because the categorization worked off "has a tenant_id column" rather than
-- "the row's tenant_id is actually NULL."
--
-- #4272 (Phase 2) then deleted/truncated exactly that approved list, wiping every
-- customer_roles row except the four #4371 later reseeded in an unrelated build
-- (MonitoringPending/Consented, PackPending/Consented — collateral of #4371's own
-- INSERT, not a repair) and every customer_feature_role_mapping row with no
-- replacement at all (#4371's own mapping UPDATEs ran against a table that no
-- longer had the rows to update, so they silently matched nothing).
--
-- This exact finding is already filed and open as #4400 (`URGENT: customer-side
-- RBAC catalog wiped post-#4272 reset`) — this file is the repair migration both
-- #4400 and #4384 call for. `lib/db/src/rbac/integrity-check.ts:128`'s unscoped
-- `DELETE FROM customer_roles` (#4384's own original hypothesis) is ruled out: it
-- deletes msp_* and customer_* symmetrically inside a transaction that always
-- rolls back (a `Rollback` is unconditionally thrown at the end) or aborts safely
-- server-side if the process crashes mid-transaction — it cannot produce an
-- asymmetric wipe of customer-only tables while msp_roles/msp_feature_role_mapping
-- stay fully intact, which is exactly what the live data shows.
--
-- ── What this does ───────────────────────────────────────────────────────────
--   1. Refuses unless msp_roles (the intact twin, and therefore the source of
--      truth for the ladder's current shape) carries the full twelve-rung ladder.
--   2. Reseeds the eight missing ladder-mirror roles into customer_roles, copying
--      the exact key/name pattern #2457/#3974/#4371 used (the four Monitoring/Pack
--      rows already exist from #4371 and are re-asserted, not duplicated).
--   3. Reseeds `customer-admin` / `billing` (#3629) and `cap.team.manage` /
--      `cap.changes.approve` (#2457 section 3) — the customer-only special roles
--      with no msp_roles twin to copy from.
--   4. Rebuilds all five `customer_feature_role_mapping` rows from scratch —
--      team.manage, changes.approve, billing.view, billing.manage,
--      marketplace.browse-full — to the exact allow/deny sets #2457 + #3465 +
--      #3590 + #3629 + #3974 + #4371 converge to, computed by key (never a
--      hardcoded uuid), so this is correct regardless of the new rows' ids.
--   5. Re-converges every user's ladder rung + cap.changes.approve membership via
--      the live `rbac_sync_user_roles()` (unaffected by the wipe — it's a
--      function, not data, and #4371 already carries the full 12-rung list).
--   6. Carries forward `cap.team.manage` from `users.can_manage_team` and
--      `billing` from real `invoices`/`client_services` ownership (#3629's own
--      one-time carry-forward logic) — both are genuinely 0 rows on this database
--      today, but the logic is real and correct if that ever changes.
--
-- ── An honest, permanent gap this migration CANNOT close ────────────────────
-- `customer-admin` role MEMBERSHIP (who was actually granted Customer Admin by
-- hand through AdminV2) has no backing column anywhere in `users` — unlike
-- `cap.team.manage`/`cap.changes.approve`/`billing`, it was never derivable from
-- data, only from the `customer_user_roles` row itself, which #4272 deleted. That
-- specific grant is unrecoverable. Confirmed live: zero real (non-vitest) users
-- exist today with any customer-admin-shaped test account, so nothing is silently
-- lost by this repair — but if any org had a real Customer Admin assigned before
-- 2026-09-15's reset, that assignment needs Shane to redo it by hand in AdminV2.
-- This is a real gap, not a maybe — it is stated here rather than papered over.
--
-- One transaction; converging (ON CONFLICT ... DO UPDATE throughout, same as
-- #2457/#3629/#3867/#3974/#4371) rather than a one-shot INSERT, so a future re-run
-- lands on the same correct state instead of erroring or duplicating. Run against
-- the local dev DATABASE_URL in-session per CLAUDE.md's Database section.
-- Replit/Staging were not touched by #4272 (local dev/testbed only, per that
-- issue's own closing comment) — #1630 is not needed for this file.
--
-- Verified by: pnpm --filter @workspace/db run check-rbac-parity, and
-- lib/db's src/rbac/user-role-sync.test.ts + retainer-no-consent-gating.test.ts.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Precondition — msp_roles must carry the full, current twelve-rung ladder
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF (SELECT count(*) FROM msp_roles WHERE msp_id IS NULL AND key IN (
        'Free', 'MonitoringPending', 'MonitoringConsented', 'PackPending', 'PackConsented',
        'RetainerPending', 'RetainerConsented', 'Customer', 'ServiceAccount',
        'MSPOperator', 'MSPAdmin', 'PlatformAdmin'
      )) <> 12 THEN
    RAISE EXCEPTION 'REFUSING: msp_roles does not carry the full twelve-rung ladder — run 2457/3590/3629/3974/4371 first. This repair mirrors FROM msp_roles, which must be the intact side.';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 2. The twelve-rung ladder, mirrored into customer_roles (re-asserts the four
--    Monitoring/Pack rows #4371 already reseeded; recreates the eight #4272 wiped)
-- ----------------------------------------------------------------------------
INSERT INTO customer_roles (tenant_id, key, name, description, is_system)
SELECT NULL, r.key, r.name,
       CASE r.key
         WHEN 'Free'               THEN 'Mirrored into the customer system by #2457, resurrected by #4384''s repair after #4272''s reset wiped the platform row. Pre-payment tier.'
         WHEN 'MonitoringPending'  THEN 'Mirrored into the customer system by #4371. No tenant while in this state.'
         WHEN 'MonitoringConsented' THEN 'Mirrored into the customer system by #4371. Has a tenant.'
         WHEN 'PackPending'        THEN 'Mirrored into the customer system by #4371. No tenant while in this state.'
         WHEN 'PackConsented'      THEN 'Mirrored into the customer system by #4371. Has a tenant.'
         WHEN 'RetainerPending'    THEN 'Mirrored into the customer system by #3974 (as RetainerNoConsent), renamed by #4371, resurrected by #4384''s repair after #4272''s reset wiped the platform row. No tenant while in this state.'
         WHEN 'RetainerConsented'  THEN 'Mirrored into the customer system by #3974, resurrected by #4384''s repair after #4272''s reset wiped the platform row. Same tenant requirement shape as Customer.'
         WHEN 'Customer'           THEN 'Mirrored into the customer system by #2457, renamed from CustomerUser by #3590, resurrected by #4384''s repair after #4272''s reset wiped the platform row. The one paid-customer rung.'
         WHEN 'ServiceAccount'     THEN 'Mirrored into the customer system by #2457, resurrected by #4384''s repair after #4272''s reset wiped the platform row.'
         WHEN 'MSPOperator'        THEN 'Mirrored into the customer system by #2457, resurrected by #4384''s repair after #4272''s reset wiped the platform row.'
         WHEN 'MSPAdmin'           THEN 'Mirrored into the customer system by #2457, resurrected by #4384''s repair after #4272''s reset wiped the platform row.'
         WHEN 'PlatformAdmin'      THEN 'Mirrored into the customer system by #2457, resurrected by #4384''s repair after #4272''s reset wiped the platform row.'
       END,
       true
FROM msp_roles r
WHERE r.msp_id IS NULL
  AND r.key IN ('Free', 'MonitoringPending', 'MonitoringConsented', 'PackPending', 'PackConsented',
                'RetainerPending', 'RetainerConsented', 'Customer', 'ServiceAccount',
                'MSPOperator', 'MSPAdmin', 'PlatformAdmin')
ON CONFLICT (key) WHERE tenant_id IS NULL DO UPDATE
  SET name = EXCLUDED.name, description = EXCLUDED.description, is_system = true, updated_at = now();

-- ----------------------------------------------------------------------------
-- 3. Customer-only special roles — no msp_roles twin, recreated verbatim
-- ----------------------------------------------------------------------------
-- customer-admin / billing (#3629)
INSERT INTO customer_roles (tenant_id, key, name, description, is_system) VALUES
  (NULL, 'customer-admin', 'Customer Admin',
   'The top of a customer org, parallel to MSPAdmin on the MSP side (#3629, resolving #3587). '
     || 'Holds every customer-system capability by default: billing.view, billing.manage, '
     || 'team.manage, changes.approve and marketplace.browse-full. A platform default an org '
     || 'may customise or reassign (#2455). Resurrected by #4384''s repair after #4272''s reset '
     || 'wiped the platform row — see #4384''s header for the one gap this repair cannot close: '
     || 'any real customer-admin MEMBERSHIP assigned by hand before the reset is gone and needs '
     || 'Shane to redo it in AdminV2.',
   true),
  (NULL, 'billing', 'Billing',
   'Billing access without admin rights (#3629, resolving #3587): customer:billing.view and '
     || 'customer:billing.manage only. A Customer Admin assigns it to specific employees. Also '
     || 'granted automatically to whoever an invoice or client service is addressed to, because '
     || 'every portal billing route reads the caller''s own rows. Resurrected by #4384''s repair '
     || 'after #4272''s reset wiped the platform row; the billed-party carry-forward is re-run by '
     || 'this same file.',
   true)
ON CONFLICT (key) WHERE tenant_id IS NULL DO UPDATE
  SET name = EXCLUDED.name, description = EXCLUDED.description, is_system = true, updated_at = now();

-- cap.team.manage / cap.changes.approve (#2457 section 3)
INSERT INTO customer_roles (tenant_id, key, name, description, is_system) VALUES
  (NULL, 'cap.team.manage', 'Team Manager',
   'Carries users.can_manage_team (Git #1142) — the elevated-customer distinction '
     || 'portal-team.ts:40-54 requires of a customer-tier caller on top of tenant isolation. '
     || 'Resurrected by #4384''s repair after #4272''s reset wiped the platform row; membership '
     || 'is re-derived from the live can_manage_team column by this same file.',
   true),
  (NULL, 'cap.changes.approve', 'Change Approver',
   'Carries users.can_approve_changes (Git #1496) — the live per-user authority '
     || 'portal-change-control.ts:493-506 requires to approve or reject a change against the '
     || 'customer''s own tenant. Resurrected by #4384''s repair after #4272''s reset wiped the '
     || 'platform row; membership is re-derived from the live can_approve_changes column via '
     || 'rbac_sync_user_roles() by this same file.',
   true)
ON CONFLICT (key) WHERE tenant_id IS NULL DO UPDATE
  SET name = EXCLUDED.name, description = EXCLUDED.description, is_system = true, updated_at = now();

-- ----------------------------------------------------------------------------
-- 4. customer_feature_role_mapping — rebuilt from scratch, by key, to the
--    exact converged state of #2457 + #3465 + #3590 + #3629 + #3974 + #4371
-- ----------------------------------------------------------------------------

-- team.manage — #2457 base (ServiceAccount/MSPOperator/MSPAdmin/PlatformAdmin/
-- cap.team.manage) + #3629 appends customer-admin + #3974/#4371 deny the three
-- tenant-less Pending rungs.
INSERT INTO customer_feature_role_mapping (tenant_id, system, capability_key, roles)
SELECT NULL, 'customer', 'team.manage',
       jsonb_build_object(
         'allow', COALESCE((SELECT jsonb_agg(id::text ORDER BY key) FROM customer_roles
                   WHERE tenant_id IS NULL
                     AND key IN ('ServiceAccount', 'MSPOperator', 'MSPAdmin', 'PlatformAdmin',
                                 'cap.team.manage', 'customer-admin')), '[]'::jsonb),
         'deny', COALESCE((SELECT jsonb_agg(id::text ORDER BY key) FROM customer_roles
                   WHERE tenant_id IS NULL
                     AND key IN ('RetainerPending', 'MonitoringPending', 'PackPending')), '[]'::jsonb))
ON CONFLICT (capability_key) WHERE tenant_id IS NULL DO UPDATE
  SET roles = EXCLUDED.roles, updated_at = now();

-- changes.approve — #2457 base (MSPOperator/MSPAdmin/PlatformAdmin/cap.changes.approve)
-- + #3629 appends customer-admin + #3974/#4371 deny the three Pending rungs.
INSERT INTO customer_feature_role_mapping (tenant_id, system, capability_key, roles)
SELECT NULL, 'customer', 'changes.approve',
       jsonb_build_object(
         'allow', COALESCE((SELECT jsonb_agg(id::text ORDER BY key) FROM customer_roles
                   WHERE tenant_id IS NULL
                     AND key IN ('MSPOperator', 'MSPAdmin', 'PlatformAdmin',
                                 'cap.changes.approve', 'customer-admin')), '[]'::jsonb),
         'deny', COALESCE((SELECT jsonb_agg(id::text ORDER BY key) FROM customer_roles
                   WHERE tenant_id IS NULL
                     AND key IN ('RetainerPending', 'MonitoringPending', 'PackPending')), '[]'::jsonb))
ON CONFLICT (capability_key) WHERE tenant_id IS NULL DO UPDATE
  SET roles = EXCLUDED.roles, updated_at = now();

-- billing.view / billing.manage — #3629's final narrowed state (identical sets):
-- customer-admin, billing, MSPOperator, MSPAdmin, PlatformAdmin. Untouched by
-- #3974/#4371 (the billed-party trigger handles Pending/NoConsent rungs, not a
-- mapping-row edit — see those files' own headers).
INSERT INTO customer_feature_role_mapping (tenant_id, system, capability_key, roles)
SELECT NULL, 'customer', cap.capability_key,
       jsonb_build_object(
         'allow', COALESCE((SELECT jsonb_agg(id::text ORDER BY key) FROM customer_roles
                   WHERE tenant_id IS NULL
                     AND key IN ('customer-admin', 'billing', 'MSPOperator', 'MSPAdmin', 'PlatformAdmin')), '[]'::jsonb),
         'deny', '[]'::jsonb)
FROM (VALUES ('billing.view'), ('billing.manage')) AS cap(capability_key)
ON CONFLICT (capability_key) WHERE tenant_id IS NULL DO UPDATE
  SET roles = EXCLUDED.roles, updated_at = now();

-- marketplace.browse-full — #3590 base (Customer + every rung above it) +
-- #3974 (both Retainer rungs) + #4371 (all four Monitoring/Pack rungs) + #3629
-- section 2c, which appends customer-admin to team.manage/changes.approve/
-- marketplace.browse-full alike (Customer Admin "holds every customer-system
-- capability by default" per #3629's own header — easy to miss since it's the
-- one of the three appended elsewhere in that file, not alongside the other two).
INSERT INTO customer_feature_role_mapping (tenant_id, system, capability_key, roles)
SELECT NULL, 'customer', 'marketplace.browse-full',
       jsonb_build_object(
         'allow', COALESCE((SELECT jsonb_agg(id::text ORDER BY key) FROM customer_roles
                   WHERE tenant_id IS NULL
                     AND key IN ('MonitoringPending', 'MonitoringConsented', 'PackPending', 'PackConsented',
                                 'RetainerPending', 'RetainerConsented', 'Customer', 'ServiceAccount',
                                 'MSPOperator', 'MSPAdmin', 'PlatformAdmin', 'customer-admin')), '[]'::jsonb),
         'deny', '[]'::jsonb)
ON CONFLICT (capability_key) WHERE tenant_id IS NULL DO UPDATE
  SET roles = EXCLUDED.roles, updated_at = now();

-- ----------------------------------------------------------------------------
-- 5. Re-converge every user's ladder rung + cap.changes.approve
-- ----------------------------------------------------------------------------
SELECT rbac_sync_user_roles(id) FROM users;

-- ----------------------------------------------------------------------------
-- 6. Carry forward cap.team.manage and billing — real data, currently 0 rows
--    matched on this database, but the logic is real (#2457 section 7 / #3629
--    section 2a's exact shape) and correct if that ever changes.
-- ----------------------------------------------------------------------------
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

INSERT INTO customer_user_roles (user_id, role_id)
SELECT billed.user_id, r.id
FROM (SELECT client_user_id AS user_id FROM invoices
      UNION
      SELECT client_user_id FROM client_services) billed
JOIN customer_roles r ON r.tenant_id IS NULL AND r.key = 'billing'
ON CONFLICT (user_id, role_id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- Run tracking (Git #497) — Simulator Studio's Migrations tree reads this.
-- ----------------------------------------------------------------------------
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-16-rbac-repair-customer-catalog-wipe-4384.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
