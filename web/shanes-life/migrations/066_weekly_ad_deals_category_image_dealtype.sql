-- Shane's Life -- Category, ImageUrl, structured DealType, real date range for weekly-ad
-- deals/coupons (Git #3310, sub-issue of #3234).
--
-- Real, confirmed gap (issue body): `push_deals` (writes item_prices, migration 021) and
-- `push_coupons` (writes coupons, migration 029) have no place to carry a category
-- (Snacks/Dairy/Produce/etc.), no product image URL, and no structured deal-type tag -- today
-- "sale"/"bogo"/"digital_coupon"/"multi_buy" only exists as loose free text buried in
-- coupons.description, and item_prices has no equivalent field at all. `item_prices.observed_on`
-- (the column push_deals writes as a single "valid on" date) also has no end-date counterpart,
-- unlike coupons' own valid_from/valid_to pair -- inconsistent for what is otherwise the same
-- real "a store's current flyer price is good through some date" shape.
--
-- deal_type is deliberately free-form text, not a CHECK-constrained enum -- the issue's own scope
-- says so ("don't over-engineer into a rigid enum given real-world flyer variety"): a real flyer
-- prints "BOGO," "digital coupon," "buy 3 save $5," and dozens of store-specific phrasings that a
-- fixed vocabulary would just be fighting forever.
--
-- category/image_url are populated only when a real source actually has them -- Claude's own
-- conversational flyer-reads, and (per this issue's own real DOM investigation, see
-- desktop/ShanesSurvival/src/ShanesSurvival.App/Groceries/WeeklyAdScraperWindow.cs's
-- ExtractionScript) Publix's own rendered ad card DOM, which already exposes a per-card
-- `img[alt]` element the parser reads for the title -- its `src` is a real, genuinely-extractable
-- product image URL. No evidence of a per-card category grouping in that same DOM was found in
-- this pass (not live-verified -- no interactive WebView2/browser session available in this
-- headless build); the column exists for Claude's own manual/conversational pushes and any future
-- store whose ad page does expose one, not populated by the Publix scraper today.

ALTER TABLE item_prices ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE item_prices ADD COLUMN IF NOT EXISTS image_url text;
ALTER TABLE item_prices ADD COLUMN IF NOT EXISTS deal_type text;
ALTER TABLE item_prices ADD COLUMN IF NOT EXISTS valid_to date;

ALTER TABLE coupons ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS image_url text;
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS deal_type text;
