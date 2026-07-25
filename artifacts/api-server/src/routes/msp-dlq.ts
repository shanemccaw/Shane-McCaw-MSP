import { Router, type IRouter, type Request, type Response } from "express";
import { db, mspDlqStoreTable, mspCustomersTable } from "@workspace/db";
import { eq, and, desc, inArray } from "drizzle-orm";
import { z } from "zod";
import { requireAuth, requireRole } from "../middlewares/requireAuth.ts";
import { resolveMspIdStrict } from "../lib/resolve-msp-id.ts";
import { apiError, ApiErrorCode } from "../lib/api-helpers.ts";
import { replayDlqItem } from "../lib/portal-workflow-engine.ts";
import { logger } from "../lib/logger.ts";

const log = logger.child({ channel: "tenant.portal" });

const router: IRouter = Router();

const patchDlqSchema = z.object({
  resolution: z.enum(["discarded", "manual"]).optional(),
  payload: z.record(z.any()).optional(),
});

const bulkReplaySchema = z.object({
  dlqIds: z.array(z.string()),
});

// GET /api/msp/dlq
// List DLQ entries for active MSP
router.get(
  "/msp/dlq",
  requireAuth,
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const mspId = resolveMspIdStrict(req);
      if (mspId === null) {
        res.status(403).json({ error: "MSP context required" });
        return;
      }

      const rows = await db
        .select({
          id: mspDlqStoreTable.id,
          dlqId: mspDlqStoreTable.dlqId,
          sourceEventId: mspDlqStoreTable.sourceEventId,
          eventType: mspDlqStoreTable.eventType,
          payload: mspDlqStoreTable.payload,
          errorMessage: mspDlqStoreTable.errorMessage,
          errorStack: mspDlqStoreTable.errorStack,
          attemptCount: mspDlqStoreTable.attemptCount,
          lastAttemptAt: mspDlqStoreTable.lastAttemptAt,
          resolvedAt: mspDlqStoreTable.resolvedAt,
          resolution: mspDlqStoreTable.resolution,
          mspId: mspDlqStoreTable.mspId,
          customerId: mspDlqStoreTable.customerId,
          createdAt: mspDlqStoreTable.createdAt,
          tenantId: mspCustomersTable.tenantId,
          tenantName: mspCustomersTable.name,
        })
        .from(mspDlqStoreTable)
        .leftJoin(mspCustomersTable, eq(mspDlqStoreTable.customerId, mspCustomersTable.id))
        .where(eq(mspDlqStoreTable.mspId, mspId))
        .orderBy(desc(mspDlqStoreTable.createdAt));

      res.json(rows);
    } catch (err: unknown) {
      log.error({ err }, "GET /api/msp/dlq failed");
      const msg = err instanceof Error ? err.message : String(err);
      apiError(res, 500, ApiErrorCode.INTERNAL, msg);
    }
  }
);

// POST /api/msp/dlq/:dlqId/replay
// Replay single DLQ item
router.post(
  "/msp/dlq/:dlqId/replay",
  requireAuth,
  requireRole("MSPAdmin"),
  async (req: Request, res: Response) => {
    try {
      const mspId = resolveMspIdStrict(req);
      if (mspId === null) {
        res.status(403).json({ error: "MSP context required" });
        return;
      }

      const dlqIdStr = String(req.params.dlqId);

      // Verify item exists and belongs to this MSP
      const [existing] = await db
        .select()
        .from(mspDlqStoreTable)
        .where(and(eq(mspDlqStoreTable.dlqId, dlqIdStr), eq(mspDlqStoreTable.mspId, mspId)))
        .limit(1);

      if (!existing) {
        apiError(res, 404, ApiErrorCode.NOT_FOUND, "DLQ item not found");
        return;
      }

      if (existing.resolvedAt) {
        apiError(res, 409, ApiErrorCode.CONFLICT, "DLQ item is already resolved");
        return;
      }

      // Replay
      const newRunId = await replayDlqItem(dlqIdStr);

      res.json({
        ok: true,
        dlqId: dlqIdStr,
        newRunId,
        message: "DLQ item replay initiated successfully",
      });
    } catch (err: unknown) {
      log.error({ err }, "POST /api/msp/dlq/:dlqId/replay failed");
      const msg = err instanceof Error ? err.message : String(err);
      apiError(res, 500, ApiErrorCode.INTERNAL, msg);
    }
  }
);

