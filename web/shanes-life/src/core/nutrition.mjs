// Open Food Facts integration (Git #3260) -- real product images + real per-100g nutrition
// facts for a scanned barcode (#3109), requested specifically for Shane's real heart-healthy
// dietary needs (issue body, contract pack Section 3).
//
// "Real, confirmed gotcha, worth building around correctly from the start" (issue body): OFF
// returns real HTTP 200 even for an invalid/unknown barcode -- failure shows up as
// `status: 0` / `status_verbose: "no code or invalid code"` in the response BODY, not the HTTP
// status. Live-verified against the real endpoint before writing this: a known barcode
// (3017620422003, Nutella) returns `status: 1`; an unrecognised one returns `status: 0`. Checked
// explicitly below -- a naive integration checking only `res.ok` would silently treat a failed
// lookup as a successful empty result.
//
// Real, sensible caching (issue scope item 4), matching #3112's own per-store price-history
// pattern (prices.mjs): the same real barcode scanned again doesn't re-fetch from OFF every time.
// Unlike barcode_links/item_prices, this cache is keyed on the barcode ALONE, not per-user --
// see migrations/059_off_nutrition.sql's own header for why.
//
// Real, honest fallback (issue scope item 2): OFF having no data for a barcode is a real, common
// case (regional/store-brand products) -- every function here degrades to `found: false` /
// `null` fields rather than throwing, so the core scan flow (#3109) never breaks on this being
// unavailable. This is a real enrichment, not a dependency.

import { one } from "../db.mjs";

const OFF_TIMEOUT_MS = 6000;
// A product's real name/image/nutrition facts don't change day to day -- unlike a price, there's
// no freshness reason to re-fetch often. 30 days balances "don't hammer OFF for a static fact"
// against "a product's OFF entry does occasionally get corrected/filled in by its own editors".
const CACHE_STALE_DAYS = 30;

// UK Food Standards Agency nutrient-profiling "high" thresholds (per 100g) -- a real, established
// vocabulary for "genuinely high" (issue scope item 3: "flagging a genuinely high-sodium item"),
// not an invented cutoff. Salt high >= 1.5g/100g == sodium high >= 0.6g (600mg) /100g; sugars
// high >= 22.5g/100g; saturated fat high >= 5g/100g.
const HIGH_SODIUM_G_100G = 0.6;
const HIGH_SATURATED_FAT_G_100G = 5;
const HIGH_SUGARS_G_100G = 22.5;

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Real fetch against Open Food Facts. Returns the real fields this feature needs, or
 * `{ found: false }` for a genuine miss (unrecognised barcode) or a genuine failure (network
 * unreachable/timed out/malformed) -- both are honest "nothing to enrich with", never a fake
 * empty product.
 */
