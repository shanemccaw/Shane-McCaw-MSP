-- Column source_task_ids already exists on script_modules (added via raw SQL earlier).
-- This migration registers it in the drizzle schema so db.select() returns it.
-- The ALTER TABLE is wrapped in a DO block so it's a no-op if the column exists.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'script_modules' AND column_name = 'source_task_ids'
  ) THEN
    ALTER TABLE "script_modules" ADD COLUMN "source_task_ids" integer[];
  END IF;
END$$;
