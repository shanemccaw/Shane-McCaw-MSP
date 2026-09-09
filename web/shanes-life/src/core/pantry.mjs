// Real pantry inventory -- what Shane actually has at home, and real quantities (Git #3308,
// Feature under Epic #3086; rebuilt as its own dedicated room by Git #3316, correcting #3308's
// "tab inside Shopping" call -- Shane's own real, stated direction was always a dedicated 14th
// room; the assets (critter pair 1y, r-pantry furniture) now exist). Reverses the earlier "that's
// not even my area" cut -- see contract.md Section 5's 2026-09-09 real, further superseding
// update.
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
// pantry quantities' real scale). `low_at` (migration 070) is the same real shape.

import { many, one, query } from "../db.mjs";
import { badRequest, notFound } from "../http.mjs";
import { categoryOf, CAT_ORDER } from "./shopping-order.mjs";

// COALESCE(low_at, ...) reads the real per-item override (migration 070) when Shane/Claude has
// ever stated one, and the real unit-based default otherwise (0 for a plain count -- only Out
// counts as low; 1 for a 'lvl' item -- Almost out counts too) -- computed at read time so a row
// written before this column existed, or never explicitly overridden, still reads a real number
// rather than null. See migration 070's own header for why this is read-time, not a bulk backfill.
const SELECT_COLUMNS =
  "id, name, quantity::float8 AS quantity, unit, category, house, " +
  "COALESCE(low_at, CASE WHEN unit = 'lvl' THEN 1 ELSE 0 END)::float8 AS low_at, " +
  "created_at, updated_at";

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

/** Real, explicit "running low" override (README: "Chicken breasts 2, Sparkling water 3, Coffee
 *  1…") -- undefined/null means "no override stated," which setPantryQuantity/
 *  adjustPantryQuantity below both leave alone (never clobber an existing real override with a
 *  guessed default) and SELECT_COLUMNS' own COALESCE resolves to the real unit-based default. */
function normaliseLowAt(lowAt) {
  if (lowAt === undefined || lowAt === null) return null;
  const n = Number(lowAt);
  if (!Number.isFinite(n) || n < 0) throw badRequest("lowAt must be a real, non-negative number");
  return n;
}

// ---------------------------------------------------------------------------------------------
// Zones -- the design's 8 real display zones (Git #3316, README "eight zone tiles"), a grouping
// layered ON TOP OF the existing fixed CAT_ORDER category, never a restructuring of category
// itself (#3316's own explicit instruction). Order matches the design's own real `PZ` array
// (First Slice Prototype.dc.html) -- the Pantry room's zone grid renders in this order.
// ---------------------------------------------------------------------------------------------

export const PANTRY_ZONES = [
  "Spices & seasonings",
  "Cans & jars",
  "Dry goods",
  "Oils & condiments",
  "Fridge",
  "Freezer",
  "Produce",
  "Snacks & drinks",
];

// Real hue per zone (rgb triplets), lifted verbatim from the design's own `PZ_HUE` -- the zone
// grid's own tiles and the Zone screen's glow/pebble both key off these exact values.
export const PANTRY_ZONE_HUE = {
  "Spices & seasonings": "251,146,60",
  "Cans & jars": "148,163,184",
  "Dry goods": "214,176,140",
  "Oils & condiments": "250,204,21",
  Fridge: "147,197,253",
  Freezer: "165,243,252",
  Produce: "134,239,172",
  "Snacks & drinks": "249,168,212",
};

