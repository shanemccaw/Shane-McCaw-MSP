-- #1871 — azure-rm becomes a real executor transport.
--
-- Additive only. Three changes, none destructive:
--   1. monitor_checks.arm_operation — the code-owned operation key for the new
--      transport, exactly parallel to sp_operation / ps_cmdlet_key. NULL for every
--      existing row.
--   2. tenant_azure_reach — what Azure the platform's ARM principal can actually
--      SEE in a tenant. New table; nothing reads it until an azure-rm check runs.
--   3. No DDL is needed for the two new tenant_monitor_profiles.status values
--      ("azure_no_rbac", "azure_no_subscriptions"): that column is TEXT with the
--      enum enforced in Drizzle, not a Postgres enum type, so no ALTER TYPE
--      exists to write. Confirmed against the live local database before writing
--      this file.
--
-- The executor_type column on monitor_checks is likewise TEXT with a Drizzle-side
-- enum, so adding 'azure-rm' to MONITOR_CHECK_EXECUTOR_TYPES needs no DDL either.

BEGIN;

-- 1. The ARM operation key.
ALTER TABLE monitor_checks
  ADD COLUMN IF NOT EXISTS arm_operation text;

COMMENT ON COLUMN monitor_checks.arm_operation IS
  'Key into the code-owned AZURE_RM_OPERATIONS registry in azure-rm.ts — an identifier only, never a URL and never a script. NULL unless executor_type = ''azure-rm''. (#1871)';

-- 2. Per-tenant Azure Resource Manager reach, as last observed.
--
-- Exists because Azure RBAC is a different control plane from Microsoft Entra:
-- tenants.consent records Graph app permissions, and those confer nothing on
-- https://management.azure.com. Every column here is written from a real observed
-- HTTP result; a tenant with no row has simply never been probed.
--
-- state:
--   ok               GET /subscriptions returned at least one subscription.
--   no_rbac          Valid ARM token, 200, EMPTY listing, and no tenant-root read
--                    to corroborate it. We hold no Azure role assignment here. Says
--                    nothing about whether the customer has Azure — the listing is
--                    RBAC-filtered.
--   no_subscriptions The same empty listing, but a readable management-group scope
--                    (which covers every subscription in the tenant) corroborates
--                    it. Conclusive: the tenant genuinely has no Azure.
--   unreachable      No ARM token could be acquired for this tenant at all.
CREATE TABLE IF NOT EXISTS tenant_azure_reach (
  id                            serial PRIMARY KEY,
  tenant_id                     text        NOT NULL UNIQUE,
  state                         text        NOT NULL,
  token_acquired                boolean     NOT NULL,
  subscriptions_http_status     integer,
  management_groups_http_status integer,
  subscriptions                 jsonb       NOT NULL DEFAULT '[]'::jsonb,
  principal_client_id           text,
  principal_object_id           text,
  error_message                 text,
  probed_at                     timestamptz NOT NULL DEFAULT now(),
  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tenant_azure_reach_state_idx ON tenant_azure_reach (state);

COMMENT ON TABLE tenant_azure_reach IS
  'What Azure the platform''s ARM principal can actually see in a tenant, as last observed. Reach is a property of the PRINCIPAL, not the tenant — hence principal_client_id. (#1871)';
COMMENT ON COLUMN tenant_azure_reach.management_groups_http_status IS
  'HTTP status of GET /providers/Microsoft.Management/managementGroups. 200 is the ONLY thing that makes an empty subscription listing conclusive; 403 is the normal answer for a principal holding only subscription- or resource-group-scoped roles (including everything Azure Lighthouse can delegate).';

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-30-azure-rm-executor-1871.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
