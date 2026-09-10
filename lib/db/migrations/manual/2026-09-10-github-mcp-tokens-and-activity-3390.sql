-- Git #3390 (Feature #3377) — GitHub MCP server: bearer-token store + Recent-Activity trail.
--
-- Additive, reversible DDL (new tables only). Run against the local DATABASE_URL in-session
-- per CLAUDE.md's Database rules; a line for Replit/Staging is appended to the #1630 checklist.
--
-- These tables hold ONLY the bearer tokens a Claude connection uses to reach the MCP server
-- (SHA-256 fingerprints, never the plaintext) and the audit trail of tool calls. The GitHub PAT
-- itself is NEVER stored here — it lives only in the server process's environment.

BEGIN;

CREATE TABLE IF NOT EXISTS github_mcp_tokens (
  id           serial PRIMARY KEY,
  token_hash   text        NOT NULL,
  label        text        NOT NULL DEFAULT 'unnamed',
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at   timestamptz,
  call_count   integer     NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS github_mcp_tokens_token_hash_unique
  ON github_mcp_tokens (token_hash);

CREATE TABLE IF NOT EXISTS github_mcp_activity (
  id          serial PRIMARY KEY,
  token_id    integer     REFERENCES github_mcp_tokens(id) ON DELETE SET NULL,
  token_label text,
  tool        text        NOT NULL,
  params      jsonb,
  outcome     text        NOT NULL,
  detail      text,
  duration_ms integer,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS github_mcp_activity_token_id_idx
  ON github_mcp_activity (token_id);
CREATE INDEX IF NOT EXISTS github_mcp_activity_created_at_idx
  ON github_mcp_activity (created_at);

-- Self-mark so Simulator Studio's Migrations tree (Git #497) reflects DB reality
-- regardless of which console ran the file.
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-10-github-mcp-tokens-and-activity-3390.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
