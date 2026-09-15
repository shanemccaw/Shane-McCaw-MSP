-- Git #4242: record the MSP's own Microsoft Entra tenant on `msps`, set by a
-- platform admin. The MSP mailbox connector (msp-settings.ts) refuses to bind to
-- any other tenant once this is set, closing the residual left by #4227 where an
-- MSP admin could bind the connector to one of their own customers' tenants.
-- Nullable: unset keeps #4227's mailbox-domain binding and logs a warning.
-- Stored lowercase; unique so two MSPs cannot claim the same tenant.
BEGIN;

ALTER TABLE msps
  ADD COLUMN IF NOT EXISTS entra_tenant_id text;

CREATE UNIQUE INDEX IF NOT EXISTS msps_entra_tenant_id_unique
  ON msps (entra_tenant_id)
  WHERE entra_tenant_id IS NOT NULL;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-15-msps-entra-tenant-id-4242.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
