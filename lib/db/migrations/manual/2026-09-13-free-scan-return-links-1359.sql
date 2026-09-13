-- Git #1359 (Phase 7 of #1352, Free Scan): emailed "view your free scan results"
-- return link for a passwordless Free Scan Prospect.
--
-- Its own table on purpose — NOT a kind of account_setup_tokens. Those tokens are
-- exchanged by /auth/setup-password for a password + real session and are gated by
-- hasRealEntitlement() because of #656. This table's tokens only ever authorise the
-- read-only POST /api/public/free-scan/results for the one tenant row they were
-- minted for. Only a sha256 of the token is stored.
--
-- Additive only (new table). Mirrors freeScanReturnLinksTable in lib/db/src/schema/index.ts.

BEGIN;

CREATE TABLE IF NOT EXISTS free_scan_return_links (
  id           serial PRIMARY KEY,
  token_hash   text NOT NULL UNIQUE,
  purpose      text NOT NULL DEFAULT 'free_scan_results',
  user_id      integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  customer_id  integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz,
  last_used_at timestamptz,
  use_count    integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT free_scan_return_links_purpose_check CHECK (purpose = 'free_scan_results')
);

CREATE INDEX IF NOT EXISTS free_scan_return_links_user_id_idx ON free_scan_return_links (user_id);

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-13-free-scan-return-links-1359.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
