-- Shane's Life -- Open Food Facts integration for barcode scan (Git #3260).
--
-- Extends #3109's real barcode scan (src/core/scan.mjs) with real product images and real
-- per-100g nutrition facts, pulled from Open Food Facts (world.openfoodfacts.org) -- free, open,
-- keyless. Requested specifically for Shane's real heart-healthy dietary needs (issue body,
-- contract pack Section 3).
--
-- This cache is keyed on the barcode alone, NOT user_id -- unlike barcode_links (020) and
-- item_prices (021), an OFF product's name/image/nutrition facts are a fact about the product,
-- not about who scanned it. One real row per barcode serves every user, and a barcode already
-- looked up by anyone never needs a second real network round-trip.
--
-- "Real, confirmed gotcha" (issue body): OFF returns real HTTP 200 even for an invalid/unknown
-- barcode -- failure is `status: 0` in the response BODY, not the HTTP status. `found` here
-- records that real outcome explicitly, so a barcode OFF has genuinely never heard of is cached
-- as a real miss (honest, no re-fetch storm) rather than indistinguishable from "not yet looked
-- up".
--
-- Nutrition columns are deliberately narrow: sodium, saturated fat, sugars, fiber -- "the metrics
-- that actually matter for heart-healthy eating, not every field OFF returns" (issue body), not a
-- calorie-tracker's full macro/micronutrient table (explicit non-goal).
CREATE TABLE IF NOT EXISTS off_products (
    barcode              text PRIMARY KEY,
    found                boolean NOT NULL,
    product_name         text,
    brand                text,
    image_url            text,
    sodium_100g          numeric,          -- grams per 100g (OFF's own `sodium_100g` unit)
    saturated_fat_100g   numeric,          -- grams per 100g
    sugars_100g          numeric,          -- grams per 100g
    fiber_100g           numeric,          -- grams per 100g
    fetched_at           timestamptz NOT NULL DEFAULT now(),
    created_at           timestamptz NOT NULL DEFAULT now()
);
