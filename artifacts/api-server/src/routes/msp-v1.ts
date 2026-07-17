/**
 * MSP API v1 Router  (/api/msp/v1/)
 *
 * Versioned surface for the MSP multi-tenant platform.  Every route here
 * inherits the full middleware stack:
 *
 *   1. mspRequestLog  — traceId / requestId / mspId / actor on req + response header
 *   2. mspRateLimit   — per-mspId sliding-window throttle (300 req/min by default)
 *   3. requireAuth    — JWT verification (all authenticated routes below)
 *
 * Business-logic endpoints (diagnostics, billing, offers, etc.) are added by
 * their respective subsystem tasks and mounted onto this router.
 *
 * Routes registered here:
 *   GET  /api/msp/v1/health                          — unauthenticated health check
 *   GET  /api/msp/v1/msps/:mspId                     — read MSP profile (MSPAdmin+)
 *   GET  /api/msp/v1/msps/:mspId/customers           — list customers (paginated)
 *   GET  /api/msp/v1/msps/:mspId/jobs                — list background jobs (paginated)
 *   POST /api/msp/v1/msps/:mspId/jobs/:jobId/cancel  — cancel a pending job
 *   POST /api/msp/v1/msps/:mspId/jobs/:jobId/requeue — requeue a failed job
 *   Webhooks mounted at /api/msp/v1/webhooks/* (see msp-webhooks.ts)
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, mspsTable, mspCustomersTable, mspJobQueueTable, pendingApprovalsTable, wfRunsTable, wfDefinitionsTable, mspUsersTable } from "@workspace/db";
import { eq, and, desc, asc, count, sql } from "drizzle-orm";
import { requireRole, requireMspScope } from "../middlewares/requireAuth.ts";
import { mspRateLimit, mspMutatingRateLimit } from "../middlewares/mspRateLimit.ts";
import { mspRequestLog } from "../middlewares/mspRequestLog.ts";
import { withIdempotency } from "../lib/idempotency.ts";
import { z } from "zod";
import {
  apiError,
  ApiErrorCode,
  parsePagination,
  parseSort,
  parseStringFilter,
  paginatedResponse,
} from "../lib/api-helpers.ts";
import { cancelJob, requeueJob } from "../lib/msp-jobs.ts";
import webhooksRouter from "./msp-webhooks.ts";
import portalWfRouter from "./portal-wf-api.ts";
import aiBillingRouter from "./ai-billing.ts";
import { logger } from "../lib/logger.ts";

/** Coerce Express 5 params (typed as string | string[]) to a plain string */
function p(val: string | string[] | undefined): string {
  return Array.isArray(val) ? (val[0] ?? "") : (val ?? "");
}

const log = logger.child({ channel: "system.core" });
const router: IRouter = Router();

// ── Apply observability + rate limiting to all /msp/v1/* routes ───────────────
// mspRequestLog must be first so traceId is available to all downstream handlers.
// requireAuth is NOT applied globally — /health is intentionally public.
router.use(mspRequestLog);
router.use(mspRateLimit);

// ── Webhook sub-router (mounted before express.json() body parsing) ────────────
router.use("/webhooks", webhooksRouter);

// ── Portal Workflow Engine API ────────────────────────────────────────────────
router.use("/portal-wf", portalWfRouter);

// ── AI Cost Governance & Billing ──────────────────────────────────────────────
router.use("/ai-billing", aiBillingRouter);

// ── Health (unauthenticated) ──────────────────────────────────────────────────
router.get("/health", (_req: Request, res: Response) => {
  res.json({ ok: true, version: "v1", ts: new Date().toISOString() });
});

