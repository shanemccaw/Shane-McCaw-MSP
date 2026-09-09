// Real pantry inventory -- what Shane actually has at home, and real quantities (Git #3308,
// Feature under Epic #3086). Reverses the earlier "that's not even my area" cut -- see
// contract.md Section 5's 2026-09-09 real, further superseding update.
//
// Same real correction-in-place idiom things.mjs (Git #3156) and store-aisles.mjs (Git #3108)
// already use: saying a quantity again corrects the one real row rather than creating a
// duplicate -- upsert on (user, lower(name), house), per migration 068's own unique index.
// Unlike things (one real place per name, house-agnostic), a pantry item genuinely differs per
// real house (#3308's own scope item 1) -- H1 and the rental can each carry their own real "5
// lbs of rice" -- so house is part of the real upsert key here, not just a label on the row.
//
// Three real, distinct write shapes, matching #3308's own scope item 2 ("I have 2 lbs of chicken
// breasts", "used the last of the rosemary", "bought 3 cans of diced tomatoes"):
//   - setPantryQuantity  -- states an absolute real quantity ("I have").
//   - adjustPantryQuantity -- adds a real delta on top of whatever's already on file ("bought").
//   - depletePantryItem -- zeroes a real, already-known item ("used the last of").
// capture-grammar.mjs's pantry rules and mcp/tools.mjs's set_pantry_item both call these same
// three functions -- no separate write path exists.
//
// `quantity` is a real Postgres `numeric` column (fractional real-world amounts, "2.5 lbs"), which
// node-pg returns as a string, not a number, unless told otherwise -- every SELECT/RETURNING below
// casts it `::float8` so every caller (JSON API responses included) gets a real JS number, same
// real gotcha tesla.mjs's own charge_cost_per_kwh already documents (there handled with a JS-side
// Number() instead; a SQL-side cast is simpler here since there's no float-precision concern at
// pantry quantities' real scale).

import { many, one, query } from "../db.mjs";
import { badRequest, notFound } from "../http.mjs";
import { categoryOf, CAT_ORDER } from "./shopping-order.mjs";

const SELECT_COLUMNS = "id, name, quantity::float8 AS quantity, unit, category, house, created_at, updated_at";

function normaliseName(name) {
  const n = String(name || "").trim().slice(0, 200);
  if (!n) throw badRequest("name is required");
  return n;
}

function normaliseUnit(unit) {
  if (unit === undefined || unit === null) return null;
  const u = String(unit).trim().slice(0, 40);
  return u || null;
}

function normaliseHouse(house) {
  if (house === undefined || house === null) return null;
  const h = String(house).trim().slice(0, 80);
  return h || null;
}

function normaliseCategory(category, name) {
  const c = category === undefined || category === null ? "" : String(category).trim();
  return (c || categoryOf(name)).slice(0, 60);
}

function normaliseQuantity(quantity) {
  const n = Number(quantity);
  if (!Number.isFinite(n)) throw badRequest("quantity must be a real number");
  return n;
}

/** Every real pantry item on file, newest-updated first -- what the Pantry tab reads. Pass house
 *  to see just what's on hand at one real hub/spoke, same filter shape as things.listThings. */
export async function listPantryItems(userId, { house = null } = {}) {
  const params = [userId];
  let filter = "";
  if (house) {
    params.push(house);
    filter = `AND house = $${params.length}`;
  }
  return many(
    `SELECT ${SELECT_COLUMNS}
       FROM pantry_items
      WHERE user_id = $1 ${filter}
      ORDER BY updated_at DESC`,
    params,
  );
}

/** Real, ordered-by-category grouping (Pantry tab, #3308's own scope item 5: "showing current
 *  real inventory grouped by category") -- same CAT_ORDER sequence shopping-order.mjs's own
 *  orderItems('category') groups the Shopping run by, so Pantry groups read consistently with
 *  Shopping. Empty groups are dropped, same as orderItems does. */
export function groupPantryByCategory(items) {
  return CAT_ORDER.map((cat) => ({
    category: cat,
    items: items.filter((it) => it.category === cat),
  })).filter((g) => g.items.length > 0);
}

/** Every distinct house a pantry item is on file for -- same "Lives at <house>" grouping shape
 *  things.listHouses already gives the Things room. */
export async function listPantryHouses(userId) {
  return many(
    `SELECT house, count(*)::int AS item_count
       FROM pantry_items
      WHERE user_id = $1 AND house IS NOT NULL
      GROUP BY house
      ORDER BY house ASC`,
    [userId],
  );
}

/** Real, deterministic tiered lookup (exact -> starts-with -> substring, same shape
 *  capture-grammar.tieredMatch already applies everywhere else) for correcting/depleting an
 *  existing real item by name -- ambiguous or not-found both come back null rather than guessing.
 *  Scoped to the exact same real house bucket the write itself targets (including the "no house
 *  stated" bucket, matched via COALESCE the same way migration 068's own unique index does) --
 *  never blended across Shane's other real houses, so "bought 3 cans of diced tomatoes" (no house
 *  stated) can't accidentally correct a same-named item tracked at H2. */
async function tieredFind(userId, name, house) {
  const n = String(name || "").trim().toLowerCase();
  if (!n) return null;
  const rows = await many(
    `SELECT ${SELECT_COLUMNS}
       FROM pantry_items WHERE user_id = $1 AND COALESCE(house, '') = COALESCE($2, '')`,
    [userId, house],
  );
  const exact = rows.filter((r) => r.name.toLowerCase() === n);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;
  const starts = rows.filter((r) => r.name.toLowerCase().startsWith(n));
  if (starts.length === 1) return starts[0];
  if (starts.length > 1) return null;
  const contains = rows.filter((r) => r.name.toLowerCase().includes(n));
  return contains.length === 1 ? contains[0] : null;
}
export { tieredFind as findPantryItemFuzzy };

