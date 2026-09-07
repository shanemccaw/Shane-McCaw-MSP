-- ─────────────────────────────────────────────────────────────────────────────
-- Git #3113 — local Postgres mirror of GitHub issue state (batched GraphQL sync)
-- ─────────────────────────────────────────────────────────────────────────────
-- The real root fix for the recurring 5-day rate-limit cycle (Shane's own
-- architectural redirect, 2026-09-07): instead of firing one `gh issue view #N`
-- (or per-issue board-status GraphQL) call PER issue number on every refresh,
-- keep a local mirror of the issue state routine reads actually need, refreshed
-- by a single periodic, BATCHED GraphQL sync. Routine display reads (issue-title
-- warm-up, chat-dock enrichment, the background Verifying-row board reconcile)
-- read this table and never touch GitHub's API budget; live GitHub calls are
-- reserved for (a) the periodic sync itself and (b) genuinely authoritative
-- real-time checks (the fail-closed dispatch/blocker gate, a just-made board
-- move) which are DELIBERATELY left calling GitHub live — a stale mirror reading
-- there could be genuinely unsafe.
--
-- This is a NEW table, distinct from the pre-existing bt_issues / bt_epics
-- internal sync tables (which mirror a different, epic_id-based association
-- graph, #910). This one is a read cache of real GitHub state, keyed by issue
-- number.

CREATE TABLE IF NOT EXISTS bt_issue_mirror (
  issue_number            INTEGER PRIMARY KEY,
  title                   TEXT NOT NULL DEFAULT '',
  -- 'open' | 'closed' — GitHub's real issue state (never a label).
  state                   TEXT NOT NULL DEFAULT 'open',
  -- The ProjectV2 "Status" field's real option id (e.g. Batter Up / Backlog /
  -- Park / Verifying / Done) and its display name. NULL = the issue is off the
  -- board or has no Status set.
  board_status_option_id  TEXT,
  board_status_name       TEXT,
  -- Every real GitHub label name on the issue (incl. 'blocked','in-flight','complete').
  labels                  TEXT[] NOT NULL DEFAULT '{}',
  -- Real declared blocked_by dependency edges (issue numbers). Open OR closed —
  -- the closed-ness of each is resolved from that blocker's own mirror row.
  blocked_by_numbers      INTEGER[] NOT NULL DEFAULT '{}',
  -- The inverse: issue numbers THIS issue blocks (computed during sync).
  blocking_numbers        INTEGER[] NOT NULL DEFAULT '{}',
  html_url                TEXT NOT NULL DEFAULT '',
  created_at              TIMESTAMP WITH TIME ZONE,
  closed_at              TIMESTAMP WITH TIME ZONE,
  -- The moment this row was last confirmed against real GitHub state.
  last_synced_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS bt_issue_mirror_state_idx
  ON bt_issue_mirror (state);
CREATE INDEX IF NOT EXISTS bt_issue_mirror_board_status_idx
  ON bt_issue_mirror (board_status_option_id);

-- Single-row sync bookkeeping: when the last full sync completed, whether it
-- succeeded, and a short human note. Lets a caller cheaply answer "has the
-- mirror ever synced?" (fail-closed for the chat dock) and lets the periodic
-- sync trigger gate on an interval without scanning the whole table.
CREATE TABLE IF NOT EXISTS bt_issue_mirror_sync_state (
  id                 INTEGER PRIMARY KEY DEFAULT 1,
  last_full_sync_at  TIMESTAMP WITH TIME ZONE,
  last_sync_ok       BOOLEAN NOT NULL DEFAULT false,
  last_sync_note     TEXT,
  CONSTRAINT bt_issue_mirror_sync_state_singleton CHECK (id = 1)
);
INSERT INTO bt_issue_mirror_sync_state (id, last_full_sync_at, last_sync_ok, last_sync_note)
VALUES (1, NULL, false, 'not yet synced')
ON CONFLICT (id) DO NOTHING;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-07-bt-issue-mirror-3113.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
