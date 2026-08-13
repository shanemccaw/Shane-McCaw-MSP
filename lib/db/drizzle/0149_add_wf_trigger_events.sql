CREATE TABLE IF NOT EXISTS "wf_trigger_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "trigger_id" integer NOT NULL REFERENCES "wf_triggers"("id") ON DELETE CASCADE,
  "run_id" integer REFERENCES "wf_runs"("id") ON DELETE SET NULL,
  "status" text NOT NULL,
  "duration_ms" integer,
  "payload" jsonb,
  "error_message" text,
  "fired_at" timestamp DEFAULT now() NOT NULL
);
