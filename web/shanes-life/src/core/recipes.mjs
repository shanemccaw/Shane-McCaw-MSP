// Recipes -- core list + ingredient matching (Git #3124, sub-issue of #3086, blocked_by #3088).
//
// Contract pack Section 5's real superseding update: Recipes are "populated by Claude-generated
// content pushed in via MCP ... the app's job is to host, display, and let Shane check items
// off" -- same division of labor as Shopping (lists.mjs). This module never generates a recipe
// itself; it stores what Claude wrote, matches it against the one real Shopping run, and moves
// missing ingredients onto that run when asked.
//
// Real scope, per #3124: (1) the list itself -- name/time/needs, (2) a real can-make status per
// recipe matched against what's currently on the Shopping run, (3) "Add missing" onto that same
// run, (4) real heart-healthy context, stated once and read by Claude before it generates.
// Explicitly NOT here (at #3124 time): Cook mode, Tonight (multi-dish timing), the Sunday
// ritual -- each its own separate, real sibling Feature under #3086.
//
// Git #3126 (Tonight, multi-dish synchronized cooking) is the first real consumer of
// `cook_minutes` -- a recipe's own real total cook time in minutes, the one number the
// prototype's own sync math (`MEAL_TOTAL = max(dish.min)`, each dish's start-offset
// `MEAL_TOTAL - dish.min`) needs and neither `time_text` (free prose) nor `steps` supplies.
// Nullable: a recipe with no `cook_minutes` set just isn't eligible to be picked as a Tonight
// dish (see migration 028's own real reasoning).

import { many, one, query } from "../db.mjs";
import { badRequest, notFound } from "../http.mjs";
import { getOrCreateShoppingList, addListItems, getListDetail } from "./lists.mjs";
import { listPantryItems } from "./pantry.mjs";

const MAX_RECIPES_PER_CALL = 100;
const MAX_NEEDS_PER_RECIPE = 60;
const MAX_STEPS_PER_RECIPE = 60;

/** Same case-insensitive, both-ways substring match prices.mjs's weekly-ad verdicts use
 *  (Git #3110) -- one side is Claude's recipe-generated ingredient text, the other is Shane's
 *  own capture-grammar wording on the Shopping run ("milk" should match "whole milk" either
 *  direction). */
function normalise(text) {
  return String(text || "").trim().toLowerCase();
}

function matches(a, b) {
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
}

function normaliseNeeds(needs) {
  if (needs === undefined || needs === null) return [];
  if (!Array.isArray(needs)) throw badRequest("needs must be an array of strings");
  if (needs.length > MAX_NEEDS_PER_RECIPE) throw badRequest(`needs must contain at most ${MAX_NEEDS_PER_RECIPE} entries`);
  return needs.map((n, i) => {
    const text = String(n ?? "").trim();
    if (!text) throw badRequest(`needs[${i}] is empty`);
    return text.slice(0, 200);
  });
}

const MAX_STEP_INGS = 30;

/** A step is either a bare string (how #3124 stored them, before anything read `ings`) or a real
 *  `{ text, ings }` object matching the design's own seed shape (contract pack prototype's
 *  `RECIPES` data: `{ text: '...', ings: ['Alfredo sauce, 1 jar', ...] }`). Cook mode (#3125) is
 *  what actually reads `ings` -- the per-step ingredients Shane checks off while cooking that
 *  step, "unchecked ingredients never block Next" per the design's own locked line -- so this is
 *  the first real consumer normalising both shapes into one, rather than a schema change: `steps`
 *  is still the same jsonb column, just carrying its real intended shape now that something reads
 *  the ings half of it.
 */
function normaliseSteps(steps) {
  if (steps === undefined || steps === null) return [];
  if (!Array.isArray(steps)) throw badRequest("steps must be an array of strings or {text, ings} objects");
  if (steps.length > MAX_STEPS_PER_RECIPE) throw badRequest(`steps must contain at most ${MAX_STEPS_PER_RECIPE} entries`);
  return steps.map((s, i) => {
    const raw = typeof s === "string" ? { text: s } : s && typeof s === "object" ? s : {};
    const text = String(raw.text ?? "").trim();
    if (!text) throw badRequest(`steps[${i}] is empty`);
    const ings = Array.isArray(raw.ings)
      ? raw.ings
          .slice(0, MAX_STEP_INGS)
          .map((g) => String(g ?? "").trim())
          .filter(Boolean)
      : [];
    return { text: text.slice(0, 2000), ings: ings.map((g) => g.slice(0, 200)) };
  });
}

