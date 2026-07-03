CREATE TABLE IF NOT EXISTS "client_presentations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_email" text NOT NULL,
	"project_title" text NOT NULL,
	"html" text NOT NULL,
	"checkout_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp
);
