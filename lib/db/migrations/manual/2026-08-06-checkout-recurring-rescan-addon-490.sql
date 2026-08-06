-- #490 — Recurring rescan add-on at checkout (epic #427).
--
-- Adds the two things the Home-page assessment flow needs in order to sell a
-- recurring add-on alongside the existing one-time $5,000 PaymentIntent (#435):
--
--   1. tenants.stripe_customer_id — a REAL Stripe Customer (`cus_…`).
--      Before this, the flow was fully anonymous on Stripe's side: the
--      PaymentIntent carried no `customer` at all, and nothing existed for a
--      Subscription to hang off. (Note: the "customerId" naming used all over
--      consent.ts and the portal routes means `tenants.id`, a local row id —
--      it has never been a Stripe id. This column is the actual Stripe one.)
--      It lives on `tenants` rather than on `checkout_sessions` because the
--      Stripe customer outlives any single order and belongs to the
--      organisation, exactly like `tenants.consent` does.
--
--   2. checkout_sessions.rescan_addon_* / rescan_subscription_id — the buyer's
--      answer to the opt-in step that sits between the #432 Compliance decision
--      and Payment, the price they were quoted, and the Subscription that
--      answer produced.
--
--      rescan_addon_opt_in is deliberately TRI-STATE (nullable boolean): NULL
--      means "not asked yet", which is what lets a resumed session land back on
--      the add-on step instead of silently treating an unanswered question as a
--      decline.
--
--      rescan_addon_price_cents snapshots the monthly price AS QUOTED at
--      decision time. The buyer agreed to a specific number; if the catalog row
--      is edited between the decision and the payment landing, the subscription
--      is created at the price that was on screen and the divergence is logged.
--
-- Until this file is run, the flow degrades rather than breaking: every read of
-- these columns in public-assessment-payment.ts is wrapped so that a missing
-- column logs an error and falls back to exactly today's behaviour (anonymous
-- one-time PaymentIntent, no add-on offered). The base $5,000 purchase path
-- cannot regress on an un-migrated database.
--
-- ALSO REQUIRED, and NOT done by this file: a Product Catalog row for the
-- add-on itself, with slug 'copilot-assessment-recurring-rescan' and a real
-- monthly price. Shane creates that in admin-panel — no price is invented here
-- or anywhere in the code. Until that row exists the add-on step reports itself
-- unavailable and the flow goes straight to Payment, unchanged.
--
-- Safe to re-run.

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;

ALTER TABLE checkout_sessions
  ADD COLUMN IF NOT EXISTS rescan_addon_opt_in       BOOLEAN,
  ADD COLUMN IF NOT EXISTS rescan_addon_service_id   INTEGER,
  ADD COLUMN IF NOT EXISTS rescan_addon_price_cents  INTEGER,
  ADD COLUMN IF NOT EXISTS rescan_subscription_id    TEXT;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-06-checkout-recurring-rescan-addon-490.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
