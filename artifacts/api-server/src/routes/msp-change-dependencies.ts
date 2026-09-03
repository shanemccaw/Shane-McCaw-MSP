/**
 * msp-change-dependencies.ts — MSP-console CRUD for `blocked_by` edges between
 * change requests (#1504).
 *
 *   GET    /api/msp/change-requests/:id/dependencies
 *   POST   /api/msp/change-requests/:id/dependencies
 *   DELETE /api/msp/change-requests/:id/dependencies/:depId
 *
 * `:id` is the human-readable `CR-2026-XXX` code, same convention every other
 * `msp-changes.ts` sub-route follows. The actual enforcement — a CR with an
 * open blocker cannot be claimed to authorize a write — lives entirely in
 * `change-control-write-gate.ts`; this file is CRUD on the edges only, plus a
 * read a future calendar view can use to render "blocked by CR-...".
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, mspChangeRequestsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { requireAuth, requireRole } from "../middlewares/requireAuth.ts";
import { resolveMspIdStrict } from "../lib/resolve-msp-id.ts";
import { apiError, ApiErrorCode } from "../lib/api-helpers.ts";
import { logger } from "../lib/logger.ts";
import { createDependency, deleteDependency, dependencyEdgesFor, type DependencyEdge } from "../lib/portal-change-dependencies-store.ts";

const log = logger.child({ channel: "workflow.change-control" });

const router: IRouter = Router();

/** `CR-2026-101` → the numeric msp_change_requests.id, or null. */
function parseCrId(crId: string): number | null {
  const match = crId.match(/^CR-2026-(\d+)$/);
  if (!match) return null;
  return parseInt(match[1], 10) - 100;
}

/**
 * `otherChangeRequestCode`/`otherStatus` describe the OTHER CR in the edge —
 * the blocker when returned under `blockedBy`, the dependent CR when
 * returned under `blocks`. See `DependencyEdge`'s own header.
 */
interface WireDependencyEdge {
  readonly id: number;
  readonly otherChangeRequestCode: string;
  readonly otherStatus: string;
  readonly note: string | null;
  readonly createdBy: string | null;
  readonly createdAt: string;
}

function toWire(edge: DependencyEdge): WireDependencyEdge {
  return {
    id: edge.id,
    otherChangeRequestCode: edge.otherChangeRequestCode,
    otherStatus: edge.otherStatus,
    note: edge.note,
    createdBy: edge.createdBy,
    createdAt: edge.createdAt.toISOString(),
  };
}

async function loadScopedCr(dbId: number, mspId: number) {
  const [row] = await db
    .select({ id: mspChangeRequestsTable.id })
    .from(mspChangeRequestsTable)
    .where(and(eq(mspChangeRequestsTable.id, dbId), eq(mspChangeRequestsTable.mspId, mspId)))
    .limit(1);
  return row ?? null;
}

// GET /api/msp/change-requests/:id/dependencies
router.get(
  "/msp/change-requests/:id/dependencies",
  requireAuth,
  requireRole("MSPOperator"),
  async (req: Request, res: Response): Promise<void> => {
    const mspId = resolveMspIdStrict(req);
    if (mspId === null) {
      res.status(403).json({ error: "MSP context required" });
      return;
    }
    const dbId = parseCrId(String(req.params.id));
    if (dbId === null) {
      apiError(res, 400, ApiErrorCode.VALIDATION, "Invalid change request ID format");
      return;
    }
    try {
      const cr = await loadScopedCr(dbId, mspId);
      if (!cr) {
        apiError(res, 404, ApiErrorCode.NOT_FOUND, "Change request not found");
        return;
      }
      const edges = await dependencyEdgesFor(dbId, mspId);
      res.json({
        blockedBy: edges.blockedBy.map(toWire),
        blocks: edges.blocks.map(toWire),
      });
    } catch (err) {
      log.error({ err, mspId, dbId }, "GET /msp/change-requests/:id/dependencies failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, "Failed to load dependencies");
    }
  },
);

const createSchema = z.object({
  blocksChangeRequestId: z.string().trim().min(1),
  note: z.string().trim().max(2_000).optional(),
});

// POST /api/msp/change-requests/:id/dependencies — body.blocksChangeRequestId is a CR-2026-XXX code.
router.post(
  "/msp/change-requests/:id/dependencies",
  requireAuth,
  requireRole("MSPOperator"),
  async (req: Request, res: Response): Promise<void> => {
    const mspId = resolveMspIdStrict(req);
    if (mspId === null) {
      res.status(403).json({ error: "MSP context required" });
      return;
    }
    const dbId = parseCrId(String(req.params.id));
    if (dbId === null) {
      apiError(res, 400, ApiErrorCode.VALIDATION, "Invalid change request ID format");
      return;
    }
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      apiError(res, 400, ApiErrorCode.VALIDATION, "Invalid dependency payload", parsed.error.flatten());
      return;
    }
    const blocksId = parseCrId(parsed.data.blocksChangeRequestId);
    if (blocksId === null) {
      apiError(res, 400, ApiErrorCode.VALIDATION, "Invalid blocksChangeRequestId format");
      return;
    }

    try {
      const cr = await loadScopedCr(dbId, mspId);
      if (!cr) {
        apiError(res, 404, ApiErrorCode.NOT_FOUND, "Change request not found");
        return;
      }
      const result = await createDependency({
        mspId,
        changeRequestId: dbId,
        blocksChangeRequestId: blocksId,
        note: parsed.data.note ?? null,
        createdBy: req.user?.email ?? null,
      });
      if (!result.ok) {
        apiError(res, 409, ApiErrorCode.CONFLICT, result.reason);
        return;
      }
      res.status(201).json({ edge: toWire(result.edge) });
    } catch (err) {
      log.error({ err, mspId, dbId }, "POST /msp/change-requests/:id/dependencies failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, "Failed to create dependency");
    }
  },
);

// DELETE /api/msp/change-requests/:id/dependencies/:depId
router.delete(
  "/msp/change-requests/:id/dependencies/:depId",
  requireAuth,
  requireRole("MSPOperator"),
  async (req: Request, res: Response): Promise<void> => {
    const mspId = resolveMspIdStrict(req);
    if (mspId === null) {
      res.status(403).json({ error: "MSP context required" });
      return;
    }
    const dbId = parseCrId(String(req.params.id));
    const depId = Number(req.params.depId);
    if (dbId === null || !Number.isInteger(depId) || depId <= 0) {
      apiError(res, 400, ApiErrorCode.VALIDATION, "Invalid change request or dependency ID");
      return;
    }
    try {
      const cr = await loadScopedCr(dbId, mspId);
      if (!cr) {
        apiError(res, 404, ApiErrorCode.NOT_FOUND, "Change request not found");
        return;
      }
      const removed = await deleteDependency(depId, mspId);
      if (!removed) {
        apiError(res, 404, ApiErrorCode.NOT_FOUND, "Dependency not found");
        return;
      }
      log.info({ mspId, dbId, depId }, "change-control: blocked_by dependency removed");
      res.status(204).end();
    } catch (err) {
      log.error({ err, mspId, dbId, depId }, "DELETE /msp/change-requests/:id/dependencies/:depId failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, "Failed to remove dependency");
    }
  },
);

export default router;
