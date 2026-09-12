-- Git #2009 — Sales-offer accept flow (project-class services): signing an
-- msp_sows row now kicks off fulfillAcceptedProjectOffer() (project-sow-
-- fulfillment.ts), the same pipeline the customer-facing accept route
-- already uses. project_id records the real projects row that resulted, so
-- the MSP Console's SOW drawer can show an operator that a signed SOW
-- genuinely became a project, not just that it was signed and (maybe)
-- charged. Nullable and set-null on delete: a deleted project must not
-- silently orphan the SOW row it came from.

BEGIN;

ALTER TABLE msp_sows ADD COLUMN IF NOT EXISTS project_id integer REFERENCES projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS msp_sows_project_id_idx ON msp_sows (project_id);

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-12-msp-sows-project-id-2009.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