async function fetchFromOpenFoodFacts(barcode) {
  try {
    const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${barcode}.json`, {
      signal: AbortSignal.timeout(OFF_TIMEOUT_MS),
      headers: { "User-Agent": "ShanesLife/1.0 (personal use; shanes-life nutrition lookup)" },
    });
    if (!res.ok) return { found: false };
    const data = await res.json();
    // The real gotcha (issue body): check the BODY's `status`, not `res.ok` / HTTP status.
    if (data.status !== 1 || !data.product) return { found: false };
    const p = data.product;
    const n = p.nutriments || {};
    return {
      found: true,
      productName: p.product_name || p.generic_name ? String(p.product_name || p.generic_name).trim().slice(0, 200) : null,
      brand: p.brands ? String(p.brands).trim().slice(0, 200) : null,
      imageUrl: p.image_front_url || p.image_url || null,
      sodium100g: num(n["sodium_100g"]),
      saturatedFat100g: num(n["saturated-fat_100g"]),
      sugars100g: num(n["sugars_100g"]),
      fiber100g: num(n["fiber_100g"]),
    };
  } catch {
    // Network unreachable / timed out / malformed response -- real failure, not faked; the
    // caller's cache-miss-with-no-data degrade is the honest outcome, same as scan.mjs's own
    // lookupProductName precedent.
    return { found: false };
  }
}

async function upsertOffProduct(barcode, fetched) {
  return one(
    `INSERT INTO off_products
       (barcode, found, product_name, brand, image_url, sodium_100g, saturated_fat_100g, sugars_100g, fiber_100g, fetched_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
     ON CONFLICT (barcode) DO UPDATE
       SET found = EXCLUDED.found, product_name = EXCLUDED.product_name, brand = EXCLUDED.brand,
           image_url = EXCLUDED.image_url, sodium_100g = EXCLUDED.sodium_100g,
           saturated_fat_100g = EXCLUDED.saturated_fat_100g, sugars_100g = EXCLUDED.sugars_100g,
           fiber_100g = EXCLUDED.fiber_100g, fetched_at = now()
     RETURNING *`,
    [
      barcode,
      fetched.found,
      fetched.productName ?? null,
      fetched.brand ?? null,
      fetched.imageUrl ?? null,
      fetched.sodium100g ?? null,
      fetched.saturatedFat100g ?? null,
      fetched.sugars100g ?? null,
      fetched.fiber100g ?? null,
    ],
  );
}

function isFresh(fetchedAt) {
  const ageMs = Date.now() - new Date(fetchedAt).getTime();
  return ageMs < CACHE_STALE_DAYS * 24 * 60 * 60 * 1000;
}

/** "Genuinely high" flags per issue scope item 3 -- null (not false) for a metric OFF never
 *  reported, so the client can distinguish "known to be fine" from "unknown". */
function computeFlags(row) {
  if (!row.found) return null;
  return {
    highSodium: row.sodium_100g != null ? Number(row.sodium_100g) >= HIGH_SODIUM_G_100G : null,
    highSaturatedFat: row.saturated_fat_100g != null ? Number(row.saturated_fat_100g) >= HIGH_SATURATED_FAT_G_100G : null,
    highSugar: row.sugars_100g != null ? Number(row.sugars_100g) >= HIGH_SUGARS_G_100G : null,
  };
}

function shapeProduct(row) {
  if (!row || !row.found) {
    return { found: false, productName: null, brand: null, imageUrl: null, nutrition: null, flags: null };
  }
  return {
    found: true,
    productName: row.product_name,
    brand: row.brand,
    imageUrl: row.image_url,
    nutrition:
      row.sodium_100g == null && row.saturated_fat_100g == null && row.sugars_100g == null && row.fiber_100g == null
        ? null
        : {
            sodiumG100g: row.sodium_100g != null ? Number(row.sodium_100g) : null,
            saturatedFatG100g: row.saturated_fat_100g != null ? Number(row.saturated_fat_100g) : null,
            sugarsG100g: row.sugars_100g != null ? Number(row.sugars_100g) : null,
            fiberG100g: row.fiber_100g != null ? Number(row.fiber_100g) : null,
          },
    flags: computeFlags(row),
  };
}

/**
 * Cache-backed real lookup: the same barcode scanned again reads the cache instead of re-hitting
 * OFF (issue scope item 4). Never throws -- a genuine OFF miss or a genuine network failure both
 * shape to `found: false`, the honest "no enrichment available" outcome scan.mjs's three match
 * states degrade to unchanged.
 */
export async function getOffProduct(rawBarcode) {
  const barcode = String(rawBarcode || "").trim();
  if (!barcode) return shapeProduct(null);

  const cached = await one(`SELECT * FROM off_products WHERE barcode = $1`, [barcode]);
  if (cached && isFresh(cached.fetched_at)) return shapeProduct(cached);

  const fetched = await fetchFromOpenFoodFacts(barcode);
  const row = await upsertOffProduct(barcode, fetched);
  return shapeProduct(row);
}

/**
 * MCP get_nutrition entry point (issue scope item 3: "informing Recipes/Money's existing
 * heartHealthy tagging ... with real, concrete nutrition numbers instead of Claude's own general
 * judgment alone"). Matches the same normalised (lower/trim) item text prices.mjs's
 * normaliseItemText uses, against this user's own barcode_links (#3109) -- "what has actually
 * been scanned that matches this item" -- then reads the shared OFF cache for it. Returns
 * `found: false` for an item that was never scanned/barcode-linked, or one OFF has no data for --
 * an honest "nothing to inform this with" rather than a guess.
 */
export async function getNutritionForItem(userId, itemText) {
  const norm = String(itemText || "").trim().toLowerCase().slice(0, 500);
  if (!norm) return { item: itemText ?? null, ...shapeProduct(null) };

  const link = await one(
    `SELECT barcode FROM barcode_links WHERE user_id = $1 AND lower(trim(item_text)) = $2
      ORDER BY last_seen_at DESC NULLS LAST, updated_at DESC LIMIT 1`,
    [userId, norm],
  );
  if (!link) return { item: itemText, ...shapeProduct(null) };

  const product = await getOffProduct(link.barcode);
  return { item: itemText, barcode: link.barcode, ...product };
}
