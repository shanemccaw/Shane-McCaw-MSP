-- 2026-08-14 — Git #1043 (Epic #660, Phase 1)
--
-- Sibling to print_tokens (2026-08-12-print-tokens-415.sql) for the Copilot
-- Readiness journey's live-rendered documents (JOURNEY_LIVE_DOCUMENTS in
-- artifacts/msp-portal/src/components/copilot-journey/journeyTokens.ts).
-- Those documents have id: null by design — journeyModel.ts's
-- buildGeneration()/withLiveDocuments() never back them with a row — so
-- print_tokens' NOT NULL document_id FK into insights_generated_documents
-- structurally cannot scope a token to one of them. This table is keyed by
-- doc_type instead. No document_id column — there is nothing to reference.
--
-- Same consumable-secret shape as print_tokens/impersonation_tokens/
-- account_setup_tokens:
--   * expires_at makes it short-lived
--   * used_at makes it single-use
--
-- insights-documents / insights_generated_documents / print_tokens are
-- DEPRECATED for this feature and are untouched here — this is a clean
-- table for the live-rendered document set only.
--
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS document_print_tokens (
  id          SERIAL PRIMARY KEY,
  token       TEXT        NOT NULL UNIQUE,
  user_id     INTEGER     NOT NULL REFERENCES users(id),
  doc_type    TEXT        NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS document_print_tokens_expires_at_idx
  ON document_print_tokens (expires_at);

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-14-document-print-tokens-1043.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
