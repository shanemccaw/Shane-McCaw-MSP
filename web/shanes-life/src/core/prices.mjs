// Per-store price history (Git #3112) AND weekly-ad cross-store verdicts / coupons (Git #3110).
//
// Design handoff, Shanes Life 04 - Shopping.dc.html: "Prices are stored per store and per date,
// and Claude reads them over MCP (get_prices) so the next list carries real numbers instead of
// estimates." #3112's own real scope is the historical record -- repeated real observations of
// the same item at the same store over time. #3110 is the current-week snapshot: Claude reads a
// real weekly ad flyer conversationally and pushes it in (push_deals/push_coupons, below), and
// the app turns that into a real cross-store "cheapest right now" verdict on matching list items.
// Both live in the SAME item_prices/stores tables -- a weekly-ad price is the same real shape as
// a shane-observed one, just source = 'weekly_ad' instead of the default 'shane', and read
// differently (current-cheapest-across-stores vs. history-over-time). Coupons are a genuinely
// different shape (multi-buy count, flat discount) and get their own table.
//
// "Synced across Shane's own devices" (the design README's "store per phone") needs no sync
// mechanism here: this is one real row in the shared database per observation, reachable from
// any signed-in session, so every device already sees the same real history.

import { many, one, query } from "../db.mjs";
import { badRequest, notFound } from "../http.mjs";

const MAX_ROWS_PER_CALL = 200;
// A weekly ad is, by definition, this week's -- a forgotten push from a month ago should not
// keep winning a cross-store verdict forever. Real slack past 7 days for a late "Done shopping".
const WEEKLY_AD_FRESHNESS_DAYS = 10;

/** Same normalisation on both write and read, so "Ground Beef" and "ground beef " match the
 *  same real history row -- the whole point of keying on text rather than a barcode (#3109). */
export function normaliseItemText(text) {
  return String(text || "").trim().toLowerCase().slice(0, 500);
}

/** Find-or-create a store, scoped to the account -- mirrors lists.getOrCreateListByName's
 *  case-insensitive find-or-create shape. */
export async function getOrCreateStore(userId, rawName) {
  const name = String(rawName || "").trim().slice(0, 200);
  if (!name) throw badRequest("store name is required");

  const existing = await one(
    `SELECT id, name, created_at FROM stores WHERE user_id = $1 AND lower(name) = lower($2)`,
    [userId, name],
  );
  if (existing) return existing;

  try {
    return await one(
      `INSERT INTO stores (user_id, name) VALUES ($1, $2) RETURNING id, name, created_at`,
      [userId, name],
    );
  } catch (err) {
    // A concurrent request already created it (stores_user_name_key) -- re-read rather than 500.
    if (err.code === "23505") return getOrCreateStore(userId, rawName);
    throw err;
  }
}

export async function listStores(userId) {
  return many(
    `SELECT s.id, s.name, s.created_at,
            (SELECT count(*)::int FROM item_prices ip WHERE ip.store_id = s.id) AS price_count
       FROM stores s WHERE s.user_id = $1 ORDER BY lower(s.name)`,
    [userId],
  );
}

/**
 * Record one real, dated price observation. `storeId` or `storeName` -- exactly one of the two
 * identifies the store; a name that has never been seen before creates it, same as a list
 * (#3088) gets created the first time it's needed.
 */
