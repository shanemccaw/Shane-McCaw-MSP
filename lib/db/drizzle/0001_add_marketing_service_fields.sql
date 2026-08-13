-- Migration: add marketing content fields to services table
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "service_type" text;
--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "tagline" text;
--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "target_audience" text;
--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "inclusions" jsonb;
--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "features" jsonb;
--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "badge" text;
--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "highlighted" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "hours_per_month" text;
--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "icon_name" text;
--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "page_href" text;
--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "sort_order" integer NOT NULL DEFAULT 0;