// Real keyword table per zone, ported VERBATIM from the design's own `PZ_WORDS` (First Slice
// Prototype.dc.html) -- extracted, not authored, per CLAUDE.md's own rule that a Shell export's
// logic class is the real specification. First zone whose word list matches wins.
const PZ_WORDS = [
  ["Freezer", ["frozen", "ice cream", "steak", "chicken", "beef", "salmon", "shrimp", "fillet", "nugget", "pizza", "turkey", "pork", "tater"]],
  ["Fridge", ["egg", "milk", "butter", "cheese", "yogurt", "sour cream", "juice", "ketchup", "mustard", "mayo", "ranch", "lunch meat", "deli"]],
  ["Produce", ["potato", "onion", "garlic", "banana", "apple", "lemon", "lime", "carrot", "bell pepper", "lettuce", "avocado", "berries", "fresh"]],
  ["Spices & seasonings", ["salt", "pepper", "paprika", "cumin", "oregano", "cinnamon", "powder", "seasoning", "spice", "cayenne", "bay lea", "chili", "basil", "thyme"]],
  ["Oils & condiments", ["oil", "vinegar", "soy", "hot sauce", "honey", "worcestershire", "bbq", "syrup", "dressing"]],
  ["Snacks & drinks", ["chip", "popcorn", "coffee", "tea", "water", "soda", "pretzel", "granola", "cookie", "cracker"]],
  ["Cans & jars", ["bean", "tomato", "paste", "broth", "tuna", "corn", "peanut butter", "salsa", "sauce", "soup", "pickle", "chickpea"]],
  ["Dry goods", ["rice", "pasta", "oat", "cereal", "flour", "sugar", "bread", "tortilla", "lentil", "noodle", "ramen", "mix"]],
];

/** The real zone a pantry item displays under (#3316 scope items 2 + 4), ported verbatim from
 *  the design's own `pantryZoneOf` (First Slice Prototype.dc.html): a can/jar unit or a
 *  broth/stock name -> Cans & jars; a bottle unit -> Oils & condiments; then PZ_WORDS above,
 *  first match wins. The already-real `category` (shopping-order.mjs's fixed CAT_ORDER) is the
 *  fallback ONLY for a name neither rule recognizes -- category's own keyword coverage is
 *  narrower than PZ_WORDS' (most real spice names -- "paprika", "cumin", "oregano" -- never match
 *  category's own Pantry keyword list and land in 'Other'; confirmed directly against the real
 *  local DB before shipping this, see build-journal/3316.md), so leaning on category FIRST would
 *  misclassify most real spices into a generic Dry goods catch-all instead of Spices &
 *  seasonings. This never restructures category itself -- the stored `category` column and
 *  shopping-order.mjs's own categoryOf/CAT_ORDER are untouched; this only decides which zone tile
 *  a row's real name/unit displays under. */
export function zoneOf({ name, unit, category }) {
  const l = String(name || "").toLowerCase();
  const u = String(unit || "").toLowerCase();
  if (u === "can" || u === "jar" || /broth|stock/.test(l)) return "Cans & jars";
  if (u === "bottle") return "Oils & condiments";
  for (const [zone, words] of PZ_WORDS) {
    if (words.some((w) => l.includes(w))) return zone;
  }
  const cat = category || categoryOf(name);
  if (cat === "Produce") return "Produce";
  if (cat === "Snacks") return "Snacks & drinks";
  if (cat === "Dairy") return "Fridge";
  if (cat === "Frozen") return "Freezer";
  if (cat === "Bakery") return "Dry goods";
  if (cat === "Meat") return /deli|lunch meat/.test(l) ? "Fridge" : "Freezer";
  return "Dry goods"; // category 'Other' (or 'Pantry' with nothing more specific) -- the generic shelf.
}

function attachZone(row) {
  return row ? { ...row, zone: zoneOf(row) } : row;
}

/** "Home" -> "Home", anything else ("Rental", "H2", ...) -> "the {house}" -- the same real
 *  placeName() the design uses everywhere it names a house in a sentence, ported verbatim rather
 *  than reinvented so the Pantry room's own copy ("2 at Home · 1 at the Rental") reads exactly
 *  like the design. A pantry item with no house stated has no place to name -- callers check for
 *  that themselves rather than this function inventing a fallback string. */
export function placeName(house) {
  return house === "Home" ? "Home" : `the ${house}`;
}

// ---------------------------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------------------------

/** Every real pantry item on file, newest-updated first -- what the Pantry room reads. Pass house
 *  to see just what's on hand at one real hub/spoke, same filter shape as things.listThings;
 *  omit it (the Pantry room's own default fetch) for every real item across every house, since
 *  the room's own "Do we have…" search and Home/Rental toggle both need both places on hand at
 *  once. */
export async function listPantryItems(userId, { house = null } = {}) {
  const params = [userId];
  let filter = "";
  if (house) {
    params.push(house);
    filter = `AND house = $${params.length}`;
  }
  const rows = await many(
    `SELECT ${SELECT_COLUMNS}
       FROM pantry_items
      WHERE user_id = $1 ${filter}
      ORDER BY updated_at DESC`,
    params,
  );
  return rows.map(attachZone);
}

