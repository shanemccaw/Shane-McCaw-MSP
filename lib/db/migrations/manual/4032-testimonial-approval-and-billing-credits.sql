-- 4032-testimonial-approval-and-billing-credits.sql
--
-- Git #4032 (Feature #3436). Additive, reversible.
--
-- #3436's settled decision (2026-09-14): a customer's testimonial earns a discount
-- only once Admin Panel approves it — never on submission — and that discount is a
-- one-time credit against the customer's next month of service, not a recurring one.
--
-- 1. customer_testimonials gains the admin review decision: status + who reviewed
--    it and when. Every existing row starts 'pending' (none has ever been reviewed;
--    no review route existed before this migration).
-- 2. customer_billing_credits is the per-customer one-time credit ledger that an
--    approval writes. It is NOT a `coupons` row — see the table comment below.

BEGIN;

ALTER TABLE customer_testimonials
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS reviewed_at timestamp,
  ADD COLUMN IF NOT EXISTS reviewed_by_user_id integer REFERENCES users(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customer_testimonials_status_check') THEN
    ALTER TABLE customer_testimonials
      ADD CONSTRAINT customer_testimonials_status_check CHECK (status IN ('pending', 'approved', 'rejected'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS customer_billing_credits (
  id                        serial PRIMARY KEY,
  tenant_id                 integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  source                    text NOT NULL,
  source_testimonial_id     integer REFERENCES customer_testimonials(id) ON DELETE SET NULL,
  discount_type             text NOT NULL,
  discount_value            numeric(10, 2) NOT NULL,
  currency                  text NOT NULL DEFAULT 'usd',
  status                    text NOT NULL DEFAULT 'pending',
  failure_reason            text,
  tenant_subscription_id    integer REFERENCES tenant_subscriptions(id) ON DELETE SET NULL,
  stripe_subscription_id    text,
  stripe_coupon_id          text,
  stripe_discount_id        text,
  issued_at                 timestamptz,
  applied_stripe_invoice_id text,
  applied_amount_cents      integer,
  applied_at                timestamptz,
  issued_by_user_id         integer REFERENCES users(id) ON DELETE SET NULL,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_billing_credits_status_check
    CHECK (status IN ('pending', 'issued', 'awaiting_subscription', 'failed', 'applied')),
  CONSTRAINT customer_billing_credits_source_check
    CHECK (source IN ('testimonial_approval')),
  CONSTRAINT customer_billing_credits_discount_type_check
    CHECK (discount_type IN ('fixed', 'percentage'))
);

CREATE INDEX IF NOT EXISTS customer_billing_credits_tenant_id_idx
  ON customer_billing_credits (tenant_id);
CREATE INDEX IF NOT EXISTS customer_billing_credits_stripe_discount_idx
  ON customer_billing_credits (stripe_discount_id);
-- One credit per approved testimonial: a double-submitted approval cannot issue two.
CREATE UNIQUE INDEX IF NOT EXISTS customer_billing_credits_source_testimonial_uq
  ON customer_billing_credits (source_testimonial_id);

COMMENT ON TABLE customer_billing_credits IS
  'Git #4032 — one-time credits against a customer''s NEXT invoice, written by an Admin Panel testimonial approval. Not a coupons row: coupons are global code-entered checkout promos with no customer binding and no subscription-invoice redemption path. Delivered as a Stripe duration=once coupon attached to the tenant''s active subscription.';

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('4032-testimonial-approval-and-billing-credits.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
