-- ═══════════════════════════════════════════════════════════════════════════════
-- REPAIR: "Seven Hundred" (users.id = 21) — real paid monitoring purchase that
-- completed with NO msp_customers / msp_users bridge.
--
-- FOR SHANE TO REVIEW AND RUN MANUALLY. Nothing here is applied automatically.
--
-- Background: the consent-time provisioning (provisionProspectAccount) and the
-- Stripe webhook's ensure* calls both failed silently for this account, leaving
-- a users row with no customer record — so every portal chart shows "no data".
-- "Jane Smith" (users.id = 9) hit the identical pattern and is ABANDONED per
-- your decision — this script deliberately does NOT touch user 9.
--
-- HOW TO USE:
--   1. Run SECTION 0 (read-only diagnostics) first. It confirms the broken
--      state AND tells us which leg actually failed (see the interpretation
--      notes on each query — please report these results back).
--   2. If diagnostics confirm (no msp_users row / no linked msp_customers row
--      for user 21), run SECTION 1 inside the transaction as written.
--   3. SECTION 2 (optional, recommended): after deploying the code fix, replay
--      the Stripe checkout session via the admin endpoint to create any missing
--      invoice/project/client_services — it is idempotent.
-- ═══════════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────────
-- SECTION 0 — DIAGNOSTICS (read-only; run each, note the results)
-- ───────────────────────────────────────────────────────────────────────────────

-- 0.1  The account itself. Expect: role='client', password set or not.
SELECT id, email, name, company, role, created_at
FROM users
WHERE id = 21;

-- 0.2  Confirm the missing bridge. Expect: BOTH return zero rows.
SELECT * FROM msp_users WHERE user_id = 21;
SELECT mc.*
FROM msp_customers mc
JOIN users u ON u.id = 21
WHERE mc.tenant_id IN (SELECT tenant_id FROM tenant_consent WHERE lower(admin_email) = lower(u.email))
   OR mc.name IN (u.name, u.company);

-- 0.3  WHICH LEG FAILED?  The checkout session tells us:
--        status = 'pending'   → the consent callback never received the session
--                               UUID as OAuth state (state-less consent URL) —
--                               consent-time provisioning never even looked at it.
--        status = 'consented' → consent DID link the session; provisioning ran
--                               and its ensure* calls threw (check api logs for
--                               "provisionProspectAccount: ensure customer/msp_user"
--                               and "onboarding_purchase: ensureClientMspUser failed").
--        status = 'paid'      → webhook guest branch ran too; ensure* threw twice.
--        tenant_id NULL       → consent callback never stamped this session.
SELECT id, product_slug, full_name, email, seats, status, tenant_id, created_at, updated_at, expires_at
FROM checkout_sessions
WHERE lower(email) = (SELECT lower(email) FROM users WHERE id = 21)
ORDER BY created_at DESC;

-- 0.4  The consent record. client_user_id / customer_id NULL here is part of the
--      same breakage. Note the tenant_id — SECTION 1 uses it.
SELECT tenant_id, customer_id, client_user_id, consent_status, consented_at, admin_email
FROM tenant_consent
WHERE lower(admin_email) = (SELECT lower(email) FROM users WHERE id = 21)
   OR client_user_id = 21;

-- 0.5  Did the webhook's project/invoice provisioning run at all?
--      All three empty → provisionOnboardingProject never completed (webhook
--      failed early or never verified) → also run SECTION 2 (replay) after the
--      code fix is deployed.
SELECT id, invoice_number, description, amount, status, stripe_session_id, created_at
FROM invoices WHERE client_user_id = 21;
SELECT id, title, status, created_at FROM projects WHERE client_user_id = 21;
SELECT id, service_id, status, stripe_subscription_id, purchased_at
FROM client_services WHERE client_user_id = 21;

-- 0.6  The direct-business MSP the repair attaches to. Expect exactly one row.
SELECT id, name, is_direct_business FROM msps WHERE is_direct_business = true;

