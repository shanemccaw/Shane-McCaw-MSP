CREATE TABLE IF NOT EXISTS "quick_win_result_shares" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_user_id" integer NOT NULL,
	"share_token" text NOT NULL,
	"scores_snapshot" jsonb NOT NULL,
	"latest_date" timestamp,
	"expires_at" timestamp NOT NULL,
	"view_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "quick_win_result_shares_share_token_unique" UNIQUE("share_token")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "quick_win_result_shares" ADD CONSTRAINT "quick_win_result_shares_client_user_id_users_id_fk" FOREIGN KEY ("client_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
