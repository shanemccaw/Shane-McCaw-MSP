ALTER TABLE "status_reports" ADD COLUMN IF NOT EXISTS "admin_reply" text;
ALTER TABLE "kanban_tasks" ADD COLUMN IF NOT EXISTS "status_report_id" integer REFERENCES "status_reports"("id") ON DELETE SET NULL;
