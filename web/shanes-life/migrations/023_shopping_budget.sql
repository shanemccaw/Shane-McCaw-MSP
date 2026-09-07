-- Shane's Life -- per-run budget + put-it-back (#3111, sub-issue of #3086, Shopping).
--
-- The real price the running total sums already exists: #3109's 020_barcode_scan.sql added
-- `list_items.price_cents` (set only via a real scan, per that migration's own scope). #3111
-- doesn't need a price column of its own -- it needs a real stated budget for the run to check
-- that total against. `lists.budget_cents` is nullable and per-list (not shopping-specific in
-- the schema) so any future room built on this same typed shape can carry a stated budget the
-- same way -- Shopping is just the first real user of it, same pattern as `category` on `lists`
-- itself.

ALTER TABLE lists
    ADD COLUMN IF NOT EXISTS budget_cents integer;

ALTER TABLE lists DROP CONSTRAINT IF EXISTS lists_budget_cents_check;
ALTER TABLE lists
    ADD CONSTRAINT lists_budget_cents_check CHECK (budget_cents IS NULL OR budget_cents >= 0);
