-- Add Monitoring Tier-specific fields to services table.
-- These columns are only meaningful when serviceClass = 'subscription'
-- and deliveryType = 'bundle_subscription'.

ALTER TABLE services ADD COLUMN IF NOT EXISTS tenant_tier_label text;
ALTER TABLE services ADD COLUMN IF NOT EXISTS seat_min integer;
ALTER TABLE services ADD COLUMN IF NOT EXISTS seat_max integer;
ALTER TABLE services ADD COLUMN IF NOT EXISTS included_engines jsonb;
ALTER TABLE services ADD COLUMN IF NOT EXISTS included_features jsonb;
ALTER TABLE services ADD COLUMN IF NOT EXISTS price_per_user_month numeric(10, 2);
ALTER TABLE services ADD COLUMN IF NOT EXISTS seat_count_floor integer;
ALTER TABLE services ADD COLUMN IF NOT EXISTS min_msp_plan_tier text;
