-- Git #4228 — azure_tenant_credentials.created_at/updated_at were naive `timestamp` columns
-- serialized as if UTC, while the local server writes NY wall-clock (SHOW timezone ->
-- America/New_York). Convert both to timestamptz, reinterpreting existing naive values as
-- America/New_York wall-clock so the stored instant is correct.

ALTER TABLE azure_tenant_credentials
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'America/New_York';

ALTER TABLE azure_tenant_credentials
  ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'America/New_York';

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('4228-azure-tenant-credentials-timestamptz.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
