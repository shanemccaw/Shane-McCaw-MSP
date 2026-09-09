// Hub/spoke item-location memory (Git #3156, migration 016 + 031).
//
// Design handoff, capture grammar item 9: "X is in the garage" -> Things, requires a place word.
// Contract Section 8: "trust stated facts immediately" -- no confirmation dialog, and a later
// report of the same item corrects the spot in place rather than duplicating it (the same
// pattern store-aisles.mjs already uses for the same reason). `house` is the hub-and-spoke label
// (H1 / H2 / the rental / ...); a thing with no house is just "the one place it lives."

import { many, one } from "../db.mjs";
import { badRequest } from "../http.mjs";

function normaliseName(name) {
  const n = String(name || "").trim().slice(0, 200);
  if (!n) throw badRequest("name is required");
  return n;
}

function normalisePlace(place) {
  const p = String(place || "").trim().slice(0, 200);
  if (!p) throw badRequest("place is required -- a thing with no place answers nothing");
  return p;
}

function normaliseHouse(house) {
  if (house === undefined || house === null) return null;
  const h = String(house).trim().slice(0, 80);
  return h || null;
}

function normaliseNote(note) {
  if (note === undefined || note === null) return null;
  const n = String(note).trim().slice(0, 2000);
  return n || null;
}

/** Record (or correct) where a real thing is. Upsert on (user, lower(name)): saying it again
 *  moves the same row rather than leaving a stale one behind. */
export async function recordThing(userId, { name, place, house, note }) {
  const n = normaliseName(name);
  const p = normalisePlace(place);
  const h = normaliseHouse(house);
  const note_ = normaliseNote(note);

  return one(
    `INSERT INTO things (user_id, name, place, house, note)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, lower(name))
     DO UPDATE SET place = EXCLUDED.place, house = EXCLUDED.house,
                    note = COALESCE(EXCLUDED.note, things.note), updated_at = now()
     RETURNING id, name, place, house, note, created_at, updated_at`,
    [userId, n, p, h, note_],
  );
}

/** Every real thing on file, newest-said first -- what "Just logged" reads. */
export async function listThings(userId, { house = null, limit = 200 } = {}) {
  const params = [userId];
  let filter = "";
  if (house) {
    params.push(house);
    filter = `AND house = $${params.length}`;
  }
  params.push(Math.min(Number(limit) || 200, 500));
  return many(
    `SELECT id, name, place, house, note, created_at, updated_at
       FROM things
      WHERE user_id = $1 ${filter}
      ORDER BY updated_at DESC
      LIMIT $${params.length}`,
    params,
  );
}

/**
 * "Next [house] run · Take" checklist (Git #3300). `take_for_house` is the queue: a thing on
 * file for one house (the design's "supplies default to Home") that needs to ride along on the
 * next real run to another house. Grouped by destination house, since more than one run could
 * theoretically be queued at once; the design itself only ever shows one live group, so the UI
 * treats the first (only real) group as "the" next run.
 */
export async function listTakeChecklist(userId) {
  const rows = await many(
    `SELECT id, name, place, house, note, quantity, take_for_house, take_done, is_grocery, updated_at
       FROM things
      WHERE user_id = $1 AND take_for_house IS NOT NULL
      ORDER BY take_for_house ASC, take_done ASC, is_grocery ASC, lower(name) ASC`,
    [userId],
  );
  const byHouse = new Map();
  for (const row of rows) {
    if (!byHouse.has(row.take_for_house)) byHouse.set(row.take_for_house, []);
    byHouse.get(row.take_for_house).push(row);
  }
  return Array.from(byHouse, ([house, items]) => ({ house, items }));
}

/** Queue (or re-queue) a real thing on file for the next run to `takeForHouse`. Upsert-by-name
 *  like recordThing -- saying "take the drill to the rental" again just re-queues the same row.
 *  A thing genuinely not on file yet is created with `house` (its current home, default "Home")
 *  as its place -- "supplies default to Home" (Shanes Life 09 - Things.dc.html's own "Why"). */
