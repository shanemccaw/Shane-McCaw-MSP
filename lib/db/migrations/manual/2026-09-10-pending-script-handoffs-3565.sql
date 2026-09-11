-- #3565 — human-in-the-loop hand-off for the `generate_script` workflow node.
--
-- The node used to call Anthropic directly and save the result inline. Per
-- Shane's decision on #3561, it now pauses the run (reusing the same
-- pauseForApproval / wf_runs.status='awaiting_approval' mechanism
-- approval_gate and break_glass_verification_gate already use) and creates a
-- row here so Shane can generate + tenant-verify the script himself before
-- it's considered done. Resume happens via the existing generic
-- resumeWorkflowRun(runId, nodeId, resumePayload, decisionNote) once he saves
-- the finished script/package to the Script Library (existing
-- POST /admin/ps-scripts[/packages] routes) and links it here.
--
-- Additive, nullable where not essential, reversible. Safe to re-run (IF NOT EXISTS).

BEGIN;

CREATE TABLE IF NOT EXISTS pending_script_handoffs (
  id SERIAL PRIMARY KEY,
  run_id INTEGER NOT NULL REFERENCES wf_runs(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL,
  source_mode TEXT NOT NULL,
  target_id INTEGER NOT NULL,
  target_label TEXT,
  custom_instructions TEXT,
  output_mode TEXT NOT NULL DEFAULT 'auto',
  status TEXT NOT NULL DEFAULT 'pending',
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  script_id UUID REFERENCES powershell_scripts(id),
  package_id UUID REFERENCES script_packages(id),
  result_title TEXT,
  completed_by TEXT,
  completed_at TIMESTAMPTZ,
  decision_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pending_script_handoffs_status_idx
  ON pending_script_handoffs (status);

CREATE INDEX IF NOT EXISTS pending_script_handoffs_run_idx
  ON pending_script_handoffs (run_id);

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-10-pending-script-handoffs-3565.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
