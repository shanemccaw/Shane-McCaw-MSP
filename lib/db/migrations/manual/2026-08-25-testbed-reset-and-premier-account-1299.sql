-- 2026-08-25-testbed-reset-and-premier-account-1299.sql
--
-- Two things, run together:
--   1. Reset all scan-derived data for the real testbed tenant
--      (mccawsoft2.onmicrosoft.com, tenant_id c4c814d4-3afe-441e-9145-
--      62461d0a4fd3) back to empty, so the next real scan is the ONLY
--      data on the account -- no more real/fixture/test-run pollution
--      mixed together. The tenants row itself (identity + consent) is
--      left untouched -- no reconsent needed.
--   2. Create a real CustomerUser login for testing: a NEW user row
--      scoped to that SAME tenant (the schema's tenants.tenant_id is
--      UNIQUE -- a second tenants row for the same real M365 tenant is
--      not possible; this is a second LOGIN against the existing
--      tenant instead, which is what actually gets the "log in as a
--      customer" test Shane wants).
--
-- Per Shane: also wipe msp_risk_decisions -- the seeded RBD-2026-10x rows
-- from 2026-08-21-portal-v2-risk-register-testbed-seed.sql go too, along
-- with everything else scan-derived.
--
-- Password for the new account is a real bcrypt hash (cost 12, same as
-- seed-portal.ts's demoPassword pattern) of a password shared with
-- Shane directly in chat, not committed here in plaintext.

BEGIN;

-- ── Step 1: locate the real tenant row (never hardcode the id) ─────────────
DO $$
DECLARE
  v_tenant_id INT;
  v_msp_id INT;
BEGIN
  SELECT id, msp_id INTO v_tenant_id, v_msp_id
  FROM tenants
  WHERE tenant_id = 'c4c814d4-3afe-441e-9145-62461d0a4fd3';

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Testbed tenant (mccawsoft2.onmicrosoft.com) not found -- aborting, nothing changed.';
  END IF;

  -- ── Step 2: clear scan-derived data for this tenant only ──────────────────
  -- Two different FK shapes in play, verified against the real schema before
  -- writing this — do not "simplify" these to all use the same column:
  --   msp_diagnostic_findings / msp_diagnostic_runs -> customer_id (integer,
  --     tenants.id)
  --   tenant_check_item_details / tenant_monitor_profiles / drift_events /
  --     overshared_items -> tenant_id (text, the real M365 tenant GUID)
  DELETE FROM msp_diagnostic_findings WHERE customer_id = v_tenant_id;
  DELETE FROM msp_diagnostic_runs WHERE customer_id = v_tenant_id;
  DELETE FROM tenant_check_item_details WHERE tenant_id = 'c4c814d4-3afe-441e-9145-62461d0a4fd3';
  DELETE FROM tenant_monitor_profiles WHERE tenant_id = 'c4c814d4-3afe-441e-9145-62461d0a4fd3';
  DELETE FROM drift_events WHERE tenant_id = 'c4c814d4-3afe-441e-9145-62461d0a4fd3';
  -- msp_risk_decisions cleared below too, per Shane -- same tenant_id (text) shape
  DELETE FROM overshared_items WHERE tenant_id = 'c4c814d4-3afe-441e-9145-62461d0a4fd3';
  DELETE FROM msp_risk_decisions WHERE tenant_id = 'c4c814d4-3afe-441e-9145-62461d0a4fd3';

  RAISE NOTICE 'Cleared scan-derived data for tenant id=%, msp_id=%', v_tenant_id, v_msp_id;
END $$;

-- ── Step 3: create the new test login, scoped to the same real tenant ──────
INSERT INTO users (
  email,
  password_hash,
  role,
  name,
  company,
  msp_role,
  msp_id,
  tenant_id,
  is_active
)
SELECT
  'shanemccaw+premier@outlook.com',
  '$2b$12$mNdowSmO.HhbUMoNK.NKUegPMOs9Xv.u.tk7HqcedTsYiieXAaU/2',
  'client',
  'Shane McCaw (Premier test)',
  t.customer_name,
  'CustomerUser',
  t.msp_id,
  t.id,
  true
FROM tenants t
WHERE t.tenant_id = 'c4c814d4-3afe-441e-9145-62461d0a4fd3'
ON CONFLICT (email) DO NOTHING;

COMMIT;
