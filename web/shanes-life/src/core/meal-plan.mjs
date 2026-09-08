// Real Sunday meal-planning ritual + Today surfacing (Git #3127, sub-issue of #3086's Feature:
// Recipes, blocked_by #3124 (core list + can-make matching) and #3132 (food preferences)).
//
// Contract pack Section 5's real superseding update, last paragraph: "Sundays, Shane works with
// Claude to build the week's real recipe list and meal plan (same Claude + MCP generation
// pattern as Shopping). That plan then surfaces on the Today view as simple, real, moment-based
// nudges -- 'ready to make dinner,' 'don't forget to make lunch for tomorrow' -- never as a
// calendar to browse." Same division of labor as recipes.mjs: this module never decides what to
// cook or when Sunday planning happens -- it stores what Claude wrote down for which day, and
// reads back only "today" and "tomorrow" against the server's own clock, same discipline
// api.mjs's serverDateKey() already uses for the critter roll so every device agrees.
//
// Explicitly NOT here, per #3127's own scope and #3124's sibling-feature carve-out: Cook mode,
// multi-dish timing/the "Tonight" cook-along state machine. The "Tonight" teaser this module
// serves is a single, real read of what's planned for today -- a label, not a timer.

import { many, one, query } from "../db.mjs";
import { badRequest, notFound } from "../http.mjs";

const MAX_ENTRIES_PER_CALL = 60; // a two-week plan at 3 meals/day, with headroom
const MEAL_TYPES = new Set(["breakfast", "lunch", "dinner"]);

/** Zero-padded ISO date (YYYY-MM-DD) from the SERVER's own clock -- deliberately padded, unlike
 *  api.mjs's serverDateKey() (which formats for a critter-roll hash, not a real SQL `date`
 *  comparison). Every "today"/"tomorrow" read in this module goes through this, never the
 *  client's clock or timezone. */