// PATCH /api/msp/dlq/:dlqId
// Update resolution (discarded/manual) OR payload (editing payload)
router.patch(
  "/msp/dlq/:dlqId",
  requireAuth,
  requireRole("MSPAdmin"),
  async (req: Request, res: Response) => {
    try {
      const mspId = resolveMspIdStrict(req);
      if (mspId === null) {
        res.status(403).json({ error: "MSP context required" });
        return;
      }

      const dlqIdStr = String(req.params.dlqId);

      const parsedBody = patchDlqSchema.safeParse(req.body);
      if (!parsedBody.success) {
        apiError(res, 400, ApiErrorCode.VALIDATION, "Invalid patch body", parsedBody.error.flatten());
        return;
      }

      // Verify item exists and belongs to this MSP
      const [existing] = await db
        .select()
        .from(mspDlqStoreTable)
        .where(and(eq(mspDlqStoreTable.dlqId, dlqIdStr), eq(mspDlqStoreTable.mspId, mspId)))
        .limit(1);

      if (!existing) {
        apiError(res, 404, ApiErrorCode.NOT_FOUND, "DLQ item not found");
        return;
      }

      const updateData: Partial<typeof mspDlqStoreTable.$inferInsert> = {};

      if (parsedBody.data.resolution) {
        if (existing.resolvedAt) {
          apiError(res, 409, ApiErrorCode.CONFLICT, "DLQ item is already resolved");
          return;
        }
        updateData.resolution = parsedBody.data.resolution;
        updateData.resolvedAt = new Date();
      }

      if (parsedBody.data.payload) {
        updateData.payload = parsedBody.data.payload;
      }

      await db
        .update(mspDlqStoreTable)
        .set(updateData)
        .where(eq(mspDlqStoreTable.id, existing.id));

      res.json({
        dlqId: dlqIdStr,
        message: "DLQ item updated successfully",
      });
    } catch (err: unknown) {
      log.error({ err }, "PATCH /api/msp/dlq/:dlqId failed");
      const msg = err instanceof Error ? err.message : String(err);
      apiError(res, 500, ApiErrorCode.INTERNAL, msg);
    }
  }
);

// POST /api/msp/dlq/bulk-replay
// Replay multiple DLQ items
router.post(
  "/api/msp/dlq/bulk-replay",
  requireAuth,
  requireRole("MSPAdmin"),
  async (req: Request, res: Response) => {
    try {
      const mspId = resolveMspIdStrict(req);
      if (mspId === null) {
        res.status(403).json({ error: "MSP context required" });
        return;
      }

      const parsedBody = bulkReplaySchema.safeParse(req.body);
      if (!parsedBody.success) {
        apiError(res, 400, ApiErrorCode.VALIDATION, "Invalid bulk replay body", parsedBody.error.flatten());
        return;
      }

      const { dlqIds } = parsedBody.data;
      if (dlqIds.length === 0) {
        res.json({ replayedCount: 0, messages: [] });
        return;
      }

      // Verify items belong to this MSP
      const items = await db
        .select({ dlqId: mspDlqStoreTable.dlqId })
        .from(mspDlqStoreTable)
        .where(
          and(
            inArray(mspDlqStoreTable.dlqId, dlqIds),
            eq(mspDlqStoreTable.mspId, mspId)
          )
        );

      const validIds = items.map((i) => i.dlqId);
      if (validIds.length === 0) {
        res.json({ replayedCount: 0, messages: [] });
        return;
      }

      const results = await Promise.all(
        validIds.map(async (id) => {
          try {
            const newRunId = await replayDlqItem(id);
            return { dlqId: id, success: true, newRunId };
          } catch (e: any) {
            return { dlqId: id, success: false, error: e.message || String(e) };
          }
        })
      );

      res.json({
        replayedCount: results.filter((r) => r.success).length,
        results,
      });
    } catch (err: unknown) {
      log.error({ err }, "POST /api/msp/dlq/bulk-replay failed");
      const msg = err instanceof Error ? err.message : String(err);
      apiError(res, 500, ApiErrorCode.INTERNAL, msg);
    }
  }
);

export default router;
