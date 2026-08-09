/**
 * Admin Dead-Letter Queue Routes — the platform-wide view over `msp_dlq_store`.
 *
 *   GET   /api/admin/dlq                 — list parked items (unresolved by default)
 *   POST  /api/admin/dlq/:dlqId/replay   — re-run a portal-workflow item
 *   PATCH /api/admin/dlq/:dlqId          — mark handled ("manual") or discard it
 *
 * Why this exists alongside `msp-dlq.ts`: that router is session-MSP-fenced
 * (`resolveMspIdStrict` + `WHERE msp_id = $1`), which is correct for an MSP
 * operator and useless here. A PlatformAdmin carries no `mspId` claim, so the
 * MSP route returns an empty list for them; and `msp_dlq_store.msp_id` is
 * nullable — `lib/dlq.ts`'s own `enqueueDlq` defaults it to null — so even a
 * PlatformAdmin who *did* have an mspId would never see the platform-scoped
 * failures. This router is deliberately unfenced, and `requireAdmin` is what
 * makes that safe.
 *
 * **Not everything parked here is replayable.** Only the portal workflow engine
 * writes a `workflowKey` into the payload, and `replayDlqItem` is the only
 * replay path that exists; `msp-jobs`, `zoho-batch-drain` and
 * `engagebay-batch-drain` park raw job/batch payloads that nothing knows how to
 * re-run. Rather than offering a Retry that fails at click time, the list
 * states `replayable` per item and the replay route refuses the rest with a
 * plain reason.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, mspDlqStoreTable, tenantsTable } from "@workspace/db";
import { and, count, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { z } from "zod";
import { logger } from "../lib/logger";
import { requireAdmin } from "../middlewares/requireAuth";
import { resolveDlqItem } from "../lib/dlq";
import { replayDlqItem } from "../lib/portal-workflow-engine";

const router: IRouter = Router();
const log = logger.child({ channel: "admin.dlq" });

/**
 * A parked item can only be re-run when the portal workflow engine put it
 * there — `replayDlqItem` reads `payload.workflowKey` and throws without it.
 */
function isReplayable(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const key = (payload as Record<string, unknown>)["workflowKey"];
  return typeof key === "string" && key.length > 0;
}

// ── GET /api/admin/dlq ────────────────────────────────────────────────────────

router.get("/admin/dlq", requireAdmin, async (req: Request, res: Response) => {
  const status = String(req.query["status"] ?? "unresolved");
  const parsedLimit = parseInt(String(req.query["limit"] ?? "100"), 10);
  const limit = Math.min(Number.isNaN(parsedLimit) ? 100 : parsedLimit, 500);

  const statusFilter =
    status === "resolved"
      ? isNotNull(mspDlqStoreTable.resolvedAt)
      : status === "all"
        ? undefined
        : isNull(mspDlqStoreTable.resolvedAt);

  try {
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
        customerName: tenantsTable.customerName,
      })
      .from(mspDlqStoreTable)
      .leftJoin(tenantsTable, eq(mspDlqStoreTable.customerId, tenantsTable.id))
      .where(statusFilter)
      .orderBy(desc(mspDlqStoreTable.createdAt))
      .limit(limit);

    // Reported separately so the caller can say "showing 100 of 214" rather
    // than silently presenting a truncated list as the whole queue.
    const [totals] = await db
      .select({ n: count() })
      .from(mspDlqStoreTable)
      .where(isNull(mspDlqStoreTable.resolvedAt));

    res.json({
      items: rows.map((r) => ({ ...r, replayable: isReplayable(r.payload) })),
      unresolvedTotal: totals?.n ?? 0,
      limit,
    });
  } catch (err) {
    log.error({ err }, "GET /admin/dlq failed");
    res.status(500).json({ error: "Failed to list dead-letter items" });
  }
});

// ── POST /api/admin/dlq/:dlqId/replay ─────────────────────────────────────────

router.post("/admin/dlq/:dlqId/replay", requireAdmin, async (req: Request, res: Response) => {
  const dlqId = String(req.params["dlqId"] ?? "");
  if (!dlqId) {
    res.status(400).json({ error: "Invalid dlqId" });
    return;
  }

  try {
    const [existing] = await db
      .select()
      .from(mspDlqStoreTable)
      .where(eq(mspDlqStoreTable.dlqId, dlqId))
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: "Dead-letter item not found" });
      return;
    }
    if (existing.resolvedAt) {
      res.status(409).json({ error: "This item has already been dealt with" });
      return;
    }
    if (!isReplayable(existing.payload)) {
      res.status(400).json({
        error:
          "This job did not come from a portal workflow run, so there is nothing to re-run. " +
          "Fix the cause, then mark it handled.",
      });
      return;
    }

    const newRunId = await replayDlqItem(dlqId);
    log.info({ dlqId, newRunId, userId: req.user?.id }, "dead-letter item replayed");
    res.json({ ok: true, dlqId, newRunId });
  } catch (err) {
    log.error({ err, dlqId }, "POST /admin/dlq/:dlqId/replay failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to replay item" });
  }
});

// ── PATCH /api/admin/dlq/:dlqId ───────────────────────────────────────────────

const patchSchema = z.object({
  // "replayed" is deliberately absent: only the replay route may claim a job
  // was actually re-run, so a stamp here can never disagree with reality.
  resolution: z.enum(["discarded", "manual"]),
});

router.patch("/admin/dlq/:dlqId", requireAdmin, async (req: Request, res: Response) => {
  const dlqId = String(req.params["dlqId"] ?? "");
  if (!dlqId) {
    res.status(400).json({ error: "Invalid dlqId" });
    return;
  }

  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid request" });
    return;
  }

  try {
    const [existing] = await db
      .select({ id: mspDlqStoreTable.id, resolvedAt: mspDlqStoreTable.resolvedAt })
      .from(mspDlqStoreTable)
      .where(and(eq(mspDlqStoreTable.dlqId, dlqId), isNull(mspDlqStoreTable.resolvedAt)))
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: "Dead-letter item not found, or already dealt with" });
      return;
    }

    const ok = await resolveDlqItem(dlqId, { resolution: parsed.data.resolution });
    if (!ok) {
      res.status(404).json({ error: "Dead-letter item not found" });
      return;
    }

    log.info({ dlqId, resolution: parsed.data.resolution, userId: req.user?.id }, "dead-letter item resolved");
    res.json({ ok: true, dlqId, resolution: parsed.data.resolution });
  } catch (err) {
    log.error({ err, dlqId }, "PATCH /admin/dlq/:dlqId failed");
    res.status(500).json({ error: "Failed to update dead-letter item" });
  }
});

export default router;
