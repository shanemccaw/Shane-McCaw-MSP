-- Real pantry inventory tracking (Git #3308, Feature under Epic #3086) -- reverses the earlier
-- "that's not even my area" cut recorded in contract.md Section 5 (see the 2026-09-09 real,
-- further superseding update there). Real, direct, explicit reversal from Shane, confirmed as a
-- genuine change of mind, not a lighter reinterpretation: real scope now is tracking what Shane
-- actually has at home and real quantities -- spices, vegetables, meats, etc.
--
-- Same real upsert-in-place philosophy as things (Git #3156) and store_aisles (Git #3108):
-- saying a quantity again corrects the same real row rather than creating a duplicate. Unlike
-- things (one real place per name, house-agnostic), a pantry item genuinely differs per real
-- house -- H1 and the rental can each have their own real "5 lbs of rice" -- so house is part of
-- the real upsert key here, not just a label on the row (#3308's own scope item 1: "track
-- per-house, matching set_thing's own existing house pattern"). house is nullable (a pantry item
-- with no stated house yet is still real), so the unique index below keys on COALESCE(house, '')
-- rather than house directly -- a plain UNIQUE constraint treats NULL as always-distinct, which
-- would let "I have 2 lbs of chicken breasts" (no house stated) create a fresh duplicate row
-- every time instead of correcting the one real row in place.
--
-- unit is real, free text as Shane states it ("lbs", "cans", "jar", "bunch") -- NOT a locked
-- enum, per #3308's own explicit scope, matching contract Section 3's "genuinely open" data
-- model (same reasoning categories.mjs's own open registry already uses).
--
-- category reuses the fixed, already-real CAT_ORDER set (Produce/Meat/Snacks/Bakery/Pantry/
-- Frozen/Dairy/Other) shopping-order.mjs extracted verbatim from the First Slice Prototype --
-- the app layer (core/pantry.mjs) auto-classifies via that same categoryOf() when Claude/Shane
-- doesn't state one explicitly, so Pantry grouping stays consistent with how Shopping already
-- groups. Not FK-constrained to that fixed list -- categoryOf() never produces anything outside
-- it, but a future explicit override (Claude filing something under a category the fixed list
-- doesn't cover) shouldn't be blocked by a hard constraint here.
--
-- No expiration/shelf-life columns -- #3308's own explicit non-goal, contract.md Section 5's
-- real, further superseding update: "quantity tracking specifically, not shelf-life/expiry
-- dates, which were never separately requested."

CREATE TABLE IF NOT EXISTS pantry_items (
    id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       text        NOT NULL,
    quantity   numeric     NOT NULL DEFAULT 0,
    unit       text,
    category   text        NOT NULL DEFAULT 'Other',
    house      text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pantry_items_quantity_non_negative CHECK (quantity >= 0)
);

-- The real upsert key: saying "I have 2 lbs of chicken breasts" again corrects this same row
-- (same house, or no house) rather than creating a duplicate -- see header.
CREATE UNIQUE INDEX IF NOT EXISTS pantry_items_user_name_house_key
    ON pantry_items (user_id, lower(name), COALESCE(house, ''));

CREATE INDEX IF NOT EXISTS pantry_items_house_idx ON pantry_items (user_id, house);
CREATE INDEX IF NOT EXISTS pantry_items_category_idx ON pantry_items (user_id, category);
