-- Add updated_at to wf_versions so the workflow builder can compare
-- local draft timestamps against the server's last graph save.
ALTER TABLE wf_versions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
