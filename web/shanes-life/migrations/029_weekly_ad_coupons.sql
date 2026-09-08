-- Shane's Life -- Weekly-ad cross-store verdicts, coupons and multi-buy counts (Git #3110).
--
-- #3088 explicitly parked this ("each its own separate Feature, blocked_by this one"). #3112
-- landed first and built the real historical per-store price record (`stores`/`item_prices`,
-- 021_item_prices.sql) with its own `source` column ('shane' by default) -- exactly the shape a
-- current weekly-ad price is too, just a different source and read pattern (cross-store
-- CURRENT-cheapest, not history-over-time). So this migration does NOT create a parallel prices
-- table: `push_deals` (MCP) writes weekly-ad rows into the SAME `item_prices` with
-- `source = 'weekly_ad'`, and `unit` is the one column that table didn't yet need until now
-- (a weekly-ad flyer often prices something "$4/lb" or "3/$5" where the unit matters to the
-- verdict, unlike a single scanned/typed price).
--
-- Coupons are a genuinely different shape (multi-buy count, flat discount, not-store-specific),
-- so they get their own real table.

ALTER TABLE item_prices ADD COLUMN IF NOT EXISTS unit text;

CREATE TABLE IF NOT EXISTS coupons (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id               uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    store                 text,                      -- null when the coupon isn't store-specific
    item_text             text        NOT NULL,      -- normalised (lower/trim), same as item_prices.item_text
    description           text        NOT NULL,      -- "Buy 2 Get 1 Free", "$1 off any"
    multi_buy_count       integer,                   -- 2 for "2 for $5"
    multi_buy_price_cents integer,
    discount_cents        integer,
    valid_from            date,
    valid_to              date,
    created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS coupons_lookup_idx ON coupons (user_id, item_text, valid_to);
