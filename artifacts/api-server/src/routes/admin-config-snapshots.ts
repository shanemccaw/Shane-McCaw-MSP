/**
 * admin-config-snapshots.ts — render a tenant configuration SNAPSHOT as a readable
 * document (Git #1798).
 *
 * `admin-config-resources.ts` serves the resource MODEL (#1794). `admin-config-diffs.ts`
 * serves the DIFFERENCE between two snapshots (#1797). This file serves the snapshot
 * itself — what a tenant's configuration actually WAS, at one instant — grouped by
 * workload and resource type the way a configuration report reads, not the way the
 * collector wrote it.
 *
 *   GET  /api/admin/config-snapshots
 *     Filterable list of snapshot headers with their completeness roll-up.
 *   GET  /api/admin/config-snapshots/:id
 *     One snapshot as a document: the header, and every targeted resource type's
 *     outcome grouped by workload — collected/empty/partial/skipped/failed, with the
 *     real reason for anything less than collected. This IS the completeness report;
 *     nothing here is silently omitted (constraint 4 of the snapshot store, read back).
 *   GET  /api/admin/config-snapshots/:id/objects?resourceKey=...
 *     The real objects stored for one resource type in this snapshot — the drill-down
 *     from the document's summary row into the actual configuration, paginated because
 *     a single resource type can hold thousands of objects.
 *
 * requireAdmin, matching the sibling config-resources/config-diffs/drift routes: a
 * PlatformAdmin/operator view of tenant configuration state, not a customer-facing
 * surface.
 *
 * READ-ONLY. Nothing here writes a snapshot; collection is `config-snapshot-collector.ts`
 * and is out of scope for this file.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  tenantConfigSnapshotsTable,
  tenantConfigSnapshotResourceStatusTable,
  tenantConfigSnapshotObjectsTable,
  configSnapshotResourceTypesTable,
  tenantsTable,
  SNAPSHOT_STATUSES,
  SNAPSHOT_RESOURCE_STATUSES,
} from "@workspace/db";
import { and, asc, desc, eq, sql, type SQL } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth.ts";
import { apiError, ApiErrorCode } from "../lib/api-helpers.ts";
import { logger } from "../lib/logger.ts";

const log = logger.child({ channel: "engine.dashboard" });

const router: IRouter = Router();

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;

const clampLimit = (raw: unknown, max = MAX_LIMIT): number => {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(n), max);
};

/** `:id` accepts either the uuid or the integer row id, matching the diff routes' convention. */
function snapshotIdCondition(raw: string): SQL | null {
  if (/^\d+$/.test(raw)) return eq(tenantConfigSnapshotsTable.id, Number(raw));
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) {
    return eq(tenantConfigSnapshotsTable.snapshotId, raw);
  }
  return null;
}

// ── GET /api/admin/config-snapshots ──────────────────────────────────────────

router.get("/api/admin/config-snapshots", requireAdmin, async (req: Request, res: Response) => {
  try {
    const where: SQL[] = [];
    const { tenantId, status } = req.query;

    if (typeof tenantId === "string" && /^\d+$/.test(tenantId)) {
      where.push(eq(tenantConfigSnapshotsTable.tenantId, Number(tenantId)));
    }
    if (typeof status === "string") {
      if (!(SNAPSHOT_STATUSES as readonly string[]).includes(status)) {
        return apiError(res, 400, ApiErrorCode.VALIDATION,
          `status must be one of: ${SNAPSHOT_STATUSES.join(", ")}`);
      }
      where.push(eq(tenantConfigSnapshotsTable.status, status as typeof SNAPSHOT_STATUSES[number]));
    }

    const rows = await db.select({
      snapshot: tenantConfigSnapshotsTable,
      tenantName: tenantsTable.customerName,
    }).from(tenantConfigSnapshotsTable)
      .leftJoin(tenantsTable, eq(tenantsTable.id, tenantConfigSnapshotsTable.tenantId))
      .where(where.length > 0 ? and(...where) : undefined)
      .orderBy(desc(tenantConfigSnapshotsTable.capturedAt))
      .limit(clampLimit(req.query.limit));

    res.json({
      snapshots: rows.map(({ snapshot: s, tenantName }) => ({
        id: s.id,
        snapshotId: s.snapshotId,
        tenantId: s.tenantId,
        tenantName: tenantName ?? null,
        entraTenantId: s.entraTenantId,
        capturedAt: s.capturedAt,
        status: s.status,
        trigger: s.trigger,
        isComplete: s.isComplete,
        resourceTypesTargeted: s.resourceTypesTargeted,
        resourceTypesCollected: s.resourceTypesCollected,
        resourceTypesEmpty: s.resourceTypesEmpty,
        resourceTypesPartial: s.resourceTypesPartial,
        resourceTypesSkipped: s.resourceTypesSkipped,
        resourceTypesFailed: s.resourceTypesFailed,
        objectCount: s.objectCount,
        collectorVersion: s.collectorVersion,
        error: s.error,
      })),
    });
  } catch (err) {
    log.error({ err }, "config-snapshots: list failed");
    return apiError(res, 500, ApiErrorCode.INTERNAL, "Failed to list configuration snapshots");
  }
});

// ── GET /api/admin/config-snapshots/:id ──────────────────────────────────────
// The document: one row per targeted resource type, grouped by workload. Every
// resource that was skipped or failed appears here with its real reason — that is
// the whole point of rendering this table rather than only the header counts.

