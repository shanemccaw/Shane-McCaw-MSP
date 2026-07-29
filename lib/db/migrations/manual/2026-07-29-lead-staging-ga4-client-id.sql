-- Manual Migration: GA4 client_id on lead_staging, Issue #116
-- Target: Postgres database. To be run manually by Shane.
--
-- One additive, nullable column: links a staged lead back to its GA4
-- visitor/session for attribution once the lead lands in Zoho. Dev data
-- only — no backfill needed.

ALTER TABLE lead_staging ADD COLUMN IF NOT EXISTS ga4_client_id TEXT;