/** State an absolute real quantity -- "I have 2 lbs of chicken breasts." Upsert on
 *  (user, lower(name), house): saying it again corrects the one real row in place. category
 *  defaults to shopping-order.mjs's own categoryOf(name) when not stated explicitly, so Pantry
 *  groups the same way Shopping already does. */
export async function setPantryQuantity(userId, { name, quantity, unit, category, house }) {
  const n = normaliseName(name);
  const qty = normaliseQuantity(quantity);
  const u = normaliseUnit(unit);
  const h = normaliseHouse(house);
  const cat = normaliseCategory(category, n);

  return one(
    `INSERT INTO pantry_items (user_id, name, quantity, unit, category, house)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id, lower(name), COALESCE(house, ''))
     DO UPDATE SET quantity = EXCLUDED.quantity,
                    unit = COALESCE(EXCLUDED.unit, pantry_items.unit),
                    category = EXCLUDED.category,
                    updated_at = now()
     RETURNING ${SELECT_COLUMNS}`,
    [userId, n, qty, u, cat, h],
  );
}

/** Add a real delta on top of whatever's already on file -- "bought 3 cans of diced tomatoes."
 *  Creates the row (at exactly the stated delta) the first time this item is ever mentioned,
 *  same "the list is created if missing" idiom lists.getOrCreateListByName already uses. delta
 *  may be negative (a real, direct decrement -- e.g. a future Cook-mode integration), but never
 *  below zero: migration 068's own CHECK constraint is the backstop, this clamps first so a
 *  caller gets a clean floor rather than a raw constraint-violation error. */
export async function adjustPantryQuantity(userId, { name, delta, unit, category, house }) {
  const n = normaliseName(name);
  const d = normaliseQuantity(delta);
  const u = normaliseUnit(unit);
  const h = normaliseHouse(house);
  const cat = normaliseCategory(category, n);

  const existing = await tieredFind(userId, n, h);
  if (existing) {
    const next = Math.max(0, Number(existing.quantity) + d);
    return one(
      `UPDATE pantry_items SET quantity = $2, unit = COALESCE($3, unit), updated_at = now()
        WHERE id = $1
        RETURNING ${SELECT_COLUMNS}`,
      [existing.id, next, u],
    );
  }

  return one(
    `INSERT INTO pantry_items (user_id, name, quantity, unit, category, house)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id, lower(name), COALESCE(house, ''))
     DO UPDATE SET quantity = GREATEST(0, pantry_items.quantity + EXCLUDED.quantity),
                    unit = COALESCE(EXCLUDED.unit, pantry_items.unit),
                    updated_at = now()
     RETURNING ${SELECT_COLUMNS}`,
    [userId, n, Math.max(0, d), u, cat, h],
  );
}

/** "Used the last of the rosemary" -- zeroes an already-known real item rather than deleting the
 *  row, so unit/category survive for the next time it's restocked. Real, deterministic tiered
 *  match against what's already on file (see tieredFind above); genuinely nothing on file for
 *  this name is a real null, not an error -- the caller (capture-grammar) treats that as a
 *  fallback, since "used the last of X" naming something never tracked is still worth Claude
 *  seeing in the inbox rather than silently discarded. */
export async function depletePantryItem(userId, name, house) {
  const n = normaliseName(name);
  const h = normaliseHouse(house);
  const existing = await tieredFind(userId, n, h);
  if (!existing) return null;
  return one(
    `UPDATE pantry_items SET quantity = 0, updated_at = now() WHERE id = $1
     RETURNING ${SELECT_COLUMNS}`,
    [existing.id],
  );
}

/** Ownership-checked read of one real row, for a future direct edit/delete UI action. */
export async function getOwnedPantryItem(userId, itemId) {
  return one(
    `SELECT ${SELECT_COLUMNS} FROM pantry_items WHERE id = $1 AND user_id = $2`,
    [itemId, userId],
  );
}

/** Real, honest "is this actually in the pantry" check -- quantity > 0, fuzzy-matched the same
 *  case-insensitive, both-ways substring way recipes.mjs already matches a recipe's `needs`
 *  against the Shopping run (Git #3110's own `matches()`), so "chicken" on a pantry row named
 *  "chicken breasts" still counts. Used by recipes.listRecipesWithMatch to extend canMake beyond
 *  the Shopping run alone (#3308's own scope item 3). */
export async function hasPantryQuantity(userId, needText) {
  const rows = await many(
    `SELECT name FROM pantry_items WHERE user_id = $1 AND quantity > 0`,
    [userId],
  );
  const need = String(needText || "").trim().toLowerCase();
  if (!need) return false;
  return rows.some((r) => {
    const have = r.name.toLowerCase();
    return have.includes(need) || need.includes(have);
  });
}

/** Ownership-checked delete of a genuinely mistaken row -- distinct from depletePantryItem
 *  (which zeroes, keeping unit/category for the next restock): this removes the row entirely,
 *  for a real add-in-error correction. */
export async function deletePantryItem(userId, itemId) {
  const owned = await getOwnedPantryItem(userId, itemId);
  if (!owned) throw notFound("Pantry item not found");
  await query("DELETE FROM pantry_items WHERE id = $1", [itemId]);
}
