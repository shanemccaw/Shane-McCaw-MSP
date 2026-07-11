-- Drop azure_runbook_name column from powershell_scripts and script_modules.
-- Azure Automation remote-execution infrastructure has been replaced by the
-- local Script Runner (admin-script-runner.ts + script-ingestion.ts).
-- The column is dead: no remaining code reads or writes it after this migration.
ALTER TABLE "powershell_scripts" DROP COLUMN IF EXISTS "azure_runbook_name";
ALTER TABLE "script_modules" DROP COLUMN IF EXISTS "azure_runbook_name";
