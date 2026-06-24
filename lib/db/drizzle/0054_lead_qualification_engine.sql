-- Lead Qualification Engine: extend leads table + create new tables

-- Extend leads table with qualification engine fields
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "score" integer NOT NULL DEFAULT 0;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "previous_score" integer NOT NULL DEFAULT 0;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "stage" text NOT NULL DEFAULT 'Lead';
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "last_qualified_at" timestamp;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "industry" text;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "employee_count" integer;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "license_tier" text;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "tenant_age" integer;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "it_team_size" integer;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "pain_points" jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "maturity_indicators" jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "engagement_signals" jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "urgency_signals" jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint

-- Create opportunities table
CREATE TABLE IF NOT EXISTS "opportunities" (
	"id" serial PRIMARY KEY NOT NULL,
	"lead_id" integer NOT NULL,
	"score_snapshot" integer NOT NULL DEFAULT 0,
	"score_fit" integer NOT NULL DEFAULT 0,
	"score_pain" integer NOT NULL DEFAULT 0,
	"score_maturity" integer NOT NULL DEFAULT 0,
	"score_intent" integer NOT NULL DEFAULT 0,
	"score_urgency" integer NOT NULL DEFAULT 0,
	"evidence" jsonb NOT NULL DEFAULT '[]'::jsonb,
	"recommended_next_step" text,
	"workflow_type" text,
	"project_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- Create opportunity_tasks table
CREATE TABLE IF NOT EXISTS "opportunity_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"opportunity_id" integer NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"due_date" timestamp,
	"assigned_to" text NOT NULL DEFAULT 'Shane',
	"status" text NOT NULL DEFAULT 'todo',
	"kanban_task_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- Create lead_qualifications table
CREATE TABLE IF NOT EXISTS "lead_qualifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"lead_id" integer NOT NULL,
	"new_score" integer NOT NULL,
	"previous_score" integer NOT NULL DEFAULT 0,
	"stage" text NOT NULL,
	"recommended_next_step" text,
	"workflow_type" text,
	"evidence" jsonb NOT NULL DEFAULT '[]'::jsonb,
	"score_fit" integer NOT NULL DEFAULT 0,
	"score_pain" integer NOT NULL DEFAULT 0,
	"score_maturity" integer NOT NULL DEFAULT 0,
	"score_intent" integer NOT NULL DEFAULT 0,
	"score_urgency" integer NOT NULL DEFAULT 0,
	"status" text NOT NULL DEFAULT 'pending',
	"snoozed_until" timestamp,
	"opportunity_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- Foreign keys
DO $$ BEGIN
 ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "opportunity_tasks" ADD CONSTRAINT "opportunity_tasks_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lead_qualifications" ADD CONSTRAINT "lead_qualifications_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lead_qualifications" ADD CONSTRAINT "lead_qualifications_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
