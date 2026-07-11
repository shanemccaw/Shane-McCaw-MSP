ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "fulfillment_type" text DEFAULT 'manual';
--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "tenant_allowance" integer;
--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "ai_credit_allowance" integer;
--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "overage_rate_cents" integer;
--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "tier_capabilities" jsonb;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "msp_subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"msp_id" integer NOT NULL,
	"service_id" integer NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"stripe_price_id" text,
	"status" text DEFAULT 'trialing' NOT NULL,
	"current_period_start" timestamptz,
	"current_period_end" timestamptz,
	"dunning_state" text,
	"payment_failed_at" timestamptz,
	"tenant_count_snapshot" integer DEFAULT 0 NOT NULL,
	"contact_email" text,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT "msp_subscriptions_msp_id_unique" UNIQUE("msp_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "msp_subscriptions" ADD CONSTRAINT "msp_subscriptions_msp_id_msps_id_fk" FOREIGN KEY ("msp_id") REFERENCES "public"."msps"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "msp_subscriptions_status_idx" ON "msp_subscriptions" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "msp_subscriptions_stripe_sub_idx" ON "msp_subscriptions" ("stripe_subscription_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "msp_subscriptions_dunning_idx" ON "msp_subscriptions" ("dunning_state");