export async function recordPrice(
  userId,
  {
    storeId,
    storeName,
    itemText,
    priceCents,
    observedOn,
    note,
    source = "shane",
    category = null,
    imageUrl = null,
    dealType = null,
    validTo = null,
  },
) {
  const label = String(itemText || "").trim().slice(0, 500);
  if (!label) throw badRequest("itemText is required");
  const cents = Number(priceCents);
  if (!Number.isFinite(cents) || cents < 0) throw badRequest("priceCents must be a non-negative number");

  let store;
  if (storeId) {
    store = await one(`SELECT id, name FROM stores WHERE id = $1 AND user_id = $2`, [storeId, userId]);
    if (!store) throw notFound("Store not found");
  } else if (storeName) {
    store = await getOrCreateStore(userId, storeName);
  } else {
    throw badRequest("storeId or storeName is required");
  }

  const normalisedText = normaliseItemText(label);
  const roundedCents = Math.round(cents);
  const row = await one(
    `INSERT INTO item_prices (user_id, store_id, item_text, item_label, price_cents, observed_on, note, source, category, image_url, deal_type, valid_to)
     VALUES ($1, $2, $3, $4, $5, COALESCE($6, current_date), $7, $8, $9, $10, $11, $12)
     RETURNING id, store_id, item_text, item_label, price_cents, observed_on, note, source, category, image_url, deal_type, valid_to, created_at`,
    [
      userId,
      store.id,
      normalisedText,
      label,
      roundedCents,
      observedOn || null,
      note ? String(note).slice(0, 2000) : null,
      source,
      category ? String(category).trim().slice(0, 200) || null : null,
      imageUrl ? String(imageUrl).trim().slice(0, 2000) || null : null,
      dealType ? String(dealType).trim().slice(0, 100) || null : null,
      validTo || null,
    ],
  );

  // Git #3203: a real, Shane-stated price ("chicken breasts are $3.49 now" -- typed into the
  // capture box, or the old "Log price" mechanism) is a real observation for THIS item, not just
  // a history row. Sync it onto every matching open list_items row too, same column
  // core/scan.mjs's real barcode scan already writes -- otherwise Shopping's running total
  // (lists.mjs getListDetail's totalCents) only ever moves via a scan, which #3203 confirmed is
  // the whole real bug: most items get priced by typing, never scanning. Weekly-ad pushes
  // (source 'weekly_ad') are a different real shape -- a store's current flyer price, not "here
  // is what I paid" -- and deliberately do NOT touch list_items; they surface as
  // item.weeklyAdVerdict instead (attachWeeklyAdVerdicts, above).
  if (source === "shane") {
    await query(
      `UPDATE list_items li
          SET price_cents = $3, price_source = 'manual', priced_at = now()
         FROM lists l
        WHERE li.list_id = l.id AND l.user_id = $1 AND l.archived_at IS NULL
          AND lower(trim(li.text)) = $2`,
      [userId, normalisedText, roundedCents],
    );
  }

  return { ...row, store_name: store.name };
}

/** The real, queryable history for one item -- every store, every date it was ever priced. */
export async function getPriceHistory(userId, itemText, { limit = 100 } = {}) {
  const norm = normaliseItemText(itemText);
  if (!norm) throw badRequest("item is required");
  return many(
    `SELECT ip.id, ip.item_text, ip.item_label, ip.price_cents, ip.observed_on, ip.note, ip.source, ip.created_at,
            s.id AS store_id, s.name AS store_name
       FROM item_prices ip JOIN stores s ON s.id = ip.store_id
      WHERE ip.user_id = $1 AND ip.item_text = $2
      ORDER BY ip.observed_on DESC, ip.created_at DESC
      LIMIT $3`,
    [userId, norm, Math.min(Math.max(Number(limit) || 100, 1), 500)],
  );
}

/**
 * The most recent price for each of a set of item texts (one query, not N) -- what the Shopping
 * room's list rows show as "last time $X at Store". Mutates each item with a `lastPrice` field
 * so a caller can pass GET /api/shopping's items straight through.
 */
