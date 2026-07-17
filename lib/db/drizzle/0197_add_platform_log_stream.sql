-- Platform Log Stream — DB mirror of pino log output (Phase 1a).
-- Hand-authored idempotent migration (CREATE TABLE / INDEX IF NOT EXISTS)
-- matching the 0193/0194 pattern, since this table is added outside
-- `drizzle-kit generate` (schema-drift-safe, re-runnable either way).

CREATE TABLE IF NOT EXISTS "platform_log_stream" (
	"id" serial PRIMARY KEY NOT NULL,
	"channel" text NOT NULL,
	"level" text NOT NULL,
	"message" text NOT NULL,
	"meta" jsonb,
	"correlation_id" uuid,
	"msp_id" integer,
	"customer_id" integer,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_log_stream_channel_idx" ON "platform_log_stream" ("channel");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_log_stream_correlation_id_idx" ON "platform_log_stream" ("correlation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_log_stream_msp_id_idx" ON "platform_log_stream" ("msp_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_log_stream_occurred_at_idx" ON "platform_log_stream" ("occurred_at");
