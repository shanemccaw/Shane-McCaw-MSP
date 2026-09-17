-- #4438 — a skipped-consent Retainer purchase gets a real Stripe customer.
--
-- A Retainer bought with read consent skipped (#1311) has no tenants row, so
-- /api/public/purchase/payment-intent charged month 1 as an anonymous
-- PaymentIntent (no customer, no card kept on file) and #4431's recurring
-- subscription could never be created. The customer is now resolved from the
-- buyer's own account instead, and recorded here:
--
--   users.stripe_customer_id — the account's Stripe Customer for purchases made
--     before any tenant exists. Adopted onto tenants.stripe_customer_id (only
--     when that is still empty) once a later consent links the user to a tenant.
--
-- Additive, nullable, reversible. Safe to re-run (IF NOT EXISTS).

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('4438-users-stripe-customer-id.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
