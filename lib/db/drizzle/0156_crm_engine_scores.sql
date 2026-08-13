ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "priority_score" integer NOT NULL DEFAULT 0;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "pricing_influence_score" integer NOT NULL DEFAULT 0;
