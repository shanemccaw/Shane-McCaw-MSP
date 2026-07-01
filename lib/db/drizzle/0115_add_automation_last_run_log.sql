ALTER TABLE "insights_automations" ADD COLUMN IF NOT EXISTS "last_run_log" jsonb;