-- 0.7  Any diagnostic runs orphaned at consent time (customer_id NULL) for her tenant.
SELECT run_id, tenant_id, customer_id, status, run_status, checks_total, created_at
FROM msp_diagnostic_runs
WHERE tenant_id IN (
  SELECT tenant_id FROM tenant_consent
  WHERE lower(admin_email) = (SELECT lower(email) FROM users WHERE id = 21) OR client_user_id = 21
)
ORDER BY created_at DESC;


-- ───────────────────────────────────────────────────────────────────────────────
-- SECTION 1 — REPAIR (run only after SECTION 0 confirms the broken state)
--
-- Mirrors exactly what provisionProspectAccount / ensureDirectCustomerRecord /
-- ensureClientMspUser / promoteMspUserToCustomer would have done for a paid
-- direct-business buyer: an ACTIVE msp_customers row under the isDirectBusiness
-- MSP stamped with the consented tenant, an msp_users row at CustomerUser, and
-- the tenant_consent / diagnostic-run backfills the webhook normally performs.
-- Idempotent — safe to re-run.
-- ───────────────────────────────────────────────────────────────────────────────

BEGIN;

-- 1.1  Create the msp_customers row (skipped if user 21 is somehow already
--      linked, or a customer already exists for her tenant).
WITH direct_msp AS (
  SELECT id FROM msps WHERE is_direct_business = true LIMIT 1
),
buyer AS (
  SELECT id, email, name, company FROM users WHERE id = 21
),
consented_tenant AS (
  -- Prefer tenant_consent (stamped at the real consent grant); fall back to the
  -- checkout session's tenant_id if that's where it landed.
  SELECT tenant_id FROM (
    SELECT tc.tenant_id, 1 AS pri
    FROM tenant_consent tc, buyer b
    WHERE (lower(tc.admin_email) = lower(b.email) OR tc.client_user_id = b.id)
      AND tc.consent_status = 'granted'
    UNION ALL
    SELECT cs.tenant_id, 2 AS pri
    FROM checkout_sessions cs, buyer b
    WHERE lower(cs.email) = lower(b.email) AND cs.tenant_id IS NOT NULL
  ) t
  WHERE tenant_id IS NOT NULL
  ORDER BY pri
  LIMIT 1
)
INSERT INTO msp_customers (msp_id, name, tenant_id, status, owner_type)
SELECT
  dm.id,
  COALESCE(NULLIF(trim(b.company), ''), NULLIF(trim(b.name), ''), 'Direct Customer'),
  (SELECT tenant_id FROM consented_tenant),
  'active',
  'customer'
FROM direct_msp dm, buyer b
WHERE NOT EXISTS (SELECT 1 FROM msp_users mu WHERE mu.user_id = 21 AND mu.customer_id IS NOT NULL)
  AND NOT EXISTS (
    SELECT 1 FROM msp_customers mc
    WHERE mc.tenant_id IS NOT NULL
      AND mc.tenant_id = (SELECT tenant_id FROM consented_tenant)
  );

