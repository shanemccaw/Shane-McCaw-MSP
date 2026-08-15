-- 2026-08-15 — Git #636 (Epic: A. Core Assessment Product)
--
-- Auto-login a buyer into the portal right after they set their real
-- password (POST /public/flow/set-password), via the same exchange-token
-- shape as print_tokens (2026-08-12-print-tokens-415.sql) and
-- document_print_tokens (2026-08-14-document-print-tokens-1043.sql):
--   * expires_at makes it short-lived
--   * used_at makes it single-use
--
-- Unlike those two (which trade for a scoped, short-lived print JWT), the
-- token this table backs is traded (POST /auth/signup-exchange) for a REAL,
-- ordinary session via the same session-issuing logic /auth/login uses —
-- this is the customer's own real identity, not a document-scoped
-- impersonation-shaped grant.
--
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS signup_exchange_tokens (
  id          SERIAL PRIMARY KEY,
  token       TEXT        NOT NULL UNIQUE,
  user_id     INTEGER     NOT NULL REFERENCES users(id),
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS signup_exchange_tokens_expires_at_idx
  ON signup_exchange_tokens (expires_at);

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-15-signup-exchange-tokens-636.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
