// Real per-user "House · Room order" preference (Git #3215, design
// `v4-settings-room-order.png` + github.md's own sync note: "Room order added as the first
// Settings card -- house order is user state here").
//
// The Today "Rooms -- the house" grid (Git #3165, roomsHouseSection() in public/app.js) has one
// fixed set of 8 real rooms. ROOM_KEYS below is the server's own copy of that same key set --
// duplicated rather than shared because this module has no browser/server shared bundle to put
// it in (same reason fmtUsd() in api.mjs is duplicated rather than imported). If a room is ever
// added or removed from ROOM_DEFS in public/app.js, this list must be updated to match.
//
// DEFAULT_ORDER is the grid's own existing shipped order -- so a user who has never touched
// Settings, or whose stored order has gone stale (a room added/removed since they last saved),
// sees exactly the layout the house grid has always rendered, not a surprise reshuffle.

import { one, query } from "../db.mjs";
import { badRequest } from "../http.mjs";

export const ROOM_KEYS = ["things", "lists", "people", "dates", "recipes", "pets", "shopping", "money"];
export const DEFAULT_ORDER = [...ROOM_KEYS];

/** Repairs a stored order against the real, current room set: drops any key that no longer
 *  exists, then appends (in default order) any real room the stored array is missing. This is
 *  what makes a schema change (a room added/removed from ROOM_KEYS) self-healing instead of
 *  quietly stale for anyone who saved an order before the change. */
function reconcile(stored) {
  if (!Array.isArray(stored)) return DEFAULT_ORDER;
  const known = stored.filter((k) => ROOM_KEYS.includes(k));
  const deduped = [...new Set(known)];
  const missing = ROOM_KEYS.filter((k) => !deduped.includes(k));
  return [...deduped, ...missing];
}

/** The user's real room order -- their saved preference, reconciled against the current real
 *  room set, or the default shipped order if they've never set one. */
export async function getRoomOrder(userId) {
  const row = await one("SELECT room_order FROM users WHERE id = $1", [userId]);
  if (!row?.room_order) return DEFAULT_ORDER;
  return reconcile(row.room_order);
}

/** Save a real, user-chosen order -- must be exactly a permutation of the real room set (Section
 *  3's "no forms" doesn't forbid validating a reorder; it forbids typed input). */
export async function setRoomOrder(userId, order) {
  if (!Array.isArray(order) || order.length !== ROOM_KEYS.length) {
    throw badRequest(`order must list all ${ROOM_KEYS.length} rooms exactly once`);
  }
  const deduped = new Set(order);
  if (deduped.size !== ROOM_KEYS.length || ROOM_KEYS.some((k) => !deduped.has(k))) {
    throw badRequest(`order must be a permutation of: ${ROOM_KEYS.join(", ")}`);
  }
  await query("UPDATE users SET room_order = $2::jsonb WHERE id = $1", [userId, JSON.stringify(order)]);
  return order;
}

/** "Reset to the default order" -- clears the stored preference so getRoomOrder() falls back to
 *  DEFAULT_ORDER again, rather than writing DEFAULT_ORDER itself (keeps "never set" and "reset"
 *  indistinguishable in storage, which is exactly right -- both mean "use the shipped order"). */
export async function resetRoomOrder(userId) {
  await query("UPDATE users SET room_order = NULL WHERE id = $1", [userId]);
  return DEFAULT_ORDER;
}
