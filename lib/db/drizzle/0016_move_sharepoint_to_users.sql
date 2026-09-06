-- @migration-gate: auto-approved
-- @gate-reason: Historical, already applied (dev __drizzle_migrations 2026-06-20). The DROP COLUMNs remove projects.sharepoint_site_url/site_id after the same file copies them onto users; retained only for fresh-database replay. Reviewed under #2930.

ALTER TABLE users ADD COLUMN IF NOT EXISTS sharepoint_site_url text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS sharepoint_site_id text;

ALTER TABLE projects DROP COLUMN IF EXISTS sharepoint_site_url;
ALTER TABLE projects DROP COLUMN IF EXISTS sharepoint_site_id;
