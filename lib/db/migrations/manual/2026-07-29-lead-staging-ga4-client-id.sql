-- #116: GA4 client_id -> lead_staging -> Zoho CRM path.
-- Additive/nullable: no GA4 client-side instrumentation exists in this monorepo
-- yet (Phase 2 of the epic, #115), so every row will be NULL until that ships.
ALTER TABLE lead_staging ADD COLUMN IF NOT EXISTS ga4_client_id text;
