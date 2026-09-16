-- #4403 — Monitoring purchases provision their entitlement on payment-confirmed.
--
-- /api/public/purchase/payment-confirmed never wrote the client_services row the
-- Portal's tier gate reads (portal-tier-features.ts resolveCustomerIncludedFeatures:
-- client_services status='active' -> services service_type='monitoring_tier'), so a
-- paid Monitoring buyer's portal said their tier included nothing (#4401/#4402).
--
-- The provisioning write needs a durable idempotency key: payment-confirmed is
-- legitimately hit more than once for the same PaymentIntent (reload, retry, a
-- lost response), and the set-password / portal-handoff backstops re-run it too.
-- `checkout_session_id` records which purchase provisioned the row; the unique
-- index on (checkout_session_id, service_id) makes a second insert a conflict,
-- not a second entitlement. Postgres unique indexes treat NULLs as distinct, so
-- every existing/non-purchase row (checkout_session_id NULL) is unaffected.
--
-- ON DELETE SET NULL: identity purge deletes checkout_sessions rows; the
-- entitlement record must never block that delete.
--
-- Additive, nullable, reversible. Safe to re-run (IF NOT EXISTS).

BEGIN;

ALTER TABLE client_services
  ADD COLUMN IF NOT EXISTS checkout_session_id UUID
    REFERENCES checkout_sessions(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS client_services_checkout_session_service_uidx
  ON client_services (checkout_session_id, service_id);

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('4403-client-services-checkout-session-id.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
