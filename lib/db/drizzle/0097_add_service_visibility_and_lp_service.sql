ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "visibility" text DEFAULT 'public' NOT NULL;
ALTER TABLE "landing_pages" ADD COLUMN IF NOT EXISTS "linked_service_id" integer REFERENCES "services"("id") ON DELETE SET NULL;
UPDATE "services" SET "visibility" = 'private' WHERE "is_public" = false AND "visibility" = 'public';
