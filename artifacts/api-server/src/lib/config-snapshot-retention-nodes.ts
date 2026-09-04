/**
 * config-snapshot-retention-nodes.ts
 *
 * Dedicated handler for the `config_snapshot_prune` workflow node type (Git #2114).
 * Same convention as `telemetry-retention-nodes.ts`'s `platform_log_stream_prune`:
 * called directly from the executor's case block, no opaque dispatcher.
 *
 * ── THE POLICY ────────────────────────────────────────────────────────────────
 * A per-tenant COUNT CAP, not a TTL: keep the most recent `keepPerTenant` non-
 * `running` snapshots for each tenant, delete the rest — excluding any snapshot
 * that a `config_diffs` row (base or head, EVER, not just "currently active") or
 * a `config_snapshot_baselines` row still names. See the migration
 * (2026-09-04-config-snapshot-retention-2114.sql) and config-snapshots.ts's
 * `configSnapshotPruneRunsTable` doc comment for the full reasoning, in particular
 * why `config_diffs`' `ON DELETE CASCADE` means this exclusion MUST be enforced
 * here rather than left to the database.
 *
 * `running` snapshots are never candidates: collection in flight is never
 * eligible for retention.
 *
 * Deleting a `tenant_config_snapshots` row cascades (by existing FK) to its
 * `tenant_config_snapshot_objects` and `tenant_config_snapshot_resource_status`
 * rows — so one DELETE against the header table is the whole prune.
 *
 * Every run is recorded in `config_snapshot_prune_runs` — the audit trail this
 * store's "honest completeness" discipline demands for a destructive sweep.
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

const log = logger.child({ channel: "system.core" });

const DEFAULT_KEEP_PER_TENANT = 20;

interface ConfigSnapshotPruneSweepRow {
  [key: string]: unknown;
  tenants_considered: number;
  candidates_over_cap: number;
  protected_by_diff: number;
  protected_by_baseline: number;
  snapshots_deleted: number;
  objects_deleted_estimate: number;
}

export async function handleConfigSnapshotPrune(
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const keepPerTenant = Math.max(0, Number(payload.keepPerTenant ?? DEFAULT_KEEP_PER_TENANT));
  const startedAt = Date.now();

  // One statement: rank each tenant's non-running snapshots newest-first, take
  // everything past the cap as a candidate, exclude anything a config_diffs or
  // config_snapshot_baselines row still names, then delete what's left and
  // report real counts at every stage — never estimated.
  const result = await db.execute<ConfigSnapshotPruneSweepRow>(sql`
    WITH ranked AS (
      SELECT id, tenant_id, object_count,
             row_number() OVER (PARTITION BY tenant_id ORDER BY captured_at DESC) AS rn
      FROM tenant_config_snapshots
      WHERE status <> 'running'
    ),
    candidates AS (
      SELECT id, tenant_id, object_count FROM ranked WHERE rn > ${keepPerTenant}
    ),
    protected_by_diff AS (
      SELECT DISTINCT snap_id FROM (
        SELECT base_snapshot_row_id AS snap_id FROM config_diffs
        UNION
        SELECT head_snapshot_row_id AS snap_id FROM config_diffs
      ) both_sides
    ),
    protected_by_baseline AS (
      SELECT DISTINCT snapshot_row_id AS snap_id FROM config_snapshot_baselines
    ),
    deletable AS (
      SELECT c.id, c.object_count
      FROM candidates c
      WHERE NOT EXISTS (SELECT 1 FROM protected_by_diff p WHERE p.snap_id = c.id)
        AND NOT EXISTS (SELECT 1 FROM protected_by_baseline p WHERE p.snap_id = c.id)
    ),
    deleted AS (
      DELETE FROM tenant_config_snapshots
      WHERE id IN (SELECT id FROM deletable)
      RETURNING id
    )
    SELECT
      (SELECT count(DISTINCT tenant_id) FROM ranked)::int AS tenants_considered,
      (SELECT count(*) FROM candidates)::int AS candidates_over_cap,
      (SELECT count(*) FROM candidates c WHERE EXISTS (SELECT 1 FROM protected_by_diff p WHERE p.snap_id = c.id))::int AS protected_by_diff,
      (SELECT count(*) FROM candidates c
        WHERE NOT EXISTS (SELECT 1 FROM protected_by_diff p WHERE p.snap_id = c.id)
          AND EXISTS (SELECT 1 FROM protected_by_baseline p WHERE p.snap_id = c.id))::int AS protected_by_baseline,
      (SELECT count(*) FROM deleted)::int AS snapshots_deleted,
      (SELECT coalesce(sum(object_count), 0) FROM deletable
        WHERE id IN (SELECT id FROM deleted))::int AS objects_deleted_estimate
  `);

  const row = result.rows[0] ?? {
    tenants_considered: 0,
    candidates_over_cap: 0,
    protected_by_diff: 0,
    protected_by_baseline: 0,
    snapshots_deleted: 0,
    objects_deleted_estimate: 0,
  };

  const durationMs = Date.now() - startedAt;
  const trigger = (payload.trigger as string | undefined) ?? "scheduled";
  const wfRunId = payload.wfRunId != null ? Number(payload.wfRunId) : null;

  await db.execute(sql`
    INSERT INTO config_snapshot_prune_runs (
      keep_per_tenant, tenants_considered, candidates_over_cap,
      protected_by_diff, protected_by_baseline,
      snapshots_deleted, objects_deleted_estimate,
      trigger, wf_run_id, duration_ms
    ) VALUES (
      ${keepPerTenant}, ${row.tenants_considered}, ${row.candidates_over_cap},
      ${row.protected_by_diff}, ${row.protected_by_baseline},
      ${row.snapshots_deleted}, ${row.objects_deleted_estimate},
      ${trigger}, ${wfRunId}, ${durationMs}
    )
  `);

  log.info(
    {
      keepPerTenant,
      tenantsConsidered: row.tenants_considered,
      candidatesOverCap: row.candidates_over_cap,
      protectedByDiff: row.protected_by_diff,
      protectedByBaseline: row.protected_by_baseline,
      snapshotsDeleted: row.snapshots_deleted,
      objectsDeletedEstimate: row.objects_deleted_estimate,
      durationMs,
    },
    "config_snapshot_prune: completed",
  );

  return {
    keepPerTenant,
    tenantsConsidered: row.tenants_considered,
    candidatesOverCap: row.candidates_over_cap,
    protectedByDiff: row.protected_by_diff,
    protectedByBaseline: row.protected_by_baseline,
    snapshotsDeleted: row.snapshots_deleted,
    objectsDeletedEstimate: row.objects_deleted_estimate,
    durationMs,
  };
}
