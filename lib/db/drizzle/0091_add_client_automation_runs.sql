CREATE TABLE IF NOT EXISTS "client_automation_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_user_id" integer NOT NULL,
	"triggered_at" timestamp DEFAULT now() NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"current_package_id" uuid,
	"current_module_id" uuid,
	"modules_completed" integer DEFAULT 0 NOT NULL,
	"modules_total" integer DEFAULT 0 NOT NULL,
	"last_log_snippet" text,
	"error_message" text,
	"finished_at" timestamp,
	CONSTRAINT "client_automation_runs_status_check" CHECK (status IN ('pending','running','completed','failed'))
);
--> statement-breakpoint
ALTER TABLE "client_automation_runs" ADD CONSTRAINT "client_automation_runs_client_user_id_users_id_fk" FOREIGN KEY ("client_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
