ALTER TABLE "checkout_sessions" ADD COLUMN IF NOT EXISTS "seats" integer NOT NULL DEFAULT 1;
