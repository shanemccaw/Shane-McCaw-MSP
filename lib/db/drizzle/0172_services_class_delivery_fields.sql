-- 0172_services_class_delivery_fields
-- Adds MSP billing/checkout classification fields to services:
-- service_class, delivery_type, allow_free_checkout, trial_period_days
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "service_class" text;
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "delivery_type" text;
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "allow_free_checkout" boolean NOT NULL DEFAULT true;
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "trial_period_days" integer;
