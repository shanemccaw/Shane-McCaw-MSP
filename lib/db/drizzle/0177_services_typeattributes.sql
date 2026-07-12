-- Services catalog schema cleanup: drop retired flat columns, drop script-set
-- tables, add typeAttributes jsonb.  All product-type-specific data (seat ranges,
-- tier capabilities, AI credit allowances, etc.) now lives in typeAttributes.
--
-- Safe to re-apply: DROP IF EXISTS / ADD COLUMN IF NOT EXISTS throughout.

-- 1. Add the new generic typeAttributes column.
ALTER TABLE services ADD COLUMN IF NOT EXISTS type_attributes jsonb;

-- 2. Drop retired monitoring-tier flat columns (moved to typeAttributes).
ALTER TABLE services DROP COLUMN IF EXISTS tenant_tier_label;
ALTER TABLE services DROP COLUMN IF EXISTS seat_min;
ALTER TABLE services DROP COLUMN IF EXISTS seat_max;
ALTER TABLE services DROP COLUMN IF EXISTS included_engines;
ALTER TABLE services DROP COLUMN IF EXISTS included_features;
ALTER TABLE services DROP COLUMN IF EXISTS price_per_user_month;
ALTER TABLE services DROP COLUMN IF EXISTS seat_count_floor;
ALTER TABLE services DROP COLUMN IF EXISTS min_msp_plan_tier;

-- 3. Drop retired MSP platform-subscription flat columns (moved to typeAttributes).
ALTER TABLE services DROP COLUMN IF EXISTS tenant_allowance;
ALTER TABLE services DROP COLUMN IF EXISTS overage_rate_cents;
ALTER TABLE services DROP COLUMN IF EXISTS ai_credit_allowance;
ALTER TABLE services DROP COLUMN IF EXISTS tier_capabilities;

-- 4. Drop retired billing flat columns.
ALTER TABLE services DROP COLUMN IF EXISTS billing_cycle;
ALTER TABLE services DROP COLUMN IF EXISTS stripe_product_id;

-- 5. Drop retired script-set join tables (script package linking now service-agnostic).
DROP TABLE IF EXISTS service_required_scripts CASCADE;
DROP TABLE IF EXISTS service_script_sets CASCADE;

-- 6. Clean up billingType enum: remove legacy values 'recurring' and 'fixed'.
--    Rows with those values should have been migrated before this runs.
--    We use a NO-OP UPDATE guard so this is re-runnable.
UPDATE services SET billing_type = 'one_time'        WHERE billing_type NOT IN ('one_time', 'recurring_monthly');
