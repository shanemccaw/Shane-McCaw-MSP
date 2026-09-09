-- ─────────────────────────────────────────────────────────────────────────────
-- Git #3337 — incremental (REST since=) sync bookkeeping for the issue mirror
-- ─────────────────────────────────────────────────────────────────────────────
-- Bookkeeping for a NEW, cheap incremental sync path, tracked separately from the
-- existing last_full_sync_at (which keeps meaning "last full GraphQL issues-walk +
-- board-status sweep" — the expensive, ~32-paginated-call reconciliation pass).
--
-- Real, live investigation (2026-09-09, see GitHubIssueMirror.cs / #3337 for the
-- full account): GitHub's REST `GET /issues?since=...` is a genuine, DB-backed
-- incremental filter — safe to trust. GitHub's Projects v2 GraphQL API, by
-- contrast, has NO reliable incremental signal for board-status (Status field)
-- changes: `ProjectV2Item.updatedAt` is real and accurate, but the only way to
-- ASK for "items changed since X" is the search-index-backed
-- `items(query: "updated:>...")` filter, which measurably lagged 15+ minutes
-- behind a confirmed real change in live testing against this repo's own real
-- project board (an item whose own updatedAt was unambiguously inside the
-- filtered window still came back `totalCount: 0` many minutes later), and
-- `ProjectV2ItemOrderField` offers no `UPDATED_AT` option to sort by either
-- (only `POSITION`). Shipping board-status diffing against that filter would
-- silently miss real column moves for as long as the index lags — exactly what
-- the issue asked NOT to do. So: issue-level state (title/state/labels) gets the
-- new fast incremental path below; board status stays full-walk-only, still
-- reconciled on its own periodic cadence (see FullSyncInterval).

ALTER TABLE bt_issue_mirror_sync_state
  ADD COLUMN IF NOT EXISTS last_incremental_sync_at   TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS last_incremental_sync_ok    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_incremental_sync_note  TEXT;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-09-bt-issue-mirror-incremental-sync-3337.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
