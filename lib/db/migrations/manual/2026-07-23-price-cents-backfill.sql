-- ─────────────────────────────────────────────────────────────────────────────
-- MANUAL MIGRATION — backfill services.price_cents from the legacy decimal
-- price columns.
-- 2026-07-23 · platform-wide (reported: 113 rows across every service_type)
--
-- DO NOT run this file blind. Run SECTION 0 first, read the output, then run
-- SECTION 1 (and only SECTION 1) inside the transaction it opens. SECTION 3 is
-- deliberately left commented out — it covers the ambiguous rows and needs a
-- human decision per row.
--
-- ── WHY THESE ROWS EXIST (both producers are real, both fixed in code) ───────
--
--   1. POST /api/admin/catalog/import (admin-services.ts) did not list
--      price_cents in its INSERT at all, and no product type's import
--      allow-list even accepts a `priceCents` key
--      (PRODUCT_TYPE_IMPORT_FIELDS, productTypeConfig.ts) — types carry `price`
--      and/or `basePrice` in dollars. Every imported product landed with its
--      real price in a legacy decimal column and price_cents NULL.
--
--   2. PUT /api/admin/services/:id set price_cents unconditionally from the
--      request body, and the admin catalog editor's form schema
--      (ServiceEditorShell.tsx `serviceSchema`) does not contain it — nor does
--      the duplicate-service payload (CatalogProductList.tsx handleDuplicate).
--      Every save through the catalog editor NULLed price_cents (and
--      internal_cost_cents, and annual_price_cents).
--
--   Both are fixed in the same commit as this file, so the population stops
--   growing. This migration repairs the rows already in that state.
--
-- ── WHAT THIS IS *NOT* ──────────────────────────────────────────────────────
--
--   NULL price_cents does NOT cause the reported
--   "Service not found — msp-platform-growth" checkout error. Confirmed by code
--   trace, not assumption: that string is the marketing Checkout page's
--   `not-found` step (Checkout.tsx:296-301), reached only when the slug is
--   absent from the merged catalog arrays. The endpoint that supplies MSP tiers
--   (/api/msp/signup/tiers, msp-signup.ts:66-69) filters ONLY on
--   fulfillment_type / fulfillment_type_key — no price filter, no visibility
--   filter, no price_cents dependence. See
--   2026-07-23-msp-tier-slug-checkout-DIAGNOSTIC.sql Q2 for the decisive query.
--
--   The canonical resolvers were also never the blocker: both
--   resolveServicePriceCents and resolveEffectiveChargeCents
--   (artifacts/api-server/src/lib/catalog-pricing.ts) already read the legacy
--   `price` / `basePrice` columns, so the paid checkout path charges the right
--   amount for these rows today.
--
--   The real, confirmed damage from NULL price_cents is elsewhere, and the
--   backfill fixes all of it:
--     · the in-portal marketplace showed these products as "priced on
--       consultation", and POST /msp/customers/:id/marketplace/checkout 422'd
--       them as unpurchasable (msp-marketplace-purchase.ts:172). The base_price
--       half of that is also fixed in code in this commit; the price_cents half
--       is fixed by this backfill.
--     · MSP revenue / MRR aggregation counts these services as $0
--       (msp-financial-aggregator.ts uses `priceCents ?? 0`).
--     · the public AI chat front door quotes "pricing varies" for them
--       (public-chat.ts:102).
--     · public-personalization, the admin catalog's wholesale/retail columns and
--       /api/services' retailPriceCents all read $0.
--
-- ── SAFETY PROPERTIES ───────────────────────────────────────────────────────
--
--   · Only ever writes rows where price_cents IS NULL. Never overwrites an
--     existing canonical price.
--   · Uses the platform's own canonical precedence, `price ?? base_price`
--     (resolveServicePriceCents) — so a backfilled value can never disagree
--     with what checkout already charges for that row today.
--   · SECTION 1 only touches rows where exactly ONE of the two legacy columns
--     is populated, so there is no judgment call to get wrong. Rows with BOTH
--     populated are excluded and reported (SECTION 3).
--   · Per-seat rows (type_attributes->>'pricePerUserMonth') are excluded and
--     reported. A flat price on a per-seat row is stale/accidental data — this
--     is the failure mode that once charged a 2000-seat tier $11/mo. Do not
--     stamp a flat price_cents onto one.
--   · price_cents is `integer`, price/base_price are `numeric(10,2)`. A dollar
--     value above $21,474,836.47 would overflow int4, so such rows are excluded
--     and reported rather than aborting the run mid-way.
--   · Because the columns are `numeric`, no malformed/unusual string formatting
--     is possible — Postgres already rejected anything non-numeric at write
--     time. price * 100 is exact (no float rounding); ROUND() is belt-and-braces
--     for the scale-2 guarantee.
-- ─────────────────────────────────────────────────────────────────────────────


