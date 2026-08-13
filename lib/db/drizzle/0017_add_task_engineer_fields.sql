ALTER TABLE workflow_template_step_tasks ADD COLUMN IF NOT EXISTS instructions jsonb;
ALTER TABLE workflow_template_step_tasks ADD COLUMN IF NOT EXISTS checklist jsonb;
ALTER TABLE workflow_template_step_tasks ADD COLUMN IF NOT EXISTS artifacts_produced jsonb;
ALTER TABLE workflow_template_step_tasks ADD COLUMN IF NOT EXISTS client_deliverables jsonb;
