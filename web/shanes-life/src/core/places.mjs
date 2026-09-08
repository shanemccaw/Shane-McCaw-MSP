// Real physical places + foreground nearby-matching (Git #3159, migration 037).
//
// See docs/location-aware-content-surfacing-findings.md for the real investigation this is
// built on. Short version: a Home Screen web app cannot detect arrival at a place in the
// background -- there is no browser API for that on iOS or Android. What this module gives is
// the honest, buildable half: given a real current position (the app asking, in the
// foreground, right now), which saved real place -- if any -- is Shane standing in.
//
// A place is never created through a dedicated form (Section 3, "no forms, anywhere, ever").
// It comes from `push_place` (src/mcp/tools.mjs), which Claude calls after reading a geo-tagged
// capture -- "remember this as Home", said while the real coordinates rode along silently on
// that capture (captures.latitude/longitude, migration 037).

import { many, one } from "../db.mjs";
import { badRequest } from "../http.mjs";

function normaliseLabel(label) {
  const l = String(label || "").trim().slice(0, 120);
  if (!l) throw badRequest("label is required");
  return l;
}

function normaliseCoord(value, name, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw badRequest(`${name} must be a real number between ${min} and ${max}`);
  }
  return n;
}

function normaliseRadius(value) {
  if (value === undefined || value === null) return 150;
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n < 20 || n > 5000) {
    throw badRequest("radiusMeters must be between 20 and 5000");
  }
  return n;
}

function normaliseNote(note) {
  if (note === undefined || note === null) return null;
  const n = String(note).trim().slice(0, 500);
  return n || null;
}

/** File (or re-center) a real named place. Upsert on (user, lower(label)) -- saying "remember
 *  this as Home" again from a new real position corrects the same place rather than duplicating
 *  it, same pattern as things.recordThing / store-aisles. */
export async function upsertPlace(userId, { label, latitude, longitude, radiusMeters, note, createdBy = "claude" }) {
  const l = normaliseLabel(label);
  const lat = normaliseCoord(latitude, "latitude", -90, 90);
  const lng = normaliseCoord(longitude, "longitude", -180, 180);
  const radius = normaliseRadius(radiusMeters);
  const note_ = normaliseNote(note);
  const by = createdBy === "shane" ? "shane" : "claude";

  return one(
    `INSERT INTO places (user_id, label, latitude, longitude, radius_meters, note, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (user_id, lower(label))
     DO UPDATE SET latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
                    radius_meters = EXCLUDED.radius_meters,
                    note = COALESCE(EXCLUDED.note, places.note), updated_at = now()
     RETURNING id, label, latitude, longitude, radius_meters, note, created_by, created_at, updated_at`,
    [userId, l, lat, lng, radius, note_, by],
  );
}

/** Every real place on file, newest-updated first. */
export async function listPlaces(userId) {
  return many(
    `SELECT id, label, latitude, longitude, radius_meters, note, created_by, created_at, updated_at
       FROM places
      WHERE user_id = $1
      ORDER BY updated_at DESC`,
    [userId],
  );
}

export async function deletePlace(userId, id) {
  const row = await one(`DELETE FROM places WHERE id = $1 AND user_id = $2 RETURNING id`, [id, userId]);
  if (!row) throw badRequest("Place not found");
  return row;
}

/** Real places whose radius actually contains a real given position, nearest first. Haversine
 *  distance in meters -- no PostGIS/earthdistance extension needed for a handful of rows per
 *  user. Deliberately a plain foreground query: called when the app is open and asking right
 *  now, never a background job (there is no background position to ask for -- see the findings
 *  doc). */
export async function findNearby(userId, { latitude, longitude }) {
  const lat = normaliseCoord(latitude, "latitude", -90, 90);
  const lng = normaliseCoord(longitude, "longitude", -180, 180);

  return many(
    `SELECT id, label, note, radius_meters, distance_meters
       FROM (
         SELECT id, label, note, radius_meters,
                6371000 * acos(
                  LEAST(1, GREATEST(-1,
                    cos(radians($2)) * cos(radians(latitude)) * cos(radians(longitude) - radians($3))
                    + sin(radians($2)) * sin(radians(latitude))
                  ))
                ) AS distance_meters
           FROM places
          WHERE user_id = $1
       ) d
      WHERE distance_meters <= radius_meters
      ORDER BY distance_meters ASC`,
    [userId, lat, lng],
  );
}
