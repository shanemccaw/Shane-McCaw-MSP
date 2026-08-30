-- Git #1591 — service_type is an empty string on Groups B and C, diverging from `category`.
--
-- Every other populated services row has service_type == category for the categories that
-- follow this 1:1 pattern (project, config_pack, retainer, assessment) -- e.g. Group A
-- (ids 34-60, category='project') already carries service_type='project'. Groups B and C were
-- inserted with service_type left as ''.
--
-- Two call sites gate signature-requirement on serviceType === "project" || "retainer":
--   shane-mccaw-consulting/src/pages/Checkout.tsx:544
--   artifacts/api-server/src/routes/portal-onboarding.ts:481-483
-- '' evaluates false on both, so a project-category service with service_type='' silently
-- skips the signature requirement. Dead code today (nothing feeds a project-category service
-- ID from these Group B/C rows into either path yet) but Group B is the catalog #1576 settled
-- on and will be wired in -- fixing the data now closes the gap before it becomes live.
--
-- Group B: category='project',      service_type='' -> ids 158-167 (10 rows)
-- Group C: category='config_pack',  service_type='' -> ids 169-175, 195 (8 rows)
--
-- Purely corrective UPDATE of an existing column. Nothing added or dropped; safe to re-run
-- (the WHERE clause only ever matches rows still diverging from their own category).

BEGIN;

UPDATE services
SET service_type = category
WHERE category IN ('project', 'config_pack')
  AND (service_type IS NULL OR service_type = '')
  AND category <> '';

-- Self-marking run record (Git #497) so Simulator Studio's Migrations tree reflects
-- DB reality regardless of which console executed this file.
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-30-services-service-type-backfill-1591.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
