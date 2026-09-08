// Real food preferences -- dislikes (soft) and allergies (hard) (Git #3132, foundational
// sub-issue of #3086; the Recipes Sunday-ritual Feature is blocked_by this one).
//
// Contract pack Section 5's own recipe-generation order names this real, deliberate
// distinction: `allergies` is a hard exclusion, never suggested, no exceptions, safety-grade,
// same seriousness as the already-locked heart-health context. `dislikes` is a soft avoid --
// fine for a plan to still surface one occasionally with a real stated reason. One row per
// user, same "stated once, respected everywhere forever" pattern as everything else here
// (Section 8), and the same real "unset fields keep their current value, additive not
// destructive" upsert shape ShanesSurvival's `set_income_source` uses.

import { one } from "../db.mjs";
import { badRequest } from "../http.mjs";

const MAX_ITEMS = 100;
const MAX_ITEM_LEN = 200;

const EMPTY = Object.freeze({ dislikes: [], allergies: [], updated_at: null });

/** Trim/cap each entry, drop empties. Returns `undefined` untouched -- that is how a caller
 *  signals "leave this field alone" (matches `set_income_source`'s unset-keeps-current shape). */
function normaliseList(input, label) {
  if (input === undefined) return undefined;
  if (!Array.isArray(input)) throw badRequest(`${label} must be an array of strings`);
  return input.map((s) => String(s ?? "").trim().slice(0, MAX_ITEM_LEN)).filter(Boolean);
}

/** Additive merge: existing items are never dropped by a later call. Case-insensitive dedupe
 *  (existing casing wins) is what makes "I'm allergic to shellfish" said twice not create two
 *  rows -- the same real problem #3132's own spec calls out ("adding one item doesn't wipe the
 *  rest"). */
function mergeAdditive(existing, incoming) {
  const seen = new Set(existing.map((s) => s.toLowerCase()));
  const merged = [...existing];
  for (const item of incoming) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged.slice(0, MAX_ITEMS);
}

/** Real, current preferences for one user. Never throws for "none stated yet" -- returns the
 *  real empty shape so callers (recipe/list generation) always have something to check against. */
export async function getFoodPreferences(userId) {
  const row = await one(
    `SELECT dislikes, allergies, updated_at FROM food_preferences WHERE user_id = $1`,
    [userId],
  );
  return row || EMPTY;
}

/** Additive write. Passing `dislikes` alone leaves `allergies` completely untouched, and vice
 *  versa -- omitting a field is not the same as clearing it. There is deliberately no "replace"
 *  or "remove one" mode here: this is a hard-safety list, not a list Claude should ever be able
 *  to shrink from a single ambiguous conversational turn. */
export async function setFoodPreferences(userId, { dislikes, allergies } = {}) {
  const newDislikes = normaliseList(dislikes, "dislikes");
  const newAllergies = normaliseList(allergies, "allergies");
  if (newDislikes === undefined && newAllergies === undefined) {
    throw badRequest("at least one of dislikes/allergies is required");
  }

  const current = await getFoodPreferences(userId);
  const finalDislikes = newDislikes === undefined ? current.dislikes : mergeAdditive(current.dislikes, newDislikes);
  const finalAllergies = newAllergies === undefined ? current.allergies : mergeAdditive(current.allergies, newAllergies);

  return one(
    `INSERT INTO food_preferences (user_id, dislikes, allergies, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (user_id)
     DO UPDATE SET dislikes = EXCLUDED.dislikes, allergies = EXCLUDED.allergies, updated_at = now()
     RETURNING dislikes, allergies, updated_at`,
    [userId, finalDislikes, finalAllergies],
  );
}
