-- Git #1044 (Epic #660, Phase 2). "Share a link" for the live-rendered
-- document set — a long-lived, revocable, no-login token, distinct from
-- document_print_tokens (#1043, single-use/minutes-lived, authenticates a
-- headless print tab as the real logged-in user). quick_win_result_shares
-- and any other old share mechanism are DEPRECATED for this feature and are
-- not touched or reused by this migration.
--
-- No expires_at: a share link is handed to someone specifically so they can
-- come back to it later (a purchasing approval can take weeks), and
-- revoked_at is the real, deliberate control the customer has over it — see
-- the Drizzle table's own comment in lib/db/src/schema/index.ts for the full
-- reasoning.

CREATE TABLE IF NOT EXISTS live_document_shares (
  id          SERIAL PRIMARY KEY,
  token       TEXT        NOT NULL UNIQUE,
  customer_id INTEGER     NOT NULL REFERENCES users(id),
  variant     TEXT        NOT NULL CHECK (variant IN ('review', 'purchasing')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS live_document_shares_customer_id_idx
  ON live_document_shares (customer_id);

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-14-live-document-shares-1044.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
