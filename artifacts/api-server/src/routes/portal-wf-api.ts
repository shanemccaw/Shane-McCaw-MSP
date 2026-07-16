/**
 * portal-wf-api.ts
 *
 * REST API for the MSP Portal Workflow Engine.
 *
 * Mounted at /api/msp/v1/portal-wf by the msp-v1 router.
 *
 * Routes:
 *   Workflow definitions:
 *     GET    /workflows                          — list all workflow definitions
 *     GET    /workflows/:workflowKey             — get one definition (with start mappings)
 *     PUT    /workflows/:workflowKey             — create or update a workflow definition
 *     PATCH  /workflows/:workflowKey/active      — enable/disable a workflow
 *
 *   Start mappings:
 *     GET    /start-mappings                     — list all event pattern subscriptions
 *     POST   /start-mappings                     — add a mapping
 *     DELETE /start-mappings                     — remove a mapping (body: {eventPattern, workflowKey})
 *     POST   /start-mappings/reload              — hot-reload mappings from DB into memory
 *
 *   Runs:
 *     GET    /runs                               — list runs (paginated, filterable by workflowKey/status/mspId)
 *     GET    /runs/:runId                        — get one run with node outputs
 *     POST   /runs                               — manually trigger a workflow run
 *     POST   /runs/:runId/retry                  — retry a failed/cancelled run (creates a new run)
 *     POST   /runs/:runId/cancel                 — cancel a pending run
 *
 *   Operator tasks:
 *     GET    /operator-tasks                     — list open operator tasks (paginated)
 *     PATCH  /operator-tasks/:taskId             — update status (acknowledge/resolve)
 *
 *   DLQ:
 *     GET    /dlq                                — list DLQ entries for portal_wf events (paginated)
 *     POST   /dlq/:dlqId/replay                  — replay a DLQ entry
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  portalWfWorkflowsTable,
  portalWfStartMappingsTable,
  portalWfRunsTable,
  portalWfNodeOutputsTable,
  portalWfOperatorTasksTable,
  mspDlqStoreTable,
  wfRunsTable,
  wfDefinitionsTable,
} from "@workspace/db";
import { eq, and, desc, asc, count, sql, like } from "drizzle-orm";
import { requireRole } from "../middlewares/requireAuth.ts";
import { mspMutatingRateLimit } from "../middlewares/mspRateLimit.ts";
import {
  apiError,
  ApiErrorCode,
  parsePagination,
  parseSort,
  parseStringFilter,
  paginatedResponse,
} from "../lib/api-helpers.ts";
import {
  listWorkflows,
  getWorkflow,
  upsertWorkflow,
  listStartMappings,
  upsertStartMapping,
  deleteStartMapping,
  reloadStartMappings,
  createRun,
  executeRun,
  retryRun,
  replayDlqItem,
  startMappings,
  mappingsLoadedAt,
} from "../lib/portal-workflow-engine.ts";
import { resolveBillingMspId } from "../lib/ai-billing.ts";

function p(val: string | string[] | undefined): string {
  return Array.isArray(val) ? (val[0] ?? "") : (val ?? "");
}

const router: IRouter = Router();

// All portal-wf routes require at minimum MSPOperator role
router.use(requireRole("MSPOperator"));

// ── Workflow Definitions ──────────────────────────────────────────────────────

router.get("/workflows", async (_req: Request, res: Response) => {
  const rows = await listWorkflows();
  res.json({ workflows: rows });
});

router.get("/workflows/:workflowKey", async (req: Request, res: Response) => {
  const workflowKey = p(req.params["workflowKey"]);
  const wf = await getWorkflow(workflowKey);
  if (!wf) { apiError(res, 404, ApiErrorCode.NOT_FOUND, "Workflow not found"); return; }

  const mappings = await listStartMappings();
  const wfMappings = mappings.filter((m) => m.workflowKey === workflowKey);

  res.json({ workflow: wf, startMappings: wfMappings });
});

router.put(
  "/workflows/:workflowKey",
  requireRole("MSPAdmin"),
  mspMutatingRateLimit,
  async (req: Request, res: Response) => {
    const workflowKey = p(req.params["workflowKey"]);
    const { label, description, graph, retryPolicy, isActive } = req.body as {
      label?: string;
      description?: string;
      graph?: unknown;
      retryPolicy?: unknown;
      isActive?: boolean;
    };

    if (!label) { apiError(res, 400, ApiErrorCode.VALIDATION, "label is required"); return; }
    if (!graph || typeof graph !== "object") { apiError(res, 400, ApiErrorCode.VALIDATION, "graph must be an object"); return; }

    const wf = await upsertWorkflow({
      workflowKey,
      label,
      description,
      graph: graph as Parameters<typeof upsertWorkflow>[0]["graph"],
      retryPolicy: retryPolicy as Parameters<typeof upsertWorkflow>[0]["retryPolicy"],
      isActive,
    });
    res.json({ workflow: wf });
  },
);

router.patch(
  "/workflows/:workflowKey/active",
  requireRole("MSPAdmin"),
  mspMutatingRateLimit,
  async (req: Request, res: Response) => {
    const workflowKey = p(req.params["workflowKey"]);
    const { isActive } = req.body as { isActive?: boolean };
    if (typeof isActive !== "boolean") { apiError(res, 400, ApiErrorCode.VALIDATION, "isActive (boolean) is required"); return; }

    const wf = await getWorkflow(workflowKey);
    if (!wf) { apiError(res, 404, ApiErrorCode.NOT_FOUND, "Workflow not found"); return; }

    const [updated] = await db.update(portalWfWorkflowsTable)
      .set({ isActive, updatedAt: new Date() })
      .where(eq(portalWfWorkflowsTable.workflowKey, workflowKey))
      .returning();
    res.json({ workflow: updated });
  },
);

// ── Start Mappings ────────────────────────────────────────────────────────────

router.get("/start-mappings", async (_req: Request, res: Response) => {
  const rows = await listStartMappings();
  res.json({
    mappings: rows,
    inMemoryCount: startMappings.length,
    loadedAt: mappingsLoadedAt,
  });
});

router.post(
  "/start-mappings",
  requireRole("MSPAdmin"),
  mspMutatingRateLimit,
  async (req: Request, res: Response) => {
    const { eventPattern, workflowKey, isActive } = req.body as {
      eventPattern?: string;
      workflowKey?: string;
      isActive?: boolean;
    };

    if (!eventPattern || !workflowKey) {
      apiError(res, 400, ApiErrorCode.VALIDATION, "eventPattern and workflowKey are required");
      return;
    }

    const wf = await getWorkflow(workflowKey);
    if (!wf) { apiError(res, 404, ApiErrorCode.NOT_FOUND, `Workflow '${workflowKey}' not found`); return; }

    await upsertStartMapping({ eventPattern, workflowKey, isActive: isActive ?? true });
    res.json({ ok: true, eventPattern, workflowKey });
  },
);

router.delete(
  "/start-mappings",
  requireRole("MSPAdmin"),
  mspMutatingRateLimit,
  async (req: Request, res: Response) => {
    const { eventPattern, workflowKey } = req.body as {
      eventPattern?: string;
      workflowKey?: string;
    };

    if (!eventPattern || !workflowKey) {
      apiError(res, 400, ApiErrorCode.VALIDATION, "eventPattern and workflowKey are required");
      return;
    }

    await deleteStartMapping(eventPattern, workflowKey);
    res.json({ ok: true });
  },
);

router.post(
  "/start-mappings/reload",
  requireRole("MSPAdmin"),
  mspMutatingRateLimit,
  async (_req: Request, res: Response) => {
    await reloadStartMappings();
    res.json({ ok: true, count: startMappings.length, loadedAt: mappingsLoadedAt });
  },
);

// ── Runs ──────────────────────────────────────────────────────────────────────

router.get("/runs", async (req: Request, res: Response) => {
  const pg = parsePagination(req.query);
  const sort = parseSort(req.query, ["startedAt", "createdAt", "status", "workflowKey"], "startedAt");
  const statusFilter = parseStringFilter(req.query, "status");
  const wfFilter = parseStringFilter(req.query, "workflowKey");
  const mspIdStr = parseStringFilter(req.query, "mspId");
  const customerIdStr = parseStringFilter(req.query, "customerId");

  // Portal runs conditions
  const portalConditions: ReturnType<typeof eq>[] = [];
  const systemConditions: any[] = [];

  if (statusFilter) {
    portalConditions.push(eq(portalWfRunsTable.status, statusFilter as any));
    systemConditions.push(eq(wfRunsTable.status, statusFilter as any));
  }
  if (wfFilter) {
    portalConditions.push(eq(portalWfRunsTable.workflowKey, wfFilter));
    systemConditions.push(eq(wfDefinitionsTable.name, wfFilter));
  }
  if (mspIdStr) {
    const mspId = parseInt(mspIdStr, 10);
    portalConditions.push(eq(portalWfRunsTable.mspId, mspId));
    systemConditions.push(sql`CAST(${wfRunsTable.payload}->>'mspId' AS INTEGER) = ${mspId}`);
  }
  if (customerIdStr) {
    const custId = parseInt(customerIdStr, 10);
    portalConditions.push(eq(portalWfRunsTable.customerId, custId));
    systemConditions.push(sql`CAST(${wfRunsTable.payload}->>'customerId' AS INTEGER) = ${custId}`);
  }

  const portalWhere = portalConditions.length ? and(...portalConditions) : undefined;
  const systemWhere = systemConditions.length ? and(...systemConditions) : undefined;

  // Counts
  const [{ total: portalTotal }] = await db.select({ total: count() }).from(portalWfRunsTable).where(portalWhere);
  const [{ total: systemTotal }] = await db.select({ total: count() })
    .from(wfRunsTable)
    .leftJoin(wfDefinitionsTable, eq(wfRunsTable.definitionId, wfDefinitionsTable.id))
    .where(systemWhere);
  const total = portalTotal + systemTotal;

  // Queries
  const portalQuery = db.select({
    id: portalWfRunsTable.id,
    runId: sql<string>`CAST(${portalWfRunsTable.runId} AS TEXT)`.as("runId"),
    workflowKey: portalWfRunsTable.workflowKey,
    tenantContext: portalWfRunsTable.tenantContext,
    status: portalWfRunsTable.status,
    triggerEventType: portalWfRunsTable.triggerEventType,
    errorMessage: portalWfRunsTable.errorMessage,
    startedAt: portalWfRunsTable.startedAt,
    completedAt: portalWfRunsTable.completedAt,
    mspId: portalWfRunsTable.mspId,
    customerId: portalWfRunsTable.customerId,
    createdAt: portalWfRunsTable.createdAt,
    source: sql<string>`'portal'`.as("source"),
  }).from(portalWfRunsTable).where(portalWhere);

  const systemQuery = db.select({
    id: wfRunsTable.id,
    runId: sql<string>`CAST(${wfRunsTable.id} AS TEXT)`.as("runId"),
    workflowKey: sql<string>`COALESCE(${wfDefinitionsTable.name}, 'unknown')`.as("workflowKey"),
    tenantContext: sql<any>`'{}'::jsonb`.as("tenantContext"),
    status: wfRunsTable.status,
    triggerEventType: wfRunsTable.triggerType.as("triggerEventType"),
    errorMessage: wfRunsTable.errorMessage,
    startedAt: wfRunsTable.startedAt,
    completedAt: wfRunsTable.finishedAt.as("completedAt"),
    mspId: sql<number | null>`CAST(${wfRunsTable.payload}->>'mspId' AS INTEGER)`.as("mspId"),
    customerId: sql<number | null>`CAST(${wfRunsTable.payload}->>'customerId' AS INTEGER)`.as("customerId"),
    createdAt: wfRunsTable.createdAt,
    source: sql<string>`'system'`.as("source"),
  })
  .from(wfRunsTable)
  .leftJoin(wfDefinitionsTable, eq(wfRunsTable.definitionId, wfDefinitionsTable.id))
  .where(systemWhere);

  const orderColStr = sort.sortBy === "status" ? "status" : sort.sortBy === "workflowKey" ? "workflowKey" : sort.sortBy === "createdAt" ? "createdAt" : "startedAt";
  const sortDirStr = sort.sortDir === "asc" ? "asc" : "desc";

  const result = await db.execute(sql`
    WITH combined AS (
      ${portalQuery} UNION ALL ${systemQuery}
    )
    SELECT * FROM combined
    ORDER BY "${sql.raw(orderColStr)}" ${sql.raw(sortDirStr)}
    LIMIT ${pg.pageSize} OFFSET ${pg.offset}
  `);
  
  // db.execute returns { rows: any[] } for node-postgres
  const rows = (result as any).rows ?? result;

  res.json(paginatedResponse(rows as any[], total, pg));
});

router.get("/runs/:runId", async (req: Request, res: Response) => {
  const runId = p(req.params["runId"]);

  const [run] = await db.select().from(portalWfRunsTable)
    .where(eq(portalWfRunsTable.runId, runId)).limit(1);
  if (!run) { apiError(res, 404, ApiErrorCode.NOT_FOUND, "Run not found"); return; }

  const nodeOutputs = await db.select().from(portalWfNodeOutputsTable)
    .where(eq(portalWfNodeOutputsTable.runId, runId))
    .orderBy(asc(portalWfNodeOutputsTable.createdAt));

  res.json({ run, nodeOutputs });
});

router.post(
  "/runs",
  requireRole("MSPAdmin"),
  mspMutatingRateLimit,
  async (req: Request, res: Response) => {
    const { workflowKey, mspId, customerId, inputPayload } = req.body as {
      workflowKey?: string;
      mspId?: number;
      customerId?: number;
      inputPayload?: Record<string, unknown>;
    };

    if (!workflowKey) { apiError(res, 400, ApiErrorCode.VALIDATION, "workflowKey is required"); return; }

    const wf = await getWorkflow(workflowKey);
    if (!wf) { apiError(res, 404, ApiErrorCode.NOT_FOUND, `Workflow '${workflowKey}' not found`); return; }
    if (!wf.isActive) { apiError(res, 409, ApiErrorCode.CONFLICT, `Workflow '${workflowKey}' is not active`); return; }

    // resolveBillingMspId takes precedence so impersonation sessions always
    // debit the target MSP rather than the acting PlatformAdmin (who has no
    // mspId of their own).  Body-provided mspId is used as a fallback for
    // direct PlatformAdmin calls where no impersonation context is present.
    const runId = await createRun({
      workflowKey,
      tenantContext: { mspId: resolveBillingMspId(req.user) ?? mspId ?? null, customerId: customerId ?? null },
      inputPayload: inputPayload ?? {},
    });

    // Kick off execution asynchronously
    void executeRun(runId);

    res.status(202).json({ runId, workflowKey, status: "pending" });
  },
);

router.post(
  "/runs/:runId/retry",
  requireRole("MSPAdmin"),
  mspMutatingRateLimit,
  async (req: Request, res: Response) => {
    const runId = p(req.params["runId"]);
    try {
      const newRunId = await retryRun(runId);
      res.status(202).json({ ok: true, originalRunId: runId, newRunId, status: "pending" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      apiError(res, 409, ApiErrorCode.CONFLICT, message);
    }
  },
);

router.post(
  "/runs/:runId/cancel",
  requireRole("MSPAdmin"),
  mspMutatingRateLimit,
  async (req: Request, res: Response) => {
    const runId = p(req.params["runId"]);

    const [run] = await db.select().from(portalWfRunsTable)
      .where(eq(portalWfRunsTable.runId, runId)).limit(1);
    
    if (!run) {
      const numericId = parseInt(runId, 10);
      if (!isNaN(numericId)) {
        const [sysRun] = await db.select().from(wfRunsTable)
          .where(eq(wfRunsTable.id, numericId)).limit(1);
        if (sysRun) {
          if (sysRun.status !== "pending" && sysRun.status !== "running") { 
            apiError(res, 409, ApiErrorCode.CONFLICT, `Run is not in a cancellable state (current: ${sysRun.status})`); 
            return; 
          }
          await db.update(wfRunsTable).set({
            status: "cancelled",
            finishedAt: new Date(),
          }).where(eq(wfRunsTable.id, numericId));
          res.json({ ok: true, runId, status: "cancelled", source: "system" });
          return;
        }
      }
      apiError(res, 404, ApiErrorCode.NOT_FOUND, "Run not found");
      return;
    }

    if (run.status !== "pending" && run.status !== "running") { 
      apiError(res, 409, ApiErrorCode.CONFLICT, `Run is not in a cancellable state (current: ${run.status})`); 
      return; 
    }

    await db.update(portalWfRunsTable).set({
      status: "cancelled",
      completedAt: new Date(),
    }).where(eq(portalWfRunsTable.runId, runId));

    res.json({ ok: true, runId, status: "cancelled", source: "portal" });
  },
);

router.delete(
  "/runs/:runId",
  requireRole("MSPAdmin"),
  mspMutatingRateLimit,
  async (req: Request, res: Response) => {
    const runId = p(req.params["runId"]);

    const [pRun] = await db.delete(portalWfRunsTable)
      .where(eq(portalWfRunsTable.runId, runId)).returning();
    if (pRun) {
      res.json({ ok: true, runId, source: "portal" });
      return;
    }

    const numericId = parseInt(runId, 10);
    if (!isNaN(numericId)) {
      const [sRun] = await db.delete(wfRunsTable)
        .where(eq(wfRunsTable.id, numericId)).returning();
      if (sRun) {
        res.json({ ok: true, runId, source: "system" });
        return;
      }
    }

    apiError(res, 404, ApiErrorCode.NOT_FOUND, "Run not found");
  }
);

// ── Operator Tasks ────────────────────────────────────────────────────────────

router.get("/operator-tasks", async (req: Request, res: Response) => {
  const pg = parsePagination(req.query);
  const statusFilter = parseStringFilter(req.query, "status") ?? "open";
  const mspIdStr = parseStringFilter(req.query, "mspId");

  const conditions: ReturnType<typeof eq>[] = [
    eq(portalWfOperatorTasksTable.status, statusFilter as "open" | "acknowledged" | "resolved"),
  ];
  if (mspIdStr) conditions.push(eq(portalWfOperatorTasksTable.mspId, parseInt(mspIdStr, 10)));

  const whereClause = and(...conditions);

  const [{ total }] = await db.select({ total: count() }).from(portalWfOperatorTasksTable).where(whereClause);

  const rows = await db.select().from(portalWfOperatorTasksTable)
    .where(whereClause)
    .orderBy(desc(portalWfOperatorTasksTable.createdAt))
    .limit(pg.pageSize)
    .offset(pg.offset);

  res.json(paginatedResponse(rows, total, pg));
});

router.patch(
  "/operator-tasks/:taskId",
  requireRole("MSPAdmin"),
  mspMutatingRateLimit,
  async (req: Request, res: Response) => {
    const taskId = p(req.params["taskId"]);
    const { status, resolvedByUserId } = req.body as {
      status?: "acknowledged" | "resolved";
      resolvedByUserId?: number;
    };

    if (!status || !["acknowledged", "resolved"].includes(status)) {
      apiError(res, 400, ApiErrorCode.VALIDATION, "status must be 'acknowledged' or 'resolved'");
      return;
    }

    const [task] = await db.select().from(portalWfOperatorTasksTable)
      .where(eq(portalWfOperatorTasksTable.taskId, taskId)).limit(1);
    if (!task) { apiError(res, 404, ApiErrorCode.NOT_FOUND, "Operator task not found"); return; }

    const [updated] = await db.update(portalWfOperatorTasksTable).set({
      status,
      resolvedAt: status === "resolved" ? new Date() : task.resolvedAt,
      resolvedByUserId: resolvedByUserId ?? task.resolvedByUserId,
    }).where(eq(portalWfOperatorTasksTable.taskId, taskId)).returning();

    res.json({ task: updated });
  },
);

// ── DLQ ───────────────────────────────────────────────────────────────────────

router.get("/dlq", async (req: Request, res: Response) => {
  const pg = parsePagination(req.query);
  const resolved = parseStringFilter(req.query, "resolved");

  const conditions = [like(mspDlqStoreTable.eventType, "portal_wf.%")];
  if (resolved === "false") conditions.push(sql`${mspDlqStoreTable.resolvedAt} IS NULL`);
  if (resolved === "true") conditions.push(sql`${mspDlqStoreTable.resolvedAt} IS NOT NULL`);

  const whereClause = and(...conditions);

  const [{ total }] = await db.select({ total: count() }).from(mspDlqStoreTable).where(whereClause);

  const rows = await db.select().from(mspDlqStoreTable)
    .where(whereClause)
    .orderBy(desc(mspDlqStoreTable.createdAt))
    .limit(pg.pageSize)
    .offset(pg.offset);

  res.json(paginatedResponse(rows, total, pg));
});

router.post(
  "/dlq/:dlqId/replay",
  requireRole("MSPAdmin"),
  mspMutatingRateLimit,
  async (req: Request, res: Response) => {
    const dlqId = p(req.params["dlqId"]);
    try {
      const newRunId = await replayDlqItem(dlqId);
      res.status(202).json({ ok: true, dlqId, newRunId, status: "pending" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      apiError(res, 409, ApiErrorCode.CONFLICT, message);
    }
  },
);

router.patch(
  "/dlq/:dlqId",
  requireRole("MSPAdmin"),
  mspMutatingRateLimit,
  async (req: Request, res: Response) => {
    const dlqId = p(req.params["dlqId"]);
    const { resolution } = req.body as { resolution?: "discarded" | "manual" };

    if (!resolution || !["discarded", "manual"].includes(resolution)) {
      apiError(res, 400, ApiErrorCode.VALIDATION, "resolution must be 'discarded' or 'manual'");
      return;
    }

    const [existing] = await db.select().from(mspDlqStoreTable)
      .where(eq(mspDlqStoreTable.dlqId, dlqId)).limit(1);
    if (!existing) { apiError(res, 404, ApiErrorCode.NOT_FOUND, "DLQ entry not found"); return; }
    if (existing.resolvedAt) { apiError(res, 409, ApiErrorCode.CONFLICT, "DLQ entry is already resolved"); return; }

    const [updated] = await db.update(mspDlqStoreTable).set({
      resolution,
      resolvedAt: new Date(),
    }).where(eq(mspDlqStoreTable.dlqId, dlqId)).returning();

    res.json({ entry: updated });
  },
);

export default router;