/** Real, ordered-by-category grouping -- same CAT_ORDER sequence shopping-order.mjs's own
 *  orderItems('category') groups the Shopping run by. Kept for any future category-shaped read
 *  (MCP, a future report); the Pantry room's own real UI groups by zone (PANTRY_ZONES above), not
 *  this. Empty groups are dropped, same as orderItems does. */
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
  if (exact.length === 1) return attachZone(exact[0]);
  if (exact.length > 1) return null;
  const starts = rows.filter((r) => r.name.toLowerCase().startsWith(n));
  if (starts.length === 1) return attachZone(starts[0]);
  if (starts.length > 1) return null;
  const contains = rows.filter((r) => r.name.toLowerCase().includes(n));
  return contains.length === 1 ? attachZone(contains[0]) : null;
}
export { tieredFind as findPantryItemFuzzy };

// ---------------------------------------------------------------------------------------------
// Pantry <-> the shopping run (#3316 scope items 5 + 6) -- one real definition of "the same real
// item" shared by the out-of-X capture rule (join the run, don't duplicate an already-queued
// item), the Pantry/Zone screens' own "Add to run" / "already on the run" state, and the
// checkoff-restock integration in routes/api.mjs, rather than three near-identical ones drifting
// apart. Ported verbatim from the design's own `rkey`/`pantryOnRun`/`pantryRestock`.
// ---------------------------------------------------------------------------------------------

/** The name before any comma, minus a trailing parenthetical, lowercased -- "Pasta" and a run
 *  item logged as "Pasta, 3 boxes" (or a pantry row future-noted "Pasta (Rental)") both reduce to
 *  the same real key. */
export function pantryRunKey(text) {
  return String(text || "").toLowerCase().split(",")[0].replace(/\s*\(.*\)$/, "").trim();
}

function runKeysMatch(a, b) {
  if (!a || !b) return false;
  return a === b || a.startsWith(`${b} `) || b.startsWith(`${a} `);
}

/** Is a real pantry item already on the shopping run? `runItems` is a real shopping list's own
 *  `items` array (routes/lists.mjs's getListDetail shape: `{ text, done, ... }`). */
export function isPantryItemOnRun(name, runItems) {
  const key = pantryRunKey(name);
  if (!key) return false;
  return (runItems || []).some((it) => !it.done && runKeysMatch(pantryRunKey(it.text), key));
}

/** "3 cans of X" -> 3; a run item with no stated leading count defaults to 1 -- the same real +1
 *  a Zone screen's own + button applies, never a fabricated guess. */
function extractRunQuantity(text) {
  // A true leading number ("3 cans of X") OR the design's own real trailing-note convention
  // ("Pasta, 3 boxes" -- name first, quantity after the comma, same shape pantryRunKey's own
  // comma-split assumes for matching); a run item with no stated count either way defaults to 1.
  const m = String(text || "").match(/(?:^|,\s*)(\d+(?:\.\d+)?)\b/);
  return m ? Number(m[1]) : 1;
}

/** Checking a shopping-run item off restocks the matching real Home pantry row; unchecking it
 *  reverses that same restock (#3316 scope item 6, the design's own `pantryRestock`). Scoped to
 *  Home, or a real row with no house stated yet (the same "no house bucket" this module's own
 *  upsert key already treats as real) -- never the Rental, matching the design's own explicit
 *  "restocks Home pantry" rule. A genuinely ambiguous match (more than one real row fits) does
 *  nothing rather than guess, same ladder depleteForCookCheckoff below already uses. A level item
 *  ('lvl') goes straight to Full (3) on check, and back down to at most 1 (Almost out) on
 *  uncheck -- never all the way back to Out, since unchecking doesn't know how much was really
 *  used. Returns the updated row, or null when nothing on file matches (a genuinely new item
 *  bought for the first time isn't pantry's problem to invent -- Shane still has to say "I have 2
 *  boxes of pasta" for it to actually land here). */
