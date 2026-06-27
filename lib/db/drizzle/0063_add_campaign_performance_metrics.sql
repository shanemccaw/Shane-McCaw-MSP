ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "leads_generated" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "emails_sent" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "revenue_attributed" numeric(12, 2) DEFAULT '0' NOT NULL;
