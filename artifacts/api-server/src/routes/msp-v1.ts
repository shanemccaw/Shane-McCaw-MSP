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
import { db, mspsTable, mspCustomersTable, mspJobQueueTable } from "@workspace/db";
import { eq, and, desc, asc, count, sql } from "drizzle-orm";
import { requireRole, requireMspScope } from "../middlewares/requireAuth.ts";
import { mspRateLimit, mspMutatingRateLimit } from "../middlewares/mspRateLimit.ts";
import { mspRequestLog } from "../middlewares/mspRequestLog.ts";
import { withIdempotency } from "../lib/idempotency.ts";
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

/** Coerce Express 5 params (typed as string | string[]) to a plain string */
function p(val: string | string[] | undefined): string {
  return Array.isArray(val) ? (val[0] ?? "") : (val ?? "");
}

const router: IRouter = Router();

// ── Apply observability + rate limiting to all /msp/v1/* routes ───────────────
// mspRequestLog must be first so traceId is available to all downstream handlers.
// requireAuth is NOT applied globally — /health is intentionally public.
router.use(mspRequestLog);
router.use(mspRateLimit);

// ── Webhook sub-router (mounted before express.json() body parsing) ────────────
router.use("/webhooks", webhooksRouter);

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
    res.json({ ok: true, jobId, status: "pending" });
  },
);

export default router;