export async function queueForTake(userId, { name, takeForHouse, quantity, isGrocery, house }) {
  const n = normaliseName(name);
  const destHouse = normaliseHouse(takeForHouse);
  if (!destHouse) throw badRequest("takeForHouse is required");
  const qty = quantity === undefined || quantity === null || quantity === "" ? null : Math.max(1, Math.trunc(Number(quantity)) || 1);
  const grocery = Boolean(isGrocery);
  const fallbackHouse = normaliseHouse(house) || "Home";

  const existing = await one(
    `SELECT id FROM things WHERE user_id = $1 AND lower(name) = lower($2)`,
    [userId, n],
  );
  if (existing) {
    return one(
      `UPDATE things
          SET take_for_house = $1, take_done = false,
              quantity = COALESCE($2, quantity), is_grocery = $3 OR is_grocery, updated_at = now()
        WHERE id = $4 AND user_id = $5
        RETURNING id, name, place, house, note, quantity, take_for_house, take_done, is_grocery, updated_at`,
      [destHouse, qty, grocery, existing.id, userId],
    );
  }
  return one(
    `INSERT INTO things (user_id, name, place, house, quantity, take_for_house, is_grocery)
     VALUES ($1, $2, $3, $3, $4, $5, $6)
     RETURNING id, name, place, house, note, quantity, take_for_house, take_done, is_grocery, updated_at`,
    [userId, n, fallbackHouse, qty, destHouse, grocery],
  );
}

/** Check (or uncheck) one take-checklist row for this run -- mirrors list_items.done, checked
 *  but not yet cleared. Ownership-checked like every other per-row thing mutation here. */
export async function setTakeDone(userId, thingId, done) {
  const row = await one(
    `UPDATE things SET take_done = $1, updated_at = now()
      WHERE id = $2 AND user_id = $3 AND take_for_house IS NOT NULL
      RETURNING id, name, place, house, note, quantity, take_for_house, take_done, is_grocery, updated_at`,
    [Boolean(done), thingId, userId],
  );
  if (!row) throw badRequest("Thing not found, or not queued for a run");
  return row;
}

/** The run actually happened: every checked-off item for `house` now really lives there --
 *  `house` moves to the destination and the queue clears, the same real-state-change the design's
 *  own Heading Out "All set" applies to that separate list (#3158). Unchecked items stay queued
 *  for next time, since they were never actually taken. Returns how many rows moved. */
export async function clearTakeRun(userId, house) {
  const h = normaliseHouse(house);
  if (!h) throw badRequest("house is required");
  const rows = await many(
    `UPDATE things
        SET house = take_for_house, take_for_house = NULL, take_done = false,
            quantity = NULL, is_grocery = false, updated_at = now()
      WHERE user_id = $1 AND take_for_house = $2 AND take_done = true
      RETURNING id`,
    [userId, h],
  );
  return rows.length;
}

/** Every distinct house a thing is on file for, so the "Lives at <house>" grouping doesn't
 *  guess at a fixed list of houses. */
export async function listHouses(userId) {
  return many(
    `SELECT house, count(*)::int AS thing_count
       FROM things
      WHERE user_id = $1 AND house IS NOT NULL
      GROUP BY house
      ORDER BY house ASC`,
    [userId],
  );
}

/** "where's the drill?" -- real, deterministic search (no AI call, per contract Section 10),
 *  case-insensitive substring either direction so "the drill" still finds "Drill". Returns the
 *  best real match, or null when genuinely nothing is on file, which is a real answer, not an
 *  error. */
export async function findThing(userId, q) {
  const query = String(q || "").trim();
  if (!query) throw badRequest("q is required");
  const rows = await many(
    `SELECT id, name, place, house, note, created_at, updated_at
       FROM things
      WHERE user_id = $1 AND (lower(name) LIKE '%' || lower($2) || '%' OR lower($2) LIKE '%' || lower(name) || '%')
      ORDER BY updated_at DESC`,
    [userId, query],
  );
  return rows[0] ?? null;
}

/** Every real match, for a real results list rather than just the single best guess. */
export async function searchThings(userId, q) {
  const query = String(q || "").trim();
  if (!query) return [];
  return many(
    `SELECT id, name, place, house, note, created_at, updated_at
       FROM things
      WHERE user_id = $1 AND lower(name) LIKE '%' || lower($2) || '%'
      ORDER BY updated_at DESC
      LIMIT 50`,
    [userId, query],
  );
}
