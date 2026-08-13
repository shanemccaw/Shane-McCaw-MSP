CREATE TABLE IF NOT EXISTS "quiz_analytics_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_name" text NOT NULL,
	"properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
