-- Shane's Life -- Shopping: store paths + aisle memory (Git #3108).
--
-- Design handoff, capture grammar item 9: "aisle memory (`pasta aisle 12 end cap`)". README
-- ("Data model additions") does not carry a dedicated table for this -- lists/list_items (016)
-- only got as far as "quantity/aisle/price ... have nowhere to go" (lists.mjs's own comment,
-- #3088). "Shanes Life 04 - Shopping.dc.html" option 2b and the First Slice Prototype's real
-- wired logic (`it.aisleBy[store] = { aisle, note }`, `known.sort((x,y) => A(x).aisle - A(y).aisle)`)
-- are the real specification this migration and the ordering it enables are built from: "the
-- location is captured the way Shane would say it out loud, stored per store, ... the list
-- re-sorts into walking order (by aisle number, then shelf notes) every trip after."
--
-- Real, growing record: one row per (user, store, item), not a one-time entry -- a later report
-- of the same item at the same store updates the spot and bumps `hits` rather than duplicating.

-- Which store a run is being shopped at -- "one bar of walking order" needs to know which real
-- store's aisle map to walk. Nullable: a list with no store set falls back to flat order.
ALTER TABLE lists ADD COLUMN IF NOT EXISTS store text;

CREATE TABLE IF NOT EXISTS store_aisles (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    store         text        NOT NULL,
    item_text     text        NOT NULL,   -- as captured, e.g. "pasta" -- matched case-insensitively
    aisle         integer     NOT NULL,
    note          text,                   -- "end cap", "halfway down, left side, second row"
    hits          integer     NOT NULL DEFAULT 1,   -- how many times this spot has been reported
    last_seen_at  timestamptz NOT NULL DEFAULT now(),
    created_at    timestamptz NOT NULL DEFAULT now()
);

-- One real, current spot per (user, store, item) -- a later capture corrects the spot in place
-- (store layouts move things) rather than piling up duplicate rows for the same item.
CREATE UNIQUE INDEX IF NOT EXISTS store_aisles_user_store_item_key
    ON store_aisles (user_id, lower(store), lower(item_text));

-- Best-path ordering reads a whole store's map sorted by aisle in one query.
CREATE INDEX IF NOT EXISTS store_aisles_store_aisle_idx
    ON store_aisles (user_id, lower(store), aisle);
