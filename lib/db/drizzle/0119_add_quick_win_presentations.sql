CREATE TABLE IF NOT EXISTS "quick_win_presentations" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer,
	"client_user_id" integer,
	"share_token" text,
	"documents_included" jsonb,
	"sow_phases" jsonb,
	"selected_phase_ids" jsonb,
	"total_price" numeric,
	"signature_data" text,
	"signed_at" timestamp,
	"signer_name" text,
	"payment_plan" text,
	"stripe_session_id" text,
	"payment_schedule" jsonb,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "quick_win_presentations_share_token_unique" UNIQUE("share_token")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "quick_win_presentations" ADD CONSTRAINT "quick_win_presentations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "quick_win_presentations" ADD CONSTRAINT "quick_win_presentations_client_user_id_users_id_fk" FOREIGN KEY ("client_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
