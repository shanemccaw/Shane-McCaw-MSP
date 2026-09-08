// Real physical places + foreground nearby-matching (Git #3159, migration 040).
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
// that capture (captures.latitude/longitude, migration 040).

import { many, one, query } from "../db.mjs";
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

/** places.house / things.house / money.mjs's BILL_CATEGORIES share one real, open vocabulary
 *  for Shane's own houses (his own word -- "h1", "h2", not an enum). Nullable: most places
 *  (Walmart, NASA) are not a house at all. */
function normaliseHouse(house) {
  if (house === undefined || house === null) return null;
  const h = String(house).trim().toLowerCase().slice(0, 80);
  return h || null;
}

/** File (or re-center) a real named place. Upsert on (user, lower(label)) -- saying "remember
 *  this as Home" again from a new real position corrects the same place rather than duplicating
 *  it, same pattern as things.recordThing / store-aisles. `house`, if given, tags this place as
 *  one of Shane's own real houses (Git #3216) -- omit it (or pass null) to leave an existing
 *  tag alone rather than clearing it on every re-center. */
export async function upsertPlace(userId, { label, latitude, longitude, radiusMeters, note, house, createdBy = "claude" }) {
  const l = normaliseLabel(label);
  const lat = normaliseCoord(latitude, "latitude", -90, 90);
  const lng = normaliseCoord(longitude, "longitude", -180, 180);
  const radius = normaliseRadius(radiusMeters);
  const note_ = normaliseNote(note);
  const house_ = normaliseHouse(house);
  const by = createdBy === "shane" ? "shane" : "claude";

  return one(
    `INSERT INTO places (user_id, label, latitude, longitude, radius_meters, note, house, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (user_id, lower(label))
     DO UPDATE SET latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
                    radius_meters = EXCLUDED.radius_meters,
                    note = COALESCE(EXCLUDED.note, places.note),
                    house = COALESCE(EXCLUDED.house, places.house), updated_at = now()
     RETURNING id, label, latitude, longitude, radius_meters, note, house, created_by, created_at, updated_at`,
    [userId, l, lat, lng, radius, note_, house_, by],
  );
}

/** Every real place on file, newest-updated first. */
export async function listPlaces(userId) {
  return many(
    `SELECT id, label, latitude, longitude, radius_meters, note, house, created_by, created_at, updated_at
       FROM places
      WHERE user_id = $1
      ORDER BY updated_at DESC`,
    [userId],
  );
}

/** The real place tagged as a given house -- e.g. the actual real-world coordinates a Heading
 *  Home command should navigate to for "h1". Null if that house has no place on file yet. */
export async function findByHouse(userId, house) {
  const h = normaliseHouse(house);
  if (!h) return null;
  return one(
    `SELECT id, label, latitude, longitude, radius_meters, note, house
       FROM places WHERE user_id = $1 AND house = $2
      ORDER BY updated_at DESC LIMIT 1`,
    [userId, h],
  );
}

/** Every real house-tagged place on file, for the Heading Home action's real one-tap
 *  alternative -- "not H1? here's H2" -- listing whatever real houses are actually on file
 *  rather than assuming exactly two exist. */
export async function listHouses(userId) {
  return many(
    `SELECT DISTINCT ON (house) house, id, label
       FROM places WHERE user_id = $1 AND house IS NOT NULL
       ORDER BY house, updated_at DESC`,
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
    `SELECT id, label, note, house, radius_meters, distance_meters
       FROM (
         SELECT id, label, note, house, radius_meters,
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

// ---------------------------------------------------------------------------------------------
// Presence + "which home" (Git #3216) -- the real, server-tracked signal /widget's stateless
// page needs, since it can never take a live GPS read of its own (see routes/widget.mjs's own
// header). Updated as a side effect of the existing /api/places/nearby check the foreground app
// already makes on every Today open (Git #3159) -- no new geolocation call anywhere.
// ---------------------------------------------------------------------------------------------

/** Record the real place (if any) the foreground app just found Shane nearest to, and derive
 *  the real "which home" recommendation from it: the moment `current_house` changes AWAY from a
 *  house, that house becomes `last_house` -- a real, observed departure, not a guess. Returns the
 *  resulting state so the caller (the /api/places/nearby route) can reuse it without a second
 *  query. `top` is `findNearby`'s own first row, or null when nothing matched. */
export async function recordPresence(userId, top) {
  const prev = await one(
    `SELECT current_house, last_house, last_house_at FROM presence_state WHERE user_id = $1`,
    [userId],
  );
  const currentHouse = top?.house || null;
  let lastHouse = prev?.last_house ?? null;
  let lastHouseAt = prev?.last_house_at ?? null;
  if (prev?.current_house && prev.current_house !== currentHouse) {
    lastHouse = prev.current_house;
    lastHouseAt = new Date();
  }

  return one(
    `INSERT INTO presence_state
       (user_id, current_place_id, current_place_label, current_house, last_house, last_house_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (user_id) DO UPDATE SET
       current_place_id = EXCLUDED.current_place_id, current_place_label = EXCLUDED.current_place_label,
       current_house = EXCLUDED.current_house, last_house = EXCLUDED.last_house,
       last_house_at = EXCLUDED.last_house_at, updated_at = now()
     RETURNING user_id, current_place_id, current_place_label, current_house, last_house,
               last_house_at, last_triggered_at, updated_at`,
    [userId, top?.id ?? null, top?.label ?? null, currentHouse, lastHouse, lastHouseAt],
  );
}

export async function getPresenceState(userId) {
  return one(`SELECT * FROM presence_state WHERE user_id = $1`, [userId]);
}

/** Real, honest "should the Heading Home action show right now" check for the widget/Next card:
 *  Shane is currently away from every known house (current_house is null -- covers both "at a
 *  known non-house place like Work" and "matched no saved place at all"), AND a real house is
 *  known to recommend. Explicit, stated interpretation (no dedicated "Work" place concept exists
 *  yet to check against more narrowly) -- see build-journal/3216.md. */
export async function headingHomeSignal(userId) {
  const state = await getPresenceState(userId);
  if (!state || state.current_house || !state.last_house) return null;
  return { recommendedHouse: state.last_house, since: state.last_house_at, currentPlaceLabel: state.current_place_label };
}

const TRIGGER_DEDUPE_MINUTES = 10;

/** Whether a real Heading Home command was already sent recently enough that firing again would
 *  just be a repeat tap/refresh, not a genuinely new "heading home" moment -- same dedupe
 *  reasoning tesla.mjs's own hook-event handler already applies to the inbound webhook. */
export async function recentlyTriggeredHeadingHome(userId) {
  const state = await getPresenceState(userId);
  if (!state?.last_triggered_at) return false;
  return Date.now() - new Date(state.last_triggered_at).getTime() < TRIGGER_DEDUPE_MINUTES * 60_000;
}

export async function markHeadingHomeTriggered(userId) {
  await query(
    `INSERT INTO presence_state (user_id, last_triggered_at, updated_at) VALUES ($1, now(), now())
     ON CONFLICT (user_id) DO UPDATE SET last_triggered_at = now(), updated_at = now()`,
    [userId],
  );
}
