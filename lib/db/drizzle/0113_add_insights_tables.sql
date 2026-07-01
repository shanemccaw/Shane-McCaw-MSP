CREATE TABLE IF NOT EXISTS "insights_generated_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_id" integer,
	"project_id" integer,
	"category" text DEFAULT 'report' NOT NULL,
	"doc_type" text DEFAULT 'other' NOT NULL,
	"title" text NOT NULL,
	"html_content" text DEFAULT '' NOT NULL,
	"pdf_url" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"approved_at" timestamp,
	"delivered_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "insights_generated_documents" ADD CONSTRAINT "insights_generated_documents_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "insights_generated_documents" ADD CONSTRAINT "insights_generated_documents_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;

CREATE TABLE IF NOT EXISTS "insights_automations" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"customer_id" integer,
	"project_id" integer,
	"automation_type" text DEFAULT 'monthly_tenant_health_report' NOT NULL,
	"cron_expression" text DEFAULT '0 9 1 * *' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"linked_runbook_script_id" text,
	"generate_document" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp,
	"next_run_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "insights_automations" ADD CONSTRAINT "insights_automations_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "insights_automations" ADD CONSTRAINT "insights_automations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;
