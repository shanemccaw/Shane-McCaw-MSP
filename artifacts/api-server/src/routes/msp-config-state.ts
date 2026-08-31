/**
 * msp-config-state.ts — the MSP OPERATOR read + collection surface over tenant
 * configuration state (Git #1843).
 *
 * The customer reads their own tenant on `/api/portal/config-state/*`. This is the
 * same evidence read ACROSS the operator's book, plus the management actions that
 * have no customer-side equivalent. `msp-config-state-diffs.ts` carries the
 * comparison half (diffs, baselines, promotion); this file carries snapshots,
 * collection and the resource-type registry.
 *
 *   GET  /api/msp/config-state/tenants
 *     One row per customer in the book: their latest sealed snapshot, its
 *     completeness, and how stale it is. The "who has been collected, and how well"
 *     answer that has no single-tenant equivalent.
 *   GET  /api/msp/config-state/snapshots
 *     Snapshot history across the book, narrowable to one tenant.
 *   GET  /api/msp/config-state/snapshots/:id
 *     One snapshot as the completeness document, paginated.
 *   GET  /api/msp/config-state/snapshots/:id/objects?resourceKey=…
 *     The real stored objects behind one resource type.
 *   POST /api/msp/config-state/collections
 *     Trigger a collection run — through the Workflow Engine definition, never a
 *     bare call to the collector.
 *   GET  /api/msp/config-state/collections/:runId
 *     That run's real status, so the trigger is followable.
 *   GET  /api/msp/config-state/registry  ·  /registry/summary
 *     What is collectable, over what transport, needing which permission — and what
 *     is NOT collectable and exactly why.
 *
 * ─── Scoping ───────────────────────────────────────────────────────────────────
 * `resolveConfigStateBook(req)` — see that file's header. Every snapshot read takes
 * the book as an explicit predicate; `?tenantId=` can only ever NARROW within it,
 * never widen. There is no route here that reads a snapshot without the book.
 *
 * The resource-type REGISTRY is deliberately not tenant-scoped, because it is not
 * tenant data: `config_snapshot_resource_types` describes what this platform can read
 * from Microsoft, identically for every customer. It contains no tenant's
 * configuration and no tenant's identifiers.
 *
 * ─── Role floor ────────────────────────────────────────────────────────────────
 * `requireRole("MSPOperator")` throughout — MSPOperator, MSPAdmin and PlatformAdmin.
 * Matching `msp-executive.ts` and `msp-ownership.ts`; the cross-tenant guard is the
 * book, not the floor.
 *
 * ─── No write-to-tenant path ───────────────────────────────────────────────────
 * `POST /collections` starts a READ of a tenant — every call the collector makes is a
 * GET or a `Get-*` cmdlet, enforced in `config-snapshot-collector.ts` and in the
 * ps-execution container's own code-owned catalog. Nothing on this router writes
 * configuration to a tenant, and nothing on it may: applying configuration is the
 * Config Pack path with its consent gates, break-glass gate and approval steps.
 *
 * ─── Path convention, and a live trap ──────────────────────────────────────────
 * `app.ts` mounts the whole route tree at `app.use("/api", router)`, so a path
 * registered here must NOT repeat the `/api` prefix. The sibling
 * `admin-config-snapshots.ts` / `admin-config-diffs.ts` do repeat it and are
 * therefore served at `/api/api/admin/config-*`, unreachable at the path their own
 * admin-panel pages fetch — confirmed live on 2026-08-31 and filed separately. The
 * externally-visible paths in the list above are what a caller uses; the strings
 * below are those paths minus the mount prefix.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  wfDefinitionsTable,
  wfRunsTable,
  wfRunNodeLogsTable,
  tenantsTable,
  tenantConfigSnapshotsTable,
  CONFIG_READ_TRANSPORTS,
  CONFIG_SURFACES,
  CONFIG_AVAILABILITY,
  SNAPSHOT_RESOURCE_STATUSES,
  SNAPSHOT_STATUSES,
} from "@workspace/db";
import { and, asc, desc, eq } from "drizzle-orm";

import { requireRole } from "../middlewares/requireAuth.ts";
import { apiError, ApiErrorCode } from "../lib/api-helpers.ts";
import { logger } from "../lib/logger.ts";
import { resolveConfigStateBook } from "../lib/msp-config-state-scope.ts";
import {
  OBJECT_PAGE,
  REGISTRY_PAGE,
  RESOURCE_PAGE,
  SNAPSHOT_LIST_PAGE,
  clampLimit,
  clampOffset,
  latestSealedSnapshots,
  listSnapshots,
  loadScopedSnapshot,
  readResourceRegistry,
  readResourceRegistrySummary,
  readSnapshotDocument,
  readSnapshotObjects,
  snapshotCompleteness,
} from "../lib/config-state-views.ts";
import { fireWorkflowForDefinition } from "../lib/workflow-executor.ts";

const log = logger.child({ channel: "tenant.config-state" });

const router: IRouter = Router();

/** The seeded definition in `seed-system-workflows.ts`. The only collection entry point. */
const COLLECT_WORKFLOW_NAME = "__system__: Tenant Configuration Snapshot";

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.length > 0 ? v : undefined;

