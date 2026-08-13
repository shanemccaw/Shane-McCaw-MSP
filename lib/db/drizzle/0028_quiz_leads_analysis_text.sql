ALTER TABLE "quiz_leads" ADD COLUMN IF NOT EXISTS "analysis_text" jsonb DEFAULT '{}';
