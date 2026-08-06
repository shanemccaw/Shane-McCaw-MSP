-- ═══════════════════════════════════════════════════════════════════════════════
-- DIAGNOSTIC — MSP Offerings Not Showing on the /msp Page (2026-07-22)
-- READ-ONLY. Run each block in the SQL console; nothing here writes.
--
-- Context: GET /api/msp/signup/tiers filtered WHERE fulfillment_type =
-- 'msp_monthly_subscription' and selected ONLY the legacy decimal `price`
-- column. The modern admin create/edit paths write ONLY `price_cents` (legacy
-- price/basePrice NULL), and the admin bulk-import path inserts
-- fulfillment_type defaulted to 'standard'. Either condition hides or
-- unprices the tier cards. Code is now fixed to resolve pricing canonically
-- and to also match on fulfillment_type_key; these queries confirm which
-- condition the live rows were actually in.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── Block 1: Every candidate MSP platform tier row, however it is tagged ──────
-- Expect the real tiers here. Columns to eyeball:
--   * fulfillment_type: 'msp_monthly_subscription' expected. If 'standard' on a
--     real tier row → that was the zero-rows / not-rendering cause (the old
--     filter missed it; the new key OR-arm now catches it if the key is set).
--   * price vs price_cents: modern-created rows have price NULL + price_cents
--     set → the old endpoint showed "Contact for pricing" and 400'd checkout.
SELECT id, slug, name, service_type, fulfillment_type, fulfillment_type_key,
       visibility, is_public, billing_type, sort_order,
       price, base_price, price_cents, annual_price_cents, is_free_offering,
       type_attributes ->> 'tenantAllowance' AS tenant_allowance
FROM services
WHERE fulfillment_type = 'msp_monthly_subscription'
   OR fulfillment_type_key = 'msp_monthly_subscription'
   OR service_type IN ('msp', 'platform_subscription_tier')
   OR slug LIKE 'msp-platform-%'
ORDER BY sort_order, id;

-- ── Block 2: Tier rows the OLD endpoint filter would have returned ────────────
-- If this returns 0 rows while Block 1 returns real tiers, the not-rendering
-- symptom was the filter (fulfillment_type stuck at 'standard').
-- If it returns rows but with price NULL, the symptom was pricing display /
-- checkout 400, not the filter.
SELECT id, slug, name, price, price_cents
FROM services
WHERE fulfillment_type = 'msp_monthly_subscription'
ORDER BY sort_order, id;

-- ── Block 3: msp_onboarding service rows (getOnboardingPrice on Msp.tsx) ──────
-- The page reads serviceType 'msp_onboarding' rows via /api/services and
-- previously parsed only legacy `price`. Confirm which pricing fields are
-- populated, and that visibility = 'public' (the /api/services route filters
-- on visibility = 'public' — a private row never reaches the page at all).
SELECT id, slug, name, service_type, visibility, is_public,
       price, base_price, price_cents, is_free_offering
FROM services
WHERE service_type = 'msp_onboarding'
   OR slug LIKE 'msp-onboarding-%'
ORDER BY id;

-- ── Block 4: any other rows carrying the legacy-only pricing shape ────────────
-- Platform-wide census of rows whose price lives ONLY in a legacy decimal
-- column (price/base_price set, price_cents NULL) or ONLY in price_cents.
-- Not corrective — just sizes how much of the catalog each read-path style
-- serves correctly.
SELECT
  count(*) FILTER (WHERE price_cents IS NOT NULL AND price IS NULL AND base_price IS NULL) AS modern_only_rows,
  count(*) FILTER (WHERE price_cents IS NULL AND (price IS NOT NULL OR base_price IS NOT NULL)) AS legacy_only_rows,
  count(*) FILTER (WHERE price_cents IS NOT NULL AND (price IS NOT NULL OR base_price IS NOT NULL)) AS both_rows,
  count(*) FILTER (WHERE price_cents IS NULL AND price IS NULL AND base_price IS NULL) AS unpriced_rows
FROM services;