-- 1.2  Resolve the customer id we will link (created above, or the pre-existing
--      row for her tenant) and create/patch the msp_users row.
WITH buyer AS (
  SELECT id, email FROM users WHERE id = 21
),
consented_tenant AS (
  SELECT tenant_id FROM (
    SELECT tc.tenant_id, 1 AS pri
    FROM tenant_consent tc, buyer b
    WHERE (lower(tc.admin_email) = lower(b.email) OR tc.client_user_id = b.id)
      AND tc.consent_status = 'granted'
    UNION ALL
    SELECT cs.tenant_id, 2 AS pri
    FROM checkout_sessions cs, buyer b
    WHERE lower(cs.email) = lower(b.email) AND cs.tenant_id IS NOT NULL
  ) t
  WHERE tenant_id IS NOT NULL
  ORDER BY pri
  LIMIT 1
),
target_customer AS (
  SELECT mc.id, mc.msp_id
  FROM msp_customers mc
  WHERE mc.tenant_id = (SELECT tenant_id FROM consented_tenant)
     OR (
       -- Tenant-less fallback: the row 1.1 just created for this repair
       (SELECT tenant_id FROM consented_tenant) IS NULL
       AND mc.msp_id = (SELECT id FROM msps WHERE is_direct_business = true LIMIT 1)
       AND mc.name = (SELECT COALESCE(NULLIF(trim(company), ''), NULLIF(trim(name), ''), 'Direct Customer') FROM users WHERE id = 21)
     )
  ORDER BY mc.id DESC
  LIMIT 1
)
INSERT INTO msp_users (user_id, msp_id, customer_id, msp_role, is_active)
SELECT 21, tc.msp_id, tc.id, 'CustomerUser', true
FROM target_customer tc
ON CONFLICT (user_id) DO UPDATE
  SET customer_id = COALESCE(msp_users.customer_id, EXCLUDED.customer_id),
      msp_id      = COALESCE(msp_users.msp_id,      EXCLUDED.msp_id),
      updated_at  = now();

-- 1.3  Promote (mirrors promoteMspUserToCustomer): only lifts Assessment/Free.
UPDATE msp_users
SET msp_role = 'CustomerUser', updated_at = now()
WHERE user_id = 21 AND msp_role IN ('Assessment', 'Free');

-- 1.4  Backfill tenant_consent linkage (what the consent callback/webhook
--      normally stamps).
UPDATE tenant_consent tc
SET client_user_id = 21,
    customer_id = mu.customer_id,
    updated_at = now()
FROM msp_users mu
WHERE mu.user_id = 21
  AND mu.customer_id IS NOT NULL
  AND tc.tenant_id = (SELECT tenant_id FROM msp_customers WHERE id = mu.customer_id)
  AND (tc.client_user_id IS NULL OR tc.customer_id IS NULL);

-- 1.5  Backfill orphaned diagnostic runs for her tenant (the consent-time scan
--      ran with customer_id NULL because no customer existed yet).
UPDATE msp_diagnostic_runs dr
SET customer_id = mc.id, updated_at = now()
FROM msp_users mu
JOIN msp_customers mc ON mc.id = mu.customer_id
WHERE mu.user_id = 21
  AND dr.customer_id IS NULL
  AND dr.tenant_id = mc.tenant_id;

-- 1.6  Verify before committing. EXPECT: one msp_users row with a non-NULL
--      customer_id, msp_role='CustomerUser', and an ACTIVE msp_customers row
--      (tenant_id set if consent linkage was recoverable).
SELECT mu.user_id, mu.msp_id, mu.customer_id, mu.msp_role, mu.is_active,
       mc.name AS customer_name, mc.tenant_id, mc.status AS customer_status
FROM msp_users mu
LEFT JOIN msp_customers mc ON mc.id = mu.customer_id
WHERE mu.user_id = 21;

-- If the verify row looks right:
COMMIT;
-- If anything looks wrong: ROLLBACK;


-- ───────────────────────────────────────────────────────────────────────────────
-- SECTION 2 — OPTIONAL (recommended if 0.5 showed no invoice/project/services)
--
-- After deploying the code fix, replay the Stripe Checkout Session so the
-- invoice / project / client_services / subscription linkage is created by the
-- real (now-hardened) webhook logic. Idempotent — returns "already_processed"
-- if the invoice exists.
--
--   1. Find the session id (cs_live_…) in the Stripe Dashboard → Payments →
--      the Seven Hundred charge → "Checkout session".
--   2. As an admin, call:
--        POST /api/admin/stripe/replay-session
--        { "sessionId": "cs_live_…" }
--
-- Run this AFTER Section 1 so the bridge already exists and the replay's
-- ensure* calls no-op cleanly.
-- ───────────────────────────────────────────────────────────────────────────────
