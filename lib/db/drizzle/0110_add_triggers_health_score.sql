DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'workflow_template_step_tasks' AND column_name = 'triggers_health_score'
  ) THEN
    ALTER TABLE "workflow_template_step_tasks" ADD COLUMN "triggers_health_score" boolean NOT NULL DEFAULT false;
  END IF;
END$$;
