-- @migration-gate: auto-approved
-- @gate-reason: Historical, already applied (dev __drizzle_migrations 2026-07-11). Drops the dead azure_runbook_name column left behind by the Azure Automation -> local Script Runner move; retained only for fresh-database replay. Reviewed under #2930.

-- Drop azure_runbook_name column from powershell_scripts and script_modules.
-- Azure Automation remote-execution infrastructure has been replaced by the
-- local Script Runner (admin-script-runner.ts + script-ingestion.ts).
-- The column is dead: no remaining code reads or writes it after this migration.
ALTER TABLE "powershell_scripts" DROP COLUMN IF EXISTS "azure_runbook_name";
ALTER TABLE "script_modules" DROP COLUMN IF EXISTS "azure_runbook_name";
