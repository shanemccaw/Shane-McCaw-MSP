ALTER TABLE "kanban_tasks" ADD COLUMN IF NOT EXISTS "source_email_id" integer REFERENCES "emails"("id") ON DELETE SET NULL;