function pickEnum(raw: unknown, allowed: readonly string[]): string | undefined | null {
  const v = str(raw);
  if (v === undefined) return undefined;
  return allowed.includes(v) ? v : null;
}

function parseTenantFilter(raw: unknown): number | undefined | null {
  const v = str(raw);
  if (v === undefined) return undefined;
  if (!/^\d+$/.test(v)) return null;
  return Number(v);
}

// ── GET /api/msp/config-state/tenants ────────────────────────────────────────

router.get("/msp/config-state/tenants", requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const book = await resolveConfigStateBook(req);
      const latest = await latestSealedSnapshots(book.tenantIds);
      const now = Date.now();

      res.json({
        mspId: book.mspId,
        tenants: book.tenants.map((t) => {
          const s = latest.get(t.id);
          return {
            tenantId: t.id,
            customerName: t.customerName,
            domain: t.domain,
            entraTenantId: t.entraTenantId,
            isTestbed: t.isTestbed,
            status: t.status,
            // `null`, never a zeroed-out placeholder snapshot. "Never collected" and
            // "collected and found nothing" are different facts about a customer and
            // the operator view is where that difference is acted on.
            latestSnapshot: s
              ? {
                id: s.id,
                snapshotId: s.snapshotId,
                capturedAt: s.capturedAt,
                trigger: s.trigger,
                ageHours: Math.round(((now - s.capturedAt.getTime()) / 3_600_000) * 10) / 10,
                completeness: snapshotCompleteness(s),
              }
              : null,
            everCollected: s !== undefined,
          };
        }),
        collectedCount: book.tenantIds.filter((id) => latest.has(id)).length,
        neverCollectedCount: book.tenantIds.filter((id) => !latest.has(id)).length,
      });
    } catch (err) {
      log.error({ err }, "msp-config-state: tenant roll-up failed");
      return apiError(res, 500, ApiErrorCode.INTERNAL,
        "Failed to read configuration snapshot coverage across your customers");
    }
  });

// ── GET /api/msp/config-state/snapshots ──────────────────────────────────────

router.get("/msp/config-state/snapshots", requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const book = await resolveConfigStateBook(req);

      const tenantId = parseTenantFilter(req.query.tenantId);
      if (tenantId === null) {
        return apiError(res, 400, ApiErrorCode.VALIDATION, "tenantId must be an integer tenants.id");
      }
      const status = pickEnum(req.query.status, SNAPSHOT_STATUSES);
      if (status === null) {
        return apiError(res, 400, ApiErrorCode.VALIDATION,
          `status must be one of: ${SNAPSHOT_STATUSES.join(", ")}`);
      }

      const result = await listSnapshots({
        allowedTenantIds: book.tenantIds,
        tenantId,
        status,
        limit: clampLimit(req.query.limit, SNAPSHOT_LIST_PAGE),
        offset: clampOffset(req.query.offset),
      });
      res.json(result);
    } catch (err) {
      log.error({ err }, "msp-config-state: snapshot list failed");
      return apiError(res, 500, ApiErrorCode.INTERNAL, "Failed to list configuration snapshots");
    }
  });

// ── GET /api/msp/config-state/registry ───────────────────────────────────────
// Registered before the `/snapshots/:id` family purely for readability; the paths do
// not collide.

