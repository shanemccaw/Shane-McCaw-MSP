CREATE TABLE IF NOT EXISTS "tenant_write_consent" (
	"tenant_id" text PRIMARY KEY NOT NULL,
	"customer_id" integer,
	"consent_status" text DEFAULT 'pending' NOT NULL,
	"consented_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"admin_email" text,
	"admin_display_name" text,
	"scopes_granted" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tenant_write_consent" ADD CONSTRAINT "tenant_write_consent_customer_id_msp_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."msp_customers"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tenant_write_consent_customer_id_idx" ON "tenant_write_consent" USING btree ("customer_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tenant_write_consent_status_idx" ON "tenant_write_consent" USING btree ("consent_status");
--> statement-breakpoint
ALTER TABLE "msps" ADD COLUMN IF NOT EXISTS "write_back_enabled" boolean DEFAULT false NOT NULL;
