-- #1915 — Azure Lighthouse onboarding: promise/record layer
--
-- tenant_azure_reach (#1871) is purely observational: it records what a live ARM
-- probe currently sees. It has no field for what Azure Lighthouse delegation
-- scope was ever OFFERED or PROMISED to a customer, which means a revoked
-- delegation is indistinguishable from one that was never made. This table is
-- that separate promise/record layer. See lib/db/src/schema/msp.ts for the full
-- rationale and Drizzle definition this mirrors.

CREATE TABLE IF NOT EXISTS tenant_azure_lighthouse_offers (
  id SERIAL PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  scope_type TEXT NOT NULL DEFAULT 'subscription',
  subscription_id TEXT NOT NULL,
  resource_group_name TEXT,
  arm_scope_path TEXT NOT NULL,
  role_definition_id TEXT NOT NULL,
  role_name TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'offered',
  offered_artifact JSONB NOT NULL,
  offered_by_user_id INTEGER,
  offered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS tenant_azure_lighthouse_offers_tenant_scope_idx
  ON tenant_azure_lighthouse_offers (tenant_id, arm_scope_path);

CREATE INDEX IF NOT EXISTS tenant_azure_lighthouse_offers_tenant_id_idx
  ON tenant_azure_lighthouse_offers (tenant_id);

CREATE INDEX IF NOT EXISTS tenant_azure_lighthouse_offers_state_idx
  ON tenant_azure_lighthouse_offers (state);

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-04-tenant-azure-lighthouse-offers-1915.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