/** `cook_minutes` (Git #3126) -- a recipe's own real total cook time, in whole minutes, used only
 *  for Tonight's synchronized start-offset math. Undefined/null clears it (not Tonight-eligible);
 *  anything else must be a real positive integer -- the same constraint migration 028 enforces at
 *  the database level, checked here too so a bad push fails with a real message, not a raw
 *  constraint-violation error. */
function normaliseCookMinutes(cookMinutes) {
  if (cookMinutes === undefined || cookMinutes === null || cookMinutes === "") return null;
  const n = Number(cookMinutes);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    throw badRequest("cookMinutes must be a positive whole number of minutes, or null");
  }
  return n;
}

/** Ownership check + the raw row, used by every other export here. */
export async function getOwnedRecipe(userId, recipeId) {
  return one(
    `SELECT id, name, time_text, needs, steps, heart_healthy, cook_minutes, created_by, created_at, updated_at
       FROM recipes WHERE id = $1 AND user_id = $2 AND archived_at IS NULL`,
    [recipeId, userId],
  );
}

/** Create one real recipe. `createdBy` defaults to 'claude' -- the design's own real generation
 *  path (Section 5); a manually-typed recipe from the web UI passes 'shane'. */
export async function createRecipe(userId, { name, timeText, needs, steps, heartHealthy, cookMinutes, createdBy = "claude" }) {
  const cleanName = String(name || "").trim().slice(0, 200);
  if (!cleanName) throw badRequest("name is required");
  const row = await one(
    `INSERT INTO recipes (user_id, name, time_text, needs, steps, heart_healthy, cook_minutes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id, name, time_text, needs, steps, heart_healthy, cook_minutes, created_by, created_at, updated_at`,
    [
      userId,
      cleanName,
      timeText ? String(timeText).trim().slice(0, 200) : null,
      normaliseNeeds(needs),
      JSON.stringify(normaliseSteps(steps)),
      Boolean(heartHealthy),
      normaliseCookMinutes(cookMinutes),
      createdBy === "shane" ? "shane" : "claude",
    ],
  );
  return row;
}

/** Push a batch of recipes in one call -- push_recipes' (MCP) real entry point, mirroring
 *  push_list's shape. `replace: true` archives every existing real recipe first (a fresh
 *  Claude-generated set replacing the old one), same "fresh run" semantics as
 *  lists.replaceListItems; leave false to add onto what's already saved. */
export async function pushRecipes(userId, recipes, { replace = false } = {}) {
  if (!Array.isArray(recipes)) throw badRequest("recipes must be a non-empty array");
  if (recipes.length === 0 && !replace) throw badRequest("recipes must be a non-empty array");
  if (recipes.length > MAX_RECIPES_PER_CALL) throw badRequest(`recipes must contain at most ${MAX_RECIPES_PER_CALL} entries`);

  if (replace) {
    await query("UPDATE recipes SET archived_at = now() WHERE user_id = $1 AND archived_at IS NULL", [userId]);
  }

  const created = [];
  for (const r of recipes) {
    created.push(
      await createRecipe(userId, {
        name: r.name,
        timeText: r.timeText ?? r.time,
        needs: r.needs,
        steps: r.steps,
        heartHealthy: r.heartHealthy,
        cookMinutes: r.cookMinutes,
        createdBy: "claude",
      }),
    );
  }
  return created;
}

/** Delete (archive) a recipe Shane no longer wants kept -- correcting a bad push, same "archive
 *  don't hard-delete" idiom lists.mjs's clear-checked leaves the parent list row alone for. */
export async function archiveRecipe(userId, recipeId) {
  const owned = await getOwnedRecipe(userId, recipeId);
  if (!owned) throw notFound("Recipe not found");
  await query("UPDATE recipes SET archived_at = now() WHERE id = $1", [recipeId]);
}

