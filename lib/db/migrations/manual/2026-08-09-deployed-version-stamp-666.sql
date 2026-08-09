-- Deployed Version Stamp — Git #666
-- Manual migration — review and run by hand (do not run drizzle-kit push/push --force).
--
-- ── THE PROBLEM ──────────────────────────────────────────────────────────────
-- GET /api/version's computeVersionInfo() (artifacts/api-server/src/routes/
-- version.ts) shells out to `git rev-list --count HEAD` / `git rev-parse --short
-- HEAD` against the repo root. That only works where a real .git directory
-- exists — the dev workspace. A real production deploy is a compiled build
-- artifact with no .git folder at all, so the shellout always throws there and
-- the catch block returns a generic, meaningless placeholder:
--   { version: "1.0.0", hash: "unknown", display: "1.0.0 (unknown)" }
-- All three frontends (admin-panel, msp-portal, shane-mccaw-consulting) call
-- this same one endpoint via their own useVersionInfo.ts hooks, so the same
-- meaningless info shows everywhere in production.
--
-- ── THE FIX ──────────────────────────────────────────────────────────────────
-- This table holds the real commit hash/message of whatever was last actually
-- deployed. A new authenticated POST /api/admin/version-stamp (requireAdmin)
-- writes one row here per deploy. computeVersionInfo()'s catch block now reads
-- the most recent row here before falling back further to the generic
-- placeholder (kept as the final safety net if this table is also empty, e.g.
-- before the first deploy after this migration runs).
--
-- Consumed by:
--   - GET  /api/version                    (public, all three frontends)
--   - POST /api/admin/version-stamp         (PlatformAdmin only, writes a row)

CREATE TABLE IF NOT EXISTS "deployed_version_stamp" (
  "id" serial PRIMARY KEY,
  "commit_hash" text NOT NULL,
  "commit_message" text NOT NULL,
  "deployed_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "deployed_version_stamp_deployed_at_idx" ON "deployed_version_stamp" ("deployed_at");

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-09-deployed-version-stamp-666.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
