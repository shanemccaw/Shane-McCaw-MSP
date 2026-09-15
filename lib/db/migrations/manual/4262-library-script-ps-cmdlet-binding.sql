-- Git #4262 — POST /api/admin/run-script migrated off the retired Azure
-- Automation stub onto the ps-execution container. The container only runs
-- entries from its code-owned catalog (services/ps-execution/cmdlet-catalog.ps1,
-- #209's boundary), never a DB-stored script body, so a library script / module
-- now carries an optional KEY into that catalog — the same contract
-- monitor_checks.ps_cmdlet_key / ps_params already follow. Additive, nullable.

ALTER TABLE powershell_scripts ADD COLUMN IF NOT EXISTS ps_cmdlet_key text;
ALTER TABLE powershell_scripts ADD COLUMN IF NOT EXISTS ps_params jsonb;

ALTER TABLE script_modules ADD COLUMN IF NOT EXISTS ps_cmdlet_key text;
ALTER TABLE script_modules ADD COLUMN IF NOT EXISTS ps_params jsonb;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('4262-library-script-ps-cmdlet-binding.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
