-- #4408 — TOTP replay protection (RFC 6238 §5.2).
--
-- /auth/mfa/totp/challenge and /auth/mfa/verify accepted the same six-digit code
-- for any number of sign-ins inside its ~30s tolerance window, and the code used
-- to finish enrollment (/auth/mfa/totp/verify-setup and the purchase-flow
-- verify-setup handlers) was accepted again at the challenge straight afterwards.
--
--   totp_last_accepted_step — the TOTP time-step (floor(epoch / 30)) of the last
--     code this enrollment accepted. Every verification refuses a step <= it, and
--     the challenge advances it with a compare-and-set so two concurrent requests
--     cannot both spend one code. Null for pre-#4408 rows (first code sets it) and
--     for sms/passkey rows.
--
-- Additive, nullable, reversible. Safe to re-run (IF NOT EXISTS).

BEGIN;

ALTER TABLE mfa_enrollments
  ADD COLUMN IF NOT EXISTS totp_last_accepted_step BIGINT;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('4408-mfa-enrollments-totp-last-accepted-step.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
