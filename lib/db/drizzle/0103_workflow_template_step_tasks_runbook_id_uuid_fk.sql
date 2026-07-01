-- Step 1: Convert any remaining slug-based runbook_id values to UUIDs via
-- powershell_scripts.azure_runbook_name lookup. Unmatched slugs are set NULL.
DO $$
DECLARE
  rec RECORD;
  matched_id UUID;
BEGIN
  FOR rec IN
    SELECT id, runbook_id
    FROM workflow_template_step_tasks
    WHERE runbook_id IS NOT NULL
      AND runbook_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  LOOP
    SELECT id INTO matched_id FROM powershell_scripts
    WHERE azure_runbook_name = rec.runbook_id LIMIT 1;

    IF matched_id IS NOT NULL THEN
      UPDATE workflow_template_step_tasks SET runbook_id = matched_id::text WHERE id = rec.id;
      RAISE WARNING 'runbook_id slug→UUID: task % "%" → %', rec.id, rec.runbook_id, matched_id;
    ELSE
      UPDATE workflow_template_step_tasks SET runbook_id = NULL WHERE id = rec.id;
      RAISE WARNING 'runbook_id slug→NULL (no match): task % "%"', rec.id, rec.runbook_id;
    END IF;
  END LOOP;
END$$;

-- Step 2: NULL out any UUID-shaped values that no longer exist in powershell_scripts
-- (orphaned foreign-key values that would block the constraint addition).
UPDATE workflow_template_step_tasks
SET runbook_id = NULL
WHERE runbook_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM powershell_scripts WHERE id::text = runbook_id
  );

-- Step 3: Cast column from text to uuid and add FK constraint.
ALTER TABLE "workflow_template_step_tasks"
  ALTER COLUMN "runbook_id" TYPE uuid USING runbook_id::uuid;

ALTER TABLE "workflow_template_step_tasks"
  ADD CONSTRAINT "workflow_template_step_tasks_runbook_id_fk"
    FOREIGN KEY ("runbook_id") REFERENCES "powershell_scripts"("id") ON DELETE SET NULL;
