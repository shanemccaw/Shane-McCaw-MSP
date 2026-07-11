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
  const sort = parseSort(req.query, ["createdAt", "status", "workflowKey"], "createdAt");
  const statusFilter = parseStringFilter(req.query, "status");
  const wfFilter = parseStringFilter(req.query, "workflowKey");
  const mspIdStr = parseStringFilter(req.query, "mspId");
  const customerIdStr = parseStringFilter(req.query, "customerId");

  const conditions: ReturnType<typeof eq>[] = [];
  if (statusFilter) conditions.push(eq(portalWfRunsTable.status, statusFilter as "pending" | "running" | "completed" | "failed" | "cancelled"));
  if (wfFilter) conditions.push(eq(portalWfRunsTable.workflowKey, wfFilter));
  if (mspIdStr) conditions.push(eq(portalWfRunsTable.mspId, parseInt(mspIdStr, 10)));
  if (customerIdStr) conditions.push(eq(portalWfRunsTable.customerId, parseInt(customerIdStr, 10)));

  const whereClause = conditions.length ? and(...conditions) : undefined;

  const [{ total }] = await db.select({ total: count() }).from(portalWfRunsTable).where(whereClause);

  const orderCol =
    sort.sortBy === "status" ? portalWfRunsTable.status
    : sort.sortBy === "workflowKey" ? portalWfRunsTable.workflowKey
    : portalWfRunsTable.createdAt;

  const rows = await db.select().from(portalWfRunsTable)
    .where(whereClause)
    .orderBy(sort.sortDir === "asc" ? asc(orderCol) : desc(orderCol))
    .limit(pg.pageSize)
    .offset(pg.offset);

  res.json(paginatedResponse(rows, total, pg));
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

    const runId = await createRun({
      workflowKey,
      tenantContext: { mspId: mspId ?? null, customerId: customerId ?? null },
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
    if (!run) { apiError(res, 404, ApiErrorCode.NOT_FOUND, "Run not found"); return; }
    if (run.status !== "pending") { apiError(res, 409, ApiErrorCode.CONFLICT, `Run is not in a cancellable state (current: ${run.status})`); return; }

    await db.update(portalWfRunsTable).set({
      status: "cancelled",
      completedAt: new Date(),
    }).where(and(eq(portalWfRunsTable.runId, runId), eq(portalWfRunsTable.status, "pending")));

    res.json({ ok: true, runId, status: "cancelled" });
  },
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
