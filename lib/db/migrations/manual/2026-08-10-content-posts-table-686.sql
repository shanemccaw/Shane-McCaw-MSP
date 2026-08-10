-- Content Studio — LinkedIn post scheduling (Phase F, Git #686, epic #601).
-- Adds content_posts, the real backend behind contentStudioStore.ts's
-- previously in-memory-only Phase B-E store.
-- Run via Shane's SQL console; do NOT run drizzle-kit push against this.

BEGIN;

CREATE TABLE IF NOT EXISTS content_posts (
  id                    SERIAL PRIMARY KEY,
  body                  TEXT NOT NULL DEFAULT '',
  media_refs            JSONB NOT NULL DEFAULT '[]',
  status                TEXT NOT NULL DEFAULT 'draft',   -- draft | scheduled | posted | failed
  scheduled_for         TIMESTAMPTZ,
  platform              TEXT NOT NULL DEFAULT 'linkedin',
  ai_generated          BOOLEAN NOT NULL DEFAULT false,
  engagement_snapshot   JSONB,                            -- null until Community Mgmt API access exists
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS content_posts_status_idx ON content_posts (status);

-- The dispatcher's fan_out_query (seed-system-workflows.ts) selects on
-- exactly this pair, so it's the one index that actually matters here.
CREATE INDEX IF NOT EXISTS content_posts_due_idx ON content_posts (status, scheduled_for);

-- ── self-marking record ───────────────────────────────────────────────────────

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-10-content-posts-table-686.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
