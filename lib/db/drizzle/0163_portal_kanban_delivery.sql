ALTER TABLE "kanban_tasks" ADD COLUMN IF NOT EXISTS "public_notes" TEXT;
ALTER TABLE "kanban_tasks" ADD COLUMN IF NOT EXISTS "internal_notes" TEXT;
