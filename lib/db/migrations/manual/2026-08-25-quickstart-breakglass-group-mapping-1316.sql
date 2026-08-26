-- Git #1316 (Phase 7 of Epic #1309): make quickstart-v1 fully self-executable
-- from a paid checkout session.
--
-- quickstart-v1's later templates reference {{breakGlassGroupId}} — the object
-- id of the CA exclusion group its own third step creates. That value had no
-- source: the graph builder only mapped the GATED step's output (the break-
-- glass user id), so the orchestrator's upfront missing-variables guard
-- refused every quickstart run. #1316 taught the graph builder to materialize
-- a mapping node from a template step's parameter_mapping (reading the step's
-- own Graph response), and this row supplies the data side of that: the group
-- create's POST /groups response carries the new group's id in `id`.
--
-- Idempotent: re-running re-applies the same value.

BEGIN;

UPDATE config_pack_templates t
SET parameter_mapping = '{"breakGlassGroupId": "id"}'::jsonb
FROM config_packs p
WHERE t.pack_id = p.id
  AND p.pack_key = 'quickstart-v1'
  AND t.template_id = 'quickstart-v1.create-ca-exclusion-group';

-- Self-marking row so Simulator Studio's Migrations tree (Git #497) reflects
-- DB reality regardless of which console ran this file.
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-25-quickstart-breakglass-group-mapping-1316.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
