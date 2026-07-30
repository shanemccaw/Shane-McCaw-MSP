-- #116: GA4 client_id -> lead_staging -> Zoho CRM path.
-- One additive, nullable column: links a staged lead back to its GA4
-- visitor/session for attribution once the lead lands in Zoho.

ALTER TABLE lead_staging ADD COLUMN IF NOT EXISTS ga4_client_id text;
