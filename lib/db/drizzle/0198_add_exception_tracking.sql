-- Exception Tracking — grouped errors + per-instance occurrences (Phase 1.5).
-- Hand-authored idempotent migration (CREATE TABLE / INDEX IF NOT EXISTS)
-- matching the 0197 pattern, since these tables are added outside
-- `drizzle-kit generate` (schema-drift-safe, re-runnable either way).

CREATE TABLE IF NOT EXISTS "exception_groups" (
    "fingerprint" text PRIMARY KEY NOT NULL,
    "error_name" text NOT NULL,
    "error_message" text NOT NULL,
    "file" text,
    "line" integer,
    "function_name" text,
    "code_frame" text,
    "stack_sample" text,
    "channel" text NOT NULL,
    "source" text NOT NULL,
    "status" text DEFAULT 'open' NOT NULL,
    "occurrence_count" integer DEFAULT 1 NOT NULL,
    "first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
    "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
    "resolved_at" timestamp with time zone,
    "resolved_by" integer,
    "resolution_note" text,
    "suppressed_at" timestamp with time zone,
    "suppressed_by" integer,
    "suppression_reason" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "exception_occurrences" (
    "id" serial PRIMARY KEY NOT NULL,
    "fingerprint" text NOT NULL,
    "correlation_id" uuid,
    "channel" text NOT NULL,
    "msp_id" integer,
    "customer_id" integer,
    "occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "exception_groups_status_idx" ON "exception_groups" ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "exception_groups_last_seen_idx" ON "exception_groups" ("last_seen_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "exception_occurrences_fingerprint_idx" ON "exception_occurrences" ("fingerprint");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "exception_occurrences_correlation_id_idx" ON "exception_occurrences" ("correlation_id");
