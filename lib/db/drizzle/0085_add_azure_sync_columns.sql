ALTER TABLE "script_catalog" ADD COLUMN IF NOT EXISTS "azure_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "powershell_scripts" ADD COLUMN IF NOT EXISTS "azure_runbook_name" text;--> statement-breakpoint
ALTER TABLE "powershell_scripts" ADD COLUMN IF NOT EXISTS "azure_synced_at" timestamp with time zone;
