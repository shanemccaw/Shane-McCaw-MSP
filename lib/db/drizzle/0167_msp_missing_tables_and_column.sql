ALTER TABLE "portal_wf_runs" ADD COLUMN IF NOT EXISTS "ai_admitted" boolean;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "msp_report_definitions" (
	"id" serial PRIMARY KEY NOT NULL,
	"definition_id" uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
	"msp_id" integer NOT NULL,
	"customer_id" integer,
	"name" text NOT NULL,
	"description" text,
	"doc_type" text NOT NULL DEFAULT 'executive_summary',
	"delivery_method" text NOT NULL DEFAULT 'in_app',
	"delivery_email" text,
	"field_mappings" jsonb NOT NULL DEFAULT '{}',
	"schedule_config" jsonb NOT NULL DEFAULT '{}',
	"is_active" boolean NOT NULL DEFAULT true,
	"created_by_user_id" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL DEFAULT now(),
	"updated_at" timestamp with time zone NOT NULL DEFAULT now(),
	CONSTRAINT "msp_report_definitions_msp_id_fk" FOREIGN KEY ("msp_id") REFERENCES "msps"("id") ON DELETE CASCADE,
	CONSTRAINT "msp_report_definitions_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "msp_customers"("id") ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "msp_report_defs_msp_id_idx" ON "msp_report_definitions" ("msp_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "msp_report_defs_customer_id_idx" ON "msp_report_definitions" ("customer_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "msp_report_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
	"definition_id" uuid NOT NULL,
	"msp_id" integer NOT NULL,
	"customer_id" integer,
	"title" text NOT NULL,
	"doc_type" text NOT NULL,
	"status" text NOT NULL DEFAULT 'pending',
	"html_content" text,
	"pdf_base64" text,
	"pdf_size_bytes" integer,
	"delivered_at" timestamp with time zone,
	"delivery_email" text,
	"error_message" text,
	"workflow_run_id" uuid,
	"triggered_by_user_id" integer,
	"generated_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL DEFAULT now(),
	"updated_at" timestamp with time zone NOT NULL DEFAULT now(),
	CONSTRAINT "msp_report_runs_definition_id_fk" FOREIGN KEY ("definition_id") REFERENCES "msp_report_definitions"("definition_id") ON DELETE CASCADE,
	CONSTRAINT "msp_report_runs_msp_id_fk" FOREIGN KEY ("msp_id") REFERENCES "msps"("id") ON DELETE CASCADE,
	CONSTRAINT "msp_report_runs_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "msp_customers"("id") ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "msp_report_runs_msp_id_idx" ON "msp_report_runs" ("msp_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "msp_report_runs_def_id_idx" ON "msp_report_runs" ("definition_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "msp_report_runs_status_idx" ON "msp_report_runs" ("status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "msp_sales_bundles" (
	"id" serial PRIMARY KEY NOT NULL,
	"bundle_id" uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
	"msp_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"monitoring_package_keys" jsonb NOT NULL DEFAULT '[]',
	"internal_cost_cents" integer NOT NULL DEFAULT 0,
	"resale_price_cents" integer NOT NULL DEFAULT 0,
	"status" text NOT NULL DEFAULT 'draft',
	"trial_days" integer,
	"created_by_user_id" integer,
	"updated_by_user_id" integer,
	"created_at" timestamp with time zone NOT NULL DEFAULT now(),
	"updated_at" timestamp with time zone NOT NULL DEFAULT now(),
	CONSTRAINT "msp_sales_bundles_msp_id_fk" FOREIGN KEY ("msp_id") REFERENCES "msps"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "msp_sales_bundles_msp_id_idx" ON "msp_sales_bundles" ("msp_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "msp_sales_bundles_status_idx" ON "msp_sales_bundles" ("status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "msp_sales_bundle_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"assignment_id" uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
	"bundle_id" uuid NOT NULL,
	"msp_id" integer NOT NULL,
	"customer_id" integer NOT NULL,
	"tenant_id" text,
	"status" text NOT NULL DEFAULT 'active',
	"activated_at" timestamp with time zone,
	"trial_expires_at" timestamp with time zone,
	"assigned_by_user_id" integer,
	"assigned_at" timestamp with time zone NOT NULL DEFAULT now(),
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL DEFAULT now(),
	"updated_at" timestamp with time zone NOT NULL DEFAULT now(),
	CONSTRAINT "msp_sales_bundle_assignments_bundle_id_fk" FOREIGN KEY ("bundle_id") REFERENCES "msp_sales_bundles"("bundle_id") ON DELETE RESTRICT,
	CONSTRAINT "msp_sales_bundle_assignments_msp_id_fk" FOREIGN KEY ("msp_id") REFERENCES "msps"("id") ON DELETE CASCADE,
	CONSTRAINT "msp_sales_bundle_assignments_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "msp_customers"("id") ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "msp_sales_bundle_assignments_bundle_idx" ON "msp_sales_bundle_assignments" ("bundle_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "msp_sales_bundle_assignments_msp_id_idx" ON "msp_sales_bundle_assignments" ("msp_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "msp_sales_bundle_assignments_customer_id_idx" ON "msp_sales_bundle_assignments" ("customer_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "msp_sales_bundle_assignments_status_idx" ON "msp_sales_bundle_assignments" ("status");
