ALTER TABLE "opportunities" ADD COLUMN IF NOT EXISTS "state" text DEFAULT 'new' NOT NULL;
