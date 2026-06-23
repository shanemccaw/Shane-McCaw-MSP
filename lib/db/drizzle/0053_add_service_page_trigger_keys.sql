CREATE TABLE IF NOT EXISTS "service_page_trigger_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"page_slug" text NOT NULL,
	"trigger_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "service_page_trigger_keys_page_slug_unique" UNIQUE("page_slug")
);
