CREATE TABLE IF NOT EXISTS "wf_definitions" (
  "id" serial PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "concurrency_limit" integer NOT NULL DEFAULT 5,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "wf_versions" (
  "id" serial PRIMARY KEY NOT NULL,
  "definition_id" integer NOT NULL REFERENCES "wf_definitions"("id") ON DELETE CASCADE,
  "version_number" integer NOT NULL DEFAULT 1,
  "label" text,
  "status" text NOT NULL DEFAULT 'draft',
  "graph" jsonb NOT NULL DEFAULT '{"nodes":[],"edges":[]}',
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "wf_runs" (
  "id" serial PRIMARY KEY NOT NULL,
  "version_id" integer NOT NULL REFERENCES "wf_versions"("id") ON DELETE CASCADE,
  "definition_id" integer NOT NULL REFERENCES "wf_definitions"("id") ON DELETE CASCADE,
  "trigger_type" text NOT NULL DEFAULT 'manual',
  "trigger_ref" text,
  "status" text NOT NULL DEFAULT 'pending',
  "payload" jsonb NOT NULL DEFAULT '{}',
  "branch_path" jsonb NOT NULL DEFAULT '[]',
  "started_at" timestamp,
  "finished_at" timestamp,
  "error_message" text,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "wf_run_node_logs" (
  "id" serial PRIMARY KEY NOT NULL,
  "run_id" integer NOT NULL REFERENCES "wf_runs"("id") ON DELETE CASCADE,
  "node_id" text NOT NULL,
  "level" text NOT NULL DEFAULT 'info',
  "message" text NOT NULL,
  "timestamp" timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "wf_run_node_outputs" (
  "id" serial PRIMARY KEY NOT NULL,
  "run_id" integer NOT NULL REFERENCES "wf_runs"("id") ON DELETE CASCADE,
  "node_id" text NOT NULL,
  "input" jsonb NOT NULL DEFAULT '{}',
  "output" jsonb NOT NULL DEFAULT '{}',
  "duration_ms" integer,
  "status" text NOT NULL DEFAULT 'ok',
  "error_message" text,
  "timestamp" timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "wf_triggers" (
  "id" serial PRIMARY KEY NOT NULL,
  "definition_id" integer NOT NULL REFERENCES "wf_definitions"("id") ON DELETE CASCADE,
  "type" text NOT NULL,
  "config" jsonb NOT NULL DEFAULT '{}',
  "webhook_token" text UNIQUE,
  "next_run_at" timestamp,
  "enabled" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT now()
);
