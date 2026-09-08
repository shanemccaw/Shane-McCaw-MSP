-- Shane's Life -- Recipes: Sunday meal-planning ritual + Today surfacing (Git #3127, sub-issue
-- of #3086's Feature: Recipes, blocked_by #3124 (core list/matching) and #3132 (food
-- preferences)).
--
-- Contract pack Section 5's real superseding update, last paragraph: "Sundays, Shane works with
-- Claude to build the week's real recipe list and meal plan (same Claude + MCP generation
-- pattern as Shopping). That plan then surfaces on the Today view as simple, real, moment-based
-- nudges ... never as a calendar to browse." So this is a real, small per-day/per-meal-slot
-- table Claude pushes a week into at once, matching the "app hosts/displays what Claude
-- generated" division of labor recipes.mjs's own header already documents -- this module never
-- decides what to cook, it only stores the real plan and reads it back as of the server's own
-- clock (same server-date-key discipline `serverDateKey()` in api.mjs already uses for the
-- critter roll, so every device agrees on what "today" and "tomorrow" mean regardless of its own
-- timezone).
--
-- `recipe_id` is nullable and ON DELETE SET NULL: Claude may plan a day around a saved recipe
-- (matched against Shopping, per #3124) or just state a dish in `dish_text` with no recipe row
-- behind it (e.g. "leftovers," "grab a rotisserie chicken") -- the design's own real ritual is
-- "build the week's recipe list AND meal plan" as two related but separable real things, not one
-- that requires the other. Archiving a recipe (recipes.archiveRecipe) must not silently corrupt
-- an already-planned week, so a deleted recipe just leaves the plan entry as free text instead of
-- cascading it away.
CREATE TABLE IF NOT EXISTS meal_plan_entries (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan_date   date        NOT NULL,
    meal_type   text        NOT NULL DEFAULT 'dinner' CHECK (meal_type IN ('breakfast', 'lunch', 'dinner')),
    recipe_id   uuid        REFERENCES recipes(id) ON DELETE SET NULL,
    dish_text   text,                                -- real dish name/description when there's no recipe row, or an override label alongside one
    notes       text,
    created_by  text        NOT NULL DEFAULT 'claude', -- shane | claude -- mirrors recipes.created_by / lists.created_by
    archived_at timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS meal_plan_entries_user_date_idx
    ON meal_plan_entries (user_id, archived_at, plan_date, meal_type);
