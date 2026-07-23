-- ─────────────────────────────────────────────────────────────────────────────
-- DIAGNOSTIC (read-only) — MSP tier checkout slug mismatch
-- 2026-07-23 · "Service not found — msp-platform-growth"
--
-- Run these and paste results back. Nothing here writes.
--
-- CONFIRMED BY CODE TRACE (no DB needed to prove):
--   /msp lists tiers from  GET /api/msp/signup/tiers
--        → filters on fulfillment_type / fulfillment_type_key = 'msp_monthly_subscription'
--        → NO visibility filter
--   /checkout/:slug resolves from  GET /api/services?type=msp
--        → filters on service_type = 'msp'   ← matches NOTHING; canonical value is
--                                              'platform_subscription_tier'
--        → AND visibility = 'public'
--   So mspTiers was always [] and every MSP slug 404'd at checkout.
--
-- These queries confirm the DB side and catch the SECOND latent divergence
-- (visibility), which the code fix alone cannot repair if the data is wrong.
-- ─────────────────────────────────────────────────────────────────────────────

-- Q1. The real MSP platform tier rows: what are their actual service_type,
--     fulfillment_type, fulfillment_type_key, visibility and slugs?
--     EXPECT service_type = 'platform_subscription_tier' and visibility = 'public'
--     on every row that should be purchasable.
SELECT id,
       slug,
       name,
       service_type,
       fulfillment_type,
       fulfillment_type_key,
       visibility,
       is_active,
       price,          -- legacy decimal
       base_price,     -- legacy decimal
       price_cents,    -- canonical
       is_free_offering,
       sort_order
FROM services
WHERE fulfillment_type      = 'msp_monthly_subscription'
   OR fulfillment_type_key  = 'msp_monthly_subscription'
   OR service_type          = 'platform_subscription_tier'
ORDER BY sort_order, id;

-- Q2. Does the failing slug exist AT ALL, under any service_type?
--     If this returns 0 rows, the slug the UI sent is stale/renamed in the DB.
--     If it returns a row, compare its service_type + visibility against Q1.
SELECT id, slug, name, service_type, fulfillment_type, fulfillment_type_key,
       visibility, is_active, price_cents
FROM services
WHERE slug = 'msp-platform-growth';

-- Q2b. Fuzzy: any near-miss slugs (renamed tier?)
SELECT id, slug, name, service_type, visibility, is_active
FROM services
WHERE slug ILIKE '%platform%' OR slug ILIKE '%growth%' OR slug ILIKE '%msp%'
ORDER BY service_type, slug;

-- Q3. Rows that would list on /msp but be INVISIBLE to /checkout.
--     After the code fix, ANY row returned here is still broken — it needs a
--     data fix (set visibility='public'), not a code fix.
SELECT id, slug, name, service_type, visibility, is_active,
       'lists on /msp but checkout cannot resolve it' AS problem
FROM services
WHERE (fulfillment_type = 'msp_monthly_subscription'
       OR fulfillment_type_key = 'msp_monthly_subscription')
  AND (visibility IS DISTINCT FROM 'public' OR service_type IS DISTINCT FROM 'platform_subscription_tier')
ORDER BY id;

-- Q4. msp_onboarding rows — getOnboardingPrice()'s pricing fields.
--     Confirms whether price is legacy-only, cents-only, or both.
SELECT id, slug, name, service_type, visibility,
       price, base_price, price_cents, is_free_offering
FROM services
WHERE service_type = 'msp_onboarding' OR slug ILIKE 'msp-onboarding%'
ORDER BY sort_order, id;

-- Q5. Platform-wide legacy-price-only sweep: rows priced ONLY in the legacy
--     decimal columns with price_cents NULL (the recurring bug class).
SELECT id, slug, name, service_type, visibility, price, base_price, price_cents
FROM services
WHERE price_cents IS NULL
  AND (price IS NOT NULL OR base_price IS NOT NULL)
ORDER BY service_type, slug;
