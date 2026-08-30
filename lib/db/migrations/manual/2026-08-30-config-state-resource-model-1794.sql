-- Git #1794 — Tenant configuration state: the Graph / Microsoft365DSC RESOURCE MODEL.
--
-- Purely ADDITIVE: seven new tables and one view. Nothing existing is altered or
-- dropped, so this is safe to run against a live database and safe to re-run.
--
-- What it stores, and why:
--   graph_entity_types / graph_entity_properties
--       Microsoft Graph's own published CSDL entity model (v1.0 + beta), parsed from
--       $metadata. Reference data — the authoritative shape any Graph-backed
--       configuration snapshot has to be able to hold.
--   config_resources
--       THE resource model. One row per tenant configuration resource: what it is,
--       how it is read (Graph path or cmdlet), and which app-only permission that
--       read requires — reconciled against the scopes a tenant has actually granted.
--   config_resource_properties
--       The property model, from Graph metadata and/or a Microsoft365DSC schema.mof.
--   config_resource_check_coverage
--       Which of the existing monitor_checks rows touch which resource. This is the
--       measurement that replaces guessing at "are we missing checks".
--   config_resource_samples
--       Live read-only verification evidence. SHAPE ONLY — property names and JSON
--       types, never values: the testbed is a real production Microsoft 365 tenant.
--   config_model_extractions
--       Provenance per extraction run, so the model can be dated and re-derived.

BEGIN;