router.get("/api/admin/config-snapshots/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const cond = snapshotIdCondition(String(req.params.id));
    if (!cond) {
      return apiError(res, 400, ApiErrorCode.VALIDATION, "id must be a uuid or an integer row id");
    }
    const [snapshot] = await db.select().from(tenantConfigSnapshotsTable).where(cond).limit(1);
    if (!snapshot) return apiError(res, 404, ApiErrorCode.NOT_FOUND, "Configuration snapshot not found");

    const [tenant] = await db.select({ name: tenantsTable.customerName })
      .from(tenantsTable).where(eq(tenantsTable.id, snapshot.tenantId)).limit(1);

    const statusRows = await db.select({
      status: tenantConfigSnapshotResourceStatusTable,
      resourceKey: configSnapshotResourceTypesTable.resourceKey,
      displayName: configSnapshotResourceTypesTable.displayName,
      surface: configSnapshotResourceTypesTable.surface,
      workload: configSnapshotResourceTypesTable.workload,
    }).from(tenantConfigSnapshotResourceStatusTable)
      .leftJoin(configSnapshotResourceTypesTable,
        eq(configSnapshotResourceTypesTable.resourceKey, tenantConfigSnapshotResourceStatusTable.resourceKey))
      .where(eq(tenantConfigSnapshotResourceStatusTable.snapshotRowId, snapshot.id))
      .orderBy(asc(configSnapshotResourceTypesTable.workload), asc(tenantConfigSnapshotResourceStatusTable.resourceKey));

    const resources = statusRows.map((r) => ({
      resourceKey: r.status.resourceKey,
      // A resource key with no registry match is a real fact (the type was retired or
      // renamed since collection) and is labelled as such rather than hidden.
      displayName: r.displayName ?? r.status.resourceKey,
      surface: r.surface ?? null,
      workload: r.workload ?? "unregistered",
      readTransport: r.status.readTransport,
      status: r.status.status,
      skipReason: r.status.skipReason,
      reasonDetail: r.status.reasonDetail,
      objectCount: r.status.objectCount,
      pageCount: r.status.pageCount,
      httpStatus: r.status.httpStatus,
      errorCode: r.status.errorCode,
      durationMs: r.status.durationMs,
      attemptedAt: r.status.attemptedAt,
    }));

    // Grouped by workload — the shape the document actually renders.
    const byWorkload = new Map<string, {
      workload: string;
      resources: typeof resources;
      totals: Record<typeof SNAPSHOT_RESOURCE_STATUSES[number], number>;
      objectCount: number;
    }>();
    for (const r of resources) {
      let group = byWorkload.get(r.workload);
      if (!group) {
        group = {
          workload: r.workload,
          resources: [],
          totals: { collected: 0, empty: 0, partial: 0, skipped: 0, failed: 0 },
          objectCount: 0,
        };
        byWorkload.set(r.workload, group);
      }
      group.resources.push(r);
      group.totals[r.status as typeof SNAPSHOT_RESOURCE_STATUSES[number]] += 1;
      group.objectCount += r.objectCount;
    }

    res.json({
      snapshot: { ...snapshot, tenantName: tenant?.name ?? null },
      workloads: Array.from(byWorkload.values()).sort((a, b) => a.workload.localeCompare(b.workload)),
      resourceCount: resources.length,
    });
  } catch (err) {
    log.error({ err }, "config-snapshots: detail read failed");
    return apiError(res, 500, ApiErrorCode.INTERNAL, "Failed to read the configuration snapshot");
  }
});

// ── GET /api/admin/config-snapshots/:id/objects ──────────────────────────────
// The drill-down: the real objects behind one resource type's summary row.

router.get("/api/admin/config-snapshots/:id/objects", requireAdmin, async (req: Request, res: Response) => {
  try {
    const cond = snapshotIdCondition(String(req.params.id));
    if (!cond) {
      return apiError(res, 400, ApiErrorCode.VALIDATION, "id must be a uuid or an integer row id");
    }
    const [snapshot] = await db.select({ id: tenantConfigSnapshotsTable.id })
      .from(tenantConfigSnapshotsTable).where(cond).limit(1);
    if (!snapshot) return apiError(res, 404, ApiErrorCode.NOT_FOUND, "Configuration snapshot not found");

    const resourceKey = req.query.resourceKey;
    if (typeof resourceKey !== "string" || resourceKey.length === 0) {
      return apiError(res, 400, ApiErrorCode.VALIDATION, "resourceKey is required");
    }

    const limit = clampLimit(req.query.limit, 500);
    const offset = Math.max(0, Number(req.query.offset) || 0);

    const where = and(
      eq(tenantConfigSnapshotObjectsTable.snapshotRowId, snapshot.id),
      eq(tenantConfigSnapshotObjectsTable.resourceKey, resourceKey),
    );

    const objects = await db.select().from(tenantConfigSnapshotObjectsTable)
      .where(where)
      .orderBy(asc(tenantConfigSnapshotObjectsTable.objectIdentity))
      .limit(limit).offset(offset);

    const [{ total }] = await db.select({ total: sql<number>`count(*)::int` })
      .from(tenantConfigSnapshotObjectsTable).where(where);

    res.json({
      resourceKey,
      objects: objects.map((o) => ({
        objectIdentity: o.objectIdentity,
        identityStrategy: o.identityStrategy,
        displayName: o.displayName,
        objectJson: o.objectJson,
        objectHash: o.objectHash,
        propertyCount: o.propertyCount,
        odataType: o.odataType,
        sourceRef: o.sourceRef,
        collectedAt: o.collectedAt,
      })),
      paging: { total, limit, offset },
    });
  } catch (err) {
    log.error({ err }, "config-snapshots: object drill-down failed");
    return apiError(res, 500, ApiErrorCode.INTERNAL, "Failed to read the snapshot's stored objects");
  }
});

export default router;
