// Store paths + aisle memory (Git #3108, blocked_by #3088).
//
// Design handoff, "Shanes Life 04 - Shopping.dc.html" option 2b: "say where you found it once;
// next trip the list walks the store in order." The First Slice Prototype's real wired logic is
// the specification -- `it.aisleBy[store] = { aisle, note }`, matched by item text, sorted
// ascending by aisle number for "Best path". This module is the real, growing per-store record
// that behavior needs: a later report of the same item at the same store corrects the spot
// (store layouts move) and bumps `hits`, rather than a one-time entry.

import { many, one } from "../db.mjs";
import { badRequest } from "../http.mjs";

function normaliseStore(store) {
  const s = String(store || "").trim().slice(0, 120);
  if (!s) throw badRequest("store is required");
  return s;
}

function normaliseItemText(text) {
  const t = String(text || "").trim().slice(0, 500);
  if (!t) throw badRequest("itemText is required");
  return t;
}

/** Record (or correct) a real aisle spot for one item at one store. Upsert on
 *  (user, lower(store), lower(item_text)): a repeat report updates the spot in place and bumps
 *  `hits` -- that hit count is the "real, improving aisle map" building over repeated captures,
 *  not a one-time entry. */
export async function recordAisle(userId, store, itemText, aisle, note = null) {
  const s = normaliseStore(store);
  const t = normaliseItemText(itemText);
  const a = Number(aisle);
  if (!Number.isInteger(a) || a < 0) throw badRequest("aisle must be a non-negative integer");
  const n = note ? String(note).trim().slice(0, 500) || null : null;

  return one(
    `INSERT INTO store_aisles (user_id, store, item_text, aisle, note, hits, last_seen_at)
     VALUES ($1, $2, $3, $4, $5, 1, now())
     ON CONFLICT (user_id, lower(store), lower(item_text))
     DO UPDATE SET aisle = EXCLUDED.aisle, note = EXCLUDED.note,
                    hits = store_aisles.hits + 1, last_seen_at = now()
     RETURNING id, store, item_text, aisle, note, hits, last_seen_at, created_at`,
    [userId, s, t, a, n],
  );
}

/** The real, accumulated map for one store -- what Best-path ordering walks, and what
 *  `get_store_map` (MCP) hands back to Claude so it does not ask Shane for a spot twice. */
export async function getStoreMap(userId, store) {
  const s = normaliseStore(store);
  return many(
    `SELECT id, store, item_text, aisle, note, hits, last_seen_at, created_at
       FROM store_aisles
      WHERE user_id = $1 AND lower(store) = lower($2)
      ORDER BY aisle ASC, item_text ASC`,
    [userId, s],
  );
}

/** Every store this user has any real aisle memory for -- lets the Shopping room offer "which
 *  store" without guessing at a fixed list. */
export async function listStores(userId) {
  return many(
    `SELECT store, count(*)::int AS item_count, max(last_seen_at) AS last_seen_at
       FROM store_aisles WHERE user_id = $1
      GROUP BY store ORDER BY last_seen_at DESC`,
    [userId],
  );
}

/** Match a list item's free-text name against a store's accumulated map. Exact match (after
 *  trimming a trailing quantity clause, e.g. "Pasta, 3 boxes" -> "Pasta") wins; otherwise the
 *  longest substring match either direction -- the same tolerant matching the design's own
 *  capture grammar implies ("pasta aisle 12" should still find "Pasta, 3 boxes" on the list). */
export function matchAisle(itemText, storeMap) {
  const bare = String(itemText || "").split(",")[0].trim().toLowerCase();
  if (!bare || storeMap.length === 0) return null;

  const exact = storeMap.find((row) => row.item_text.trim().toLowerCase() === bare);
  if (exact) return exact;

  let best = null;
  for (const row of storeMap) {
    const key = row.item_text.trim().toLowerCase();
    if (!key) continue;
    if (bare.includes(key) || key.includes(bare)) {
      const len = Math.min(key.length, bare.length);
      if (!best || len > best.len) best = { row, len };
    }
  }
  return best ? best.row : null;
}
