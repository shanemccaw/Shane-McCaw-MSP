-- Shane's Life -- Recipes: core list + ingredient matching (Git #3124, sub-issue of #3086's
-- Feature: Recipes above Shopping #3088, which this is blocked_by).
--
-- Contract pack Section 5's real superseding update: Recipes are "populated by Claude-generated
-- content pushed in via MCP, not built as an in-app database/form system" -- same division of
-- labor as Shopping (#3088): the app stores, displays, matches and lets Shane act, Claude does
-- the actual writing during a conversation (Section 10: no live AI inference in this server).
--
-- `needs` is the real ingredient list a recipe is matched against the current Shopping run with
-- -- text[], not a child table, because unlike list_items a recipe's ingredient names are never
-- individually checked off or edited in place; they are only ever compared against
-- `have(n)`-style substring matching (Shanes Life 05 - Recipes.dc.html / the prototype's own
-- `recipes.map` logic). `steps` is real but out of this issue's scope to *drive* anything with
-- (Cook mode is a separate, explicitly-excluded sibling Feature) -- it is still stored, since
-- Claude generates steps in the same real conversation as needs/name/time and dropping them on
-- the floor would mean re-asking for them once Cook mode lands. Both are jsonb/text[] rather
-- than normalised child tables for the same reason `lists.data`/`entities.data` are jsonb: a
-- recipe's shape is whatever Claude wrote, not a fixed schema Shane fills in by hand.
CREATE TABLE IF NOT EXISTS recipes (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name          text        NOT NULL,
    time_text     text,                                -- "35 min · serves 4, leftovers for the Rental"
    needs         text[]      NOT NULL DEFAULT '{}',    -- real ingredient list, matched against the Shopping run
    steps         jsonb       NOT NULL DEFAULT '[]',    -- real step text, stored for the later Cook-mode Feature
    heart_healthy boolean     NOT NULL DEFAULT false,   -- Claude's own real judgement at push time (Section 5's
                                                        -- heart-healthy context), not computed by this app
    created_by    text        NOT NULL DEFAULT 'claude', -- shane | claude -- mirrors lists.created_by
    archived_at   timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS recipes_user_idx ON recipes (user_id, archived_at, created_at DESC);

-- Section 5's real health context: "Shane's real cardiac health condition ... should inform
-- Claude's real recipe and meal suggestions ... stated once, respected everywhere, forever
-- (Section 8) -- this is stated once, real health information Shane has already disclosed, not
-- re-asked for every time a meal gets planned." One real free-text field, read by Claude over
-- MCP (get_health_context) before it generates recipes -- the app itself does no AI inference
-- (Section 10), so this is context for Claude's own judgement, not a rule this server enforces.
-- Nullable and empty by default: no fabricated health data lands here until Shane (or Claude, on
-- Shane's real behalf) actually states it via set_health_context / the capture grammar.
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS health_context text;
