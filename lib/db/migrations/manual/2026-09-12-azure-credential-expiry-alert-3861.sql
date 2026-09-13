-- Git #3861 — Reinstate App Registration / Azure credential expiry email alerting
--
-- Additive nullable column: tracks the last time an expiry-warning email was sent
-- for this credential, so the alert only re-fires once per resend window instead
-- of every evaluation pass. NULL means never alerted.

ALTER TABLE azure_tenant_credentials
  ADD COLUMN IF NOT EXISTS last_expiry_alert_sent_at TIMESTAMPTZ;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-12-azure-credential-expiry-alert-3861.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
