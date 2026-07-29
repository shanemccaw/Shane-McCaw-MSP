-- Manual Migration: EngageBay Connection table (EngageBay Integration Foundation, Issue #104)
-- Target: Postgres database. To be run manually by Shane.
--
-- One row per MSP (single-tenant today: mspId 1 only, shaped for multi-tenant later).
-- EngageBay auth is a single static API key (no OAuth, no refresh, no expiry —
-- confirmed via github.com/engagebay/restapi), stored in Azure Key Vault under the
-- name in key_vault_secret_name — never in this table. Unlike zoho_connection there
-- is no access-token cache: nothing here churns.

CREATE TABLE IF NOT EXISTS engagebay_connection (
  id SERIAL PRIMARY KEY,
  msp_id INTEGER NOT NULL DEFAULT 1 REFERENCES msps(id) ON DELETE CASCADE UNIQUE,
  key_vault_secret_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'disconnected',
  connected_at TIMESTAMP WITH TIME ZONE,
  last_error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