export async function attachLatestPrices(userId, items) {
  if (!Array.isArray(items) || items.length === 0) return items;
  const texts = [...new Set(items.map((i) => normaliseItemText(i.text)).filter(Boolean))];
  if (texts.length === 0) return items;

  const rows = await many(
    `SELECT DISTINCT ON (ip.item_text) ip.item_text, ip.price_cents, ip.observed_on, s.name AS store_name
       FROM item_prices ip JOIN stores s ON s.id = ip.store_id
      WHERE ip.user_id = $1 AND ip.item_text = ANY($2)
      ORDER BY ip.item_text, ip.observed_on DESC, ip.created_at DESC`,
    [userId, texts],
  );
  const byText = new Map(rows.map((r) => [r.item_text, r]));
  for (const item of items) {
    const hint = byText.get(normaliseItemText(item.text));
    item.lastPrice = hint
      ? { priceCents: hint.price_cents, storeName: hint.store_name, observedOn: hint.observed_on }
      : null;
  }
  return items;
}

// ---------------------------------------------------------------------------
// Weekly-ad cross-store verdicts, coupons and multi-buy counts (Git #3110).
//
// Real capability this stores, not invents: Claude already reads a real weekly ad flyer
// conversationally and extracts real per-store prices and coupons (contract pack Section 5,
// "already-working real capability from earlier tonight"). The app still does no AI inference of
// its own (Section 10) -- nothing here fetches a live ad or calls a model. Claude pushes the
// structured result in (push_deals / push_coupons, src/mcp/tools.mjs); this reuses the SAME
// item_prices/stores tables #3112 built (source = 'weekly_ad' instead of the default 'shane'),
// because a weekly-ad price is the same real shape -- one item, one store, one date, one price --
// just a different origin and read pattern (current cross-store cheapest, not history-over-time).
// ---------------------------------------------------------------------------

function normaliseDate(value, field) {
  if (value === undefined || value === null || value === "") return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw badRequest(`${field} must be a valid date`);
  return d.toISOString().slice(0, 10);
}

function normaliseDealItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw badRequest("items is required and must be a non-empty array");
  }
  if (items.length > MAX_ROWS_PER_CALL) throw badRequest(`items must contain at most ${MAX_ROWS_PER_CALL} entries`);
  return items.map((raw, i) => {
    if (!raw || typeof raw !== "object") throw badRequest(`items[${i}] must be an object`);
    const itemText = String(raw.item ?? "").trim();
    if (!itemText) throw badRequest(`items[${i}].item is required`);
    const priceCents = Number(raw.priceCents);
    if (!Number.isFinite(priceCents) || priceCents < 0) {
      throw badRequest(`items[${i}].priceCents must be a non-negative number`);
    }
    return {
      itemText: itemText.slice(0, 500),
      priceCents: Math.round(priceCents),
      unit: raw.unit ? String(raw.unit).slice(0, 40) : null,
      validOn: normaliseDate(raw.validOn, `items[${i}].validOn`),
      validTo: normaliseDate(raw.validTo, `items[${i}].validTo`),
      category: raw.category ? String(raw.category).trim().slice(0, 200) : null,
      imageUrl: raw.imageUrl ? String(raw.imageUrl).trim().slice(0, 2000) : null,
      dealType: raw.dealType ? String(raw.dealType).trim().slice(0, 100) : null,
    };
  });
}

function normaliseCouponItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw badRequest("items is required and must be a non-empty array");
  }
  if (items.length > MAX_ROWS_PER_CALL) throw badRequest(`items must contain at most ${MAX_ROWS_PER_CALL} entries`);
  return items.map((raw, i) => {
    if (!raw || typeof raw !== "object") throw badRequest(`items[${i}] must be an object`);
    const itemText = String(raw.item ?? "").trim();
    if (!itemText) throw badRequest(`items[${i}].item is required`);
    const description = String(raw.description ?? "").trim();
    if (!description) throw badRequest(`items[${i}].description is required`);
    return {
      itemText: itemText.slice(0, 500),
      description: description.slice(0, 500),
      multiBuyCount:
        raw.multiBuyCount != null ? Math.max(1, Math.round(Number(raw.multiBuyCount))) : null,
      multiBuyPriceCents: raw.multiBuyPriceCents != null ? Math.round(Number(raw.multiBuyPriceCents)) : null,
      discountCents: raw.discountCents != null ? Math.round(Number(raw.discountCents)) : null,
      validFrom: normaliseDate(raw.validFrom, `items[${i}].validFrom`),
      validTo: normaliseDate(raw.validTo, `items[${i}].validTo`),
      category: raw.category ? String(raw.category).trim().slice(0, 200) : null,
      imageUrl: raw.imageUrl ? String(raw.imageUrl).trim().slice(0, 2000) : null,
      dealType: raw.dealType ? String(raw.dealType).trim().slice(0, 100) : null,
    };
  });
}

