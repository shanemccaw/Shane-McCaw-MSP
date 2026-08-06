-- DIAGNOSTIC ONLY — read-only, nothing to apply. For Shane to run by hand to
-- confirm the exact live catalog-row state behind the "paid Monitoring package
-- checked out with no Stripe" bug, and to verify this task's code fix routes
-- that same row to Stripe.
--
-- ROOT CAUSE (code-confirmed, this task's commit): the public checkout's
-- free-vs-paid decision read ONLY the legacy decimal `price` / `base_price`
-- columns and ignored the canonical `price_cents`. The admin "create service"
-- API writes ONLY `price_cents` (leaving price/base_price NULL). So a paid
-- assessment created the modern way had price=NULL, base_price=NULL,
-- price_cents=<real> — and `isFree` computed to TRUE, routing the frontend to
-- POST /api/portal/checkout/free (no Stripe) and provisioning it for $0.
-- Only serviceType='assessment' rows carry `isFree` to the storefront, so the
-- purchased product was necessarily an assessment-typed row (Shane's "monitoring
-- package" = the tenant-scan assessment product).

-- 1. Every PUBLIC assessment offer, with the OLD isFree derivation vs the NEW
--    one side by side. Any row where old_isFree=TRUE but new_isFree=FALSE is a
--    paid item that WAS bypassing Stripe and is now correctly routed to payment.
SELECT
  id,
  slug,
  name,
  service_type,
  is_free_offering,
  price          AS legacy_price,
  base_price     AS legacy_base_price,
  price_cents,
  -- OLD (buggy) derivation: legacy columns only.
  (is_free_offering
     OR COALESCE(price, base_price) IS NULL
     OR COALESCE(price, base_price) = 0)                          AS old_isfree,
  -- NEW derivation (isServiceFree): explicit flag OR zero across ALL price fields
  -- including the canonical price_cents.
  (is_free_offering
     OR (COALESCE(NULLIF(price_cents, 0), 0) = 0
         AND COALESCE(price, base_price, 0) = 0))                 AS new_isfree
FROM services
WHERE service_type = 'assessment'
  AND is_public = TRUE
ORDER BY sort_order ASC;
-- The offending row(s): old_isfree = TRUE AND new_isfree = FALSE.
-- Expect the assessment package Shane purchased to appear here with
-- price_cents > 0, price IS NULL, base_price IS NULL, is_free_offering = FALSE.

-- 2. Broader sweep — ANY purchasable service (any type) that is priced ONLY via
--    price_cents with the legacy columns NULL. These are the rows exposed to the
--    same class of legacy-only price bug anywhere the legacy columns are read.
SELECT id, slug, name, service_type, visibility, is_public,
       price, base_price, price_cents, is_free_offering
FROM services
WHERE price_cents IS NOT NULL
  AND price_cents > 0
  AND price IS NULL
  AND base_price IS NULL
ORDER BY service_type, sort_order;

-- 3. Confirm the free onboarding actually ran for this purchase (the symptom:
--    real account + $0 invoice). Look for the deterministic FREE-ONB invoice
--    number the free path writes. Replace the email if you know the buyer's.
SELECT i.id, i.invoice_number, i.amount, i.status, i.paid_at, i.client_user_id, u.email
FROM invoices i
JOIN users u ON u.id = i.client_user_id
WHERE i.invoice_number LIKE 'FREE-ONB-%'
ORDER BY i.created_at DESC
LIMIT 25;

-- REMEDIATION (NOT run here — Shane's call):
--   * If the purchased row is the one in query 1 (price_cents set, legacy NULL,
--     is_free_offering FALSE): NO data change is required — this task's code fix
--     already routes it to Stripe. Re-attempt the purchase to confirm payment.
--   * If instead is_free_offering = TRUE was set on a paid product by mistake,
--     that is an explicit "this is free" flag and is honored by design — flip it
--     to FALSE to make the product paid.
