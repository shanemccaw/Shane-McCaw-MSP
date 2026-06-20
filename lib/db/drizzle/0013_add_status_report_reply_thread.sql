ALTER TABLE "status_reports" ADD COLUMN IF NOT EXISTS "reply_thread" jsonb DEFAULT '[]'::jsonb NOT NULL;
