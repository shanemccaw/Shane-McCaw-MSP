-- Baseline Action Templates + Config Packs (admin CRUD, mirrors Monitor Checks).
-- Hand-authored idempotent migration (IF NOT EXISTS throughout) because these
-- tables predate any generated migration (schema drift, same situation as the
-- break-glass tables in 0193) — the dev/prod DBs may already carry them via
-- drizzle-kit push. IF NOT EXISTS keeps this clean either way.

CREATE TABLE IF NOT EXISTS "baseline_action_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"template_id" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"category" text NOT NULL,
	"endpoint" text NOT NULL,
	"method" text NOT NULL,
	"body_template" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"required_variables" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"success_criteria" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"depends_on" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"requires_verification_gate" boolean DEFAULT false NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by_admin_id" integer,
	"updated_by_admin_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "baseline_action_templates_template_id_unique" UNIQUE("template_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "baseline_action_template_audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"template_id" text,
	"admin_id" integer,
	"before_snapshot" jsonb,
	"after_snapshot" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "config_packs" (
	"id" serial PRIMARY KEY NOT NULL,
	"pack_key" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"categories" text[] DEFAULT '{}' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "config_packs_pack_key_unique" UNIQUE("pack_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "config_pack_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"pack_id" integer NOT NULL,
	"template_id" text NOT NULL,
	"sort_order" integer NOT NULL,
	"depends_on_override" jsonb
);
--> statement-breakpoint
-- FKs added separately (idempotent via DO block — ADD CONSTRAINT has no IF NOT EXISTS)
DO $$ BEGIN
	ALTER TABLE "config_pack_templates" ADD CONSTRAINT "config_pack_templates_pack_id_config_packs_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."config_packs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "config_pack_templates" ADD CONSTRAINT "config_pack_templates_template_id_baseline_action_templates_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."baseline_action_templates"("template_id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
-- Columns added for pre-existing (pushed) base tables that lack them.
ALTER TABLE "baseline_action_templates" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'active' NOT NULL;
--> statement-breakpoint
ALTER TABLE "config_packs" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'active' NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "baseline_action_templates_template_id_idx" ON "baseline_action_templates" USING btree ("template_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "baseline_action_template_audit_log_template_id_idx" ON "baseline_action_template_audit_log" USING btree ("template_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "baseline_action_template_audit_log_created_at_idx" ON "baseline_action_template_audit_log" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "config_packs_pack_key_idx" ON "config_packs" USING btree ("pack_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "config_pack_templates_pack_id_idx" ON "config_pack_templates" USING btree ("pack_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "config_pack_templates_template_id_idx" ON "config_pack_templates" USING btree ("template_id");
