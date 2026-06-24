CREATE TABLE IF NOT EXISTS "next_best_actions" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL DEFAULT 'general',
	"entity_id" integer,
	"entity_name" text,
	"action" text NOT NULL,
	"rationale" text,
	"confidence" integer DEFAULT 50 NOT NULL,
	"link_path" text,
	"resolved_at" timestamp,
	"generated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "revenue_forecasts" (
	"id" serial PRIMARY KEY NOT NULL,
	"period" text NOT NULL,
	"forecast" numeric(12, 2) NOT NULL,
	"lower_bound" numeric(12, 2) NOT NULL,
	"upper_bound" numeric(12, 2) NOT NULL,
	"narrative" text,
	"generated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "client_health_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"category" text NOT NULL,
	"score" integer NOT NULL,
	"recorded_at" timestamp DEFAULT now() NOT NULL
);
