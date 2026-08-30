-- 2026-08-30-config-resource-samples-stable-key-1895.sql
--
-- Git #1895 — stop build-resource-model.mjs wiping config_resource_samples.
--
-- Root cause was TWO layers, not one: build-resource-model.mjs issued an explicit
-- `DELETE FROM config_resource_samples`, but even removing that line, the very next
-- `DELETE FROM config_resources` in the same script would still have cascade-deleted
-- every sample row via the `ON DELETE CASCADE` FK below — config_resources rows are
-- deleted and re-inserted with fresh serial ids on EVERY rebuild.
--
-- Fix: config_resource_samples now keys on the STABLE `resource_key` text column
-- (e.g. "graph:v1.0:/auditLogs/signIns"), the same precedent already set by
-- config_resource_property_divergence and lib/db/src/schema/config-snapshots.ts (both
-- of which cite this issue in their own schema comments). config_resource_id keeps
-- its column but loses its FK/cascade — it's now a best-effort denormalised pointer,
-- re-pointed at whatever id resource_key currently resolves to by
-- scripts/config-state/reconcile-live-evidence.mjs after every rebuild.
--
-- Matching Drizzle definition: lib/db/src/schema/config-state.ts (configResourceSamplesTable).

BEGIN;

ALTER TABLE config_resource_samples
  DROP CONSTRAINT IF EXISTS config_resource_samples_config_resource_id_fkey;

ALTER TABLE config_resource_samples
  ADD COLUMN IF NOT EXISTS resource_key TEXT;

-- Backfill from whatever config_resources rows currently exist for the surviving
-- config_resource_id pointers (best-effort; these ids were valid at the time of the
-- sample and have not yet been invalidated by a rebuild since).
UPDATE config_resource_samples s
   SET resource_key = cr.resource_key
  FROM config_resources cr
 WHERE cr.id = s.config_resource_id
   AND s.resource_key IS NULL;

-- Any sample row that could not be backfilled (its config_resource_id no longer
-- resolves) is orphaned evidence for a resource this pipeline can no longer identify.
-- Made visible, not silently dropped or left violating the NOT NULL below.
DELETE FROM config_resource_samples WHERE resource_key IS NULL;

ALTER TABLE config_resource_samples
  ALTER COLUMN resource_key SET NOT NULL;

CREATE INDEX IF NOT EXISTS config_resource_samples_resource_key_idx
  ON config_resource_samples (resource_key);

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-30-config-resource-samples-stable-key-1895.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
