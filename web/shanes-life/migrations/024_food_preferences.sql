-- Shane's Life -- real food preferences: dislikes (soft) and allergies (hard) (Git #3132,
-- sub-issue of #3086, foundational -- the Recipes Sunday-ritual Feature is blocked_by this).
--
-- Contract pack Section 5's own recipe-generation order already assumes this table exists
-- ("Section 5's own real allergy/dislike data (once #3132 lands)") -- the real, concrete cost of
-- it not existing yet was a real deathly allergen (shrimp) landing on a real shopping list on
-- 2026-09-07 because nothing checked first.
--
-- Real, deliberate distinction, not one list: `allergies` is a hard exclusion, no exceptions,
-- safety-grade; `dislikes` is a soft avoid, fine to slip through occasionally with a real
-- stated reason. One row per user -- same "stated once, respected everywhere forever" pattern
-- as everything else in this app (Section 8), same shape ShanesSurvival's income sources use
-- (state it once via MCP, unset fields on a later call keep their current value).

CREATE TABLE IF NOT EXISTS food_preferences (
    user_id     uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    dislikes    text[] NOT NULL DEFAULT '{}',
    allergies   text[] NOT NULL DEFAULT '{}',
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
