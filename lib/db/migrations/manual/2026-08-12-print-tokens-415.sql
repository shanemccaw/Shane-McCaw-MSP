-- 2026-08-12 — Git #415
--
-- Backing table for the short-lived, single-use bearer token headless
-- Chromium exchanges (POST /auth/print-exchange) for a real short-lived JWT,
-- so it can navigate the live, authenticated Document Viewer route and
-- print-to-pdf the actual rendered page with no interactive session of its
-- own. Same consumable-secret shape as impersonation_tokens/
-- account_setup_tokens:
--   * expires_at makes it short-lived
--   * used_at makes it single-use
--
-- Scoped to exactly one document per token (document_id NOT NULL) rather than
-- one token per download batch — a "download all N ready reports" batch
-- mints one token per document, so a leaked token can never reach further
-- than the single PDF it was minted for.
--
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS print_tokens (
  id           SERIAL PRIMARY KEY,
  token        TEXT        NOT NULL UNIQUE,
  user_id      INTEGER     NOT NULL REFERENCES users(id),
  document_id  INTEGER     NOT NULL REFERENCES insights_generated_documents(id),
  expires_at   TIMESTAMPTZ NOT NULL,
  used_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS print_tokens_expires_at_idx
  ON print_tokens (expires_at);

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-12-print-tokens-415.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
