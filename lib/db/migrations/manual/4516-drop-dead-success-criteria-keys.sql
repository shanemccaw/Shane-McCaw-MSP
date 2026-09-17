-- #4516 — baseline_action_templates.success_criteria carried two dead keys on
-- exactly 2 rows: captureAs / captureField. Nothing under artifacts/ or lib/
-- reads either key — the real carrier for a step's output flowing into a later
-- step is config_pack_templates.parameter_mapping (config-pack-graph.ts:386-409,
-- set for this exact group by 2026-08-25-quickstart-breakglass-group-mapping-1316.sql,
-- plus the gate's own mapping node for the user id). Drop the dead keys so the
-- column's real vocabulary is just `expectStatus`, and nobody auditing
-- success_criteria again reads them as a live mechanism.

UPDATE baseline_action_templates
SET success_criteria = success_criteria - 'captureAs' - 'captureField',
    updated_at = now()
WHERE template_id IN (
  'quickstart-v1.create-break-glass-account',
  'quickstart-v1.create-ca-exclusion-group'
)
  AND (success_criteria ? 'captureAs' OR success_criteria ? 'captureField');

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('4516-drop-dead-success-criteria-keys.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
