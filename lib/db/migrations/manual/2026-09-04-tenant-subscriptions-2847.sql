-- Git #2847 — per-customer subscription / billing state.
--
-- #1944 part 8 gates the entire customer portal on "whether a subscription is active",
-- and #2765 freezes/resumes every per-record retention clock on the same fact. That
-- fact did not exist per customer: msp_subscriptions is msp_id-unique (the MSP's own
-- platform subscription) and the only per-tenant signal was tenants.status, an
-- operational lifecycle enum no billing event ever writes.
--
-- Purely additive. One new table, no change to any existing column, and NO BACKFILL:
-- a tenant with no row here has not cancelled, it has simply never been recorded as
-- subscribing, and resolveTenantBillingState() falls back to tenants.status for those
-- tenants exactly as before. Inserting rows here for existing tenants would either
-- invent a billing history that never happened or — if inserted as canceled — gate
-- every live customer and start their 7-year purge clocks from a migration.

BEGIN;

CREATE TABLE IF NOT EXISTS tenant_subscriptions (
  id                     serial PRIMARY KEY,
  tenant_id              integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  msp_id                 integer NOT NULL REFERENCES msps(id) ON DELETE CASCADE,
  service_id             integer,
  plan_name              text,
  -- 'msp' (wholesale: the MSP's card is charged) | 'customer' (direct: the tenant's own).
  billing_party          text NOT NULL,
  -- Stripe subscription status, same vocabulary as msp_subscriptions.status.
  status                 text NOT NULL,
  stripe_customer_id     text,
  stripe_subscription_id text,
  stripe_price_id        text,
  billing_interval       text,
  unit_amount_cents      integer,
  currency               text NOT NULL DEFAULT 'usd',
  current_period_start   timestamptz,
  current_period_end     timestamptz,
  cancel_at_period_end   boolean NOT NULL DEFAULT false,
  started_at             timestamptz NOT NULL DEFAULT now(),
  canceled_at            timestamptz,
  ended_at               timestamptz,
  payment_failed_at      timestamptz,
  -- 'msp_marketplace' | 'checkout' | 'manual'
  source                 text NOT NULL,
  notes                  text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tenant_subscriptions_tenant_id_idx ON tenant_subscriptions (tenant_id);
CREATE INDEX IF NOT EXISTS tenant_subscriptions_msp_id_idx    ON tenant_subscriptions (msp_id);
CREATE INDEX IF NOT EXISTS tenant_subscriptions_status_idx    ON tenant_subscriptions (status);

-- Partial unique rather than a plain UNIQUE: a `manual` row records a subscription
-- billed outside Stripe and legitimately has no Stripe id, and several of those must
-- be able to coexist. Where an id IS present it is the webhook's idempotency key —
-- a replayed customer.subscription.updated updates the row instead of duplicating it.
CREATE UNIQUE INDEX IF NOT EXISTS tenant_subscriptions_stripe_sub_uq
  ON tenant_subscriptions (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

-- The reconciliation sweep's predicate is "does this tenant have an active
-- subscription", which is a status-filtered lookup by tenant.
CREATE INDEX IF NOT EXISTS tenant_subscriptions_tenant_status_idx
  ON tenant_subscriptions (tenant_id, status);

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-04-tenant-subscriptions-2847.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