// ── MSP Profile ───────────────────────────────────────────────────────────────
router.get(
  "/msps/:mspId",
  requireRole("MSPAdmin"),
  requireMspScope("params"),
  async (req: Request, res: Response) => {
    const mspId = parseInt(p(req.params["mspId"]), 10);
    if (isNaN(mspId)) { apiError(res, 400, ApiErrorCode.VALIDATION, "mspId must be a number"); return; }

    const [msp] = await db
      .select({
        id: mspsTable.id,
        name: mspsTable.name,
        slug: mspsTable.slug,
        domain: mspsTable.domain,
        logoUrl: mspsTable.logoUrl,
        primaryColor: mspsTable.primaryColor,
        status: mspsTable.status,
        trialEndsAt: mspsTable.trialEndsAt,
        createdAt: mspsTable.createdAt,
      })
      .from(mspsTable)
      .where(eq(mspsTable.id, mspId))
      .limit(1);

    if (!msp) { apiError(res, 404, ApiErrorCode.NOT_FOUND, "MSP not found"); return; }
    res.json(msp);
  },
);

// ── Customers (paginated) ─────────────────────────────────────────────────────
router.get(
  "/msps/:mspId/customers",
  requireRole("MSPOperator"),
  requireMspScope("params"),
  async (req: Request, res: Response) => {
    const mspId = parseInt(p(req.params["mspId"]), 10);
    if (isNaN(mspId)) { apiError(res, 400, ApiErrorCode.VALIDATION, "mspId must be a number"); return; }

    const pg = parsePagination(req.query);
    const sort = parseSort(req.query, ["name", "createdAt", "status"], "createdAt");
    const statusFilter = parseStringFilter(req.query, "status");

    const conditions = [eq(mspCustomersTable.mspId, mspId)];
    if (statusFilter) {
      conditions.push(eq(mspCustomersTable.status, statusFilter as "active" | "inactive" | "onboarding"));
    }

    const whereClause = and(...conditions);

    const [{ total }] = await db
      .select({ total: count() })
      .from(mspCustomersTable)
      .where(whereClause);

    const orderCol =
      sort.sortBy === "name" ? mspCustomersTable.name
      : sort.sortBy === "status" ? mspCustomersTable.status
      : mspCustomersTable.createdAt;

    const rows = await db
      .select()
      .from(mspCustomersTable)
      .where(whereClause)
      .orderBy(sort.sortDir === "asc" ? asc(orderCol) : desc(orderCol))
      .limit(pg.pageSize)
      .offset(pg.offset);

    res.json(paginatedResponse(rows, total, pg));
  },
);

// ── Background Jobs (paginated) ───────────────────────────────────────────────
router.get(
  "/msps/:mspId/jobs",
  requireRole("MSPAdmin"),
  requireMspScope("params"),
  async (req: Request, res: Response) => {
    const mspId = parseInt(p(req.params["mspId"]), 10);
    if (isNaN(mspId)) { apiError(res, 400, ApiErrorCode.VALIDATION, "mspId must be a number"); return; }

    const pg = parsePagination(req.query);
    const statusFilter = parseStringFilter(req.query, "status");
    const typeFilter = parseStringFilter(req.query, "jobType");

    const conditions = [eq(mspJobQueueTable.mspId, mspId)];
    if (statusFilter) conditions.push(sql`${mspJobQueueTable.status} = ${statusFilter}`);
    if (typeFilter) conditions.push(eq(mspJobQueueTable.jobType, typeFilter));

    const whereClause = and(...conditions);

    const [{ total }] = await db
      .select({ total: count() })
      .from(mspJobQueueTable)
      .where(whereClause);

    const rows = await db
      .select()
      .from(mspJobQueueTable)
      .where(whereClause)
      .orderBy(desc(mspJobQueueTable.scheduledAt))
      .limit(pg.pageSize)
      .offset(pg.offset);

    res.json(paginatedResponse(rows, total, pg));
  },
);

