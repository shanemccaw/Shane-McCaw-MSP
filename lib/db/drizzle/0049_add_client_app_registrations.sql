CREATE TABLE IF NOT EXISTS "client_app_registrations" (
        "id" serial PRIMARY KEY NOT NULL,
        "client_user_id" integer NOT NULL,
        "tenant_id" text NOT NULL,
        "azure_client_id" text NOT NULL,
        "key_vault_secret_name" text NOT NULL,
        "status" text DEFAULT 'pending' NOT NULL,
        "submitted_at" timestamp,
        "verified_at" timestamp,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "updated_at" timestamp DEFAULT now() NOT NULL,
        CONSTRAINT "client_app_registrations_client_user_id_unique" UNIQUE("client_user_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_app_registrations" ADD CONSTRAINT "client_app_registrations_client_user_id_users_id_fk" FOREIGN KEY ("client_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
