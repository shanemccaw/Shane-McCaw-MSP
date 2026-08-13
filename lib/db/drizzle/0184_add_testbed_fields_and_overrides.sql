ALTER TABLE "msps" ADD COLUMN IF NOT EXISTS "is_testbed" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "msps" ADD COLUMN IF NOT EXISTS "testbed_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "msp_customers" ADD COLUMN IF NOT EXISTS "is_testbed" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "msp_customers" ADD COLUMN IF NOT EXISTS "testbed_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tenant_engine_overrides" (
	"id" serial PRIMARY KEY NOT NULL,
	"testbed_customer_id" integer NOT NULL,
	"run_id" text,
	"graph_endpoint" text NOT NULL,
	"field_path" text NOT NULL,
	"injected_value" jsonb NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tenant_engine_overrides" ADD CONSTRAINT "tenant_engine_overrides_testbed_customer_id_msp_customers_id_fk" FOREIGN KEY ("testbed_customer_id") REFERENCES "public"."msp_customers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
