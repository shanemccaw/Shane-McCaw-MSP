-- Manual Migration: Zoho Connection table (Zoho Integration Foundation, Issue #82)
-- Target: Postgres database. To be run manually by Shane.
--
-- One row per MSP (single-tenant today: mspId 1 only, shaped for multi-tenant later).
-- The long-lived Zoho REFRESH token is stored in Azure Key Vault under the name in
-- key_vault_secret_name — never in this table. Access tokens churn hourly and are
-- not long-term secrets, so they are cached in access_token_cache /
-- access_token_expires_at and refreshed from the Key Vault refresh token on expiry.

CREATE TABLE IF NOT EXISTS zoho_connection (
  id SERIAL PRIMARY KEY,
  msp_id INTEGER NOT NULL DEFAULT 1 REFERENCES msps(id) ON DELETE CASCADE UNIQUE,
  zoho_org_id TEXT,
  key_vault_secret_name TEXT NOT NULL,
  access_token_cache TEXT,
  access_token_expires_at TIMESTAMP WITH TIME ZONE,
  status TEXT NOT NULL DEFAULT 'disconnected',
  connected_at TIMESTAMP WITH TIME ZONE,
  last_refreshed_at TIMESTAMP WITH TIME ZONE,
  last_error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
