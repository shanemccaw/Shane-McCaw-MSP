-- 2026-09-17-free-scan-account-recovery-4483.sql — Git #4483 (Feature #1352, Free Scan)
--
-- Recovery for the scoped Free Scan engagement account (#4329):
--   * lost password      — emailed code to the account's own address -> new password;
--   * lost authenticator — emailed code + current password + an operator approval
--                          (identity checked outside the request) -> re-enrol.
--
-- Additive only: nullable columns and zero-defaulted counters on free_scan_accounts.
-- Nothing on `users`, `mfa_enrollments` or `client_services` changes.

BEGIN;

ALTER TABLE free_scan_accounts ADD COLUMN IF NOT EXISTS recovery_code_hash              text;
ALTER TABLE free_scan_accounts ADD COLUMN IF NOT EXISTS recovery_code_expires_at        timestamptz;
ALTER TABLE free_scan_accounts ADD COLUMN IF NOT EXISTS recovery_code_attempts          integer NOT NULL DEFAULT 0;
ALTER TABLE free_scan_accounts ADD COLUMN IF NOT EXISTS recovery_code_sends             integer NOT NULL DEFAULT 0;
ALTER TABLE free_scan_accounts ADD COLUMN IF NOT EXISTS recovery_code_window_started_at timestamptz;
ALTER TABLE free_scan_accounts ADD COLUMN IF NOT EXISTS recovery_nonce                  text;
ALTER TABLE free_scan_accounts ADD COLUMN IF NOT EXISTS mfa_reset_status                text;
ALTER TABLE free_scan_accounts ADD COLUMN IF NOT EXISTS mfa_reset_requested_at          timestamptz;
ALTER TABLE free_scan_accounts ADD COLUMN IF NOT EXISTS mfa_reset_decided_at            timestamptz;
ALTER TABLE free_scan_accounts ADD COLUMN IF NOT EXISTS mfa_reset_decided_by            integer;
ALTER TABLE free_scan_accounts ADD COLUMN IF NOT EXISTS mfa_reset_decision_note         text;
ALTER TABLE free_scan_accounts ADD COLUMN IF NOT EXISTS mfa_reset_approval_expires_at   timestamptz;
ALTER TABLE free_scan_accounts ADD COLUMN IF NOT EXISTS pending_mfa_method              text;
ALTER TABLE free_scan_accounts ADD COLUMN IF NOT EXISTS pending_totp_secret_encrypted   text;
ALTER TABLE free_scan_accounts ADD COLUMN IF NOT EXISTS pending_phone                   text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'free_scan_accounts_mfa_reset_status_check') THEN
    ALTER TABLE free_scan_accounts ADD CONSTRAINT free_scan_accounts_mfa_reset_status_check
      CHECK (mfa_reset_status IS NULL OR mfa_reset_status IN ('pending', 'approved', 'denied'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'free_scan_accounts_pending_mfa_method_check') THEN
    ALTER TABLE free_scan_accounts ADD CONSTRAINT free_scan_accounts_pending_mfa_method_check
      CHECK (pending_mfa_method IS NULL OR pending_mfa_method IN ('totp', 'sms'));
  END IF;
END $$;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-17-free-scan-account-recovery-4483.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
