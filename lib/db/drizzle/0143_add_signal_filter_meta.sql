ALTER TABLE "insights_generated_documents"
  ADD COLUMN IF NOT EXISTS "signal_filter_meta" jsonb;
