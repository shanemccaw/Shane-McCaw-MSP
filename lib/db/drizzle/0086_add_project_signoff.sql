ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "signed_off_at" timestamp;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "signed_off_by" integer REFERENCES "users"("id");
