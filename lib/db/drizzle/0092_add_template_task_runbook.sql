ALTER TABLE workflow_template_step_tasks
  ADD COLUMN IF NOT EXISTS runbook_id uuid REFERENCES powershell_scripts(id) ON DELETE SET NULL;
