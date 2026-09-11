-- Git #3680 — GET /api/admin/msps/:mspId/sessions reads mspImpersonationTokensTable
-- (msp_impersonation_tokens), which nothing in the codebase ever inserts into. The
-- real impersonation-minting routes all write impersonation_tokens instead, which had
-- no revokedAt column at all, so a live impersonation session could never be revoked
-- early by a PlatformAdmin. This adds the missing column; the read route and the
-- revoke handler are switched to the real table in the same commit.

ALTER TABLE impersonation_tokens ADD COLUMN IF NOT EXISTS revoked_at timestamptz;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-11-impersonation-tokens-revoked-at-3680.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
