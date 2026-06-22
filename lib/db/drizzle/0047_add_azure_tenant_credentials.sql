CREATE TABLE IF NOT EXISTS "azure_tenant_credentials" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_user_id" integer,
	"display_name" text NOT NULL,
	"tenant_id" text NOT NULL,
	"client_id" text NOT NULL,
	"credential_type" text DEFAULT 'secret' NOT NULL,
	"key_vault_secret_name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "azure_tenant_credentials" ADD CONSTRAINT "azure_tenant_credentials_client_user_id_users_id_fk" FOREIGN KEY ("client_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