-- ── Graph entity model ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS graph_entity_types (
  id                SERIAL PRIMARY KEY,
  graph_version     TEXT NOT NULL,
  namespace         TEXT NOT NULL,
  name              TEXT NOT NULL,
  qualified_name    TEXT NOT NULL,
  kind              TEXT NOT NULL,
  base_type         TEXT,
  is_abstract       BOOLEAN NOT NULL DEFAULT FALSE,
  is_open_type      BOOLEAN NOT NULL DEFAULT FALSE,
  key_properties    JSONB NOT NULL DEFAULT '[]'::jsonb,
  enum_members      JSONB NOT NULL DEFAULT '[]'::jsonb,
  property_count    INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS graph_entity_types_version_qname_uidx
  ON graph_entity_types (graph_version, qualified_name);
CREATE INDEX IF NOT EXISTS graph_entity_types_name_idx ON graph_entity_types (name);
CREATE INDEX IF NOT EXISTS graph_entity_types_kind_idx ON graph_entity_types (kind);

CREATE TABLE IF NOT EXISTS graph_entity_properties (
  id                SERIAL PRIMARY KEY,
  entity_type_id    INTEGER NOT NULL REFERENCES graph_entity_types(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  kind              TEXT NOT NULL,
  edm_type          TEXT NOT NULL,
  is_collection     BOOLEAN NOT NULL DEFAULT FALSE,
  is_nullable       BOOLEAN NOT NULL DEFAULT TRUE,
  contains_target   BOOLEAN NOT NULL DEFAULT FALSE,
  ordinal           INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS graph_entity_properties_type_kind_name_uidx
  ON graph_entity_properties (entity_type_id, kind, name);
CREATE INDEX IF NOT EXISTS graph_entity_properties_type_idx
  ON graph_entity_properties (entity_type_id);

-- ── The resource model ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS config_resources (
  id                              SERIAL PRIMARY KEY,
  resource_key                    TEXT NOT NULL,
  display_name                    TEXT NOT NULL,
  description                     TEXT,
  surface                         TEXT NOT NULL,
  workload                        TEXT NOT NULL,
  origin                          TEXT NOT NULL,
  read_transport                  TEXT NOT NULL,
  graph_version                   TEXT,
  graph_path                      TEXT,
  graph_is_collection             BOOLEAN NOT NULL DEFAULT FALSE,
  graph_container_kind            TEXT,
  graph_entity_type_id            INTEGER REFERENCES graph_entity_types(id) ON DELETE SET NULL,
  graph_entity_type               TEXT,
  also_in_beta                    BOOLEAN NOT NULL DEFAULT FALSE,
  read_cmdlets                    JSONB NOT NULL DEFAULT '[]'::jsonb,
  m365dsc_resource                TEXT,
  m365dsc_mode                    TEXT,
  link_basis                      TEXT,
  -- ALL-OF: the full set Microsoft365DSC states a resource's Get needs.
  required_app_permissions        JSONB NOT NULL DEFAULT '[]'::jsonb,
  required_delegated_permissions  JSONB NOT NULL DEFAULT '[]'::jsonb,
  required_roles                  JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- ANY-OF: permissions that each independently grant a GET on this Graph path, from
  -- Microsoft's own published permissions reference. Kept separate from the ALL-OF
  -- column above because merging the two would misreport availability both ways.
  graph_read_permission_options   JSONB NOT NULL DEFAULT '[]'::jsonb,
  permission_path_matched         TEXT,
  permission_source               TEXT,
  availability                    TEXT NOT NULL DEFAULT 'unknown',
  availability_reason             TEXT,
  missing_permissions             JSONB NOT NULL DEFAULT '[]'::jsonb,
  verification_status             TEXT NOT NULL DEFAULT 'derived_not_verified',
  property_count                  INTEGER NOT NULL DEFAULT 0,
  check_coverage_count            INTEGER NOT NULL DEFAULT 0,
  source_ref                      TEXT,
  notes                           TEXT,
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS config_resources_key_uidx ON config_resources (resource_key);
CREATE INDEX IF NOT EXISTS config_resources_surface_idx      ON config_resources (surface);
CREATE INDEX IF NOT EXISTS config_resources_workload_idx     ON config_resources (workload);
CREATE INDEX IF NOT EXISTS config_resources_transport_idx    ON config_resources (read_transport);
CREATE INDEX IF NOT EXISTS config_resources_availability_idx ON config_resources (availability);
CREATE INDEX IF NOT EXISTS config_resources_graph_path_idx   ON config_resources (graph_version, graph_path);
CREATE INDEX IF NOT EXISTS config_resources_m365dsc_idx      ON config_resources (m365dsc_resource);
CREATE INDEX IF NOT EXISTS config_resources_coverage_idx     ON config_resources (check_coverage_count);

CREATE TABLE IF NOT EXISTS config_resource_properties (
  id                      SERIAL PRIMARY KEY,
  config_resource_id      INTEGER NOT NULL REFERENCES config_resources(id) ON DELETE CASCADE,
  name                    TEXT NOT NULL,
  source                  TEXT NOT NULL,
  data_type               TEXT NOT NULL,
  is_collection           BOOLEAN NOT NULL DEFAULT FALSE,
  is_key                  BOOLEAN NOT NULL DEFAULT FALSE,
  is_required             BOOLEAN NOT NULL DEFAULT FALSE,
  is_nullable             BOOLEAN NOT NULL DEFAULT TRUE,
  allowed_values          JSONB NOT NULL DEFAULT '[]'::jsonb,
  nested_type_ref         TEXT,
  is_connection_parameter BOOLEAN NOT NULL DEFAULT FALSE,
  description             TEXT,
  ordinal                 INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS config_resource_properties_res_source_name_uidx
  ON config_resource_properties (config_resource_id, source, name);
CREATE INDEX IF NOT EXISTS config_resource_properties_resource_idx
  ON config_resource_properties (config_resource_id);

CREATE TABLE IF NOT EXISTS config_resource_check_coverage (
  id                  SERIAL PRIMARY KEY,
  config_resource_id  INTEGER REFERENCES config_resources(id) ON DELETE CASCADE,
  monitor_check_id    INTEGER NOT NULL REFERENCES monitor_checks(id) ON DELETE CASCADE,
  check_key           TEXT NOT NULL,
  executor_type       TEXT NOT NULL,
  match_basis         TEXT NOT NULL,
  confidence          TEXT NOT NULL,
  matched_on          TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- NULL config_resource_id (an unmatched check) is distinct under a Postgres unique
-- index, so this constrains only the real mappings to one row per (check, resource).
CREATE UNIQUE INDEX IF NOT EXISTS config_resource_check_coverage_uidx
  ON config_resource_check_coverage (monitor_check_id, config_resource_id);
CREATE INDEX IF NOT EXISTS config_resource_check_coverage_resource_idx
  ON config_resource_check_coverage (config_resource_id);
CREATE INDEX IF NOT EXISTS config_resource_check_coverage_basis_idx
  ON config_resource_check_coverage (match_basis);

CREATE TABLE IF NOT EXISTS config_resource_samples (
  id                      SERIAL PRIMARY KEY,
  sample_run_id           UUID NOT NULL,
  config_resource_id      INTEGER NOT NULL REFERENCES config_resources(id) ON DELETE CASCADE,
  tenant_id               INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  graph_version           TEXT NOT NULL,
  request_path            TEXT NOT NULL,
  http_status             INTEGER,
  ok                      BOOLEAN NOT NULL DEFAULT FALSE,
  error_code              TEXT,
  error_message           TEXT,
  item_count              INTEGER,
  observed_property_names JSONB NOT NULL DEFAULT '[]'::jsonb,
  observed_shape          JSONB NOT NULL DEFAULT '{}'::jsonb,
  duration_ms             INTEGER,
  skipped_reason          TEXT,
  observed_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS config_resource_samples_resource_idx ON config_resource_samples (config_resource_id);
CREATE INDEX IF NOT EXISTS config_resource_samples_run_idx      ON config_resource_samples (sample_run_id);
CREATE INDEX IF NOT EXISTS config_resource_samples_tenant_idx   ON config_resource_samples (tenant_id);

CREATE TABLE IF NOT EXISTS config_model_extractions (
  id                           SERIAL PRIMARY KEY,
  run_id                       UUID NOT NULL DEFAULT gen_random_uuid(),
  m365dsc_commit               TEXT,
  m365dsc_resource_count       INTEGER NOT NULL DEFAULT 0,
  graph_v1_type_count          INTEGER NOT NULL DEFAULT 0,
  graph_beta_type_count        INTEGER NOT NULL DEFAULT 0,
  graph_config_path_count      INTEGER NOT NULL DEFAULT 0,
  graph_permission_count       INTEGER NOT NULL DEFAULT 0,
  config_resource_count        INTEGER NOT NULL DEFAULT 0,
  property_count               INTEGER NOT NULL DEFAULT 0,
  checks_mapped                INTEGER NOT NULL DEFAULT 0,
  checks_unmatched             INTEGER NOT NULL DEFAULT 0,
  resources_covered            INTEGER NOT NULL DEFAULT 0,
  resources_uncovered          INTEGER NOT NULL DEFAULT 0,
  reconciled_against_tenant_id INTEGER REFERENCES tenants(id) ON DELETE SET NULL,
  granted_scopes               JSONB NOT NULL DEFAULT '[]'::jsonb,
  status                       TEXT NOT NULL DEFAULT 'running',
  error                        TEXT,
  started_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at                  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS config_model_extractions_started_idx ON config_model_extractions (started_at);

-- Convergence for a database that already ran an earlier revision of this file: the
-- CREATE TABLE above only applies to a fresh install, so the columns added after that
-- first run are also declared idempotently here. Both paths end at the same schema.
ALTER TABLE config_resources
  ADD COLUMN IF NOT EXISTS graph_read_permission_options JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS permission_path_matched       TEXT,
  ADD COLUMN IF NOT EXISTS permission_source             TEXT;
ALTER TABLE config_model_extractions
  ADD COLUMN IF NOT EXISTS graph_permission_count INTEGER NOT NULL DEFAULT 0;

-- One queryable property model per resource, whichever source described it. The two
-- sources name the same object differently (Graph's wire property vs the DSC
-- parameter), so this unions rather than merges, keeping `source` on every row.
CREATE OR REPLACE VIEW config_resource_property_model AS
SELECT
  r.id                AS config_resource_id,
  r.resource_key,
  r.display_name      AS resource_display_name,
  r.surface,
  r.workload,
  r.read_transport,
  r.availability,
  p.source,
  p.name              AS property_name,
  p.data_type,
  p.is_collection,
  p.is_key,
  p.is_required,
  p.allowed_values,
  p.nested_type_ref,
  p.ordinal
FROM config_resources r
JOIN config_resource_properties p ON p.config_resource_id = r.id
WHERE p.is_connection_parameter = FALSE;

-- Self-marking run record (Git #497) so Simulator Studio's Migrations tree reflects
-- DB reality regardless of which console executed this file.
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-30-config-state-resource-model-1794.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
