ALTER TABLE projects ADD COLUMN IF NOT EXISTS sharepoint_site_url text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS sharepoint_site_id text;

CREATE TABLE IF NOT EXISTS settings (
  key text PRIMARY KEY,
  value text,
  updated_at timestamp NOT NULL DEFAULT now()
);
