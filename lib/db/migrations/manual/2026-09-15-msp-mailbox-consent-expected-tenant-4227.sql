-- Git #4227: bind the MSP mailbox connector callback to the tenant that owns the
-- mailbox. The Entra tenant GUID for mailbox_upn's domain is resolved from
-- Microsoft when the consent state is minted and recorded here; the callback
-- refuses any other `tenant`. Nullable: rows minted before this change carry no
-- binding and are refused by the callback (they expire in ten minutes anyway).
BEGIN;

ALTER TABLE msp_mailbox_consent_states
  ADD COLUMN IF NOT EXISTS expected_tenant_id text;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-15-msp-mailbox-consent-expected-tenant-4227.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
