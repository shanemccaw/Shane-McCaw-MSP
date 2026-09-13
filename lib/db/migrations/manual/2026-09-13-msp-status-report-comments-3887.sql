-- Git #3887 — Status Reports: customer-facing read + comment endpoints
-- (Feature #3434, phase 1 of 4 -- API).
--
-- A real Q&A thread on a published msp_status_reports row. Either side can
-- post (customer via portal-status-reports.ts, MSP via a sibling endpoint
-- out of scope here) so author_type records which side actually wrote it.
-- author_user_id is a real users.id on either side of the tenant boundary,
-- same "no FK beyond usersTable" shape mspStatusReportsTable.authoredByUserId
-- already uses.

BEGIN;

CREATE TABLE IF NOT EXISTS msp_status_report_comments (
  id serial PRIMARY KEY,
  report_id integer NOT NULL REFERENCES msp_status_reports(id) ON DELETE CASCADE,
  author_type text NOT NULL CHECK (author_type IN ('customer', 'msp')),
  author_user_id integer NOT NULL REFERENCES users(id),
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS msp_status_report_comments_report_id_idx ON msp_status_report_comments (report_id);

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-13-msp-status-report-comments-3887.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
