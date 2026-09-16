-- Git #4314: wf_runs / wf_run_node_* lack indexes on FK columns, making cascade
-- deletes pathologically slow (each deleted parent row triggers a sequential
-- scan on the referencing table). Additive, non-destructive.

CREATE INDEX IF NOT EXISTS wf_runs_retriggered_from_run_id_idx
  ON wf_runs (retriggered_from_run_id);

CREATE INDEX IF NOT EXISTS wf_run_node_logs_run_id_idx
  ON wf_run_node_logs (run_id);

CREATE INDEX IF NOT EXISTS wf_run_node_outputs_run_id_idx
  ON wf_run_node_outputs (run_id);

CREATE INDEX IF NOT EXISTS wf_trigger_events_run_id_idx
  ON wf_trigger_events (run_id);

CREATE INDEX IF NOT EXISTS wf_trigger_events_trigger_id_idx
  ON wf_trigger_events (trigger_id);

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('4314-wf-runs-fk-indexes.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
