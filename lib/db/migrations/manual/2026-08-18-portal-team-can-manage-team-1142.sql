-- Git #1142 — SECURITY: role-based access control for /portal/team
--
-- The mutating team-management routes (invite, suspend, reset-password,
-- temp-password, reset-mfa, mfa-enforcement, unlock, emergency-bypass,
-- delete-sessions) previously gated only on tenant isolation, so ANY
-- CustomerUser could perform these on their own company's other users. The
-- code fix (artifacts/api-server/src/routes/portal-team.ts) now additionally
-- requires a live per-user `can_manage_team` capability for customer-tier
-- callers. There is deliberately no "CustomerAdmin" role in MSP_ROLES; this
-- boolean flag is the elevated-customer distinction, mirroring the existing
-- `can_approve_purchases` column.
--
-- Additive + reversible (drop column to revert). MSP staff / PlatformAdmin are
-- unaffected — they gate on role, not this flag.

BEGIN;

-- 1. The capability column. Defaults false so no one is silently granted the
--    elevated team-management rights.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS can_manage_team boolean NOT NULL DEFAULT false;

-- 2. Backfill so existing customers are NOT locked out of managing their own
--    team the moment the code gate goes live. There is no "account owner"
--    designation anywhere in the schema, so we use the standard heuristic: the
--    earliest-created ACTIVE CustomerUser in each tenant (tie-broken by lowest
--    id) becomes that tenant's initial team admin. Every other CustomerUser
--    stays false and must be granted explicitly. A tenant whose only members
--    are inactive gets no auto-admin — Shane grants one manually.
WITH first_admin AS (
  SELECT DISTINCT ON (tenant_id) id
  FROM users
  WHERE msp_role = 'CustomerUser'
    AND tenant_id IS NOT NULL
    AND is_active = true
  ORDER BY tenant_id, created_at ASC, id ASC
)
UPDATE users
SET can_manage_team = true
WHERE id IN (SELECT id FROM first_admin);

-- 3. Self-mark this migration as run so Simulator Studio's Migrations tree
--    (Git #497) reflects DB reality regardless of which console executed it.
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-18-portal-team-can-manage-team-1142.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
