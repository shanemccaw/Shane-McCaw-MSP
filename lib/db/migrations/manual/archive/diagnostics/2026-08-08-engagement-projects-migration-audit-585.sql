-- ============================================================================
-- #585 PRE-MIGRATION AUDIT -- engagement_projects -> services confirmation queries
-- ============================================================================
-- READ-ONLY. Pure SELECT. No DDL, no DML, no transaction, and deliberately NO
-- trailing simulator_migration_runs INSERT -- diagnostics files are exempt from
-- the run-tracking convention (CLAUDE.md) and this one changes nothing.
--
-- WHY THIS FILE EXISTS
--   #585/#584 both require confirming which engagement_projects rows are real
--   catalog content vs. placeholder/test data left over from early platform
--   testing, and require a real (not guessed) decision on how priceRange
--   (free text) maps to services.basePrice/price (numeric cents). Neither
--   question can be answered from this environment -- there is no
--   DATABASE_URL here (CLAUDE.md), and no docs/*.json dump of
--   engagement_projects exists (checked: only signals.json / endpoints.json /
--   check_key.json / something.json are present, none of them this table).
--
--   Run this, paste the output back, and answer:
--     1. Which rows (by id) are real catalog content to migrate, and which are
--        placeholder/test rows to leave behind (not migrated)?
--     2. What format is priceRange actually in across the real rows? (Query 2
--        buckets the observed shapes so the mapping in the actual migration
--        can be built off real examples instead of assumed off one guess.)
--     3. Do any candidate serviceId / signal_key values in the eligibility-row
--        plan (drafted separately, pending this data) fail to resolve against
--        real services / signal_derivation_rules rows? Queries 3-4 give the
--        real universe of both to check candidates against.
-- ============================================================================

-- Query 1: every engagement_projects row, in full, in display order.
SELECT
  id,
  title,
  price_range        AS "priceRange",
  description,
  meaning,
  triggered_by       AS "triggeredBy",
  sow_items          AS "sowItems",
  pages,
  sort_order         AS "sortOrder",
  is_visible         AS "isVisible",
  created_at         AS "createdAt",
  updated_at         AS "updatedAt"
FROM engagement_projects
ORDER BY sort_order, id;

-- Query 2: priceRange format census -- buckets the real values by shape so the
-- text->cents mapping can be built off what actually exists, not a guess.
SELECT
  price_range,
  COUNT(*)                                   AS row_count,
  price_range ~ '^\$[0-9,]+$'                AS looks_like_flat_dollar_amount,
  price_range ~ '^\$[0-9,]+\s*-\s*\$?[0-9,]+$' AS looks_like_dollar_range,
  price_range ~ '^\$[0-9,]+/[a-zA-Z]+$'      AS looks_like_recurring_rate
FROM engagement_projects
GROUP BY price_range
ORDER BY row_count DESC, price_range;

-- Query 3: current services catalog -- id/slug/name/serviceClass/price columns,
-- for checking migrated rows won't collide on slug/name and for confirming
-- which serviceClass values are already in real use.
SELECT
  id, slug, name, category, service_class, price, base_price, max_price,
  price_cents, internal_cost_cents, is_public, visibility, tier, sort_order,
  delivery_type, triggering_signal_keys, fulfillment_type, fulfillment_type_key
FROM services
ORDER BY id;

-- Query 4: every real signal_derivation_rules.signal_key currently in the
-- platform-wide (msp_id IS NULL) rule table, for verifying candidate
-- eligibility-row signal keys resolve to something real before the migration
-- references them.
SELECT DISTINCT signal_key
FROM signal_derivation_rules
WHERE msp_id IS NULL
ORDER BY signal_key;

-- Query 5: real sales_offer_rule_groups rows and their rule_type, to confirm
-- 'eligibility' is in active use post-#582 and to avoid colliding on `key`
-- when the migration inserts new eligibility rows.
SELECT id, key, label, rule_type, service_id, required_signal_keys, logic, is_active
FROM sales_offer_rule_groups
ORDER BY id;
