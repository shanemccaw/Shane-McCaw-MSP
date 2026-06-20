ALTER TABLE "status_reports" ADD COLUMN IF NOT EXISTS "client_status" text NOT NULL DEFAULT 'pending';
ALTER TABLE "status_reports" ADD COLUMN IF NOT EXISTS "client_question" text;