router.get("/msp/config-state/registry/summary", requireRole("MSPOperator"),
  async (_req: Request, res: Response) => {
    try {
      res.json(await readResourceRegistrySummary());
    } catch (err) {
      log.error({ err }, "msp-config-state: registry summary failed");
      return apiError(res, 500, ApiErrorCode.INTERNAL, "Failed to summarise the resource-type registry");
    }
  });

router.get("/msp/config-state/registry", requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const transport = pickEnum(req.query.transport, CONFIG_READ_TRANSPORTS);
      if (transport === null) {
        return apiError(res, 400, ApiErrorCode.VALIDATION,
          `transport must be one of: ${CONFIG_READ_TRANSPORTS.join(", ")}`);
      }
      const surface = pickEnum(req.query.surface, CONFIG_SURFACES);
      if (surface === null) {
        return apiError(res, 400, ApiErrorCode.VALIDATION,
          `surface must be one of: ${CONFIG_SURFACES.join(", ")}`);
      }
      const availability = pickEnum(req.query.availability, CONFIG_AVAILABILITY);
      if (availability === null) {
        return apiError(res, 400, ApiErrorCode.VALIDATION,
          `availability must be one of: ${CONFIG_AVAILABILITY.join(", ")}`);
      }

      const rawCollectable = str(req.query.collectable);
      if (rawCollectable !== undefined && rawCollectable !== "true" && rawCollectable !== "false") {
        return apiError(res, 400, ApiErrorCode.VALIDATION, "collectable must be 'true' or 'false'");
      }

      const result = await readResourceRegistry({
        collectable: rawCollectable === undefined ? undefined : rawCollectable === "true",
        transport,
        surface,
        availability,
        workload: str(req.query.workload),
        q: str(req.query.q),
        limit: clampLimit(req.query.limit, REGISTRY_PAGE),
        offset: clampOffset(req.query.offset),
      });
      res.json(result);
    } catch (err) {
      log.error({ err }, "msp-config-state: registry read failed");
      return apiError(res, 500, ApiErrorCode.INTERNAL, "Failed to read the resource-type registry");
    }
  });

// ── GET /api/msp/config-state/collections/:runId ─────────────────────────────
// Before `/snapshots/:id` in the file only for grouping; distinct path prefix.

router.get("/msp/config-state/collections/:runId", requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const runId = Number(req.params.runId);
      if (!Number.isSafeInteger(runId) || runId <= 0) {
        return apiError(res, 400, ApiErrorCode.VALIDATION, "runId must be a wf_runs.id integer");
      }
      const book = await resolveConfigStateBook(req);

      const [run] = await db.select().from(wfRunsTable).where(eq(wfRunsTable.id, runId)).limit(1);
      if (!run) return apiError(res, 404, ApiErrorCode.NOT_FOUND, "Collection run not found");

      // A run is readable only if the tenant it targeted is in the caller's book. The
      // tenant is on the run's own payload, put there by this router when it fired.
      const targetTenantId = Number((run.payload as { tenantId?: unknown }).tenantId);
      if (!Number.isSafeInteger(targetTenantId) || !book.tenantIds.includes(targetTenantId)) {
        // 404 rather than 403 — a 403 would confirm the run exists and names a tenant
        // outside the book, which is itself information about another MSP's customer.
        return apiError(res, 404, ApiErrorCode.NOT_FOUND, "Collection run not found");
      }

      const logs = await db.select({
        nodeId: wfRunNodeLogsTable.nodeId,
        level: wfRunNodeLogsTable.level,
        message: wfRunNodeLogsTable.message,
        timestamp: wfRunNodeLogsTable.timestamp,
      }).from(wfRunNodeLogsTable)
        .where(eq(wfRunNodeLogsTable.runId, run.id))
        .orderBy(asc(wfRunNodeLogsTable.id))
        .limit(200);

      // The snapshot the run actually produced, if it got that far. Resolved by
      // wf_run_id, which the collector stamps on the header — not by "the newest
      // snapshot for this tenant", which would attribute a concurrent run's output to
      // this one.
      const [snapshot] = await db.select().from(tenantConfigSnapshotsTable)
        .where(eq(tenantConfigSnapshotsTable.wfRunId, run.id))
        .orderBy(desc(tenantConfigSnapshotsTable.id))
        .limit(1);

      res.json({
        run: {
          id: run.id,
          status: run.status,
          triggerType: run.triggerType,
          triggerRef: run.triggerRef,
          tenantId: targetTenantId,
          startedAt: run.startedAt,
          finishedAt: run.finishedAt,
          errorMessage: run.errorMessage,
          createdAt: run.createdAt,
        },
        snapshot: snapshot
          ? {
            id: snapshot.id,
            snapshotId: snapshot.snapshotId,
            status: snapshot.status,
            capturedAt: snapshot.capturedAt,
            completeness: snapshotCompleteness(snapshot),
          }
          : null,
        logs,
      });
    } catch (err) {
      log.error({ err }, "msp-config-state: collection run read failed");
      return apiError(res, 500, ApiErrorCode.INTERNAL, "Failed to read that collection run");
    }
  });