export async function restockHomeFromRun(userId, itemText, direction) {
  const key = pantryRunKey(itemText);
  if (!key) return null;
  const rows = await many(
    `SELECT ${SELECT_COLUMNS} FROM pantry_items WHERE user_id = $1 AND (house = 'Home' OR house IS NULL)`,
    [userId],
  );
  const matches = rows.filter((r) => runKeysMatch(pantryRunKey(r.name), key));
  if (matches.length !== 1) return null;
  const existing = matches[0];
  const next =
    existing.unit === "lvl"
      ? direction > 0
        ? 3
        : Math.min(Number(existing.quantity), 1)
      : Math.max(0, Number(existing.quantity) + extractRunQuantity(itemText) * direction);
  return attachZone(
    await one(
      `UPDATE pantry_items SET quantity = $2, updated_at = now() WHERE id = $1 RETURNING ${SELECT_COLUMNS}`,
      [existing.id, next],
    ),
  );
}

// ---------------------------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------------------------

/** State an absolute real quantity -- "I have 2 lbs of chicken breasts." Upsert on
 *  (user, lower(name), house): saying it again corrects the one real row in place. category
 *  defaults to shopping-order.mjs's own categoryOf(name) when not stated explicitly, so Pantry
 *  groups the same way Shopping already does. `lowAt` (optional) states a real per-item "running
 *  low" override -- omitted, it leaves whatever's already on file alone rather than clobbering a
 *  real override with a guessed default (see normaliseLowAt above). */
export async function setPantryQuantity(userId, { name, quantity, unit, category, house, lowAt }) {
  const n = normaliseName(name);
  const qty = normaliseQuantity(quantity);
  const u = normaliseUnit(unit);
  const h = normaliseHouse(house);
  const cat = normaliseCategory(category, n);
  const low = normaliseLowAt(lowAt);

  return attachZone(
    await one(
      `INSERT INTO pantry_items (user_id, name, quantity, unit, category, house, low_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id, lower(name), COALESCE(house, ''))
       DO UPDATE SET quantity = EXCLUDED.quantity,
                      unit = COALESCE(EXCLUDED.unit, pantry_items.unit),
                      category = EXCLUDED.category,
                      low_at = COALESCE(EXCLUDED.low_at, pantry_items.low_at),
                      updated_at = now()
       RETURNING ${SELECT_COLUMNS}`,
      [userId, n, qty, u, cat, h, low],
    ),
  );
}

/** Add a real delta on top of whatever's already on file -- "bought 3 cans of diced tomatoes."
 *  Creates the row (at exactly the stated delta) the first time this item is ever mentioned,
 *  same "the list is created if missing" idiom lists.getOrCreateListByName already uses. delta
 *  may be negative (a real, direct decrement -- e.g. a future Cook-mode integration), but never
 *  below zero: migration 068's own CHECK constraint is the backstop, this clamps first so a
 *  caller gets a clean floor rather than a raw constraint-violation error. */
