-- #116: GA4 client_id -> lead_staging -> Zoho CRM path.
-- One additive, nullable column: links a staged lead back to its GA4
-- visitor/session for attribution once the lead lands in Zoho.

ALTER TABLE lead_staging ADD COLUMN IF NOT EXISTS ga4_client_id text;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-07-29-lead-staging-ga4-client-id.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