// ── POST /api/msp/config-state/collections ───────────────────────────────────

/**
 * Trigger a configuration collection for one customer.
 *
 * Fires the seeded `__system__: Tenant Configuration Snapshot` workflow definition,
 * which is the ONLY producer path — #1796 built the `config_snapshot_collect` node
 * precisely so collection is a visible Workflow Engine run rather than a bare
 * scheduler or a direct library call from a route. This endpoint therefore does not
 * import the collector at all; it hands the tenant to the engine and returns the run
 * id. The consequence is deliberate: every collection, however started, has a
 * `wf_runs` row with logs, a concurrency limit and a visible node trace.
 *
 * Body: { tenantId: number, maxResources?: number, reason?: string }
 *
 * READ of a tenant, not a write. Every call the collector makes is a GET or a `Get-*`
 * cmdlet; the ps-execution container will not resolve a write cmdlet at all (#209).
 */
router.post("/msp/config-state/collections", requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const tenantId = Number(body.tenantId);
      if (!Number.isSafeInteger(tenantId) || tenantId <= 0) {
        return apiError(res, 400, ApiErrorCode.VALIDATION,
          "tenantId is required and must be a tenants.id integer");
      }

      const book = await resolveConfigStateBook(req);
      if (!book.tenantIds.includes(tenantId)) {
        return apiError(res, 404, ApiErrorCode.NOT_FOUND, "Customer not found");
      }

      let maxResources: number | undefined;
      if (body.maxResources !== undefined && body.maxResources !== null && body.maxResources !== "") {
        maxResources = Number(body.maxResources);
        if (!Number.isSafeInteger(maxResources) || maxResources <= 0) {
          return apiError(res, 400, ApiErrorCode.VALIDATION,
            "maxResources, when supplied, must be a positive integer");
        }
      }

      const [definition] = await db.select({ id: wfDefinitionsTable.id })
        .from(wfDefinitionsTable)
        .where(eq(wfDefinitionsTable.name, COLLECT_WORKFLOW_NAME))
        .limit(1);
      if (!definition) {
        // A real, statable blocker rather than a silent fallback to calling the
        // collector directly — which would be exactly the bare-scheduler shape the
        // Workflow Engine node exists to prevent.
        return apiError(res, 503, ApiErrorCode.INTERNAL,
          `The '${COLLECT_WORKFLOW_NAME}' workflow definition is not seeded in this `
          + "environment, so there is no visible engine path to start a collection on. "
          + "Run the system-workflow seed before triggering collection.");
      }

      const reason = str(body.reason);
      const userId = (req.user as { id?: number } | undefined)?.id ?? null;

      const runId = await fireWorkflowForDefinition(
        definition.id,
        "manual",
        `msp:config-state:collect:tenant=${tenantId}${reason ? `:${reason}` : ""}`,
        { tenantId, maxResources: maxResources ?? null, requestedByUserId: userId },
        {
          // The seeded graph asks for these two by name through its `ask_for_input`
          // node; supplying them here is what makes the run non-interactive.
          inputValues: {
            tenantId: String(tenantId),
            maxResources: maxResources === undefined ? "" : String(maxResources),
          },
        },
      );

      if (runId === null) {
        // `fireWorkflowForDefinition` returns null on an unpublished version or a hit
        // concurrency limit. Both are real conditions with different fixes, and both
        // are reported rather than retried behind the caller's back.
        return apiError(res, 409, ApiErrorCode.CONFLICT,
          "The collection workflow could not be started — either it has no published "
          + "version, or its concurrency limit is already reached by runs in flight. "
          + "Check the workflow's runs before retrying.");
      }

      log.info({ runId, tenantId, userId, maxResources },
        "msp-config-state: configuration collection started");

      res.status(202).json({
        runId,
        tenantId,
        definitionId: definition.id,
        workflow: COLLECT_WORKFLOW_NAME,
        maxResources: maxResources ?? null,
        followUrl: `/api/msp/config-state/collections/${runId}`,
      });
    } catch (err) {
      log.error({ err }, "msp-config-state: collection trigger failed");
      return apiError(res, 500, ApiErrorCode.INTERNAL, "Failed to start a configuration collection");
    }
  });

