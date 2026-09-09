// Real "where Shane last said he's heading" state (Git #3320, Feature #3220, migration 071).
//
// One current fact per user, not a log -- the command tray's "heading to X" capture-grammar rule
// (capture-grammar.mjs) sets this the instant the phrase is captured, same "trust stated facts
// immediately" discipline (contract Section 8) the rest of this app already applies. Read by the
// rule itself (to phrase "fromWork" correctly), by the command tray's own GET /api/capture-tray
// (for the "you said you're heading to X" quickHead line), and -- since Git #3325 -- by
// computeLaterMoments (api.mjs) for the Today tray's own Trip act row, which is what actually
// clears this fact on arrival/cancel via clearHeadingTo below (the design prototype's own
// `st.where` vs `st.trip` two-stage model, `st.trip` half). There is still no separate history of
// past transitions -- one current fact, overwritten or cleared, never logged.

import { one, query } from "../db.mjs";

const KNOWN_HOUSES = new Set(["work", "rental", "home"]);

function normaliseHouse(house) {
  const h = String(house || "").trim().toLowerCase();
  return KNOWN_HOUSES.has(h) ? h : null;
}

/** The real, current "heading to" fact on file for this user, or null if none has ever been
 *  stated. `staleAfterMs`, if given, treats a fact older than that as no longer current -- the
 *  same honest "don't claim certainty past its shelf life" the rest of this app applies (e.g.
 *  tesla.getPreconditioningStatus's own DEDUPE_WINDOW_MINUTES). */
export async function getHeadingTo(userId, { staleAfterMs = null } = {}) {
  const row = await one("SELECT heading_to, heading_to_at FROM users WHERE id = $1", [userId]);
  if (!row?.heading_to) return null;
  const at = row.heading_to_at ? new Date(row.heading_to_at) : null;
  if (staleAfterMs != null && at && Date.now() - at.getTime() > staleAfterMs) return null;
  return { house: row.heading_to, at: at ? at.toISOString() : null };
}

/** Record the real, current "heading to" fact -- overwrites whatever was there before, since this
 *  is one current fact, not a history. `house` must be one of the real, closed 'work' | 'rental' |
 *  'home' vocabulary (see capture-grammar.mjs's normaliseHeadingDestination); anything else is a
 *  caller bug, not a real user input to reject gracefully, so it throws rather than silently
 *  storing garbage a later read can't make sense of. */
export async function setHeadingTo(userId, house) {
  const h = normaliseHouse(house);
  if (!h) throw new Error(`setHeadingTo: "${house}" is not a real destination (work | rental | home)`);
  await query("UPDATE users SET heading_to = $2, heading_to_at = now() WHERE id = $1", [userId, h]);
  return { house: h };
}

/** Clear the real "heading to" fact -- arrival confirmed, or the trip was cancelled/mistaken
 *  (Git #3325, the Today tray's own Trip card). Idempotent: clearing when nothing is on file is
 *  a no-op, not an error -- a double-tap on Confirm/Cancel, or a card the client hadn't yet
 *  re-rendered away, must never fail here. */
export async function clearHeadingTo(userId) {
  await query("UPDATE users SET heading_to = NULL, heading_to_at = NULL WHERE id = $1", [userId]);
}
