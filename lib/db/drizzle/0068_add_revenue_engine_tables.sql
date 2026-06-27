-- Lead intent events (hot-score signal stream)
CREATE TABLE IF NOT EXISTS "lead_intent_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "lead_id" integer NOT NULL REFERENCES "leads"("id") ON DELETE CASCADE,
  "event_type" text NOT NULL,
  "metadata" jsonb DEFAULT '{}',
  "occurred_at" timestamp DEFAULT now() NOT NULL
);

-- Follow-up events
CREATE TABLE IF NOT EXISTS "follow_up_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "lead_id" integer REFERENCES "leads"("id") ON DELETE SET NULL,
  "campaign_id" integer REFERENCES "campaigns"("id") ON DELETE SET NULL,
  "scheduled_at" timestamp NOT NULL,
  "completed_at" timestamp,
  "channel" text DEFAULT 'email' NOT NULL,
  "subject" text,
  "ai_draft_content" text,
  "status" text DEFAULT 'pending' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

-- Offers
CREATE TABLE IF NOT EXISTS "offers" (
  "id" serial PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "goal" text NOT NULL,
  "audience" text NOT NULL,
  "pricing" text,
  "deliverables" jsonb DEFAULT '[]' NOT NULL,
  "outcomes" jsonb DEFAULT '[]' NOT NULL,
  "cta" text,
  "campaign_id" integer REFERENCES "campaigns"("id") ON DELETE SET NULL,
  "metadata" jsonb DEFAULT '{}',
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

-- Landing pages
CREATE TABLE IF NOT EXISTS "landing_pages" (
  "id" serial PRIMARY KEY NOT NULL,
  "slug" text NOT NULL UNIQUE,
  "title" text NOT NULL,
  "campaign_id" integer REFERENCES "campaigns"("id") ON DELETE SET NULL,
  "headline" text,
  "subheadline" text,
  "value_prop_blocks" jsonb DEFAULT '[]' NOT NULL,
  "social_proof" jsonb DEFAULT '[]' NOT NULL,
  "cta" jsonb DEFAULT '{"buttonText":"Get Started","href":"/contact"}',
  "layout_blocks" jsonb DEFAULT '[]' NOT NULL,
  "published" boolean DEFAULT false NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS "lead_intent_events_lead_id_idx" ON "lead_intent_events"("lead_id");
CREATE INDEX IF NOT EXISTS "lead_intent_events_occurred_at_idx" ON "lead_intent_events"("occurred_at");
CREATE INDEX IF NOT EXISTS "follow_up_events_lead_id_idx" ON "follow_up_events"("lead_id");
CREATE INDEX IF NOT EXISTS "follow_up_events_scheduled_at_idx" ON "follow_up_events"("scheduled_at");
CREATE INDEX IF NOT EXISTS "follow_up_events_status_idx" ON "follow_up_events"("status");
CREATE INDEX IF NOT EXISTS "landing_pages_slug_idx" ON "landing_pages"("slug");
