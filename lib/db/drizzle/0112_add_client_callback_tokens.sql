CREATE TABLE IF NOT EXISTS "client_callback_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL UNIQUE,
	"label" text NOT NULL DEFAULT '',
	"client_user_id" integer NOT NULL,
	"project_id" integer,
	"script_run_result_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"revoked_at" timestamp,
	"last_used_at" timestamp,
	CONSTRAINT "client_callback_tokens_token_hash_unique" UNIQUE("token_hash")
);

CREATE INDEX IF NOT EXISTS "client_callback_tokens_project_id_idx" ON "client_callback_tokens" ("project_id");

DO $$ BEGIN
 ALTER TABLE "client_callback_tokens" ADD CONSTRAINT "client_callback_tokens_client_user_id_users_id_fk" FOREIGN KEY ("client_user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "client_callback_tokens" ADD CONSTRAINT "client_callback_tokens_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "client_callback_tokens" ADD CONSTRAINT "client_callback_tokens_script_run_result_id_script_run_results_id_fk" FOREIGN KEY ("script_run_result_id") REFERENCES "script_run_results"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
