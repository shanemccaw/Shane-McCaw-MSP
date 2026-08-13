-- M365 Command Center: script catalog, package-script mappings, run results, client scores

CREATE TABLE IF NOT EXISTS "script_catalog" (
  "id" serial PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "runbook_name" text NOT NULL,
  "app_reg_permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "ai_instructions" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "package_scripts" (
  "id" serial PRIMARY KEY NOT NULL,
  "package_id" integer NOT NULL,
  "script_id" integer NOT NULL,
  "run_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "package_scripts_package_id_run_order_unique" ON "package_scripts" ("package_id","run_order");

CREATE TABLE IF NOT EXISTS "script_run_results" (
  "id" serial PRIMARY KEY NOT NULL,
  "customer_id" integer,
  "script_id" integer NOT NULL,
  "package_id" integer,
  "job_id" text,
  "raw_output" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "parsed_findings" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "recommendations" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "score_impact" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "profile_updates" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "status" text DEFAULT 'running' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "client_scores" (
  "id" serial PRIMARY KEY NOT NULL,
  "client_id" integer NOT NULL,
  "identity" integer DEFAULT 0 NOT NULL,
  "security" integer DEFAULT 0 NOT NULL,
  "collaboration" integer DEFAULT 0 NOT NULL,
  "compliance" integer DEFAULT 0 NOT NULL,
  "copilot_readiness" integer DEFAULT 0 NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "client_scores" ADD CONSTRAINT "client_scores_client_id_unique" UNIQUE("client_id");

DO $$ BEGIN
  ALTER TABLE "package_scripts" ADD CONSTRAINT "package_scripts_package_id_services_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."services"("id") ON DELETE CASCADE ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "package_scripts" ADD CONSTRAINT "package_scripts_script_id_script_catalog_id_fk" FOREIGN KEY ("script_id") REFERENCES "public"."script_catalog"("id") ON DELETE CASCADE ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "script_run_results" ADD CONSTRAINT "script_run_results_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "script_run_results" ADD CONSTRAINT "script_run_results_script_id_script_catalog_id_fk" FOREIGN KEY ("script_id") REFERENCES "public"."script_catalog"("id") ON DELETE CASCADE ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "script_run_results" ADD CONSTRAINT "script_run_results_package_id_services_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."services"("id") ON DELETE SET NULL ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "client_scores" ADD CONSTRAINT "client_scores_client_id_users_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
