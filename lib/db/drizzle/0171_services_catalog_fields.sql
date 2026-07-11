-- 0171_services_catalog_fields
-- Adds IDE-style Product Catalog fields to services:
-- hierarchical category path, free-form tags, customer agreement template,
-- and a free-offering flag.
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "category_path" text;
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "tags" jsonb DEFAULT '[]'::jsonb;
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "customer_agreement_template" text;
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "is_free_offering" boolean NOT NULL DEFAULT false;
