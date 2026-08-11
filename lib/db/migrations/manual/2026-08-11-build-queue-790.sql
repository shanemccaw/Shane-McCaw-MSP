-- Build Tracker — queued builds (Git #790).
--
-- Shane: "if we could really build me a true queued up build... that would
-- speed up my development time like mad." A build he's not ready to launch
-- yet, or is deliberately queuing behind another one, sits here until
-- scripts/build-queue-watcher.ps1 (a persistent local watcher he runs on his
-- own machine) claims it and launches a real Claude Code session the same
-- way run-claude.ps1 already does for mybuilder://.
--
-- github_number is the issue this build is itself FOR, if any — lets the
-- panel reuse the same epic/issue linking the rest of Build Tracker already
-- does. blocked_by_number is the issue it can't start until closed/complete
-- — NULL means ready to run as soon as a watcher slot frees up. Both are
-- plain integers, no FK — same convention as bt_epics/bt_issues.github_number
-- (a real GitHub issue number, not a foreign key into any local table).
--
-- claimed_at is the real source of truth for "is this actually running right
-- now" — the watcher sets it the instant it launches a session, so a
-- watcher that gets killed mid-run doesn't leave a row silently stuck
-- "queued" while a claude.exe process from it is still (or was) alive.
--
-- Run via Shane's SQL console; do NOT run drizzle-kit push against this.

BEGIN;

CREATE TABLE IF NOT EXISTS bt_build_queue (
  id                 SERIAL PRIMARY KEY,
  title              TEXT NOT NULL,
  prompt             TEXT NOT NULL,
  model              TEXT,
  effort             TEXT,
  cwd                TEXT,
  github_number      INTEGER,
  blocked_by_number  INTEGER,
  status             TEXT NOT NULL DEFAULT 'queued',   -- queued | running | done | failed | canceled
  claimed_at         TIMESTAMPTZ,
  completed_at       TIMESTAMPTZ,
  exit_code          INTEGER,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The watcher's main poll query: "what's ready to claim right now" —
-- queued rows first, oldest first, so a build doesn't get starved by
-- everything queued after it.
CREATE INDEX IF NOT EXISTS bt_build_queue_status_created_idx
  ON bt_build_queue (status, created_at);

-- ── self-marking record ───────────────────────────────────────────────────────

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-11-build-queue-790.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
