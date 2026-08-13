ALTER TABLE script_run_results
  ADD COLUMN IF NOT EXISTS kanban_task_id integer REFERENCES kanban_tasks(id) ON DELETE SET NULL;
