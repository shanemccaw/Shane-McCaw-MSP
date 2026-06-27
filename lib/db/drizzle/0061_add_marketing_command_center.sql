-- Marketing Command Center: new tables and lead field extensions

-- Extend leads table with marketing-oriented fields
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "role" text;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "phone" text;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "location" text;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "notes" text;

-- AI-recommended leads
CREATE TABLE IF NOT EXISTS "recommended_leads" (
  "id" serial PRIMARY KEY,
  "name" text NOT NULL,
  "company" text,
  "role" text,
  "email" text,
  "phone" text,
  "industry" text,
  "company_size" text,
  "location" text,
  "pain_points" jsonb NOT NULL DEFAULT '[]',
  "why_fit" text,
  "recommended_service" text,
  "confidence" integer NOT NULL DEFAULT 0,
  "status" text NOT NULL DEFAULT 'pending',
  "converted_lead_id" integer REFERENCES "leads"("id") ON DELETE SET NULL,
  "generated_at" timestamp NOT NULL DEFAULT now(),
  "created_at" timestamp NOT NULL DEFAULT now()
);

-- Outreach content templates
CREATE TABLE IF NOT EXISTS "outreach_templates" (
  "id" serial PRIMARY KEY,
  "name" text NOT NULL,
  "template_type" text NOT NULL,
  "subject" text,
  "body" text NOT NULL,
  "lead_id" integer REFERENCES "leads"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

-- Marketing tasks kanban board
CREATE TABLE IF NOT EXISTS "marketing_tasks" (
  "id" serial PRIMARY KEY,
  "title" text NOT NULL,
  "description" text,
  "status" text NOT NULL DEFAULT 'ideas',
  "order" integer NOT NULL DEFAULT 0,
  "due_date" timestamp,
  "related_lead_id" integer REFERENCES "leads"("id") ON DELETE SET NULL,
  "related_campaign_id" integer,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

-- Campaigns
CREATE TABLE IF NOT EXISTS "campaigns" (
  "id" serial PRIMARY KEY,
  "name" text NOT NULL,
  "goal" text NOT NULL,
  "audience" text NOT NULL,
  "offer" text NOT NULL,
  "status" text NOT NULL DEFAULT 'draft',
  "start_date" timestamp,
  "end_date" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

-- Campaign assets (generated content)
CREATE TABLE IF NOT EXISTS "campaign_assets" (
  "id" serial PRIMARY KEY,
  "campaign_id" integer REFERENCES "campaigns"("id") ON DELETE CASCADE,
  "asset_type" text NOT NULL,
  "title" text NOT NULL,
  "content" text NOT NULL,
  "metadata" jsonb DEFAULT '{}',
  "created_at" timestamp NOT NULL DEFAULT now()
);
