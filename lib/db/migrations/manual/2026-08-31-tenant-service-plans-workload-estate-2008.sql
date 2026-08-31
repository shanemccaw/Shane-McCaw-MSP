-- Tenant service-plan / workload estate (Git #2008)
--
-- The tenant's REAL enabled Microsoft 365 service-plan estate, as last observed
-- on GET /subscribedSkus. Exists because the Ownership/RACI matrix must attach
-- a row to every workload the tenant actually RUNS (Exchange, SharePoint,
-- OneDrive, Teams, Security, Identity...) — #1523's settled rule — not to what
-- the customer happens to have purchased through this platform
-- (client_services). A customer with only a Monitoring purchase still runs
-- Exchange, and Exchange still needs an accountable owner.
--
-- THE ONE CONDITION (settled on #1516): a service plan whose provisioning
-- status is "Success" is enabled — full stop. Only Success rows are ever
-- stored; a full REPLACE per (msp_id, tenant_id) on every sync means a plan
-- that lapses simply stops appearing, rather than needing an in-place status
-- flip.
--
-- Workload grouping is NOT stored here — service_plan_name is Microsoft's own
-- real identifier, kept verbatim. Coarse workload buckets are a pure
-- derivation over that identifier, computed at read time in
-- lib/tenant-workloads.ts.
--
-- Drizzle schema lives in lib/db/src/schema/msp.ts (hand-written; no
-- drizzle-kit push).

BEGIN;

CREATE TABLE IF NOT EXISTS tenant_service_plans (
  id                   SERIAL PRIMARY KEY,
  msp_id               INTEGER NOT NULL,
  tenant_id            TEXT    NOT NULL,
  service_plan_id      UUID    NOT NULL,
  service_plan_name    TEXT    NOT NULL,
  service_plan_type    TEXT,
  sku_part_number      TEXT    NOT NULL,
  sku_id               UUID    NOT NULL,
  provisioning_status  TEXT    NOT NULL,
  collected_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS tenant_service_plans_msp_tenant_plan_idx
  ON tenant_service_plans (msp_id, tenant_id, service_plan_id);

CREATE INDEX IF NOT EXISTS tenant_service_plans_msp_tenant_idx
  ON tenant_service_plans (msp_id, tenant_id);

-- Self-marking run record so Simulator Studio's Migrations tree (Git #497)
-- reflects DB reality regardless of which console ran this file.
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-31-tenant-service-plans-workload-estate-2008.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
