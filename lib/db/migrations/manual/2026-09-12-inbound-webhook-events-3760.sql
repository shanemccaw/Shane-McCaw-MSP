-- Git #3760 — Inbound webhook activity log for MSP Console operators.
--
-- A real, queryable receipt log of every event the platform's real, active
-- Stripe billing webhook (msp-billing-webhook.ts, POST /api/msp/stripe/webhook)
-- actually receives -- distinct from msp_event_store, which only gets a row for
-- the subset of events that produced a real business-effect (provisioned /
-- canceled / dunning_cleared / payment_failed / plan_changed). This table logs
-- EVERY receipt, including ones a handler legitimately no-ops on, so an
-- operator can see real inbound activity rather than only its side effects.
--
-- `source` is a closed enum of the platform's real inbound receivers -- today
-- only 'stripe_msp_billing'. msp-webhooks.ts (/api/msp/v1/webhooks/*) is a
-- separate, still fully-stubbed receiver tracked by #2700 and never writes here.

BEGIN;

CREATE TABLE IF NOT EXISTS inbound_webhook_events (
  id serial PRIMARY KEY,
  source text NOT NULL CHECK (source IN ('stripe_msp_billing')),
  provider_event_id text,
  event_type text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  outcome text NOT NULL CHECK (outcome IN ('processed', 'ignored', 'blocked', 'error')),
  summary text NOT NULL,
  msp_id integer,
  error_message text
);

CREATE INDEX IF NOT EXISTS inbound_webhook_events_event_type_idx ON inbound_webhook_events (event_type);
CREATE INDEX IF NOT EXISTS inbound_webhook_events_received_at_idx ON inbound_webhook_events (received_at);
CREATE INDEX IF NOT EXISTS inbound_webhook_events_msp_id_idx ON inbound_webhook_events (msp_id);

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-12-inbound-webhook-events-3760.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