-- ═════════════════════════════════════════════════════════════════════════════
-- SECTION 0 — PRE-FLIGHT (read-only). Run this first and read the output.
-- ═════════════════════════════════════════════════════════════════════════════

-- 0a. The affected population, grouped by service_type. This is the "113 rows"
--     number, broken down. `only_price` + `only_base_price` is what SECTION 1
--     will write; the other three columns are what it will deliberately skip.
SELECT
  COALESCE(service_type, '(null)')                      AS service_type,
  COUNT(*)                                              AS total_null_price_cents,
  COUNT(*) FILTER (WHERE price IS NOT NULL
                     AND base_price IS NULL)            AS only_price,
  COUNT(*) FILTER (WHERE base_price IS NOT NULL
                     AND price IS NULL)                 AS only_base_price,
  COUNT(*) FILTER (WHERE price IS NOT NULL
                     AND base_price IS NOT NULL)        AS both_populated_ambiguous,
  COUNT(*) FILTER (WHERE COALESCE(type_attributes->>'pricePerUserMonth','') <> '')
                                                        AS per_seat_skipped,
  COUNT(*) FILTER (WHERE GREATEST(COALESCE(price,0), COALESCE(base_price,0)) > 21474836.47)
                                                        AS overflow_skipped
FROM services
WHERE price_cents IS NULL
  AND (price IS NOT NULL OR base_price IS NOT NULL)
GROUP BY 1
ORDER BY 1;

-- 0b. Full row-level listing of everything SECTION 1 will write, with the
--     before/after values. Eyeball this — it is the actual diff.
SELECT
  service_type,
  id,
  slug,
  name,
  visibility,
  is_public,
  price,
  base_price,
  ROUND(COALESCE(price, base_price) * 100)::int AS price_cents_to_write,
  CASE WHEN price IS NOT NULL THEN 'price' ELSE 'base_price' END AS source_column
FROM services
WHERE price_cents IS NULL
  AND (price IS NULL) <> (base_price IS NULL)                       -- exactly one populated
  AND COALESCE(type_attributes->>'pricePerUserMonth', '') = ''      -- not per-seat priced
  AND COALESCE(price, base_price) <= 21474836.47                    -- fits in int4 cents
ORDER BY service_type, id;

-- 0c. AMBIGUOUS — both legacy columns populated. NOT written by SECTION 1.
--     `price` and `base_price` are not always in conflict: for `project` and
--     `document_product` the catalog templates deliberately carry both as a
--     range (basePrice = floor, maxPrice = ceiling, price = the sell price), so
--     a row where they differ is usually range pricing rather than a data
--     conflict. Either way it is a judgment call, so nothing here is guessed —
--     see SECTION 3.
SELECT
  service_type,
  id,
  slug,
  name,
  price,
  base_price,
  max_price,
  CASE WHEN price = base_price THEN 'identical — safe, either column'
       ELSE 'DIFFERENT — needs a decision' END AS assessment
FROM services
WHERE price_cents IS NULL
  AND price IS NOT NULL
  AND base_price IS NOT NULL
