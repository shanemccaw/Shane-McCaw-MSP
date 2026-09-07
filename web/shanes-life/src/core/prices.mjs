// Per-store price history (Git #3112).
//
// Design handoff, Shanes Life 04 - Shopping.dc.html: "Prices are stored per store and per date,
// and Claude reads them over MCP (get_prices) so the next list carries real numbers instead of
// estimates." This is the real historical record #3112 asks for -- distinct from the current
// weekly-ad snapshot #3110 attaches to a single running list -- built from repeated real
// observations of the same item at the same store over time.
//
// "Synced across Shane's own devices" (the design README's "store per phone") needs no sync
// mechanism here: this is one real row in the shared database per observation, reachable from
// any signed-in session, so every device already sees the same real history.

import { many, one } from "../db.mjs";
import { badRequest, notFound } from "../http.mjs";

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
export async function recordPrice(userId, { storeId, storeName, itemText, priceCents, observedOn, note, source = "shane" }) {
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

  const row = await one(
    `INSERT INTO item_prices (user_id, store_id, item_text, item_label, price_cents, observed_on, note, source)
     VALUES ($1, $2, $3, $4, $5, COALESCE($6, current_date), $7, $8)
     RETURNING id, store_id, item_text, item_label, price_cents, observed_on, note, source, created_at`,
    [userId, store.id, normaliseItemText(label), label, Math.round(cents), observedOn || null, note ? String(note).slice(0, 2000) : null, source],
  );
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
