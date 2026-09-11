-- Git #3579 — real (repo_owner, repo_name) dimension for every local table currently
-- keyed on a bare GitHub issue/milestone number.
--
-- Background: bt_issue_mirror, bt_build_queue, and every other table below treat a
-- GitHub issue/milestone number as globally unique. Confirmed via direct schema read
-- (this migration's own author queried `\d` on each table against local DATABASE_URL) —
-- zero repo_owner/repo_name column anywhere. Once a second real repo's issues coexist
-- locally (e.g. `shanes-life` issue #12 alongside `Shane-McCaw-MSP` issue #12), any
-- lookup/uniqueness keyed on the number alone collides or silently mixes rows across
-- repos. This is the real foundation Feature #3578's #3582/#3583/#3584 all depend on.
--
-- Convention (picked per #3579's own body — two columns, used everywhere, never mixed
-- with a single "owner/name" string column): every table gets
--   repo_owner TEXT NOT NULL DEFAULT 'shanemccaw'
--   repo_name  TEXT NOT NULL DEFAULT 'Shane-McCaw-MSP'
-- so every existing row backfills to the one real repo running today — zero data loss,
-- nothing already running breaks. A second repo's rows will carry that repo's own real
-- owner/name once #3581 (Settings repo registry) and #3582 (merged Batter Up) land.
--
-- Composite key changes — a bare issue/milestone number is no longer a sound uniqueness
-- boundary once a second repo is real:
--   bt_issue_mirror            issue_number PK                       -> (repo_owner, repo_name, issue_number)
--   bt_dispatch_claims         github_number PK                      -> (repo_owner, repo_name, github_number)
--   bt_epics                   github_number UNIQUE                  -> (repo_owner, repo_name, github_number)
--   bt_issues                  github_number UNIQUE                  -> (repo_owner, repo_name, github_number)
--   bt_chat_issues             (chat_id, issue_number) UNIQUE        -> (chat_id, repo_owner, repo_name, issue_number)
--   bt_chat_mentioned_issues   (chat_url, issue_number) UNIQUE       -> (chat_url, repo_owner, repo_name, issue_number)
--   bt_milestone_mirror        number PK                             -> (repo_owner, repo_name, number)
--
-- Columns-only, no key change (real serial `id` stays the primary key; the repo
-- dimension is added so #3582's merge and #3584's dispatch/worktree provisioning have
-- a real column to resolve the target repo from — threading it through the actual
-- dedup/blocked_by/provisioning LOGIC on these two tables is those issues' own explicit
-- scope, not this migration's):
--   bt_build_queue         (adds repo_owner/repo_name; github_number/blocked_by_number(s)
--                            stay as-is — cross-repo-aware dedup is #3582/#3584's job)
--   build_dispatch_log     (adds repo_owner/repo_name; its lookup index is widened so a
--                            per-repo re-dispatch count stays correct once #3582 lands)
--
-- Idempotent throughout (IF NOT EXISTS / DO blocks guarding constraint drops). Run
-- against local DATABASE_URL in this session; recorded on #1630 for Replit/staging
-- release per CLAUDE.md's manual-migration convention.

BEGIN;

-- ── bt_issue_mirror ──────────────────────────────────────────────────────────────
ALTER TABLE bt_issue_mirror
    ADD COLUMN IF NOT EXISTS repo_owner TEXT NOT NULL DEFAULT 'shanemccaw',
    ADD COLUMN IF NOT EXISTS repo_name  TEXT NOT NULL DEFAULT 'Shane-McCaw-MSP';

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bt_issue_mirror_pkey') THEN
        ALTER TABLE bt_issue_mirror DROP CONSTRAINT bt_issue_mirror_pkey;
    END IF;
END $$;

ALTER TABLE bt_issue_mirror
    ADD CONSTRAINT bt_issue_mirror_pkey PRIMARY KEY (repo_owner, repo_name, issue_number);

-- ── bt_build_queue (columns only — see header) ──────────────────────────────────
ALTER TABLE bt_build_queue
    ADD COLUMN IF NOT EXISTS repo_owner TEXT NOT NULL DEFAULT 'shanemccaw',
    ADD COLUMN IF NOT EXISTS repo_name  TEXT NOT NULL DEFAULT 'Shane-McCaw-MSP';

-- ── bt_dispatch_claims ───────────────────────────────────────────────────────────
ALTER TABLE bt_dispatch_claims
    ADD COLUMN IF NOT EXISTS repo_owner TEXT NOT NULL DEFAULT 'shanemccaw',
    ADD COLUMN IF NOT EXISTS repo_name  TEXT NOT NULL DEFAULT 'Shane-McCaw-MSP';

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bt_dispatch_claims_pkey') THEN
        ALTER TABLE bt_dispatch_claims DROP CONSTRAINT bt_dispatch_claims_pkey;
    END IF;
END $$;

ALTER TABLE bt_dispatch_claims
    ADD CONSTRAINT bt_dispatch_claims_pkey PRIMARY KEY (repo_owner, repo_name, github_number);

-- ── bt_epics ─────────────────────────────────────────────────────────────────────
ALTER TABLE bt_epics
    ADD COLUMN IF NOT EXISTS repo_owner TEXT NOT NULL DEFAULT 'shanemccaw',
    ADD COLUMN IF NOT EXISTS repo_name  TEXT NOT NULL DEFAULT 'Shane-McCaw-MSP';

-- bt_epics_github_number_uniq is a plain UNIQUE INDEX (not a table constraint) —
-- drop/recreate as an index, same real name, now composite.
DROP INDEX IF EXISTS bt_epics_github_number_uniq;
CREATE UNIQUE INDEX bt_epics_github_number_uniq
    ON bt_epics (repo_owner, repo_name, github_number);

-- ── bt_issues ────────────────────────────────────────────────────────────────────
ALTER TABLE bt_issues
    ADD COLUMN IF NOT EXISTS repo_owner TEXT NOT NULL DEFAULT 'shanemccaw',
    ADD COLUMN IF NOT EXISTS repo_name  TEXT NOT NULL DEFAULT 'Shane-McCaw-MSP';

-- bt_issues_github_number_uniq is a plain UNIQUE INDEX (not a table constraint) —
-- drop/recreate as an index, same real name, now composite.
DROP INDEX IF EXISTS bt_issues_github_number_uniq;
CREATE UNIQUE INDEX bt_issues_github_number_uniq
    ON bt_issues (repo_owner, repo_name, github_number);

-- ── bt_chat_issues ───────────────────────────────────────────────────────────────
ALTER TABLE bt_chat_issues
    ADD COLUMN IF NOT EXISTS repo_owner TEXT NOT NULL DEFAULT 'shanemccaw',
    ADD COLUMN IF NOT EXISTS repo_name  TEXT NOT NULL DEFAULT 'Shane-McCaw-MSP';

-- bt_chat_issues_chat_issue_unique is a plain UNIQUE INDEX (not a table constraint) —
-- drop/recreate as an index, same real name, now composite.
DROP INDEX IF EXISTS bt_chat_issues_chat_issue_unique;
CREATE UNIQUE INDEX bt_chat_issues_chat_issue_unique
    ON bt_chat_issues (chat_id, repo_owner, repo_name, issue_number);

-- ── bt_chat_mentioned_issues ─────────────────────────────────────────────────────
ALTER TABLE bt_chat_mentioned_issues
    ADD COLUMN IF NOT EXISTS repo_owner TEXT NOT NULL DEFAULT 'shanemccaw',
    ADD COLUMN IF NOT EXISTS repo_name  TEXT NOT NULL DEFAULT 'Shane-McCaw-MSP';

-- bt_chat_mentioned_issues_chat_issue_unique is a plain UNIQUE INDEX (not a table
-- constraint) — drop/recreate as an index, same real name, now composite.
DROP INDEX IF EXISTS bt_chat_mentioned_issues_chat_issue_unique;
CREATE UNIQUE INDEX bt_chat_mentioned_issues_chat_issue_unique
    ON bt_chat_mentioned_issues (chat_url, repo_owner, repo_name, issue_number);

-- ── bt_milestone_mirror ──────────────────────────────────────────────────────────
ALTER TABLE bt_milestone_mirror
    ADD COLUMN IF NOT EXISTS repo_owner TEXT NOT NULL DEFAULT 'shanemccaw',
    ADD COLUMN IF NOT EXISTS repo_name  TEXT NOT NULL DEFAULT 'Shane-McCaw-MSP';

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bt_milestone_mirror_pkey') THEN
        ALTER TABLE bt_milestone_mirror DROP CONSTRAINT bt_milestone_mirror_pkey;
    END IF;
END $$;

ALTER TABLE bt_milestone_mirror
    ADD CONSTRAINT bt_milestone_mirror_pkey PRIMARY KEY (repo_owner, repo_name, number);

-- ── build_dispatch_log (columns + widened lookup index — see header) ───────────
ALTER TABLE build_dispatch_log
    ADD COLUMN IF NOT EXISTS repo_owner TEXT NOT NULL DEFAULT 'shanemccaw',
    ADD COLUMN IF NOT EXISTS repo_name  TEXT NOT NULL DEFAULT 'Shane-McCaw-MSP';

DROP INDEX IF EXISTS build_dispatch_log_issue_number_dispatched_at_idx;
CREATE INDEX IF NOT EXISTS build_dispatch_log_repo_issue_dispatched_at_idx
    ON build_dispatch_log (repo_owner, repo_name, issue_number, dispatched_at);

-- Self-mark so Simulator Studio's Migrations tree reflects DB reality (Git #497).
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-10-multi-repo-issue-key-dimension-3579.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
