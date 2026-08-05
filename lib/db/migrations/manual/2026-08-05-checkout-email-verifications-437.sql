-- 2026-08-05 — Git #437 / #438 (parent #427)
--
-- Backing table for the six-digit email verification code the Home-page
-- assessment flow issues after payment, gating the inline account-creation
-- steps (verify email -> set password) that replaced the old "we'll email you
-- a setup link" deferral.
--
-- Shape deliberately mirrors the other consumable-secret tables already in this
-- schema (password_reset_tokens, account_setup_tokens, mfa_challenges):
--   * only the bcrypt hash of the code is stored, never the six digits
--   * expires_at makes it short-lived
--   * verified_at makes it single-use
--   * attempts is the brute-force budget — six digits is only safe with a cap
--
-- ON DELETE CASCADE: a verification code has no meaning once the checkout
-- session it belongs to is gone.
--
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS checkout_email_verifications (
  id           SERIAL PRIMARY KEY,
  session_id   UUID        NOT NULL REFERENCES checkout_sessions(id) ON DELETE CASCADE,
  email        TEXT        NOT NULL,
  code_hash    TEXT        NOT NULL,
  attempts     INTEGER     NOT NULL DEFAULT 0,
  expires_at   TIMESTAMPTZ NOT NULL,
  verified_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS checkout_email_verifications_session_id_idx
  ON checkout_email_verifications (session_id);

CREATE INDEX IF NOT EXISTS checkout_email_verifications_expires_at_idx
  ON checkout_email_verifications (expires_at);
