-- AI dev-response-cache infrastructure — #185, sub-issue of #183.
--
-- Net-new: confirmed via direct search that no dev-time AI response caching
-- exists anywhere in this codebase before this migration. Blocks #183 Phases
-- 3/4/8 (Persona Generation, Use Case Generation, Final Report narrative —
-- the platform's only 3 real Anthropic call sites so far) since all three
-- depend on this existing first.
--
-- Read/written EXCLUSIVELY by artifacts/api-server/src/lib/ai-dev-response-cache.ts,
-- which hard-gates every access to non-production (NODE_ENV === "development"
-- or "test", fail-closed — same allow-list convention as
-- admin-active-directory.ts's assertNonProductionEnvironment()). Nothing at
-- the schema level enforces that; the table itself is inert in any
-- environment unless that module's gate passes.
--
-- Shape, per Shane's explicit comment on #185 (supersedes the issue body's
-- vaguer original wording):
--   - hash: stable lookup key over a call site's real inputs (feature + its
--     request context).
--   - feature: plain TEXT, NOT an enum/CHECK-constrained column — a new AI
--     call site must never need a schema migration just to start caching.
--   - request_context / response: JSONB, because different call sites' inputs
--     and outputs share no common shape (persona-gen's inputs look nothing
--     like a report narrative's, and that's fine).
--   - created_at / expires_at: expires_at NULL means "no TTL, cleared only by
--     the module's manual-clear helper" — the module's own default TTL is
--     applied at write time, not enforced here.
--
-- Manual migration — review and run by hand (do not run drizzle-kit push/push --force).

CREATE TABLE IF NOT EXISTS "ai_dev_response_cache" (
  "id" serial PRIMARY KEY,
  "hash" text NOT NULL UNIQUE,
  "feature" text NOT NULL,
  "request_context" jsonb NOT NULL,
  "response" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz
);

CREATE INDEX IF NOT EXISTS "ai_dev_response_cache_feature_idx" ON "ai_dev_response_cache" ("feature");
CREATE INDEX IF NOT EXISTS "ai_dev_response_cache_expires_at_idx" ON "ai_dev_response_cache" ("expires_at");

-- ── Verification — run after applying. Expect a real row count (0 on first
-- apply) and confirm the table cannot be reached from prod code paths by
-- searching the deployed app for "ai_dev_response_cache" outside
-- lib/ai-dev-response-cache.ts and this schema file.
-- SELECT count(*) FROM "ai_dev_response_cache";

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-07-30-ai-dev-response-cache.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
