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
