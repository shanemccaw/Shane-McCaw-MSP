-- #2085 — Security Plan scope: back the business_unit dimension with real data.
--
-- Additive only. One new nullable column, no existing column touched.
--
-- #1563 named three legitimate Security Plan scope dimensions: control family
-- (`pillar`), `framework`, and `business_unit`. #1561 wired the first two — both real
-- columns on policy_decisions / msp_risk_decisions. #2085 found `business_unit` had no
-- backing column anywhere in the eight assembled source modules, so it was correctly
-- left unoffered rather than faked.
--
-- This column lives on `tenants` rather than on a per-row source table: business unit
-- is an attribute of the assessed organisation itself, not a per-finding
-- classification the way pillar/framework are. Nullable, freeform text — no enum,
-- since no real business-unit vocabulary exists in this codebase yet and inventing
-- one would be exactly the fabrication #2085 was filed to avoid. Set by MSP/platform
-- staff on the AdminV2 Customer canvas (`PATCH /admin/active-directory/customer/:id`).

BEGIN;

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS business_unit text;

COMMENT ON COLUMN tenants.business_unit IS
  'Freeform business-unit label (#2085), nullable. Backs the Security Plan assembly''s '
  'businessUnit scope dimension (SECURITY_PLAN_SCOPE_DIMENSIONS) the same way pillar/'
  'framework are backed. No enum — set directly by MSP/platform staff.';

SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name = 'tenants'
   AND column_name = 'business_unit';

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-01-tenants-business-unit-2085.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
