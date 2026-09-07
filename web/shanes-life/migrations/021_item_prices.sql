-- Shane's Life -- Per-store price history (Git #3112).
--
-- Design handoff, Shanes Life 04 - Shopping.dc.html: "Prices are stored per store and per date,
-- and Claude reads them over MCP (get_prices) so the next list carries real numbers instead of
-- estimates." #3112's own real scope: a real historical record over time per item, not just the
-- weekly-ad snapshot #3110 attaches to a list item for one run -- repeated real prices for the
-- same item at the same store build a real, queryable history.
--
-- `item_prices.item_text` is the normalised (lower/trim) item name, not a foreign key onto
-- `list_items` -- list rows are deleted on every "Done shopping" clear-checked pass (#3088's
-- clearCheckedItems), so history keyed on the row would evaporate with the run. This is the same
-- normalisation Claude's own get_prices (MCP) matches against when asking "what did this cost
-- last time" while generating the next list.
--
-- Synced across Shane's own devices ("store per phone" per the design README) for free: this is
-- one real Postgres table reachable from any signed-in session, not per-device local storage --
-- there is nothing here to sync, because there is only ever one real copy.

CREATE TABLE IF NOT EXISTS stores (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       text        NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS stores_user_name_key ON stores (user_id, lower(name));

CREATE TABLE IF NOT EXISTS item_prices (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    store_id    uuid        NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    item_text   text        NOT NULL,               -- normalised: lower(trim(...))
    item_label  text        NOT NULL,               -- the real, as-typed label shown back to Shane
    price_cents integer     NOT NULL CHECK (price_cents >= 0),
    observed_on date        NOT NULL DEFAULT current_date,
    note        text,
    source      text        NOT NULL DEFAULT 'shane',   -- shane | claude
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- "what did this cost last time (anywhere)" and "what did this cost last time at store X" are
-- both real, common queries here -- get_prices (MCP) and the Shopping row's price hint use the
-- first shape, a future per-store comparison view would use the second.
CREATE INDEX IF NOT EXISTS item_prices_item_idx  ON item_prices (user_id, item_text, observed_on DESC);
CREATE INDEX IF NOT EXISTS item_prices_store_idx ON item_prices (store_id, observed_on DESC);
