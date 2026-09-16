-- #4431 — Buy.tsx Monitoring/Retainer purchases create their recurring Stripe subscription.
--
-- /api/public/purchase/payment-confirmed charged month 1 as a one-time PaymentIntent
-- (setup_future_usage off_session) and never created the subscription, so month 2
-- was never billed. The confirm now creates it, anchored one month after the charge.
--
--   purchase_payment_intent_id — the verified, succeeded intent the confirm accepted,
--     so the set-password / portal-handoff backstops can retry subscription creation
--     after a transient Stripe failure without the client re-sending it.
--   purchase_subscription_id   — the created Stripe Subscription. Also the idempotency
--     record: a replayed confirm or backstop with this set creates nothing. Mirrored
--     onto client_services.stripe_subscription_id for the (checkout_session_id,
--     service_id) row #4403/#4404 provision.
--
-- Additive, nullable, reversible. Safe to re-run (IF NOT EXISTS).

BEGIN;

ALTER TABLE checkout_sessions
  ADD COLUMN IF NOT EXISTS purchase_payment_intent_id TEXT;

ALTER TABLE checkout_sessions
  ADD COLUMN IF NOT EXISTS purchase_subscription_id TEXT;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('4431-checkout-sessions-purchase-subscription.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
