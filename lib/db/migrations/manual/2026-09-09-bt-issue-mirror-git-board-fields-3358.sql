-- ─────────────────────────────────────────────────────────────────────────────
-- Git #3358 — Git Board tree fields for the local issue mirror (bt_issue_mirror)
-- ─────────────────────────────────────────────────────────────────────────────
-- The Git Board tree's core open-issue fetch (LeftSidebar.PopulateGitTrackerBoardAsync
-- → GitHubApiClient.ListBoardIssuesAsync) was never migrated off the live 500+-issue
-- GraphQL walk in #3113/#3134 — those scoped only to Batter Up / AI Batter Up / chat
-- dock / title lookups. So the single most-visible surface in the app still failed
-- outright every time the rate-limit circuit opened, while Batter Up (mirror-backed)
-- kept working.
--
-- To let the Git Board read from bt_issue_mirror instead, the mirror must carry every
-- field the tree actually renders (audited against GitBoardIssue's consumed fields):
-- the issue body (SqlPath extraction + detail view), its GitHub milestone assignment,
-- its parent/epic linkage (+ the parent's own milestone, for Focus Mode's
-- child→epic→milestone resolution), the real sub-issue rollup counts, its child issue
-- numbers, and the GraphQL databaseId (the numeric REST id the sub_issues endpoint
-- wants). All of these are already fetched by ListBoardIssuesAsync (the same call the
-- full sync runs) — they just weren't being persisted. These are POST-PROCESSED
-- values (parent inference, transitive milestone inheritance, bidirectional child
-- reconciliation are all applied inside ListBoardIssuesInternalAsync before the sync
-- sees them), so reading them back reconstructs the same enriched tree with no live call.
--
-- All additive; safe to run against a live mirror. The FULL walk (SyncAsync) populates
-- these; the cheap incremental pass (IncrementalSyncAsync) deliberately does NOT touch
-- them (its light REST `since=` shape carries none of them), so they simply default on
-- a brand-new incremental insert and are PRESERVED (untouched) on an incremental update
-- — corrected by the next full walk (≤30 min) or a manual refresh (a forced live
-- re-sync). This is exactly the same full-walk-authoritative tradeoff board_status_*
-- already uses (see the GitHubIssueMirror class doc comment).

ALTER TABLE bt_issue_mirror ADD COLUMN IF NOT EXISTS body                     TEXT NOT NULL DEFAULT '';
ALTER TABLE bt_issue_mirror ADD COLUMN IF NOT EXISTS milestone_title          TEXT;
ALTER TABLE bt_issue_mirror ADD COLUMN IF NOT EXISTS milestone_number         INTEGER;
ALTER TABLE bt_issue_mirror ADD COLUMN IF NOT EXISTS parent_number            INTEGER;
ALTER TABLE bt_issue_mirror ADD COLUMN IF NOT EXISTS parent_milestone_number  INTEGER;
ALTER TABLE bt_issue_mirror ADD COLUMN IF NOT EXISTS sub_issue_count          INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bt_issue_mirror ADD COLUMN IF NOT EXISTS sub_issue_completed      INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bt_issue_mirror ADD COLUMN IF NOT EXISTS sub_issue_percent        INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bt_issue_mirror ADD COLUMN IF NOT EXISTS child_issue_numbers      INTEGER[] NOT NULL DEFAULT '{}';
ALTER TABLE bt_issue_mirror ADD COLUMN IF NOT EXISTS database_id              BIGINT NOT NULL DEFAULT 0;

-- Per-milestone real open/closed counts, driving the Git Board's milestone header
-- badges ("947/1430 · 66%"). These come from GitHub's own milestones object
-- (GET /repos/{o}/{r}/milestones?state=all) — a single ETag-cached REST call the
-- board fired live in the SAME try block as the issue walk, so a rate-limit-circuit
-- failure there aborted the whole board too. Mirroring it (refreshed on the full walk)
-- lets the board render its real milestone counts with the circuit open, and survives
-- a BuildConsole restart (the old in-memory 5-min cache did not). The mirror only
-- tracks the OPEN issue set + recently-closed, so it can't derive true per-milestone
-- CLOSED counts itself — hence the counts are mirrored from GitHub's authoritative
-- milestone object rather than computed from bt_issue_mirror rows.
CREATE TABLE IF NOT EXISTS bt_milestone_mirror (
  number          INTEGER PRIMARY KEY,
  title           TEXT NOT NULL DEFAULT '',
  -- 'open' | 'closed' — GitHub's real milestone state.
  state           TEXT NOT NULL DEFAULT 'open',
  open_issues     INTEGER NOT NULL DEFAULT 0,
  closed_issues   INTEGER NOT NULL DEFAULT 0,
  last_synced_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Invalidate the mirror's "fully synced" bookkeeping so the very next
-- MaybeSyncAsync tick runs a FULL walk (its decision order: last_full_sync_at IS
-- NULL → full), which is what actually populates the NEW columns above. Without
-- this, the 762 existing rows would read back with empty/default new fields (no
-- body, no milestone, sub_issue_count 0 → the Git Board would show no epics and no
-- milestone grouping) for up to the 30-min full-walk interval. Nulling this makes
-- HasUsableDataAsync fail-closed in the meantime, so every mirror reader (the Git
-- Board, Batter Up, the chat dock) transparently falls back to its existing LIVE
-- path for the brief window (~30s + one full-sync duration) until the forced full
-- walk lands and repopulates every column — then reads switch to mirror-backed.
-- No data is lost: the sync simply re-derives every row from real GitHub state.
UPDATE bt_issue_mirror_sync_state
   SET last_full_sync_at = NULL,
       last_sync_ok = false,
       last_sync_note = 'invalidated by 2026-09-09-bt-issue-mirror-git-board-fields-3358.sql — forcing a full walk to populate the new Git Board columns'
 WHERE id = 1;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-09-bt-issue-mirror-git-board-fields-3358.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
