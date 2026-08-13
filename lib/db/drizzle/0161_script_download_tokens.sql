-- Migration 0160: add platform_published/script_type/schema_version to powershell_scripts
--                 and create script_download_tokens table

ALTER TABLE "powershell_scripts"
  ADD COLUMN IF NOT EXISTS "platform_published" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "script_type" text,
  ADD COLUMN IF NOT EXISTS "schema_version" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "script_download_tokens" (
  "id" serial PRIMARY KEY NOT NULL,
  "token_hash" text NOT NULL UNIQUE,
  "script_id" uuid NOT NULL REFERENCES "powershell_scripts"("id") ON DELETE cascade,
  "msp_id" integer,
  "customer_id" integer REFERENCES "users"("id") ON DELETE set null,
  "client_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "run_result_id" integer REFERENCES "script_run_results"("id") ON DELETE set null,
  "label" text NOT NULL DEFAULT '',
  "expires_at" timestamp with time zone NOT NULL,
  "used_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp NOT NULL DEFAULT now()
);
