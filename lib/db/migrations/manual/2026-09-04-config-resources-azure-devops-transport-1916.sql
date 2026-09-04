-- 2026-09-04-config-resources-azure-devops-transport-1916.sql
--
-- Git #1916 — build-resource-model.mjs's readTransportFor() folded "Azure DevOps"
-- into the same azure-rm bucket as "azure" / "Azure Service Management" via a
-- single `||` condition. Azure DevOps is a genuinely different host, token
-- audience (499b84ac-1321-427f-aa17-267ca6975798, vs ARM's management.azure.com)
-- and permission model than Azure Resource Manager, so folding it mislabeled the
-- 4 real ADO* Microsoft365DSC resources below.
--
-- Real fix, taken from the issue's reversible option:
--   1. `azure-devops` added as its own CONFIG_READ_TRANSPORTS value
--      (lib/db/src/schema/config-state.ts).
--   2. readTransportFor() in scripts/config-state/build-resource-model.mjs no
--      longer folds "Azure DevOps" into azure-rm; it routes to azure-devops.
--   3. This migration re-labels the 4 already-extracted rows to match what a
--      fresh extraction now produces, without re-running the full fetch+build
--      pipeline (fetch-sources.mjs clones the Microsoft365DSC repo and downloads
--      Graph $metadata — a real bandwidth cost not justified for a change whose
--      effect on exactly these 4 known rows is fully deterministic).
--
-- Since no Azure DevOps executor exists yet, these 4 rows now correctly report
-- no_executor via coverageStateFor()/build-snapshot-registry.mjs's EXECUTOR_BACKED
-- set (which already excludes azure-rm and, unchanged by this migration, does not
-- include azure-devops either) — an honest, discoverable gap, not a silent
-- miscount folded into azure-rm's numbers. A real Azure DevOps executor is
-- separate future scope.
--
-- ADDITIVE-ONLY re-label of 4 existing rows. No schema change — read_transport is
-- a plain TEXT column with no DB-level CHECK constraint.

BEGIN;

UPDATE config_resources
   SET read_transport = 'azure-devops',
       updated_at = now()
 WHERE resource_key IN (
   'm365dsc:ADOOrganizationOwner',
   'm365dsc:ADOPermissionGroup',
   'm365dsc:ADOPermissionGroupSettings',
   'm365dsc:ADOSecurityPolicy'
 )
   AND read_transport = 'azure-rm';

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-04-config-resources-azure-devops-transport-1916.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
