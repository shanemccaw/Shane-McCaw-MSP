-- Add columns that were defined in the Drizzle schema but missing from the DB.
-- Both statements are idempotent (IF NOT EXISTS).
ALTER TABLE "monitoring_packages" ADD COLUMN IF NOT EXISTS "platform_cost_cents" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "monitoring_packages" ADD COLUMN IF NOT EXISTS "required_plan_feature" text;