ORDER BY (price = base_price), service_type, id;

-- 0d. SKIPPED — per-seat priced rows carrying a stale flat price. These must be
--     resolved by hand (almost certainly by CLEARING the stale flat column, not
--     by stamping price_cents). Expected to return zero rows.
SELECT id, slug, name, service_type, price, base_price,
       type_attributes->>'pricePerUserMonth' AS price_per_user_month,
       type_attributes->>'seatMin'           AS seat_min,
       type_attributes->>'seatMax'           AS seat_max
FROM services
WHERE price_cents IS NULL
  AND (price IS NOT NULL OR base_price IS NOT NULL)
  AND COALESCE(type_attributes->>'pricePerUserMonth', '') <> ''
ORDER BY id;

-- 0e. SKIPPED — would overflow integer cents. Expected to return zero rows.
SELECT id, slug, name, service_type, price, base_price
FROM services
WHERE price_cents IS NULL
  AND GREATEST(COALESCE(price, 0), COALESCE(base_price, 0)) > 21474836.47
ORDER BY id;


-- ═════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — THE BACKFILL. One statement per service_type, for reviewability.
--
-- Every statement shares the same WHERE guard set (price_cents IS NULL, exactly
-- one legacy column populated, not per-seat, fits in int4) and the same
-- canonical `COALESCE(price, base_price)` precedence. The per-type split exists
-- so the row counts can be checked against SECTION 0a one type at a time, and
-- so a single type can be skipped without skipping the rest.
--
-- Run the whole section inside the transaction below, compare each reported row
-- count against 0a's (only_price + only_base_price) for that type, then COMMIT.
-- ═════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── assessment ───────────────────────────────────────────────────────────────
-- Authoritative column: base_price. `price` is not in this type's import
-- allow-list at all (PRODUCT_TYPE_IMPORT_FIELDS.assessment = basePrice +
-- maxPrice), so a real assessment's price lives in base_price.
UPDATE services SET price_cents = ROUND(COALESCE(price, base_price) * 100)::int,
                    updated_at  = now()
WHERE service_type = 'assessment'
  AND price_cents IS NULL
  AND (price IS NULL) <> (base_price IS NULL)
  AND COALESCE(type_attributes->>'pricePerUserMonth', '') = ''
  AND COALESCE(price, base_price) <= 21474836.47;

-- ── config_pack ──────────────────────────────────────────────────────────────
-- Free-text service_type (no per-type import allow-list) — canonical
-- price ?? base_price precedence applies.
UPDATE services SET price_cents = ROUND(COALESCE(price, base_price) * 100)::int,
                    updated_at  = now()
WHERE service_type = 'config_pack'
  AND price_cents IS NULL
  AND (price IS NULL) <> (base_price IS NULL)
  AND COALESCE(type_attributes->>'pricePerUserMonth', '') = ''
  AND COALESCE(price, base_price) <= 21474836.47;

-- ── document_product ─────────────────────────────────────────────────────────
-- Authoritative column: price (template carries price = sell price, base_price /
-- max_price = the display range). Rows with both populated are excluded here and
-- handled in SECTION 3.
UPDATE services SET price_cents = ROUND(COALESCE(price, base_price) * 100)::int,
                    updated_at  = now()
WHERE service_type = 'document_product'
  AND price_cents IS NULL
  AND (price IS NULL) <> (base_price IS NULL)
  AND COALESCE(type_attributes->>'pricePerUserMonth', '') = ''
  AND COALESCE(price, base_price) <= 21474836.47;

-- ── micro_remediation ────────────────────────────────────────────────────────
-- Free-text service_type — canonical price ?? base_price precedence applies.
UPDATE services SET price_cents = ROUND(COALESCE(price, base_price) * 100)::int,
                    updated_at  = now()
WHERE service_type = 'micro_remediation'
  AND price_cents IS NULL
  AND (price IS NULL) <> (base_price IS NULL)
  AND COALESCE(type_attributes->>'pricePerUserMonth', '') = ''
  AND COALESCE(price, base_price) <= 21474836.47;

