DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'client_health_history'
      AND column_name = 'source_kanban_task_id'
  ) THEN
    ALTER TABLE client_health_history
      ADD COLUMN source_kanban_task_id integer
        REFERENCES kanban_tasks(id) ON DELETE SET NULL;
  END IF;
END;
$$;
