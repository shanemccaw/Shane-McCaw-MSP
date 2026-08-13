ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "invoice_type" text NOT NULL DEFAULT 'instant';
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "stripe_invoice_id" text;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "billing_cycle_start" timestamp;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "billing_cycle_end" timestamp;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "stripe_subscription_id" text;