// ── Job: cancel ───────────────────────────────────────────────────────────────
router.post(
  "/msps/:mspId/jobs/:jobId/cancel",
  requireRole("MSPAdmin"),
  requireMspScope("params"),
  mspMutatingRateLimit,
  withIdempotency(),
  async (req: Request, res: Response) => {
    const mspId = parseInt(p(req.params["mspId"]), 10);
    const jobId = p(req.params["jobId"]);
    if (isNaN(mspId) || !jobId) { apiError(res, 400, ApiErrorCode.VALIDATION, "mspId and jobId are required"); return; }

    const cancelled = await cancelJob(jobId);
    if (!cancelled) { apiError(res, 409, ApiErrorCode.CONFLICT, "Job is not in a cancellable state (must be pending)"); return; }
    res.json({ ok: true, jobId, status: "cancelled" });
  },
);

// ── Job: requeue ──────────────────────────────────────────────────────────────
router.post(
  "/msps/:mspId/jobs/:jobId/requeue",
  requireRole("MSPAdmin"),
  requireMspScope("params"),
  mspMutatingRateLimit,
  withIdempotency(),
  async (req: Request, res: Response) => {
    const mspId = parseInt(p(req.params["mspId"]), 10);
    const jobId = p(req.params["jobId"]);
    if (isNaN(mspId) || !jobId) { apiError(res, 400, ApiErrorCode.VALIDATION, "mspId and jobId are required"); return; }

    const requeued = await requeueJob(jobId);
    if (!requeued) { apiError(res, 409, ApiErrorCode.CONFLICT, "Job is not in a requeueable state (must be failed)"); return; }
    res.json({ ok: true, jobId, status: "queued" });
  },
);

