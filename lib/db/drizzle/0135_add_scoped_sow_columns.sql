ALTER TABLE "quick_win_presentations" ADD COLUMN IF NOT EXISTS "scoped_sow_html" text;
ALTER TABLE "quick_win_presentations" ADD COLUMN IF NOT EXISTS "scoped_total_price" integer;
ALTER TABLE "quick_win_presentations" ADD COLUMN IF NOT EXISTS "scoped_phase_ids" jsonb;
