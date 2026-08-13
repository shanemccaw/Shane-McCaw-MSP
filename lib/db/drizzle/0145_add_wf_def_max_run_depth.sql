ALTER TABLE wf_definitions ADD COLUMN IF NOT EXISTS max_run_depth integer NOT NULL DEFAULT 5;
