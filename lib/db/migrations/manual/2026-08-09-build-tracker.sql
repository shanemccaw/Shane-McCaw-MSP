-- Build Tracker: Claude chat → GitHub epic/issue organiser
-- Adds three tables: bt_epics, bt_issues, bt_chats
-- Run via Shane's SQL console; do NOT run drizzle-kit push against this.

BEGIN;

-- ── bt_epics ──────────────────────────────────────────────────────────────────
-- Top-level GitHub epics / milestones, or free-form categories.
-- When github_number IS NOT NULL the epic was imported from GitHub;
-- otherwise it was created manually in the Build Tracker screen.

CREATE TABLE IF NOT EXISTS bt_epics (
  id             SERIAL PRIMARY KEY,
  title          TEXT NOT NULL,
  description    TEXT,
  status         TEXT NOT NULL DEFAULT 'open',   -- open | in_progress | closed
  github_number  INT,                             -- NULL when not from GitHub
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS bt_epics_status_idx ON bt_epics (status);

-- ── bt_issues ─────────────────────────────────────────────────────────────────
-- Individual issues, optionally grouped under an epic.
-- status follows a lightweight Kanban: backlog → in_progress → done | closed

CREATE TABLE IF NOT EXISTS bt_issues (
  id             SERIAL PRIMARY KEY,
  epic_id        INT REFERENCES bt_epics(id) ON DELETE SET NULL,
  title          TEXT NOT NULL,
  description    TEXT,
  status         TEXT NOT NULL DEFAULT 'backlog', -- backlog | in_progress | done | closed
  github_number  INT,
  github_url     TEXT,
  labels         TEXT[] NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS bt_issues_epic_id_idx ON bt_issues (epic_id);
CREATE INDEX IF NOT EXISTS bt_issues_status_idx  ON bt_issues (status);

-- ── bt_chats ──────────────────────────────────────────────────────────────────
-- Claude chat conversation links.
-- A chat may belong to an issue, to a top-level epic, or to neither (free-form).
-- conversation_id is the UUID from claude.ai; the full URL is reconstructed as:
--   https://claude.ai/chat/<conversation_id>
-- title is a human-readable label the user sets after ingest.
-- category is a free-form tag for chats not tied to any epic/issue
-- (e.g. "Marketing", "Planning", "Architecture").

CREATE TABLE IF NOT EXISTS bt_chats (
  id               SERIAL PRIMARY KEY,
  conversation_id  TEXT NOT NULL UNIQUE,   -- UUID from Claude
  title            TEXT NOT NULL,           -- defaults to conversation_id on ingest
  issue_id         INT REFERENCES bt_issues(id) ON DELETE SET NULL,
  epic_id          INT REFERENCES bt_epics(id)  ON DELETE SET NULL,
  category         TEXT,                    -- free-form when not tied to epic/issue
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS bt_chats_issue_id_idx ON bt_chats (issue_id);
CREATE INDEX IF NOT EXISTS bt_chats_epic_id_idx  ON bt_chats (epic_id);
CREATE INDEX IF NOT EXISTS bt_chats_category_idx ON bt_chats (category);

-- ── self-marking record ───────────────────────────────────────────────────────

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-09-build-tracker.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
