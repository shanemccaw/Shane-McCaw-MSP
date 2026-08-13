ALTER TABLE "ai_prompts" ADD COLUMN IF NOT EXISTS "draft_body" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_prompt_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"prompt_id" integer NOT NULL,
	"version_number" integer NOT NULL,
	"body" text NOT NULL,
	"action" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_prompt_versions" ADD CONSTRAINT "ai_prompt_versions_prompt_id_ai_prompts_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "public"."ai_prompts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
