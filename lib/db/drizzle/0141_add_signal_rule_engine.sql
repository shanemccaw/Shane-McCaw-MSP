ALTER TABLE "engagement_projects" ADD COLUMN IF NOT EXISTS "meaning" text;

CREATE TABLE IF NOT EXISTS "signal_rule_groups" (
	"id" serial PRIMARY KEY NOT NULL,
	"signal_key" text NOT NULL,
	"logic" text DEFAULT 'OR' NOT NULL,
	"label" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "signal_derivation_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"signal_key" text NOT NULL,
	"group_id" integer,
	"rule_type" text NOT NULL,
	"source_key" text NOT NULL,
	"compare_value" text,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "signal_rule_audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"signal_key" text,
	"rule_id" integer,
	"before" jsonb,
	"after" jsonb,
	"admin_user_id" integer,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "signal_rule_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"rule_count" integer NOT NULL,
	"created_by_admin_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "signal_simulation_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"profile_updates" jsonb DEFAULT '{}' NOT NULL,
	"parsed_findings" jsonb DEFAULT '[]' NOT NULL,
	"tags" jsonb DEFAULT '[]' NOT NULL,
	"last_run_at" timestamp,
	"last_run_result" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