-- ── msp_onboarding ───────────────────────────────────────────────────────────
-- Free-text service_type. Read by the /msp page's getOnboardingPrice()
-- (Msp.tsx:343) — canonical price ?? base_price precedence applies.
UPDATE services SET price_cents = ROUND(COALESCE(price, base_price) * 100)::int,
                    updated_at  = now()
WHERE service_type = 'msp_onboarding'
  AND price_cents IS NULL
  AND (price IS NULL) <> (base_price IS NULL)
  AND COALESCE(type_attributes->>'pricePerUserMonth', '') = ''
  AND COALESCE(price, base_price) <= 21474836.47;

-- ── project ──────────────────────────────────────────────────────────────────
-- Authoritative column: price (template carries price = sell price, base_price /
-- max_price = the quoted range). Rows with both populated are excluded here and
-- handled in SECTION 3.
UPDATE services SET price_cents = ROUND(COALESCE(price, base_price) * 100)::int,
                    updated_at  = now()
WHERE service_type = 'project'
  AND price_cents IS NULL
  AND (price IS NULL) <> (base_price IS NULL)
  AND COALESCE(type_attributes->>'pricePerUserMonth', '') = ''
  AND COALESCE(price, base_price) <= 21474836.47;

-- ── retainer ─────────────────────────────────────────────────────────────────
-- Authoritative column: price (PRODUCT_TYPE_IMPORT_FIELDS.retainer carries
-- `price` and no base_price).
UPDATE services SET price_cents = ROUND(COALESCE(price, base_price) * 100)::int,
                    updated_at  = now()
WHERE service_type = 'retainer'
  AND price_cents IS NULL
  AND (price IS NULL) <> (base_price IS NULL)
  AND COALESCE(type_attributes->>'pricePerUserMonth', '') = ''
  AND COALESCE(price, base_price) <= 21474836.47;

-- ── platform_subscription_tier (MSP platform tiers, incl. msp-platform-growth) ─
-- Authoritative column: price (PRODUCT_TYPE_IMPORT_FIELDS.platform_subscription_tier
-- carries `price` and no base_price; seed-portal.ts seeds "0.00" / "499.00").
-- NOTE: this does not change what /api/msp/signup/tiers serves or what Stripe
-- charges — resolveEffectiveChargeCents already resolves these rows from `price`.
-- It repairs the marketplace/reporting/chat surfaces that read price_cents raw.
UPDATE services SET price_cents = ROUND(COALESCE(price, base_price) * 100)::int,
                    updated_at  = now()
WHERE service_type = 'platform_subscription_tier'
  AND price_cents IS NULL
  AND (price IS NULL) <> (base_price IS NULL)
  AND COALESCE(type_attributes->>'pricePerUserMonth', '') = ''
  AND COALESCE(price, base_price) <= 21474836.47;

-- ── catch-all: any service_type not named above ───────────────────────────────
-- The reported population spans 8 types, but the catalog's service_type column
-- is free text and 0a may surface others (e.g. 'msp', 'micro_offer'). This
-- covers them under exactly the same guards. Review 0a's output first — if 0a
-- shows only the 8 types above, this writes 0 rows.
UPDATE services SET price_cents = ROUND(COALESCE(price, base_price) * 100)::int,
                    updated_at  = now()
WHERE COALESCE(service_type, '') NOT IN (
        'assessment', 'config_pack', 'document_product', 'micro_remediation',
        'msp_onboarding', 'project', 'retainer', 'platform_subscription_tier'
      )
  AND price_cents IS NULL
  AND (price IS NULL) <> (base_price IS NULL)
  AND COALESCE(type_attributes->>'pricePerUserMonth', '') = ''
  AND COALESCE(price, base_price) <= 21474836.47;

COMMIT;


-- ═════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — POST-FLIGHT VERIFICATION (read-only). Run after COMMIT.
-- ═════════════════════════════════════════════════════════════════════════════

