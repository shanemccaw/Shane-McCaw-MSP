-- 2026-09-16-free-scan-accounts-4329.sql — Git #4329 (Feature #1352, Free Scan)
--
-- The scoped login a paid Free Scan Prospect creates in the Checkout design's
-- `acctScreen` block (emailed code -> password -> second factor). It opens that
-- Prospect's own engagement (scan results + signed SOW) and nothing else.
--
-- Additive: one new table, keyed on free_scan_engagements. Nothing on `users`,
-- `mfa_enrollments` or `client_services` changes — general Portal access stays
-- behind hasRealEntitlement() (routes/auth.ts, #656) exactly as it was.

CREATE TABLE IF NOT EXISTS free_scan_accounts (
  id                      serial PRIMARY KEY,
  engagement_id           integer NOT NULL UNIQUE REFERENCES free_scan_engagements(id) ON DELETE CASCADE,
  email                   text NOT NULL,
  email_code_hash         text,
  email_code_expires_at   timestamptz,
  email_code_attempts     integer NOT NULL DEFAULT 0,
  email_verified_at       timestamptz,
  password_hash           text,
  password_set_at         timestamptz,
  mfa_method              text,
  totp_secret_encrypted   text,
  phone                   text,
  sms_code_hash           text,
  sms_code_expires_at     timestamptz,
  sms_code_attempts       integer NOT NULL DEFAULT 0,
  mfa_enrolled_at         timestamptz,
  session_version         integer NOT NULL DEFAULT 0,
  failed_login_count      integer NOT NULL DEFAULT 0,
  locked_until            timestamptz,
  last_login_at           timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT free_scan_accounts_mfa_method_check
    CHECK (mfa_method IS NULL OR mfa_method IN ('totp', 'sms')),
  CONSTRAINT free_scan_accounts_complete_check
    CHECK (mfa_enrolled_at IS NULL
           OR (password_hash IS NOT NULL AND email_verified_at IS NOT NULL AND mfa_method IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS free_scan_accounts_email_uidx
  ON free_scan_accounts (lower(email))
  WHERE password_hash IS NOT NULL;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-16-free-scan-accounts-4329.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
