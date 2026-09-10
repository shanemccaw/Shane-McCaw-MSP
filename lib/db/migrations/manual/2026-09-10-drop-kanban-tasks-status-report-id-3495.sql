-- #3495 — retire kanban_tasks.status_report_id and its dead enrichment join.
-- Follow-up to #3427 (Status Reports admin surface teardown).
--
-- ── DESTRUCTIVE. DELIBERATELY NOT RUN BY THE AGENT THAT WROTE IT. ───────────
--
-- CLAUDE.md's Database section is explicit: additive DDL an agent runs itself,
-- but "destructive or irreversible changes (dropping columns/tables, bulk
-- rewrites, anything production-affecting) still go to Shane to run himself."
-- Dropping a column is named in that list. So this file is written, reviewed
-- and recorded on the #1630 release checklist, and left for a human to run.
--
-- ── Why this is safe to run, with the evidence ─────────────────────────────
--
-- 1. #3427 deleted the only writer of this column (`push-to-kanban` in
--    admin-status-reports.ts), so no code has set status_report_id on any
--    task since that commit landed.
-- 2. #3495 itself removed the only reader — the enrichment join in
--    admin-projects.ts's GET /admin/kanban-tasks that mapped
--    task.statusReportId -> statusReportQuestion/AdminReply/ReplyThread — and
--    the corresponding Drizzle field (lib/db/src/schema/index.ts,
--    kanbanTasksTable.statusReportId). Grep-verifiable after that commit:
--
--      grep -rn "statusReportId" artifacts/ lib/
--
--    returns nothing.
-- 3. The column has been permanently-dead (join always resolves null/empty)
--    since #3427, and status_reports itself was confirmed at 0 rows in local
--    dev Postgres at that time — this was never live data.
--
-- ── Rollback ───────────────────────────────────────────────────────────────
--
-- ALTER TABLE kanban_tasks ADD COLUMN IF NOT EXISTS status_report_id integer;
-- (No data to restore — the column's only writer was already removed by #3427.)

BEGIN;

ALTER TABLE kanban_tasks DROP COLUMN IF EXISTS status_report_id;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-10-drop-kanban-tasks-status-report-id-3495.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
