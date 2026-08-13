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
--
-- ── 2026-07-23 CORRECTION ────────────────────────────────────────────────────
-- Every query below originally selected `is_active`. There is NO `is_active`
-- column on `services` — confirmed against the real Drizzle schema
-- (lib/db/src/schema/index.ts:170-206). The active/visible flags on this table
-- are:
--     is_public   boolean NOT NULL DEFAULT true
--     visibility  text NOT NULL DEFAULT 'public'  ('public'|'private'|'landing_page_only')
-- Postgres aborts the whole statement on an unknown column, so every query
-- here failed with `ERROR: column "is_active" does not exist` and this
-- diagnostic returned nothing at all — which is why the MSP tier
-- investigation stayed blocked. Replaced with is_public + visibility.
--
-- (`isActive` IS accepted by the catalog IMPORT endpoint, but only as an alias
--  for is_public — admin-services.ts:789 `${item.isPublic ?? item.isActive ?? false}`.
--  It is an import-payload key, never a column. Do not re-add it here.)
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
       is_public,
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
--
--     DECISIVE, post-42871d44: checkout now sources MSP tiers from
--     /api/msp/signup/tiers, whose ONLY filter is
--         fulfillment_type = 'msp_monthly_subscription'
--      OR fulfillment_type_key = 'msp_monthly_subscription'
--     — no visibility filter, no price filter, no price_cents dependence
--     (msp-signup.ts:66-69). So for this row:
--       · either fulfillment column = 'msp_monthly_subscription'
--            → the slug RESOLVES; any remaining "Service not found" is a stale
--              deployed build of artifacts/shane-mccaw-consulting, not data.
--       · NEITHER column = 'msp_monthly_subscription'
--            → THIS is the remaining cause. Fix the data:
--              UPDATE services SET fulfillment_type_key = 'msp_monthly_subscription'
--              WHERE id = 121;   -- (the canonical key for platform_subscription_tier,
--                                --  per PRODUCT_TYPE_DEFAULT_FULFILLMENT_KEYS)
--     price_cents being NULL is NOT a cause here — confirmed by code trace, see
--     2026-07-23-price-cents-backfill.sql.
SELECT id, slug, name, service_type, fulfillment_type, fulfillment_type_key,
       visibility, is_public, price, base_price, price_cents
FROM services
WHERE slug = 'msp-platform-growth';

-- Q2b. Fuzzy: any near-miss slugs (renamed tier?)
SELECT id, slug, name, service_type, visibility, is_public
FROM services
WHERE slug ILIKE '%platform%' OR slug ILIKE '%growth%' OR slug ILIKE '%msp%'
ORDER BY service_type, slug;

-- Q3. Rows that would list on /msp but be INVISIBLE to /checkout.
--     After the code fix, ANY row returned here is still broken — it needs a
--     data fix (set visibility='public'), not a code fix.
SELECT id, slug, name, service_type, visibility, is_public,
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