function serverIsoDate(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function normaliseDate(value) {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw badRequest("date must be YYYY-MM-DD");
  return text;
}

function normaliseMealType(value) {
  const type = String(value || "dinner").trim().toLowerCase();
  if (!MEAL_TYPES.has(type)) throw badRequest("mealType must be one of breakfast, lunch, dinner");
  return type;
}

const ROW_SELECT = `
  SELECT mp.id, mp.plan_date, mp.meal_type, mp.recipe_id, mp.dish_text, mp.notes,
         mp.created_by, mp.created_at, mp.updated_at,
         r.name AS recipe_name, r.time_text AS recipe_time_text
    FROM meal_plan_entries mp
    LEFT JOIN recipes r ON r.id = mp.recipe_id AND r.archived_at IS NULL`;

function shapeRow(row) {
  return {
    id: row.id,
    date: row.plan_date instanceof Date ? row.plan_date.toISOString().slice(0, 10) : row.plan_date,
    mealType: row.meal_type,
    recipeId: row.recipe_id,
    // The real, displayable dish name: Claude's own free-text label if it gave one, otherwise
    // whatever the linked recipe is called -- a plan entry always has SOMETHING to show, per the
    // design's own "ready to make dinner" nudge line needing a real dish name to name.
    dishText: row.dish_text || row.recipe_name || null,
    recipeName: row.recipe_name || null,
    recipeTimeText: row.recipe_time_text || null,
    notes: row.notes,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Ownership check + the raw row. */
async function getOwnedEntry(userId, entryId) {
  return one(
    `SELECT id FROM meal_plan_entries WHERE id = $1 AND user_id = $2 AND archived_at IS NULL`,
    [entryId, userId],
  );
}

/**
 * Push a batch of plan entries in one call -- the Sunday ritual's real entry point, mirroring
 * push_recipes'/push_list's shape. `replace: true` archives every existing real, un-passed
 * future entry first (a fresh week replacing whatever was there); leave false to add onto what's
 * already planned. Replace only touches entries dated today or later -- a fresh Sunday plan has
 * no business erasing the record of what was actually eaten earlier in the week.
 */
export async function pushMealPlan(userId, entries, { replace = false } = {}) {
  if (!Array.isArray(entries) || entries.length === 0) throw badRequest("entries must be a non-empty array");
  if (entries.length > MAX_ENTRIES_PER_CALL) throw badRequest(`entries must contain at most ${MAX_ENTRIES_PER_CALL} entries`);

  const clean = entries.map((e, i) => {
    const date = normaliseDate(e.date);
    const mealType = normaliseMealType(e.mealType ?? e.meal ?? "dinner");
    const dishText = e.dishText ?? e.dish ?? null;
    const recipeId = e.recipeId ?? null;
    if (!recipeId && !dishText) throw badRequest(`entries[${i}] needs recipeId and/or dishText`);
    return {
      date,
      mealType,
      recipeId,
      dishText: dishText ? String(dishText).trim().slice(0, 200) : null,
      notes: e.notes ? String(e.notes).trim().slice(0, 2000) : null,
    };
  });

  if (replace) {
    await query(
      `UPDATE meal_plan_entries SET archived_at = now()
        WHERE user_id = $1 AND archived_at IS NULL AND plan_date >= $2`,
      [userId, serverIsoDate(0)],
    );
  }

  const created = [];
  for (const e of clean) {
    if (e.recipeId) {
      const owned = await one(`SELECT id FROM recipes WHERE id = $1 AND user_id = $2 AND archived_at IS NULL`, [e.recipeId, userId]);
      if (!owned) throw badRequest(`recipeId ${e.recipeId} is not a real saved recipe`);
    }
    const row = await one(
      `INSERT INTO meal_plan_entries (user_id, plan_date, meal_type, recipe_id, dish_text, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,'claude')
       RETURNING id`,
      [userId, e.date, e.mealType, e.recipeId, e.dishText, e.notes],
    );
    created.push(row.id);
  }

  return listMealPlan(userId, { from: null, to: null, ids: created });
}

/** The real plan, optionally windowed to a date range -- used for "this week's plan" display and
 *  by pushMealPlan to hand back what it just created, shaped the same way. */
export async function listMealPlan(userId, { from, to, ids } = {}) {
  const clauses = ["mp.user_id = $1", "mp.archived_at IS NULL"];
  const params = [userId];
  if (ids) {
    params.push(ids);
    clauses.push(`mp.id = ANY($${params.length})`);
  } else {
    if (from) {
      params.push(normaliseDate(from));
      clauses.push(`mp.plan_date >= $${params.length}`);
    }
    if (to) {
      params.push(normaliseDate(to));
      clauses.push(`mp.plan_date <= $${params.length}`);
    }
  }
  const rows = await many(
    `${ROW_SELECT} WHERE ${clauses.join(" AND ")} ORDER BY mp.plan_date ASC, mp.meal_type ASC`,
    params,
  );
  return rows.map(shapeRow);
}

/** Delete (archive) a plan entry Shane no longer wants -- correcting a bad push, same "archive
 *  don't hard-delete" idiom recipes.mjs's archiveRecipe already uses. */
export async function archiveMealPlanEntry(userId, entryId) {
  const owned = await getOwnedEntry(userId, entryId);
  if (!owned) throw notFound("Meal plan entry not found");
  await query("UPDATE meal_plan_entries SET archived_at = now() WHERE id = $1", [entryId]);
}

/**
 * Real, moment-based Today-tray nudges (#3127 scope item 2) -- "ready to make dinner," "don't
 * forget to make lunch for tomorrow" -- read straight off the plan for today and tomorrow, never
 * a calendar to browse. At most one nudge per (today dinner, today lunch not yet passed,
 * tomorrow's first meal) so this stays a short list, matching "Today view shows only what's
 * next" (Section 3/8).
 */
export async function getTodayNudges(userId) {
  const today = serverIsoDate(0);
  const tomorrow = serverIsoDate(1);
  const rows = await many(
    `${ROW_SELECT} WHERE mp.user_id = $1 AND mp.archived_at IS NULL AND mp.plan_date IN ($2, $3)
      ORDER BY mp.plan_date ASC, mp.meal_type ASC`,
    [userId, today, tomorrow],
  );
  const entries = rows.map(shapeRow);
  const todays = entries.filter((e) => e.date === today);
  const tomorrows = entries.filter((e) => e.date === tomorrow);

  const nudges = [];
  const dinnerToday = todays.find((e) => e.mealType === "dinner");
  if (dinnerToday) {
    nudges.push({ kind: "cook", mealType: "dinner", date: today, entryId: dinnerToday.id, dishText: dinnerToday.dishText, recipeId: dinnerToday.recipeId, text: `Ready to make dinner: ${dinnerToday.dishText}` });
  }
  const lunchToday = todays.find((e) => e.mealType === "lunch");
  if (lunchToday) {
    nudges.push({ kind: "cook", mealType: "lunch", date: today, entryId: lunchToday.id, dishText: lunchToday.dishText, recipeId: lunchToday.recipeId, text: `Ready to make lunch: ${lunchToday.dishText}` });
  }
  // "don't forget to make lunch for tomorrow" -- the design's own exact example nudge; dinner
  // isn't given the same day-ahead treatment because tonight's own dinner nudge already covers
  // it moment-by-moment the same evening.
  const lunchTomorrow = tomorrows.find((e) => e.mealType === "lunch");
  if (lunchTomorrow) {
    nudges.push({ kind: "prep", mealType: "lunch", date: tomorrow, entryId: lunchTomorrow.id, dishText: lunchTomorrow.dishText, recipeId: lunchTomorrow.recipeId, text: `Don't forget to make lunch for tomorrow: ${lunchTomorrow.dishText}` });
  }

  return { nudges, tonight: dinnerToday || null };
}