// ── GET /api/msp/config-state/snapshots/:id ──────────────────────────────────

router.get("/msp/config-state/snapshots/:id", requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const book = await resolveConfigStateBook(req);
      const snapshot = await loadScopedSnapshot(String(req.params.id), book.tenantIds);
      if (!snapshot) {
        return apiError(res, 404, ApiErrorCode.NOT_FOUND, "Configuration snapshot not found");
      }

      const workload = str(req.query.workload);
      const status = pickEnum(req.query.status, SNAPSHOT_RESOURCE_STATUSES);
      if (status === null) {
        return apiError(res, 400, ApiErrorCode.VALIDATION,
          `status must be one of: ${SNAPSHOT_RESOURCE_STATUSES.join(", ")}`);
      }

      const [tenant] = await db.select({ customerName: tenantsTable.customerName })
        .from(tenantsTable).where(eq(tenantsTable.id, snapshot.tenantId)).limit(1);

      const doc = await readSnapshotDocument({
        snapshotRowId: snapshot.id,
        workload,
        status,
        limit: clampLimit(req.query.limit, RESOURCE_PAGE),
        offset: clampOffset(req.query.offset),
      });

      res.json({
        snapshot: {
          id: snapshot.id,
          snapshotId: snapshot.snapshotId,
          tenantId: snapshot.tenantId,
          tenantName: tenant?.customerName ?? null,
          entraTenantId: snapshot.entraTenantId,
          capturedAt: snapshot.capturedAt,
          status: snapshot.status,
          trigger: snapshot.trigger,
          triggerRef: snapshot.triggerRef,
          wfRunId: snapshot.wfRunId,
          requestedByUserId: snapshot.requestedByUserId,
        },
        completeness: snapshotCompleteness(snapshot),
        workloads: doc.workloads,
        resources: doc.resources,
        paging: doc.paging,
        filtered: workload !== undefined || status !== undefined,
      });
    } catch (err) {
      log.error({ err }, "msp-config-state: snapshot document failed");
      return apiError(res, 500, ApiErrorCode.INTERNAL, "Failed to read that configuration snapshot");
    }
  });

// ── GET /api/msp/config-state/snapshots/:id/objects ──────────────────────────

router.get("/msp/config-state/snapshots/:id/objects", requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const book = await resolveConfigStateBook(req);
      const snapshot = await loadScopedSnapshot(String(req.params.id), book.tenantIds);
      if (!snapshot) {
        return apiError(res, 404, ApiErrorCode.NOT_FOUND, "Configuration snapshot not found");
      }

      const resourceKey = str(req.query.resourceKey);
      if (!resourceKey) {
        return apiError(res, 400, ApiErrorCode.VALIDATION,
          "resourceKey is required — a snapshot holds tens of thousands of objects across "
          + "the whole tenant and is not servable in one response");
      }
      const include = req.query.include === "summary" ? "summary" : "full";

      const result = await readSnapshotObjects({
        snapshotRowId: snapshot.id,
        resourceKey,
        include,
        limit: clampLimit(req.query.limit, OBJECT_PAGE),
        offset: clampOffset(req.query.offset),
      });

      res.json({
        snapshotId: snapshot.snapshotId,
        tenantId: snapshot.tenantId,
        resourceKey,
        include,
        resourceStatus: result.resourceStatus,
        objects: result.objects,
        paging: result.paging,
      });
    } catch (err) {
      log.error({ err }, "msp-config-state: object drill-down failed");
      return apiError(res, 500, ApiErrorCode.INTERNAL,
        "Failed to read the stored objects for that resource type");
    }
  });

export default router;
