-- Test Suite Runner v1 — ordered multi-step test suites + per-run results.
-- Hand-authored idempotent migration (CREATE TABLE / INDEX IF NOT EXISTS)
-- matching the 0197/0198 pattern, since these tables are added outside
-- `drizzle-kit generate` (schema-drift-safe, re-runnable either way).
-- saved_sql_scripts has existed only in schema TS (no migration anywhere), so
-- it is created here too before the is_reset_script column is added.

CREATE TABLE IF NOT EXISTS "saved_sql_scripts" (
    "id" serial PRIMARY KEY NOT NULL,
    "name" text NOT NULL,
    "category" text NOT NULL,
    "query" text NOT NULL,
    "is_destructive" boolean DEFAULT false,
    "is_reset_script" boolean DEFAULT false,
    "created_at" timestamp DEFAULT now(),
    "updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "saved_sql_scripts" ADD COLUMN IF NOT EXISTS "is_reset_script" boolean DEFAULT false;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "test_suites" (
    "id" serial PRIMARY KEY NOT NULL,
    "name" text NOT NULL,
    "steps" jsonb NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "test_suite_runs" (
    "id" serial PRIMARY KEY NOT NULL,
    "suite_id" integer NOT NULL REFERENCES "test_suites"("id") ON DELETE CASCADE,
    "status" text DEFAULT 'running' NOT NULL,
    "step_results" jsonb,
    "testbed_customer_id" integer,
    "started_at" timestamp with time zone DEFAULT now() NOT NULL,
    "completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "test_suite_runs_suite_id_idx" ON "test_suite_runs" ("suite_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "test_suite_runs_started_at_idx" ON "test_suite_runs" ("started_at");
