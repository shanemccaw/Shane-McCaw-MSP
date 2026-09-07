-- Shane's Life -- Shopping barcode scan (Git #3109).
--
-- #3088's own header in src/core/lists.mjs is explicit: "list_items has no `data` column ...
-- so quantity/aisle/price (each its own separate Feature, blocked_by #3088) have nowhere to go
-- here and are not accepted." This is the price half of that deferral -- "resolves to a real
-- item + real price, added to the run" (issue body). Quantity and aisle stay out of scope here
-- (aisle memory is #3108's own Feature); this migration touches only what a real scanned price
-- needs.
--
-- Design source: "Shanes Life 04 - Shopping.dc.html", option 2a ("Scan -> real price"). Three
-- match states, none of which block (contract's own words): Exact (barcode seen before) ->
-- straight to price. Near (new barcode, name resembles an open list item) -> candidate chips.
-- Unknown (nothing like it) -> add to the list or pick an open item. "Every link is remembered
-- per barcode, so each product asks at most once" is what barcode_links exists to do.

-- The real scanned (or typed-at-scan-time) price on a run item, plus whether it came from an
-- actual scan vs. a plain manual add -- the design's own "$1.89 - scanned" row treatment reads
-- differently from an unpriced item, so the source has to be a real column, not inferred.
ALTER TABLE list_items
    ADD COLUMN IF NOT EXISTS price_cents  integer,
    ADD COLUMN IF NOT EXISTS price_source text,          -- 'scan' | 'manual'
    ADD COLUMN IF NOT EXISTS priced_at    timestamptz;

ALTER TABLE list_items DROP CONSTRAINT IF EXISTS list_items_price_source_check;
ALTER TABLE list_items
    ADD CONSTRAINT list_items_price_source_check
    CHECK (price_source IS NULL OR price_source IN ('scan', 'manual'));

-- "Every link is remembered per barcode, so each product asks at most once" -- one real link per
-- (user, barcode), pointing at the canonical item text that barcode resolves to plus the last
-- real price seen for it. This is the resolution table (item identity), not the per-store price
-- history table -- that is #3112's own separate, blocked_by-#3088 Feature; this one only needs
-- "last seen" to make the Exact match case instant, per the design's own three-state grammar.
CREATE TABLE IF NOT EXISTS barcode_links (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    barcode          text NOT NULL,
    item_text        text NOT NULL,
    last_price_cents integer,
    last_seen_at     timestamptz,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS barcode_links_user_barcode_key
    ON barcode_links (user_id, barcode);
