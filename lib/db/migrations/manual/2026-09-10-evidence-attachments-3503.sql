-- #3503 — Evidence/attachment endpoint for remediation_tracker_steps and
-- change-control execution (cr_executions), for MyArchitect's #3470 screenshot
-- tool (`IEvidencePostClient`) to post to.
--
-- One polymorphic child table, matching retainer_work_log's existing
-- (source, source_ref_id) shape for the exact same two source tables:
--   source = 'remediation_tracker' → source_ref_id = remediation_tracker_steps.id
--   source = 'change_control'     → source_ref_id = cr_executions.id
-- No FK on source_ref_id — same soft-link convention both source tables and
-- retainer_work_log already use.
--
-- Additive, nullable where not essential, reversible. Safe to re-run (IF NOT EXISTS).

BEGIN;

CREATE TABLE IF NOT EXISTS evidence_attachments (
  id SERIAL PRIMARY KEY,
  msp_id INTEGER NOT NULL REFERENCES msps(id) ON DELETE CASCADE,
  customer_id INTEGER NOT NULL,
  source TEXT NOT NULL,
  source_ref_id INTEGER NOT NULL,
  file_path TEXT NOT NULL,
  original_filename TEXT,
  content_type TEXT,
  file_size_bytes INTEGER,
  caption TEXT,
  width INTEGER,
  height INTEGER,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  uploaded_by_user_id INTEGER,
  uploaded_by_person_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS evidence_attachments_source_ref_idx
  ON evidence_attachments (source, source_ref_id);

CREATE INDEX IF NOT EXISTS evidence_attachments_msp_customer_idx
  ON evidence_attachments (msp_id, customer_id);

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-10-evidence-attachments-3503.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
