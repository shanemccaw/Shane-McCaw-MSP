ALTER TABLE "insights_generated_documents"
  ADD COLUMN IF NOT EXISTS "sow_pricing_lines" jsonb,
  ADD COLUMN IF NOT EXISTS "sow_total_price" numeric(12,2);
