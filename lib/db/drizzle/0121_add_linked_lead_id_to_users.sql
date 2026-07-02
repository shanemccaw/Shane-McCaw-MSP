ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "linked_lead_id" integer REFERENCES "leads"("id") ON DELETE SET NULL;