-- 2a. What remains unbackfilled, and why. Every remaining row should be
--     explainable by one of the three deliberate exclusions.
SELECT
  COALESCE(service_type, '(null)') AS service_type,
  COUNT(*)                         AS still_null,
  COUNT(*) FILTER (WHERE price IS NOT NULL AND base_price IS NOT NULL) AS ambiguous_both,
  COUNT(*) FILTER (WHERE COALESCE(type_attributes->>'pricePerUserMonth','') <> '') AS per_seat,
  COUNT(*) FILTER (WHERE GREATEST(COALESCE(price,0), COALESCE(base_price,0)) > 21474836.47) AS overflow
FROM services
WHERE price_cents IS NULL
  AND (price IS NOT NULL OR base_price IS NOT NULL)
GROUP BY 1
ORDER BY 1;

-- 2b. Consistency check — the backfilled cents must equal the legacy dollars.
--     MUST return zero rows. If it returns anything, something wrote a value
--     that disagrees with what checkout charges, and it needs investigating
--     before the platform is trusted to bill from price_cents.
SELECT id, slug, service_type, price, base_price, price_cents,
       ROUND(COALESCE(price, base_price) * 100)::int AS expected_price_cents
FROM services
WHERE price_cents IS NOT NULL
  AND (price IS NULL) <> (base_price IS NULL)
  AND COALESCE(type_attributes->>'pricePerUserMonth', '') = ''
  AND price_cents <> ROUND(COALESCE(price, base_price) * 100)::int
ORDER BY service_type, id;

-- 2c. Spot-check the named row and a sample across the other affected types.
SELECT id, slug, name, service_type, visibility, is_public,
       price, base_price, price_cents,
       fulfillment_type, fulfillment_type_key
FROM services
WHERE slug = 'msp-platform-growth'
   OR id IN (
        SELECT MIN(id) FROM services
        WHERE service_type IN ('assessment','config_pack','document_product',
                               'micro_remediation','msp_onboarding','project','retainer')
        GROUP BY service_type
      )
ORDER BY service_type, id;


-- ═════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — AMBIGUOUS ROWS. NOT RUN. Needs a per-row decision from Shane.
--
-- These are the rows SECTION 0c listed: price_cents NULL with BOTH price and
-- base_price populated. Nothing here is guessed on Shane's behalf.
--
-- For the record, the platform's own canonical resolver already treats `price`
-- as the winner when both are set (resolveServicePriceCents:
-- `const legacy = s.price ?? s.basePrice`), and that is what checkout charges
-- today — so applying "price wins" would keep price_cents consistent with the
-- amount actually billed. That is a statement about the code, not a decision:
-- if any row in 0c has base_price as its real intended price, this would stamp
-- the wrong number, so review 0c row by row first.
--
-- Rows where 0c reports 'identical — safe, either column' carry no ambiguity at
-- all and can be run without further thought — that is what 3a covers.
-- ═════════════════════════════════════════════════════════════════════════════

-- 3a. SAFE subset — both columns populated but IDENTICAL, so the choice is moot.
--     Uncomment and run once 0c confirms the rows.
-- UPDATE services SET price_cents = ROUND(price * 100)::int, updated_at = now()
-- WHERE price_cents IS NULL
--   AND price IS NOT NULL
--   AND base_price IS NOT NULL
--   AND price = base_price
--   AND COALESCE(type_attributes->>'pricePerUserMonth', '') = ''
--   AND price <= 21474836.47;

-- 3b. GENUINELY AMBIGUOUS subset — both populated and DIFFERENT.
--     Do NOT run as a blanket statement. Decide per row from 0c, then write the
--     explicit per-id updates, e.g.:
-- UPDATE services SET price_cents = ROUND(price * 100)::int,      updated_at = now() WHERE id = <id>;
-- UPDATE services SET price_cents = ROUND(base_price * 100)::int, updated_at = now() WHERE id = <id>;
