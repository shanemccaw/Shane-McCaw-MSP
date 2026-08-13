CREATE TABLE IF NOT EXISTS "analytics_sessions" (
	"session_id" text PRIMARY KEY NOT NULL,
	"entry_page" text NOT NULL DEFAULT '/',
	"referrer" text,
	"utm_source" text,
	"utm_medium" text,
	"utm_campaign" text,
	"utm_content" text,
	"utm_term" text,
	"device_type" text,
	"browser" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	"total_seconds" integer NOT NULL DEFAULT 0,
	"is_bounce" boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS "analytics_pageviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"page" text NOT NULL,
	"title" text,
	"entered_at" timestamp DEFAULT now() NOT NULL,
	"exited_at" timestamp,
	"duration_seconds" integer,
	"max_scroll_pct" integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS "analytics_site_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"page" text NOT NULL,
	"event_type" text NOT NULL,
	"element_label" text,
	"element_href" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "analytics_sessions_started_at_idx" ON "analytics_sessions" ("started_at");
CREATE INDEX IF NOT EXISTS "analytics_sessions_last_seen_idx" ON "analytics_sessions" ("last_seen_at");
CREATE INDEX IF NOT EXISTS "analytics_pageviews_session_idx" ON "analytics_pageviews" ("session_id");
CREATE INDEX IF NOT EXISTS "analytics_pageviews_entered_at_idx" ON "analytics_pageviews" ("entered_at");
CREATE INDEX IF NOT EXISTS "analytics_site_events_session_idx" ON "analytics_site_events" ("session_id");
CREATE INDEX IF NOT EXISTS "analytics_site_events_created_at_idx" ON "analytics_site_events" ("created_at");
