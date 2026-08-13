ALTER TABLE "email_events" ADD COLUMN IF NOT EXISTS "campaign_id" integer REFERENCES "campaigns"("id") ON DELETE SET NULL;
