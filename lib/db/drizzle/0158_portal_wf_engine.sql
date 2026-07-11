-- MSP Portal Workflow Engine tables
-- Idempotent (CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS "portal_wf_workflows" (
  "id" serial PRIMARY KEY,
  "workflow_key" text NOT NULL UNIQUE,
  "label" text NOT NULL,
  "description" text,
  "graph" jsonb NOT NULL DEFAULT '{"nodes":[],"edges":[]}',
  "retry_policy" jsonb NOT NULL DEFAULT '{"maxAttempts":3,"backoffBaseSeconds":30,"backoffMultiplier":2}',
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "portal_wf_start_mappings" (
  "id" serial PRIMARY KEY,
  "event_pattern" text NOT NULL,
  "workflow_key" text NOT NULL REFERENCES "portal_wf_workflows"("workflow_key") ON DELETE CASCADE,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "portal_wf_start_mappings_event_pattern_idx" ON "portal_wf_start_mappings"("event_pattern");
CREATE INDEX IF NOT EXISTS "portal_wf_start_mappings_workflow_key_idx" ON "portal_wf_start_mappings"("workflow_key");
CREATE UNIQUE INDEX IF NOT EXISTS "portal_wf_start_mappings_pattern_wf_idx" ON "portal_wf_start_mappings"("event_pattern", "workflow_key");

CREATE TABLE IF NOT EXISTS "portal_wf_runs" (
  "id" serial PRIMARY KEY,
  "run_id" uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  "workflow_key" text NOT NULL,
  "tenant_context" jsonb NOT NULL DEFAULT '{}',
  "status" text NOT NULL DEFAULT 'pending',
  "trigger_event_id" uuid,
  "trigger_event_type" text,
  "input_payload" jsonb NOT NULL DEFAULT '{}',
  "output" jsonb,
  "error_message" text,
  "started_at" timestamptz,
  "completed_at" timestamptz,
  "msp_id" integer,
  "customer_id" integer,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "portal_wf_runs_workflow_key_idx" ON "portal_wf_runs"("workflow_key");
CREATE INDEX IF NOT EXISTS "portal_wf_runs_status_idx" ON "portal_wf_runs"("status");
CREATE INDEX IF NOT EXISTS "portal_wf_runs_msp_id_idx" ON "portal_wf_runs"("msp_id");
CREATE INDEX IF NOT EXISTS "portal_wf_runs_customer_id_idx" ON "portal_wf_runs"("customer_id");
CREATE INDEX IF NOT EXISTS "portal_wf_runs_created_at_idx" ON "portal_wf_runs"("created_at");

CREATE TABLE IF NOT EXISTS "portal_wf_node_outputs" (
  "id" serial PRIMARY KEY,
  "run_id" uuid NOT NULL REFERENCES "portal_wf_runs"("run_id") ON DELETE CASCADE,
  "node_id" text NOT NULL,
  "node_type" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "attempt_count" integer NOT NULL DEFAULT 0,
  "input_payload" jsonb,
  "output_payload" jsonb,
  "error_message" text,
  "error_stack" text,
  "started_at" timestamptz,
  "completed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "portal_wf_node_outputs_run_id_idx" ON "portal_wf_node_outputs"("run_id");
CREATE UNIQUE INDEX IF NOT EXISTS "portal_wf_node_outputs_run_node_idx" ON "portal_wf_node_outputs"("run_id", "node_id");

CREATE TABLE IF NOT EXISTS "portal_wf_operator_tasks" (
  "id" serial PRIMARY KEY,
  "task_id" uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  "run_id" uuid NOT NULL REFERENCES "portal_wf_runs"("run_id") ON DELETE CASCADE,
  "workflow_key" text NOT NULL,
  "node_id" text,
  "severity" text NOT NULL DEFAULT 'error',
  "title" text NOT NULL,
  "description" text,
  "deep_link" text,
  "status" text NOT NULL DEFAULT 'open',
  "resolved_at" timestamptz,
  "resolved_by_user_id" integer,
  "msp_id" integer,
  "customer_id" integer,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "portal_wf_operator_tasks_run_id_idx" ON "portal_wf_operator_tasks"("run_id");
CREATE INDEX IF NOT EXISTS "portal_wf_operator_tasks_status_idx" ON "portal_wf_operator_tasks"("status");
CREATE INDEX IF NOT EXISTS "portal_wf_operator_tasks_msp_id_idx" ON "portal_wf_operator_tasks"("msp_id");

CREATE TABLE IF NOT EXISTS "portal_wf_idempotency" (
  "id" serial PRIMARY KEY,
  "side_effect_key" text NOT NULL UNIQUE,
  "run_id" uuid NOT NULL,
  "node_id" text NOT NULL,
  "executed_at" timestamptz NOT NULL DEFAULT now(),
  "result" jsonb
);
CREATE INDEX IF NOT EXISTS "portal_wf_idempotency_run_id_idx" ON "portal_wf_idempotency"("run_id");
