-- 2026-08-31-config-snapshot-baselines-1843.sql
--
-- Git #1843 — the customer/MSP API surface for configuration state needs to serve
-- "assess a tenant against a baseline". #1797 landed the differ entry point
-- (`diffAgainstBaseline`), but nothing in the store said WHICH snapshot is the
-- known-good one: `tenant_config_snapshots` carries no baseline flag, and
-- `drift_baseline_snapshots` is the drift engine's per-domain `(text tenant_id,
-- domain_key)` config blob — a different table for a different subsystem.
--
-- This adds the missing pointer, and nothing else. A baseline holds no configuration
-- of its own; it NAMES an already-collected, trigger-immutable snapshot.
--
-- ADDITIVE ONLY. One new table, no change to any existing table, no data rewritten.
--
-- Deletion semantics (see the Drizzle definition in lib/db/src/schema/config-snapshots.ts):
--   snapshot_row_id is NO ACTION, deliberately —
--     * not CASCADE: retention-deleting a referenced snapshot would silently remove
--       the reference and leave past assessments unexplainable;
--     * not RESTRICT: RESTRICT fires immediately and would abort the legitimate
--       whole-tenant cascade (tenants -> snapshots AND baselines in one statement).
--   NO ACTION is checked at end-of-statement, which gives exactly the wanted split.

BEGIN;

CREATE TABLE IF NOT EXISTS config_snapshot_baselines (
  id                  serial PRIMARY KEY,
  baseline_id         uuid NOT NULL DEFAULT gen_random_uuid(),

  msp_id              integer NOT NULL,
  tenant_id           integer NOT NULL
                        REFERENCES tenants(id) ON DELETE CASCADE,
  snapshot_row_id     integer NOT NULL
                        REFERENCES tenant_config_snapshots(id) ON DELETE NO ACTION,

  name                text NOT NULL,
  description         text,
  purpose             text NOT NULL,

  is_active           boolean NOT NULL DEFAULT true,
  retired_at          timestamptz,
  retired_reason      text,

  declared_by_user_id integer,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT config_snapshot_baselines_purpose_valid
    CHECK (purpose IN ('known_good', 'promotion_source')),

  -- Retired rather than deleted, and a retired baseline must say why — the same rule
  -- tenant_config_snapshot_resource_status enforces for an incomplete read.
  CONSTRAINT config_snapshot_baselines_retired_needs_reason
    CHECK ((is_active = true  AND retired_at IS NULL     AND retired_reason IS NULL)
        OR (is_active = false AND retired_at IS NOT NULL AND retired_reason IS NOT NULL)),

  CONSTRAINT config_snapshot_baselines_name_not_blank
    CHECK (length(btrim(name)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS config_snapshot_baselines_uuid_uidx
  ON config_snapshot_baselines (baseline_id);
CREATE UNIQUE INDEX IF NOT EXISTS config_snapshot_baselines_msp_name_uidx
  ON config_snapshot_baselines (msp_id, name);
CREATE INDEX IF NOT EXISTS config_snapshot_baselines_msp_active_idx
  ON config_snapshot_baselines (msp_id, is_active);
CREATE INDEX IF NOT EXISTS config_snapshot_baselines_snapshot_idx
  ON config_snapshot_baselines (snapshot_row_id);

-- The msps FK is added separately so re-running this file on a database where it
-- already exists is a no-op rather than a duplicate-constraint error.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'config_snapshot_baselines_msp_id_fkey'
  ) THEN
    ALTER TABLE config_snapshot_baselines
      ADD CONSTRAINT config_snapshot_baselines_msp_id_fkey
      FOREIGN KEY (msp_id) REFERENCES msps(id) ON DELETE CASCADE;
  END IF;
END $$;

COMMENT ON TABLE config_snapshot_baselines IS
  'Git #1843 — names an already-collected tenant_config_snapshots row as the known-good '
  'reference (baseline_assessment) or promotion source (promotion) for the differ. Holds '
  'no configuration of its own; the snapshot it points at is immutable by trigger.';

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-31-config-snapshot-baselines-1843.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
