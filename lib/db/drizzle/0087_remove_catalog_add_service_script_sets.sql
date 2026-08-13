-- Migration: 0087_remove_catalog_add_service_script_sets
-- Removes script catalog tables (replaced by Library + Script Packages)
-- Adds library_script_id column to script_run_results
-- Adds service_script_sets join table

-- Drop FK constraints that reference script_catalog before dropping the table
ALTER TABLE "script_run_results" DROP CONSTRAINT IF EXISTS "script_run_results_script_id_script_catalog_id_fk";--> statement-breakpoint
ALTER TABLE "script_run_results" ALTER COLUMN "script_id" DROP NOT NULL;--> statement-breakpoint

DROP TABLE IF EXISTS "script_catalog_categories" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "package_scripts" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "script_categories" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "script_catalog" CASCADE;--> statement-breakpoint

ALTER TABLE "script_run_results" ADD COLUMN IF NOT EXISTS "library_script_id" uuid REFERENCES "powershell_scripts"("id") ON DELETE SET NULL;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "service_script_sets" (
  "service_id" integer NOT NULL,
  "script_package_id" uuid NOT NULL,
  "display_order" integer DEFAULT 0 NOT NULL,
  CONSTRAINT "service_script_sets_service_id_script_package_id_pk" PRIMARY KEY("service_id","script_package_id")
);--> statement-breakpoint

ALTER TABLE "service_script_sets" ADD CONSTRAINT "service_script_sets_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_script_sets" ADD CONSTRAINT "service_script_sets_script_package_id_script_packages_id_fk" FOREIGN KEY ("script_package_id") REFERENCES "public"."script_packages"("id") ON DELETE cascade ON UPDATE no action;