/**
 * Real "do we already have this" check, shared by listRecipesWithMatch and addMissingIngredients
 * below (#3308's own scope item 3): a need counts as had when it's either on the current
 * Shopping run OR sitting in real pantry inventory at a real quantity > 0 -- the pantry cut is
 * reversed (contract.md Section 5's 2026-09-09 update), so canMake must actually reflect what's
 * already at home, not just what's freshly on the list. Same case-insensitive, both-ways
 * substring match() either source already uses (Git #3110), so "chicken" on a pantry row named
 * "chicken breasts" still counts, same as it already does against a Shopping run item.
 */
async function buildHaveChecker(userId) {
  const shoppingList = await getOrCreateShoppingList(userId);
  const detail = await getListDetail(userId, shoppingList.id);
  const onRun = detail.items.map((i) => normalise(i.text));
  const pantryItems = await listPantryItems(userId);
  const inPantry = pantryItems.filter((p) => p.quantity > 0).map((p) => normalise(p.name));
  const have = (need) => {
    const n = normalise(need);
    return onRun.some((text) => matches(text, n)) || inPantry.some((text) => matches(text, n));
  };
  return { have, shoppingList, detail };
}

/**
 * The real list, each recipe decorated with its real can-make status against what's currently on
 * the Shopping run OR already in real pantry inventory -- the design's own `recipes.map(r => {
 * missing = r.needs.filter(n => !have(n)) ... })` logic (the prototype's exact shape), against
 * the real database instead of client-side mock state.
 */
export async function listRecipesWithMatch(userId) {
  const recipes = await many(
    `SELECT id, name, time_text, needs, steps, heart_healthy, cook_minutes, created_by, created_at, updated_at
       FROM recipes WHERE user_id = $1 AND archived_at IS NULL ORDER BY created_at DESC`,
    [userId],
  );

  const { have, shoppingList } = await buildHaveChecker(userId);

  return recipes.map((r) => {
    const missing = (r.needs || []).filter((n) => !have(n));
    return {
      id: r.id,
      name: r.name,
      timeText: r.time_text,
      needs: r.needs || [],
      steps: r.steps || [],
      heartHealthy: r.heart_healthy,
      cookMinutes: r.cook_minutes,
      createdBy: r.created_by,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      canMake: missing.length === 0,
      missing,
      listId: shoppingList.id,
    };
  });
}

/**
 * "Add missing" (#3124's real scope item 3) -- the recipe's real currently-missing ingredients,
 * pushed straight onto the real Shopping run, same run push_list/the Shopping screen already
 * write to. Recomputes missing against the run (and, per #3308, real pantry inventory) at call
 * time rather than trusting a client-held snapshot, so a concurrent edit -- or something already
 * sitting in the pantry -- can't get pushed onto the run a second time.
 */
export async function addMissingIngredients(userId, recipeId) {
  const recipe = await getOwnedRecipe(userId, recipeId);
  if (!recipe) throw notFound("Recipe not found");

  const { have, shoppingList, detail } = await buildHaveChecker(userId);
  const missing = (recipe.needs || []).filter((n) => !have(n));

  if (missing.length === 0) return { added: [], list: detail };
  const list = await addListItems(userId, shoppingList.id, missing);
  return { added: missing, list };
}

/** Section 5's real health context -- stated once, read by Claude before it generates (Section
 *  8's "state once, respected everywhere, forever"). The app does no AI inference of its own
 *  (Section 10): this is context for Claude's own real judgement, not a rule this server
 *  enforces or a filter it applies to recipes. */
export async function getHealthContext(userId) {
  const row = await one("SELECT health_context FROM users WHERE id = $1", [userId]);
  return row?.health_context ?? null;
}

/** Set (or clear, with null) the real, stated health context -- e.g. "stage 2 heart disease,
 *  hypertension -- favor heart-healthy meals." Additive in spirit but not in mechanism: unlike
 *  #3132's set_food_preferences, this is one free-text field Shane states in his own words, not
 *  a list to append to -- a later call replaces it, matching how Shane would actually correct or
 *  extend what he already said. */
export async function setHealthContext(userId, text) {
  const clean = text === null || text === undefined ? null : String(text).trim().slice(0, 2000) || null;
  await query("UPDATE users SET health_context = $2 WHERE id = $1", [userId, clean]);
  return clean;
}