/** push_deals (MCP) -- Claude's real per-store weekly-ad prices, extracted from a flyer it read
 *  conversationally. Lands in item_prices with source 'weekly_ad', same table #3112's own
 *  shane-observed prices live in -- recordPrice already does everything a weekly-ad row needs
 *  except carry a unit, so this calls it directly and patches unit on afterwards. */
export async function pushDeals(userId, { store, items }) {
  const normalised = normaliseDealItems(items);
  const rows = [];
  for (const item of normalised) {
    const row = await recordPrice(userId, {
      storeName: store,
      itemText: item.itemText,
      priceCents: item.priceCents,
      observedOn: item.validOn,
      source: "weekly_ad",
      category: item.category,
      imageUrl: item.imageUrl,
      dealType: item.dealType,
      validTo: item.validTo,
    });
    if (item.unit) {
      await one(`UPDATE item_prices SET unit = $2 WHERE id = $1 RETURNING id`, [row.id, item.unit]);
      row.unit = item.unit;
    }
    rows.push(row);
  }
  return rows;
}

/** push_coupons (MCP) -- Claude's real coupon / multi-buy reads from the same flyer. `store` is
 *  optional -- a manufacturer coupon isn't tied to one. */
export async function pushCoupons(userId, { store, items }) {
  const cleanStore = store ? String(store).trim().slice(0, 200) : null;
  const normalised = normaliseCouponItems(items);
  const rows = [];
  for (const item of normalised) {
    rows.push(
      await one(
        `INSERT INTO coupons (user_id, store, item_text, description, multi_buy_count, multi_buy_price_cents, discount_cents, valid_from, valid_to, category, image_url, deal_type)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING id, store, item_text, description, multi_buy_count, multi_buy_price_cents, discount_cents, valid_from, valid_to, category, image_url, deal_type, created_at`,
        [
          userId,
          cleanStore,
          normaliseItemText(item.itemText),
          item.description,
          item.multiBuyCount,
          item.multiBuyPriceCents,
          item.discountCents,
          item.validFrom,
          item.validTo,
          item.category,
          item.imageUrl,
          item.dealType,
        ],
      ),
    );
  }
  return rows;
}

/** fetch_weekly_ad (MCP) -- everything currently on file for one store's weekly ad: its
 *  weekly-ad-sourced item_prices rows plus its coupons. `zip` is accepted and echoed back, not
 *  yet a filter column -- today one store's prices are stored flat; per-zip ad variance is real
 *  but out of this Feature's scope. */
export async function fetchWeeklyAd(userId, { store, zip }) {
  const cleanStore = String(store ?? "").trim();
  if (!cleanStore) throw badRequest("store is required");
  const prices = await many(
    `SELECT ip.id, ip.item_text, ip.item_label, ip.price_cents, ip.unit, ip.observed_on, ip.valid_to,
            ip.category, ip.image_url, ip.deal_type, ip.created_at
       FROM item_prices ip JOIN stores s ON s.id = ip.store_id
      WHERE ip.user_id = $1 AND ip.source = 'weekly_ad' AND lower(s.name) = lower($2)
        AND ip.observed_on >= current_date - interval '${WEEKLY_AD_FRESHNESS_DAYS} days'
      ORDER BY ip.observed_on DESC, ip.price_cents ASC`,
    [userId, cleanStore],
  );
  const coupons = await many(
    `SELECT id, store, item_text, description, multi_buy_count, multi_buy_price_cents, discount_cents, valid_from, valid_to,
            category, image_url, deal_type, created_at
       FROM coupons WHERE user_id = $1 AND lower(store) = lower($2)
        AND (valid_to IS NULL OR valid_to >= CURRENT_DATE)
      ORDER BY created_at DESC`,
    [userId, cleanStore],
  );
  return { store: cleanStore, zip: zip ?? null, prices, coupons };
}

