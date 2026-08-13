-- Migration: 0082_add_script_run_result_reviewed_at
-- Adds a reviewed_at timestamp to script_run_results so Shane can mark
-- client-uploaded results as reviewed, clearing them from the pending queue.

ALTER TABLE "script_run_results"
  ADD COLUMN IF NOT EXISTS "reviewed_at" TIMESTAMPTZ;
