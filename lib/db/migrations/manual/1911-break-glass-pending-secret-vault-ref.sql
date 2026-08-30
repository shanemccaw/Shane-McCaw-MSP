-- 1911-break-glass-pending-secret-vault-ref.sql
--
-- Git #1911. Additive, reversible.
--
-- Adds the Key Vault REFERENCE column to `break_glass_pending_secrets`. The vault
-- becomes the store for a generated credential; this column is the pointer to it
-- (vault url, secret name, immutable version, expiry). It carries no secret and is
-- safe for an admin run-history surface to read.
--
-- The existing `encrypted_value` column is untouched. #1911 changes where the
-- plaintext lives; it does not weaken or bypass the gate's encryption. The reveal
-- path prefers `secret_ref` and falls back to `encrypted_value` for rows written
-- before the store existed; acknowledgement purges both.

ALTER TABLE break_glass_pending_secrets
  ADD COLUMN IF NOT EXISTS secret_ref jsonb;

COMMENT ON COLUMN break_glass_pending_secrets.secret_ref IS
  'Git #1911 — Azure Key Vault reference for the generated credential (kind/vaultUrl/secretName/version/expiresOn/purpose/customerId). Never the value.';

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('1911-break-glass-pending-secret-vault-ref.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
