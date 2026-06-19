-- Incremental migration: add wizard/pricing fields to existing tables
-- services: base_price, max_price, order_workflow
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "base_price" numeric(10, 2);
--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "max_price" numeric(10, 2);
--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "order_workflow" jsonb;
--> statement-breakpoint
-- contracts: final_price, wizard_selections
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "final_price" numeric;
--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "wizard_selections" jsonb;
