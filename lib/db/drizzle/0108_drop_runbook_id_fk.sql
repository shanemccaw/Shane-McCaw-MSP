-- runbook_id must accept UUIDs from both powershell_scripts AND script_modules.
-- The FK to powershell_scripts blocked module UUIDs from being assigned,
-- causing "Failed to assign module to task" errors in the Admin Panel.
-- All code that reads runbook_id already resolves it against both tables.
ALTER TABLE "workflow_template_step_tasks"
  DROP CONSTRAINT IF EXISTS "workflow_template_step_tasks_runbook_id_fk";