/** Case-insensitive substring match, both ways -- one side is Claude's flyer-extracted text, the
 *  other is Shane's own capture-grammar wording ("milk" vs "whole milk"), so an exact match is
 *  the wrong bar. Both sides are already normaliseItemText'd before this runs. */
function textsMatch(a, b) {
  return a.includes(b) || b.includes(a);
}

/**
 * The real per-item verdict Shopping decorates onto its list: the cheapest CURRENT weekly-ad
 * price across every store plus the best matching coupon/multi-buy, or nothing when Claude
 * hasn't pushed one that matches yet. Distinct from attachLatestPrices' `lastPrice` above --
 * that is "what did this cost last time, anywhere, any source"; this is "what does the current
 * weekly ad say, and where's it cheapest right now."
 */
export async function attachWeeklyAdVerdicts(userId, items) {
  if (!Array.isArray(items) || items.length === 0) return items;
  const uniqueNorm = [...new Set(items.map((i) => normaliseItemText(i.text)).filter(Boolean))];
  if (uniqueNorm.length === 0) return items;

  const priceRows = await many(
    `SELECT ip.item_text, ip.price_cents, ip.unit, ip.category, ip.image_url, ip.deal_type, s.name AS store_name
       FROM item_prices ip JOIN stores s ON s.id = ip.store_id
      WHERE ip.user_id = $1 AND ip.source = 'weekly_ad'
        AND ip.observed_on >= current_date - interval '${WEEKLY_AD_FRESHNESS_DAYS} days'
      ORDER BY ip.price_cents ASC`,
    [userId],
  );
  const couponRows = await many(
    `SELECT store, item_text, description, multi_buy_count, multi_buy_price_cents, discount_cents, category, image_url, deal_type FROM coupons
      WHERE user_id = $1 AND (valid_to IS NULL OR valid_to >= CURRENT_DATE)
      ORDER BY created_at DESC`,
    [userId],
  );

  const verdictByText = new Map();
  if (priceRows.length > 0 || couponRows.length > 0) {
    for (const norm of uniqueNorm) {
      const matchedPrice = priceRows.find((p) => textsMatch(norm, p.item_text));
      const matchedCoupon = couponRows.find((c) => textsMatch(norm, c.item_text));
      if (!matchedPrice && !matchedCoupon) continue;
      verdictByText.set(norm, {
        store: matchedPrice?.store_name ?? matchedCoupon?.store ?? null,
        priceCents: matchedPrice?.price_cents ?? null,
        unit: matchedPrice?.unit ?? null,
        // Real, per-item -- prefer the price row's own category/image/dealType (the actual sale
        // item) and fall back to the matched coupon's, never invent one when neither has it.
        category: matchedPrice?.category ?? matchedCoupon?.category ?? null,
        imageUrl: matchedPrice?.image_url ?? matchedCoupon?.image_url ?? null,
        dealType: matchedPrice?.deal_type ?? matchedCoupon?.deal_type ?? null,
        coupon: matchedCoupon
          ? {
              description: matchedCoupon.description,
              multiBuyCount: matchedCoupon.multi_buy_count,
              multiBuyPriceCents: matchedCoupon.multi_buy_price_cents,
              discountCents: matchedCoupon.discount_cents,
            }
          : null,
      });
    }
  }

  for (const item of items) {
    item.weeklyAdVerdict = verdictByText.get(normaliseItemText(item.text)) ?? null;
  }
  return items;
}
