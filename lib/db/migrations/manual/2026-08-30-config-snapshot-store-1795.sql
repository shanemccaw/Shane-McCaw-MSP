-- Git #1795 — Tenant configuration SNAPSHOT STORE.
--
-- Additive only: four new tables, their indexes, their CHECK constraints, and two
-- immutability trigger functions. Nothing existing is altered or dropped.
--
-- Drizzle definitions: lib/db/src/schema/config-snapshots.ts (read its header for the
-- four design constraints these objects encode).
--
-- NOTE ON WHY THERE IS NO FOREIGN KEY TO config_resources:
--   scripts/config-state/build-resource-model.mjs DELETEs and re-INSERTs every
--   config_resources row on each run, re-issuing the serial primary keys. That id is
--   volatile. A cascading FK from a snapshot table to it would wipe accumulated live
--   evidence on the next model rebuild — the bug Git #1895 found in
--   config_resource_samples. Every link here is the stable TEXT resource_key.
--
-- Safe to re-run: every statement is IF NOT EXISTS / OR REPLACE guarded.

BEGIN;

-- ── 1. Registry: what the collector is allowed to collect ────────────────────

CREATE TABLE IF NOT EXISTS config_snapshot_resource_types (
  id                            serial PRIMARY KEY,
  resource_key                  text        NOT NULL,
  display_name                  text        NOT NULL,
  surface                       text        NOT NULL,
  workload                      text        NOT NULL,

  read_transport                text        NOT NULL,
  graph_version                 text,
  graph_path                    text,
  is_collection                 boolean     NOT NULL DEFAULT false,
  read_cmdlets                  jsonb       NOT NULL DEFAULT '[]'::jsonb,

  identity_strategy             text        NOT NULL DEFAULT 'unresolved',
  identity_property_names       jsonb       NOT NULL DEFAULT '[]'::jsonb,
  identity_basis                text,

  required_app_permissions      jsonb       NOT NULL DEFAULT '[]'::jsonb,
  graph_read_permission_options jsonb       NOT NULL DEFAULT '[]'::jsonb,

  is_collectable                boolean     NOT NULL DEFAULT false,
  not_collectable_reason        text,
  collection_order              integer     NOT NULL DEFAULT 1000,

  last_known_availability       text        NOT NULL DEFAULT 'unknown',
  availability_refreshed_at     timestamptz,

  shape_provenance              text        NOT NULL DEFAULT 'none',

  notes                         text,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now(),

  -- A type with no identity strategy cannot be collected: its objects would be
  -- unpairable, manufacturing false churn on every diff.
  CONSTRAINT config_snapshot_resource_types_collectable_needs_identity
    CHECK (is_collectable = false OR identity_strategy <> 'unresolved'),
  -- An excluded type must state which reason excluded it.
  CONSTRAINT config_snapshot_resource_types_not_collectable_needs_reason
    CHECK (is_collectable = true OR not_collectable_reason IS NOT NULL),
  -- Strategies that name properties must actually name them.
  CONSTRAINT config_snapshot_resource_types_identity_props_present
    CHECK (identity_strategy NOT IN ('graph-id', 'dsc-identity', 'composite-key')
           OR jsonb_array_length(identity_property_names) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS config_snapshot_resource_types_key_uidx
  ON config_snapshot_resource_types (resource_key);
CREATE INDEX IF NOT EXISTS config_snapshot_resource_types_collectable_idx
  ON config_snapshot_resource_types (is_collectable, collection_order);
CREATE INDEX IF NOT EXISTS config_snapshot_resource_types_transport_idx
  ON config_snapshot_resource_types (read_transport);
CREATE INDEX IF NOT EXISTS config_snapshot_resource_types_surface_idx
  ON config_snapshot_resource_types (surface);

COMMENT ON TABLE config_snapshot_resource_types IS
  'Git #1795. Curated, STABLE catalog of collectable configuration resource types, keyed by the '
  'text resource_key (no FK to the volatile config_resources.id). Carries the two facts the '
  'derived model has no place for: the identity strategy the differ needs, and the operational '
  'decision of whether to collect at all.';
COMMENT ON COLUMN config_snapshot_resource_types.last_known_availability IS
  'CACHE of config_resources.availability, used only as a scheduling hint. Never evidence — the '
  'evidence for what actually happened lives per snapshot in '
  'tenant_config_snapshot_resource_status. Git #1895 is why these are kept apart.';

-- ── 2. Snapshot header ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tenant_config_snapshots (
  id                       serial PRIMARY KEY,
  snapshot_id              uuid        NOT NULL DEFAULT gen_random_uuid(),

  tenant_id                integer     NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entra_tenant_id          text        NOT NULL,

  captured_at              timestamptz NOT NULL DEFAULT now(),

  trigger                  text        NOT NULL,
  trigger_ref              text,
  wf_run_id                integer,
  requested_by_user_id     integer,

  status                   text        NOT NULL DEFAULT 'running',
  sealed_at                timestamptz,

  resource_types_targeted  integer     NOT NULL DEFAULT 0,
  resource_types_collected integer     NOT NULL DEFAULT 0,
  resource_types_empty     integer     NOT NULL DEFAULT 0,
  resource_types_partial   integer     NOT NULL DEFAULT 0,
  resource_types_skipped   integer     NOT NULL DEFAULT 0,
  resource_types_failed    integer     NOT NULL DEFAULT 0,
  object_count             integer     NOT NULL DEFAULT 0,

  is_complete              boolean     NOT NULL DEFAULT false,

  collector_version        text,
  error                    text,
  notes                    text,

  started_at               timestamptz NOT NULL DEFAULT now(),
  finished_at              timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),

  -- Writable exactly while running; sealed the instant it is anything else.
  CONSTRAINT tenant_config_snapshots_sealed_at_matches_status
    CHECK ((status = 'running' AND sealed_at IS NULL)
           OR (status <> 'running' AND sealed_at IS NOT NULL)),
  -- is_complete cannot be asserted while anything was truncated, skipped or failed.
  -- This is the flag Dev->Test->Prod promotion keys off, so it must be impossible to
  -- set optimistically.
  CONSTRAINT tenant_config_snapshots_complete_means_complete
    CHECK (is_complete = false
           OR (resource_types_partial = 0 AND resource_types_skipped = 0
               AND resource_types_failed = 0)),
  CONSTRAINT tenant_config_snapshots_counts_nonnegative
    CHECK (resource_types_targeted >= 0 AND resource_types_collected >= 0
           AND resource_types_empty >= 0 AND resource_types_partial >= 0
           AND resource_types_skipped >= 0 AND resource_types_failed >= 0
           AND object_count >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS tenant_config_snapshots_uuid_uidx
  ON tenant_config_snapshots (snapshot_id);

-- READ PATTERN 1 — "latest snapshot for a tenant". Partial, over sealed snapshots
-- only: a running or abandoned snapshot is never the answer to that question.
CREATE INDEX IF NOT EXISTS tenant_config_snapshots_tenant_latest_idx
  ON tenant_config_snapshots (tenant_id, captured_at DESC)
  WHERE status = 'sealed';

CREATE INDEX IF NOT EXISTS tenant_config_snapshots_tenant_captured_idx
  ON tenant_config_snapshots (tenant_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS tenant_config_snapshots_entra_idx
  ON tenant_config_snapshots (entra_tenant_id);
CREATE INDEX IF NOT EXISTS tenant_config_snapshots_status_idx
  ON tenant_config_snapshots (status);

COMMENT ON TABLE tenant_config_snapshots IS
  'Git #1795. One immutable, point-in-time snapshot of a tenant configuration. Snapshots '
  'accumulate and are never updated in place; diff between two instants is a first-class use.';
COMMENT ON COLUMN tenant_config_snapshots.is_complete IS
  'TRUE only when every targeted resource type finished collected or empty. A snapshot with any '
  'partial, skipped or failed resource is NOT a whole picture of the tenant and must not be '
  'promoted from.';

-- ── 3. The object store — the real objects ───────────────────────────────────

CREATE TABLE IF NOT EXISTS tenant_config_snapshot_objects (
  id                bigserial PRIMARY KEY,
  snapshot_row_id   integer     NOT NULL
                      REFERENCES tenant_config_snapshots(id) ON DELETE CASCADE,
  tenant_id         integer     NOT NULL,

  resource_key      text        NOT NULL,

  object_identity   text        NOT NULL,
  identity_strategy text        NOT NULL,
  display_name      text,

  -- THE REAL OBJECT, verbatim and complete. Never a projection onto the derived
  -- property model: Git #1846 proved live that Graph returns properties its own
  -- $metadata does not declare, and a differ cannot see a property change it never
  -- stored.
  object_json       jsonb       NOT NULL,

  object_hash       text        NOT NULL,
  hash_algorithm    text        NOT NULL DEFAULT 'jcs-sha256',

  property_count    integer     NOT NULL DEFAULT 0,
  odata_type        text,
  source_ref        text,

  collected_at      timestamptz NOT NULL DEFAULT now()
);

-- READ PATTERN 2 — pairing objects across two snapshots for diff, and the ambiguity
-- guard at the same time: a duplicate identity within one snapshot is unwritable.
CREATE UNIQUE INDEX IF NOT EXISTS tenant_config_snapshot_objects_identity_uidx
  ON tenant_config_snapshot_objects (snapshot_row_id, resource_key, object_identity);

-- The same pairing driven from the object's side: one object's whole history.
CREATE INDEX IF NOT EXISTS tenant_config_snapshot_objects_history_idx
  ON tenant_config_snapshot_objects (resource_key, object_identity, snapshot_row_id);

CREATE INDEX IF NOT EXISTS tenant_config_snapshot_objects_snapshot_resource_idx
  ON tenant_config_snapshot_objects (snapshot_row_id, resource_key);
CREATE INDEX IF NOT EXISTS tenant_config_snapshot_objects_hash_idx
  ON tenant_config_snapshot_objects (tenant_id, object_hash);

COMMENT ON COLUMN tenant_config_snapshot_objects.object_json IS
  'The whole object exactly as the transport returned it, including @odata annotations and '
  'including every property no published metadata declares (Git #1846). Not a projection, and '
  'must never become one — deliberately the opposite of tenant_monitor_profiles.extracted_'
  'properties, which is a lossy summary by design.';
COMMENT ON COLUMN tenant_config_snapshot_objects.object_identity IS
  'THE DIFF PAIRING KEY. Stable across snapshots for the same real-world object. If this is not '
  'stable, every object reads as deleted-and-recreated and the diff is worthless.';

-- ── 4. Per-resource completeness — the honest record ─────────────────────────

CREATE TABLE IF NOT EXISTS tenant_config_snapshot_resource_status (
  id              serial PRIMARY KEY,
  snapshot_row_id integer     NOT NULL
                    REFERENCES tenant_config_snapshots(id) ON DELETE CASCADE,
  resource_key    text        NOT NULL,
  read_transport  text        NOT NULL,

  status          text        NOT NULL,
  skip_reason     text,
  reason_detail   text,

  object_count    integer     NOT NULL DEFAULT 0,
  page_count      integer,

  request_ref     text,
  http_status     integer,
  error_code      text,
  error_message   text,
  duration_ms     integer,

  attempted_at    timestamptz NOT NULL DEFAULT now(),

  -- There is no way to write "we did not get this" without saying why.
  CONSTRAINT tenant_config_snapshot_resource_status_reason_required
    CHECK ((status IN ('partial', 'skipped', 'failed') AND skip_reason IS NOT NULL)
           OR (status IN ('collected', 'empty') AND skip_reason IS NULL)),
  -- collected means objects were stored; empty means the tenant genuinely has none.
  -- Neither may lie about its own count — that conflation is the precise bug Git
  -- #1847 found in the devices:* checks.
  CONSTRAINT tenant_config_snapshot_resource_status_object_count_matches
    CHECK (object_count >= 0
           AND (status <> 'collected' OR object_count > 0)
           AND (status <> 'empty' OR object_count = 0))
);

CREATE UNIQUE INDEX IF NOT EXISTS tenant_config_snapshot_resource_status_uidx
  ON tenant_config_snapshot_resource_status (snapshot_row_id, resource_key);
CREATE INDEX IF NOT EXISTS tenant_config_snapshot_resource_status_status_idx
  ON tenant_config_snapshot_resource_status (snapshot_row_id, status);
CREATE INDEX IF NOT EXISTS tenant_config_snapshot_resource_status_resource_idx
  ON tenant_config_snapshot_resource_status (resource_key, status);
CREATE INDEX IF NOT EXISTS tenant_config_snapshot_resource_status_skip_idx
  ON tenant_config_snapshot_resource_status (skip_reason);

COMMENT ON TABLE tenant_config_snapshot_resource_status IS
  'Git #1795. ONE row per targeted resource type per snapshot, ALWAYS — including for the ones '
  'skipped or failed. A snapshot that silently omits what it could not read is indistinguishable '
  'from a tenant that does not have those objects, and that distinction is the whole product.';

-- ── Immutability, enforced by the database rather than by convention ─────────
--
-- Constraint 2 of the design: once sealed, a snapshot's objects and completeness rows
-- are evidence and are frozen. Drizzle cannot express a trigger, so the guarantee
-- lives here.
--
-- Deleting the whole snapshot header IS still permitted (retention), and the cascade
-- reaches the children — the guard below checks whether the parent header still
-- exists, so a cascade delete passes while a surgical delete of rows out of a sealed
-- snapshot does not.

CREATE OR REPLACE FUNCTION config_snapshot_reject_mutation_on_sealed()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  parent_status text;
BEGIN
  SELECT s.status INTO parent_status
    FROM tenant_config_snapshots s
   WHERE s.id = OLD.snapshot_row_id;

  -- Parent already gone: this firing is a cascade from deleting the snapshot itself,
  -- which is legitimate retention. Allow it.
  IF parent_status IS NULL THEN
    RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF parent_status <> 'running' THEN
    RAISE EXCEPTION
      'tenant configuration snapshot % is sealed (status=%): % on %.% is rejected. '
      'Snapshots are immutable point-in-time evidence (Git #1795); collect a new snapshot '
      'instead of modifying this one.',
      OLD.snapshot_row_id, parent_status, TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME
      USING ERRCODE = 'raise_exception';
  END IF;

  RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
END;
$fn$;

DROP TRIGGER IF EXISTS tenant_config_snapshot_objects_immutable
  ON tenant_config_snapshot_objects;
CREATE TRIGGER tenant_config_snapshot_objects_immutable
  BEFORE UPDATE OR DELETE ON tenant_config_snapshot_objects
  FOR EACH ROW EXECUTE FUNCTION config_snapshot_reject_mutation_on_sealed();

DROP TRIGGER IF EXISTS tenant_config_snapshot_resource_status_immutable
  ON tenant_config_snapshot_resource_status;
CREATE TRIGGER tenant_config_snapshot_resource_status_immutable
  BEFORE UPDATE OR DELETE ON tenant_config_snapshot_resource_status
  FOR EACH ROW EXECUTE FUNCTION config_snapshot_reject_mutation_on_sealed();

-- The header itself: its point-in-time identity can never be rewritten, and a sealed
-- snapshot can never be re-opened for writing.
CREATE OR REPLACE FUNCTION tenant_config_snapshots_guard_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF NEW.snapshot_id     IS DISTINCT FROM OLD.snapshot_id
     OR NEW.tenant_id       IS DISTINCT FROM OLD.tenant_id
     OR NEW.entra_tenant_id IS DISTINCT FROM OLD.entra_tenant_id
     OR NEW.captured_at     IS DISTINCT FROM OLD.captured_at THEN
    RAISE EXCEPTION
      'tenant_config_snapshots.% identity is immutable (Git #1795): snapshot_id, tenant_id, '
      'entra_tenant_id and captured_at cannot be rewritten after insert.', OLD.id
      USING ERRCODE = 'raise_exception';
  END IF;

  IF OLD.status <> 'running' AND NEW.status = 'running' THEN
    RAISE EXCEPTION
      'tenant configuration snapshot % is sealed (status=%) and cannot be re-opened (Git #1795).',
      OLD.id, OLD.status
      USING ERRCODE = 'raise_exception';
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS tenant_config_snapshots_immutable ON tenant_config_snapshots;
CREATE TRIGGER tenant_config_snapshots_immutable
  BEFORE UPDATE ON tenant_config_snapshots
  FOR EACH ROW EXECUTE FUNCTION tenant_config_snapshots_guard_immutable();

-- ── Self-marking run record ──────────────────────────────────────────────────
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-30-config-snapshot-store-1795.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
