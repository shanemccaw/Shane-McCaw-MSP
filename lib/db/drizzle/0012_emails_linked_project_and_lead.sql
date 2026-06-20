ALTER TABLE "emails" ADD COLUMN IF NOT EXISTS "linked_project_id" integer REFERENCES "projects"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "emails" ADD COLUMN IF NOT EXISTS "linked_lead_id" integer REFERENCES "leads"("id") ON DELETE SET NULL;
