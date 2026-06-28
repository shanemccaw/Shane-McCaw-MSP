ALTER TABLE "workflow_template_step_tasks" DROP CONSTRAINT IF EXISTS "workflow_template_step_tasks_runbook_id_fkey";--> statement-breakpoint
ALTER TABLE "workflow_template_step_tasks" DROP CONSTRAINT IF EXISTS "workflow_template_step_tasks_runbook_id_powershell_scripts_id_fk";--> statement-breakpoint
ALTER TABLE "workflow_template_step_tasks" ALTER COLUMN "runbook_id" SET DATA TYPE text;
