-- Sales Offer Engine: 4 new tables
-- Created via manual migration (drizzle-kit generate has corrupted snapshots)

CREATE TABLE IF NOT EXISTS "sales_offers" (
  "id" serial PRIMARY KEY NOT NULL,
  "msp_id" integer NOT NULL,
  "tenant_id" integer NOT NULL,
  "service_id" integer NOT NULL,
  "state" varchar(32) NOT NULL DEFAULT 'draft',
  "idempotency_key" varchar(64) NOT NULL,
  "score" integer NOT NULL DEFAULT 0,
  "base_price_cents" integer NOT NULL DEFAULT 0,
  "adjusted_price_cents" integer NOT NULL DEFAULT 0,
  "fired_signal_keys" jsonb,
  "rationale" text,
  "rule_group_snapshot" jsonb,
  "sent_at" timestamp,
  "expires_at" timestamp,
  "resolved_at" timestamp,
  "actor_user_id" integer,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  UNIQUE("idempotency_key")
);

CREATE TABLE IF NOT EXISTS "sales_offer_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "offer_id" integer NOT NULL REFERENCES "sales_offers"("id") ON DELETE CASCADE,
  "event_name" varchar(64) NOT NULL,
  "payload" jsonb,
  "actor_user_id" integer,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "sales_offer_config" (
  "id" serial PRIMARY KEY NOT NULL,
  "msp_id" integer,
  "min_score_threshold" integer NOT NULL DEFAULT 50,
  "max_offers_per_run" integer NOT NULL DEFAULT 10,
  "expiration_days" integer NOT NULL DEFAULT 30,
  "bundling_threshold" integer NOT NULL DEFAULT 3,
  "scoring_weights" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  UNIQUE("msp_id")
);

CREATE TABLE IF NOT EXISTS "sales_offer_rule_groups" (
  "id" serial PRIMARY KEY NOT NULL,
  "msp_id" integer,
  "name" varchar(128) NOT NULL,
  "rule_type" varchar(32) NOT NULL,
  "signal_key_prefix" varchar(128),
  "service_id" integer,
  "conditions" jsonb,
  "pricing_adjustments" jsonb,
  "scoring_weights" jsonb,
  "priority" integer NOT NULL DEFAULT 0,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "sales_offers_tenant_idx" ON "sales_offers"("tenant_id");
CREATE INDEX IF NOT EXISTS "sales_offers_msp_idx" ON "sales_offers"("msp_id");
CREATE INDEX IF NOT EXISTS "sales_offers_state_idx" ON "sales_offers"("state");
CREATE INDEX IF NOT EXISTS "sales_offer_events_offer_idx" ON "sales_offer_events"("offer_id");
CREATE INDEX IF NOT EXISTS "sales_offer_rule_groups_msp_idx" ON "sales_offer_rule_groups"("msp_id");
