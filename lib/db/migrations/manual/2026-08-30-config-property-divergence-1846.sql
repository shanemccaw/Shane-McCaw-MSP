-- Git #1846 — Persist the $metadata-vs-observed divergence Git #1794 found: Microsoft Graph
-- returns properties its own published $metadata does not declare.
--
-- Purely ADDITIVE: one new table. Nothing existing is altered or dropped, so this is safe to
-- run against a live database and safe to re-run.
--
-- config_resource_property_divergence
--     One row per (resource, property) observed live with no matching graph-metadata property
--     row for that resource. Distinguishes two real cases:
--       version_gap          declared in the OTHER Graph version's $metadata (typically beta),
--                             just not the version this resource is actually read under.
--       undeclared_anywhere  declared in NEITHER v1.0 nor beta $metadata — Graph returning
--                             something no published CSDL document describes.
--
--     Deliberately keyed on `resource_key` (config_resources' own stable slug), NOT
--     `config_resources.id`, and carries no FK to config_resources at all. #1895 documented
--     that `build-resource-model.mjs` deletes and re-inserts every config_resources row (fresh
--     serial ids) on every run; a hard cascading FK from here to that volatile id would wipe
--     this table on every model rebuild — the exact bug class this issue exists to not repeat.
--     `config_resource_id` is kept only as a best-effort denormalised pointer, refreshed by the
--     detector script each run.
--
--     Re-derivable: `scripts/config-state/detect-property-divergence.mjs` recomputes this table
--     from whatever is currently in config_resource_samples + graph_entity_properties every time
--     it runs (wired into verify-sample.mjs), so a later run surfaces newly-observed undeclared
--     properties, not just the six found on 2026-08-30.

BEGIN;

CREATE TABLE IF NOT EXISTS config_resource_property_divergence (
  id                        SERIAL PRIMARY KEY,
  resource_key              TEXT NOT NULL,
  config_resource_id        INTEGER,
  graph_path                TEXT,
  graph_version             TEXT,
  graph_entity_type         TEXT,
  property_name             TEXT NOT NULL,
  divergence_class          TEXT NOT NULL,
  declared_in_graph_versions JSONB NOT NULL DEFAULT '[]'::jsonb,
  observed_json_type        TEXT,
  last_sample_run_id        UUID,
  observation_count         INTEGER NOT NULL DEFAULT 1,
  first_observed_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_observed_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT config_resource_property_divergence_class_chk
    CHECK (divergence_class IN ('version_gap', 'undeclared_anywhere'))
);

CREATE UNIQUE INDEX IF NOT EXISTS config_resource_property_divergence_uidx
  ON config_resource_property_divergence (resource_key, property_name);
CREATE INDEX IF NOT EXISTS config_resource_property_divergence_class_idx
  ON config_resource_property_divergence (divergence_class);
CREATE INDEX IF NOT EXISTS config_resource_property_divergence_resource_idx
  ON config_resource_property_divergence (config_resource_id);

-- Self-marking run record (Git #497) so Simulator Studio's Migrations tree reflects
-- DB reality regardless of which console executed this file.
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-30-config-property-divergence-1846.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
