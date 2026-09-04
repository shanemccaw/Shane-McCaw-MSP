-- Real retention policy for tenant configuration snapshots (Git #2114).
--
-- ── THE PROBLEM ──────────────────────────────────────────────────────────────
-- tenant_config_snapshots / tenant_config_snapshot_objects (#1795) accumulate by
-- design and were shipped with no retention: 34 MB / 50,176 object rows per full
-- snapshot, measured live on the local database, with nothing bounding growth as
-- manual runs (the collector, #1796, is manual-trigger-only) pile up over time.
--
-- ── THE POLICY ───────────────────────────────────────────────────────────────
-- A per-tenant COUNT CAP: keep the most recent `keepPerTenant` non-`running`
-- snapshots per tenant (default 20, see the seeded workflow node's `keepPerTenant`
-- data field), delete the rest — EXCLUDING:
--   1. any snapshot named by a `config_diffs.base_snapshot_row_id` or
--      `head_snapshot_row_id` row, ever. #1797's own FK there is ON DELETE
--      CASCADE, so an unfiltered prune would silently destroy an "immutable"
--      diff rather than being stopped by the database — the application must
--      exclude these itself. handleConfigSnapshotPrune() does exactly that.
--   2. any snapshot named by a `config_snapshot_baselines.snapshot_row_id` row.
--      Already DB-enforced (ON DELETE NO ACTION, see #1843's migration); the
--      prune query pre-filters it anyway so a baseline never turns a clean sweep
--      into a failed statement.
-- `running` snapshots are never counted or touched — collection in flight is not
-- eligible for retention by definition.
--
-- ── WHAT THIS MIGRATION ADDS ─────────────────────────────────────────────────
-- 1. config_snapshot_prune_runs — the audit trail of every prune execution: the
--    cap applied, how many snapshots were candidates, how many were excluded
--    and why, and how many the DELETE actually removed. Same "honest
--    completeness" discipline tenant_config_snapshot_resource_status applies to
--    collection, applied here to deletion — a prune run that silently deleted
--    nothing (or everything) is exactly as visible as one that worked as
--    intended.
-- 2. config_diffs_head_snapshot_row_id_idx — the prune query's exclusion check
--    (2 above) does a lookup on head_snapshot_row_id; config_diffs' existing
--    indexes all lead with base_snapshot_row_id or head_tenant_id, so a lookup
--    keyed purely on head_snapshot_row_id would table-scan config_diffs without
--    this index.
--
-- ── ENFORCEMENT ──────────────────────────────────────────────────────────────
-- Not a one-time cleanup script: the real, ongoing enforcement is the
-- `config_snapshot_prune` workflow node (artifacts/api-server/src/lib/
-- config-snapshot-retention-nodes.ts), wired into a nightly scheduled system
-- workflow ("__system__: Tenant Configuration Snapshot Retention Prune", cron
-- "0 3 * * *") seeded by seed-system-workflows.ts and run automatically by
-- seedSystemWorkflows() on every api-server boot.
--
-- Safe to run repeatedly: CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS.

BEGIN;

CREATE TABLE IF NOT EXISTS config_snapshot_prune_runs (
  id                          serial PRIMARY KEY,

  keep_per_tenant             integer NOT NULL,

  tenants_considered          integer NOT NULL DEFAULT 0,
  candidates_over_cap         integer NOT NULL DEFAULT 0,
  protected_by_diff           integer NOT NULL DEFAULT 0,
  protected_by_baseline       integer NOT NULL DEFAULT 0,
  snapshots_deleted           integer NOT NULL DEFAULT 0,
  objects_deleted_estimate    integer NOT NULL DEFAULT 0,

  trigger                     text NOT NULL DEFAULT 'scheduled'
                                CHECK (trigger IN ('manual', 'scheduled', 'workflow', 'api')),
  wf_run_id                   integer,

  duration_ms                 integer,
  ran_at                      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT config_snapshot_prune_runs_counts_nonnegative CHECK (
    keep_per_tenant >= 0 AND tenants_considered >= 0 AND candidates_over_cap >= 0
    AND protected_by_diff >= 0 AND protected_by_baseline >= 0
    AND snapshots_deleted >= 0 AND objects_deleted_estimate >= 0
  )
);

CREATE INDEX IF NOT EXISTS config_snapshot_prune_runs_ran_at_idx
  ON config_snapshot_prune_runs (ran_at DESC);

-- Supports the prune query's exclusion check against config_diffs.head_snapshot_row_id
-- (base_snapshot_row_id is already the leading column of config_diffs_pair_uidx).
CREATE INDEX IF NOT EXISTS config_diffs_head_snapshot_row_id_idx
  ON config_diffs (head_snapshot_row_id);

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-04-config-snapshot-retention-2114.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
COMMIT;


-- ══════════════════════════════════════════════════════════════════════════════════
-- READ-ONLY: verify
-- ══════════════════════════════════════════════════════════════════════════════════

SELECT table_name FROM information_schema.tables WHERE table_name = 'config_snapshot_prune_runs';
SELECT indexname FROM pg_indexes WHERE tablename = 'config_diffs' AND indexname = 'config_diffs_head_snapshot_row_id_idx';
