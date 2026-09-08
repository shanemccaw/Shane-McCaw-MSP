-- Shane's Life -- Recipes: Tonight, multi-dish synchronized cooking (Git #3126, sub-issue of
-- #3086's Epic: Shane's Life, blocked_by #3125 Cook mode + #3124 Core list -- both real, done,
-- merged before this file was written).
--
-- The prototype's own real sync math ("First Slice Prototype.dc.html", `MEAL.dishes`) needs one
-- number per dish it does not currently have anywhere in the real schema: a numeric total cook
-- time in minutes (`d.min`), used to compute `MEAL_TOTAL = max(dish.min)` and each dish's real
-- start-offset `MEAL_TOTAL - dish.min` so every dish finishes at the same real moment instead of
-- starting at the same time. #3124's `recipes.time_text` is free prose ("35 min · serves 4,
-- leftovers for the Rental") -- it is exactly what a recipe card displays, and deliberately not
-- something this app parses for a number (Section 10: no in-app inference of Claude's own
-- generated text). `cook_minutes` is the one real, explicit, numeric field Tonight's sync math
-- needs; Claude sets it (via push_recipes) for a recipe genuinely meant to be one dish of a
-- synchronized multi-dish meal, same real division of labor as `heart_healthy`.
--
-- Nullable and unused by every existing recipe: a recipe with no `cook_minutes` simply cannot be
-- picked as a Tonight dish (there is nothing to synchronize against) and the Recipes/Tonight
-- screens say so plainly rather than guessing a number out of `time_text`.
ALTER TABLE recipes
    ADD COLUMN IF NOT EXISTS cook_minutes integer;

ALTER TABLE recipes
    ADD CONSTRAINT recipes_cook_minutes_positive CHECK (cook_minutes IS NULL OR cook_minutes > 0);
