CREATE TABLE IF NOT EXISTS "ai_prompts" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"category" text NOT NULL,
	"feature_area" text DEFAULT '' NOT NULL,
	"feature_route" text DEFAULT '' NOT NULL,
	"model" text,
	"prompt_body" text NOT NULL,
	"default_body" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_prompts_key_unique" UNIQUE("key")
);
