CREATE TABLE IF NOT EXISTS "runbook_job_history" (
        "id" serial PRIMARY KEY NOT NULL,
        "job_id" text NOT NULL,
        "runbook_name" text NOT NULL,
        "credential_id" integer,
        "customer_name" text NOT NULL,
        "status" text DEFAULT 'New' NOT NULL,
        "output" text,
        "started_at" timestamp DEFAULT now() NOT NULL,
        "completed_at" timestamp,
        "created_at" timestamp DEFAULT now() NOT NULL,
        CONSTRAINT "runbook_job_history_job_id_unique" UNIQUE("job_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "runbook_job_history" ADD CONSTRAINT "runbook_job_history_credential_id_azure_tenant_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."azure_tenant_credentials"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
