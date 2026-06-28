ALTER TABLE script_catalog ADD COLUMN IF NOT EXISTS azure_synced_at timestamptz;
ALTER TABLE powershell_scripts ADD COLUMN IF NOT EXISTS azure_runbook_name text;
ALTER TABLE powershell_scripts ADD COLUMN IF NOT EXISTS azure_synced_at timestamptz;
