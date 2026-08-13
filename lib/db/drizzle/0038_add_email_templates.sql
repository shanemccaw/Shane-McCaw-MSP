CREATE TABLE IF NOT EXISTS "email_templates" (
	"slug" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"subject" text NOT NULL,
	"body_html" text NOT NULL,
	"variables" jsonb DEFAULT '[]' NOT NULL,
	"updated_at" timestamp NOT NULL DEFAULT now()
);
