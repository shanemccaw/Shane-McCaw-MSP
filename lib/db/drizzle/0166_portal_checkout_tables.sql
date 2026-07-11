ALTER TABLE "sales_offers" ADD COLUMN IF NOT EXISTS "trial_period_days" integer;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "free_checkout_attempts" (
	"id" serial PRIMARY KEY NOT NULL,
	"offer_id" integer NOT NULL,
	"customer_email" text NOT NULL,
	"ip_address" text NOT NULL,
	"msp_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fca_email_offer_idx" ON "free_checkout_attempts" ("customer_email","offer_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fca_ip_msp_idx" ON "free_checkout_attempts" ("ip_address","msp_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fca_msp_created_idx" ON "free_checkout_attempts" ("msp_id","created_at");
