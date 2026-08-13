CREATE TABLE IF NOT EXISTS "email_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "email_id" text NOT NULL,
  "event_type" text NOT NULL,
  "recipient" text,
  "subject" text,
  "occurred_at" timestamp DEFAULT now() NOT NULL,
  "metadata" jsonb DEFAULT '{}'
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_email_events_event_type" ON "email_events" ("event_type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_email_events_occurred_at" ON "email_events" ("occurred_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "seo_rankings" (
  "id" serial PRIMARY KEY NOT NULL,
  "keyword" text NOT NULL,
  "position" integer NOT NULL,
  "previous_position" integer,
  "url" text,
  "search_volume" integer,
  "notes" text,
  "checked_at" timestamp DEFAULT now() NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
