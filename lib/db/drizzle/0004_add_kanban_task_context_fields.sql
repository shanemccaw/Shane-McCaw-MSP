ALTER TABLE "kanban_tasks" ADD COLUMN IF NOT EXISTS "waiting_reason" text;
ALTER TABLE "kanban_tasks" ADD COLUMN IF NOT EXISTS "completion_status" text;
ALTER TABLE "kanban_tasks" ADD COLUMN IF NOT EXISTS "completion_notes" text;