export async function adjustPantryQuantity(userId, { name, delta, unit, category, house, lowAt }) {
  const n = normaliseName(name);
  const d = normaliseQuantity(delta);
  const u = normaliseUnit(unit);
  const h = normaliseHouse(house);
  const cat = normaliseCategory(category, n);
  const low = normaliseLowAt(lowAt);

  const existing = await tieredFind(userId, n, h);
  if (existing) {
    const next = Math.max(0, Number(existing.quantity) + d);
    return attachZone(
      await one(
        `UPDATE pantry_items SET quantity = $2, unit = COALESCE($3, unit), low_at = COALESCE($4, low_at), updated_at = now()
          WHERE id = $1
          RETURNING ${SELECT_COLUMNS}`,
        [existing.id, next, u, low],
      ),
    );
  }

  return attachZone(
    await one(
      `INSERT INTO pantry_items (user_id, name, quantity, unit, category, house, low_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id, lower(name), COALESCE(house, ''))
       DO UPDATE SET quantity = GREATEST(0, pantry_items.quantity + EXCLUDED.quantity),
                      unit = COALESCE(EXCLUDED.unit, pantry_items.unit),
                      low_at = COALESCE(EXCLUDED.low_at, pantry_items.low_at),
                      updated_at = now()
       RETURNING ${SELECT_COLUMNS}`,
      [userId, n, Math.max(0, d), u, cat, h, low],
    ),
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
  return attachZone(
    await one(
      `UPDATE pantry_items SET quantity = 0, updated_at = now() WHERE id = $1
       RETURNING ${SELECT_COLUMNS}`,
      [existing.id],
    ),
  );
}

/** Ownership-checked read of one real row, for a future direct edit/delete UI action. */
export async function getOwnedPantryItem(userId, itemId) {
  return attachZone(
    await one(`SELECT ${SELECT_COLUMNS} FROM pantry_items WHERE id = $1 AND user_id = $2`, [itemId, userId]),
  );
}

/** Real, direct +/- one unit adjust by id -- the Zone screen's own real -/+ buttons (#3316 scope
 *  item 3), a direct real-time write like a shopping-list checkbox tap, not a form and not a
 *  capture. Ownership-checked. Decrementing always takes exactly 1, floored at 0 (migration 068's
 *  own CHECK constraint is the backstop; this clamps first). Incrementing a level ('lvl') item
 *  jumps straight to Full (3) -- the design's own real rule: a level item's "+1" has no meaning
 *  between the four fixed rungs (Out/Almost out/Half/Full), so + resets it to Full the same way
 *  a real restock does; incrementing a plain count adds exactly 1. */
export async function adjustPantryItemById(userId, itemId, direction) {
  const owned = await getOwnedPantryItem(userId, itemId);
  if (!owned) throw notFound("Pantry item not found");
  const next = direction < 0 ? Math.max(0, Number(owned.quantity) - 1) : owned.unit === "lvl" ? 3 : Number(owned.quantity) + 1;
  return attachZone(
    await one(
      `UPDATE pantry_items SET quantity = $2, updated_at = now() WHERE id = $1 RETURNING ${SELECT_COLUMNS}`,
      [itemId, next],
    ),
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

/** Real Cook-mode ingredient-checkoff depletion (Git #3312, sub-issue of #3308's own scope item
 *  4). Shane's own real decision, recorded on #3308: silent decrement, no confirmation step --
 *  ticking a Cook-mode ingredient checkbox should just quietly take 1 off the matching real
 *  pantry row, same "trust stated facts immediately" philosophy the rest of this app already
 *  follows (contract.md Section 8).
 *
 *  Matching is the same case-insensitive, both-ways substring rule hasPantryQuantity above
 *  already uses for canMake ("chicken" <-> "chicken breasts") -- NOT tieredFind's narrower
 *  exact/starts-with/contains ladder, and deliberately not house-scoped: Cook mode has no house
 *  context to hand this from, and a real pantry item still gets decremented regardless of which
 *  house it's tracked at. Ambiguous (more than one real row matches) or genuinely nothing on
 *  file both do nothing and return null -- this never fabricates a new row the way
 *  adjustPantryQuantity's own upsert would (its "create the row the first time this item is
 *  ever mentioned" behavior is right for a real capture, but wrong here: an unmatched Cook-mode
 *  ingredient checkbox is not itself a real statement that Shane owns that ingredient). */
export async function depleteForCookCheckoff(userId, ingredientText) {
  const need = String(ingredientText || "").trim().toLowerCase();
  if (!need) return null;
  const rows = await many(
    `SELECT ${SELECT_COLUMNS} FROM pantry_items WHERE user_id = $1 AND quantity > 0`,
    [userId],
  );
  const matched = rows.filter((r) => {
    const have = r.name.toLowerCase();
    return have.includes(need) || need.includes(have);
  });
  if (matched.length !== 1) return null;
  const existing = matched[0];
  const next = Math.max(0, Number(existing.quantity) - 1);
  return attachZone(
    await one(
      `UPDATE pantry_items SET quantity = $2, updated_at = now() WHERE id = $1
        RETURNING ${SELECT_COLUMNS}`,
      [existing.id, next],
    ),
  );
}

/** Ownership-checked delete of a genuinely mistaken row -- distinct from depletePantryItem
 *  (which zeroes, keeping unit/category for the next restock): this removes the row entirely,
 *  for a real add-in-error correction. */
export async function deletePantryItem(userId, itemId) {
  const owned = await getOwnedPantryItem(userId, itemId);
  if (!owned) throw notFound("Pantry item not found");
  await query("DELETE FROM pantry_items WHERE id = $1", [itemId]);
}