// ── Pending Approvals: list ───────────────────────────────────────────────────
router.get(
  "/msps/:mspId/pending-approvals",
  requireRole("MSPOperator"),
  requireMspScope("params"),
  async (req: Request, res: Response) => {
    const mspId = parseInt(p(req.params["mspId"]), 10);
    if (isNaN(mspId)) { apiError(res, 400, ApiErrorCode.VALIDATION, "mspId must be a number"); return; }

    const statusFilter = (parseStringFilter(req.query, "status") ?? "pending") as "pending" | "approved" | "rejected" | "timed_out";

    try {
      const rows = await db
        .select({
          approval: pendingApprovalsTable,
          defName: wfDefinitionsTable.name,
        })
        .from(pendingApprovalsTable)
        .leftJoin(wfRunsTable, eq(pendingApprovalsTable.runId, wfRunsTable.id))
        .leftJoin(wfDefinitionsTable, eq(wfRunsTable.definitionId, wfDefinitionsTable.id))
        .where(
          and(
            eq(pendingApprovalsTable.mspId, mspId),
            eq(pendingApprovalsTable.status, statusFilter)
          )
        )
        .orderBy(desc(pendingApprovalsTable.createdAt));

      const { mspSowsTable, mspCustomersTable } = await import("@workspace/db");
      const enrichedRows = [];

      for (const r of rows) {
        const approval = r.approval;
        const context = (approval.context as Record<string, any>) ?? {};
        let sowDetails = null;
        let customerDetails = null;

        if (context.sowId) {
          const [sow] = await db
            .select()
            .from(mspSowsTable)
            .where(eq(mspSowsTable.sowId, context.sowId))
            .limit(1);

          if (sow) {
            sowDetails = {
              title: sow.title,
              amountCents: sow.amountCents,
              currency: sow.currency,
            };

            if (sow.customerId) {
              const [customer] = await db
                .select({ name: mspCustomersTable.name })
                .from(mspCustomersTable)
                .where(eq(mspCustomersTable.id, sow.customerId))
                .limit(1);
              if (customer) {
                customerDetails = {
                  id: sow.customerId,
                  name: customer.name,
                };
              }
            }
          }
        }

        enrichedRows.push({
          ...approval,
          definitionName: r.defName,
          sow: sowDetails,
          customer: customerDetails,
        });
      }

      res.json(enrichedRows);
    } catch (err) {
      req.log.error({ err }, "pending-approvals (msp): list failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, "Failed to list pending approvals");
    }
  },
);

// ── Pending Approvals: decide ──────────────────────────────────────────────────
router.post(
  "/msps/:mspId/pending-approvals/:id/decide",
  requireRole("MSPOperator"),
  requireMspScope("params"),
  mspMutatingRateLimit,
  withIdempotency(),
  async (req: Request, res: Response) => {
    const mspId = parseInt(p(req.params["mspId"]), 10);
    const id = parseInt(p(req.params["id"]), 10);
    if (isNaN(mspId) || isNaN(id)) { apiError(res, 400, ApiErrorCode.VALIDATION, "mspId and id must be numbers"); return; }

    const user = req.user!;

    // Verify decision authorization:
    // MSPAdmin and PlatformAdmin (legacy role: admin) can always decide.
    // MSPOperator needs canApprovePurchases = true.
    let isAuthorized = false;
    if (user.role === "admin" || user.mspRole === "PlatformAdmin" || user.mspRole === "MSPAdmin") {
      isAuthorized = true;
    } else if (user.mspRole === "MSPOperator") {
      const [dbUser] = await db
        .select({ canApprovePurchases: mspUsersTable.canApprovePurchases })
        .from(mspUsersTable)
        .where(and(eq(mspUsersTable.userId, user.id), eq(mspUsersTable.mspId, mspId)))
        .limit(1);
      if (dbUser?.canApprovePurchases) {
        isAuthorized = true;
      }
    }

    if (!isAuthorized) {
      apiError(res, 403, ApiErrorCode.FORBIDDEN, "You do not have permission to decide on approvals for this MSP");
      return;
    }

    const body = z.object({
      decision: z.enum(["approved", "rejected"]),
      note: z.string().optional(),
    }).safeParse(req.body);

    if (!body.success) { apiError(res, 400, ApiErrorCode.VALIDATION, body.error.message); return; }

    try {
      const [approval] = await db
        .select()
        .from(pendingApprovalsTable)
        .where(and(
          eq(pendingApprovalsTable.id, id),
          eq(pendingApprovalsTable.mspId, mspId),
          eq(pendingApprovalsTable.status, "pending")
        ))
        .limit(1);

      if (!approval) {
        apiError(res, 404, ApiErrorCode.NOT_FOUND, "Pending approval not found or already decided");
        return;
      }

      await db.update(pendingApprovalsTable).set({
        status: body.data.decision,
        decidedAt: new Date(),
        decisionNote: body.data.note ?? null,
        decidedBy: user.email,
      }).where(eq(pendingApprovalsTable.id, id));

      if (body.data.decision === "approved") {
        const resumePayload = (approval.context as Record<string, unknown>) ?? {};
        const decisionNote = body.data.note;
        const { resumeWorkflowRun } = await import("../lib/workflow-executor.ts");

        setImmediate(() => {
          resumeWorkflowRun(approval.runId, approval.nodeId, resumePayload, decisionNote).catch(err => {
            log.warn({ err, runId: approval.runId }, "pending-approvals (msp): resume failed (non-fatal)");
          });
        });
        req.log.info({ approvalId: id, runId: approval.runId }, "pending-approvals (msp): approved, resuming run");
      } else {
        await db.update(wfRunsTable).set({
          status: "failed",
          finishedAt: new Date(),
          errorMessage: `Rejected by MSP at approval gate: ${body.data.note ?? "(no reason given)"}`,
        }).where(eq(wfRunsTable.id, approval.runId));
        req.log.info({ approvalId: id, runId: approval.runId }, "pending-approvals (msp): rejected, run marked failed");
      }

      res.json({ ok: true, id, status: body.data.decision });
    } catch (err) {
      req.log.error({ err }, "pending-approvals (msp): decide failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, "Failed to register approval decision");
    }
  },
);

export default router;
