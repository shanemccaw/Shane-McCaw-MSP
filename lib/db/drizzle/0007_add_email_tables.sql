CREATE TABLE IF NOT EXISTS "emails" (
	"id" serial PRIMARY KEY NOT NULL,
	"message_id" text NOT NULL UNIQUE,
	"subject" text,
	"sender_address" text NOT NULL,
	"sender_domain" text NOT NULL,
	"body_preview" text,
	"received_at" timestamp NOT NULL,
	"raw_from" text,
	"linked_user_id" integer REFERENCES "users"("id"),
	"ingested_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_domain_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"domain" text NOT NULL UNIQUE,
	"linked_user_id" integer NOT NULL REFERENCES "users"("id"),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "graph_subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"subscription_id" text NOT NULL UNIQUE,
	"resource" text NOT NULL,
	"expiration_date_time" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
