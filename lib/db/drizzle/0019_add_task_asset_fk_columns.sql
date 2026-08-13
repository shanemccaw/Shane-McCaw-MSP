ALTER TABLE "workflow_template_step_tasks"
  ADD COLUMN "instruction_set_id" integer REFERENCES "instruction_sets"("id") ON DELETE SET NULL,
  ADD COLUMN "checklist_id" integer REFERENCES "checklists"("id") ON DELETE SET NULL,
  ADD COLUMN "artifacts_id" integer REFERENCES "artifact_sets"("id") ON DELETE SET NULL,
  ADD COLUMN "deliverables_id" integer REFERENCES "deliverable_sets"("id") ON DELETE SET NULL;
