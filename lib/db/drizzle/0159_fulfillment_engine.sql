CREATE TABLE IF NOT EXISTS "fulfillment_types" (
  "key"         TEXT PRIMARY KEY,
  "label"       TEXT NOT NULL,
  "description" TEXT,
  "fired_when"  JSONB NOT NULL DEFAULT '[]',
  "recurring"   BOOLEAN NOT NULL DEFAULT FALSE,
  "is_active"   BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "fulfillment_idempotency" (
  "idempotency_key"      TEXT PRIMARY KEY,
  "fulfillment_type_key" TEXT NOT NULL,
  "payload"              JSONB NOT NULL DEFAULT '{}',
  "created_at"           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "fulfillment_idempotency_type_key_idx"
  ON "fulfillment_idempotency" ("fulfillment_type_key");

ALTER TABLE "services"
  ADD COLUMN IF NOT EXISTS "fulfillment_type_key"   TEXT,
  ADD COLUMN IF NOT EXISTS "triggering_signal_keys" JSONB;

INSERT INTO "fulfillment_types" ("key", "label", "description", "fired_when", "recurring", "is_active")
VALUES
  ('assessment',              'Assessment',               'One-time M365 health/readiness assessment',             '["purchase","signal"]', FALSE, TRUE),
  ('bundle_subscription',     'Bundle Subscription',      'Recurring bundle of services billed monthly',           '["purchase"]',          TRUE,  TRUE),
  ('retainer',                'Retainer',                 'Monthly retainer engagement',                           '["purchase"]',          TRUE,  TRUE),
  ('msp_monthly_subscription','MSP Monthly Subscription', 'Managed service provider monthly subscription',         '["purchase"]',          TRUE,  TRUE)
ON CONFLICT ("key") DO NOTHING;
