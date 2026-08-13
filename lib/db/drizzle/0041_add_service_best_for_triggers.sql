ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "best_for" text;
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "triggers" jsonb;
