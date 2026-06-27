ALTER TABLE "email_events" ADD COLUMN IF NOT EXISTS "lead_id" integer REFERENCES "leads"("id") ON DELETE SET NULL;
