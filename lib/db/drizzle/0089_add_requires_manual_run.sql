ALTER TABLE "workflow_template_step_tasks" ADD COLUMN IF NOT EXISTS "requires_manual_run" boolean DEFAULT false;
