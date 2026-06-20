ALTER TABLE users ADD COLUMN IF NOT EXISTS sharepoint_site_url text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS sharepoint_site_id text;

ALTER TABLE projects DROP COLUMN IF EXISTS sharepoint_site_url;
ALTER TABLE projects DROP COLUMN IF EXISTS sharepoint_site_id;
