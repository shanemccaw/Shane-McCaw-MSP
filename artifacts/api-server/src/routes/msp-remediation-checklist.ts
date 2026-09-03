/**
 * msp-remediation-checklist.ts — Git #2670, Feature #1684 (Remediation
 * Tracking, MSP Console). MSP-side mirror of `portal-remediation-checklist.ts`
 * (#1538/#1941) — the findings-derived checklist, addressed by `monitor_
 * checks.key` rather than the hand-authored s1–s30 catalogue. Same table
 * (`remediation_tracker_steps`) as msp-remediation-tracker.ts; see that
 * route's header for why the two address spaces are additive, not competing.
 *
 *   GET  /api/msp/customers/:customerId/remediation/checklist
 *     — the customer's LATEST scan's real adverse findings, one item per
 *       open finding, each carrying its fix route and the tracker's current
 *       claim about it. Feature #1684: "Derive the checklist from findings."
 *   PUT  /api/msp/customers/:customerId/remediation/checklist/:checkKey
 *     — record the MSP's claim about ONE item, working it on the customer's
 *       behalf. Feature #1684: "mark steps done with evidence."
 *   POST /api/msp/customers/:customerId/remediation/checklist/:checkKey/raise-change
 *     — raise a real Change Request from this checklist item. Feature #1684:
 *       "gate execution behind a CR."
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, remediationTrackerStepsTable, REMEDIATION_TRACKER_STEP_STATUS } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { requireRole, assertCustomerAccess } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";
import { resolveRemediationChecklist, resolveRemediationChecklistItem, isKnownCheckKey } from "../lib/remediation-checklist";
import { logRetainerWorkFromTracker } from "../lib/retainer-work-logger";
import { buildRaiseChangeRequestInputForChecklistItem } from "../lib/remediation-raise-change";
import { raiseChangeRequest, RaiseChangeRequestError } from "../lib/portal-change-control-raise";

const log = logger.child({ channel: "engine.remediation-tracker" });

const router: IRouter = Router();

const putItemSchema = z.object({
  status: z.enum(REMEDIATION_TRACKER_STEP_STATUS),
});

/** Same resolve+authorize idiom as msp-remediation-tracker.ts. */
async function resolveAuthorizedCustomerId(req: Request, res: Response): Promise<number | null> {
  const customerId = parseInt(req.params.customerId as string, 10);
  if (isNaN(customerId)) {
    res.status(400).json({ error: "Invalid customerId" });
    return null;
  }
  if (!(await assertCustomerAccess(req.user!, customerId))) {
    res.status(404).json({ error: "Customer not found" });
    return null;
  }
  return customerId;
}

// ── Read: the findings-derived checklist ────────────────────────────────────
router.get(
  "/msp/customers/:customerId/remediation/checklist",
  requireRole("MSPOperator"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = await resolveAuthorizedCustomerId(req, res);
    if (customerId === null) return;

    try {
      const result = await resolveRemediationChecklist(customerId);
      res.json(result);
    } catch (err) {
      log.error({ err, customerId }, "GET /msp/customers/:customerId/remediation/checklist failed");
      res.status(500).json({ error: "Failed to resolve remediation checklist" });
    }
  },
);

// ── Write: the MSP's claim about one item, keyed by its checkKey ────────────
router.put(
  "/msp/customers/:customerId/remediation/checklist/:checkKey",
  requireRole("MSPOperator"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = await resolveAuthorizedCustomerId(req, res);
    if (customerId === null) return;

    const checkKey = String(req.params.checkKey ?? "");
    const parsed = putItemSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join("; ") });
      return;
    }

    if (!(await isKnownCheckKey(checkKey))) {
      res.status(400).json({ error: "Unknown check key" });
      return;
    }

    const { status } = parsed.data;
    const now = new Date();
    const completedAt = status === "completed" ? now : null;
    const userId = typeof req.user?.id === "number" ? req.user.id : null;
    const verificationState = "unverified" as const;

    try {
      await db
        .insert(remediationTrackerStepsTable)
        .values({
          customerId,
          stepId: checkKey,
          status,
          completedAt,
          updatedByUserId: userId,
          verificationState,
          verifiedAt: null,
          verifiedByRunId: null,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [remediationTrackerStepsTable.customerId, remediationTrackerStepsTable.stepId],
          set: { status, completedAt, updatedByUserId: userId, verificationState, verifiedAt: null, verifiedByRunId: null, updatedAt: now },
        });

      const [row] = await db
        .select({
          id: remediationTrackerStepsTable.id,
          stepId: remediationTrackerStepsTable.stepId,
          status: remediationTrackerStepsTable.status,
          completedAt: remediationTrackerStepsTable.completedAt,
          updatedAt: remediationTrackerStepsTable.updatedAt,
          verificationState: remediationTrackerStepsTable.verificationState,
          verifiedAt: remediationTrackerStepsTable.verifiedAt,
        })
        .from(remediationTrackerStepsTable)
        .where(and(eq(remediationTrackerStepsTable.customerId, customerId), eq(remediationTrackerStepsTable.stepId, checkKey)))
        .limit(1);

      log.info({ customerId, checkKey, status, userId }, "MSP-side remediation checklist item updated");

      // Retainer byproduct seam (Git #1293) — an MSP operator working the
      // checklist through this route is always the MSP-actor case.
      const actorMspId = typeof req.user?.mspId === "number" ? req.user.mspId : null;
      if (status === "completed" && row && actorMspId !== null) {
        await logRetainerWorkFromTracker({
          customerId,
          mspId: actorMspId,
          source: "remediation_tracker",
          sourceRefId: row.id,
          item: `Remediation item ${checkKey} completed`,
          finding: checkKey,
          loggedByUserId: userId,
          occurredAt: completedAt ?? now,
        });
      }

      res.json({
        item: row
          ? {
              checkKey: row.stepId,
              status: row.status,
              completedAt: row.completedAt instanceof Date ? row.completedAt.toISOString() : row.completedAt,
              updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
              verificationState: row.verificationState,
              verifiedAt: row.verifiedAt instanceof Date ? row.verifiedAt.toISOString() : row.verifiedAt,
            }
          : {
              checkKey,
              status,
              completedAt: completedAt?.toISOString() ?? null,
              updatedAt: now.toISOString(),
              verificationState,
              verifiedAt: null,
            },
      });
    } catch (err) {
      log.error({ err, customerId, checkKey, status }, "PUT /msp/customers/:customerId/remediation/checklist failed");
      res.status(500).json({ error: "Failed to save remediation checklist item" });
    }
  },
);

// ── Raise a real Change Request FROM one checklist item ──────────────────────
router.post(
  "/msp/customers/:customerId/remediation/checklist/:checkKey/raise-change",
  requireRole("MSPOperator"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = await resolveAuthorizedCustomerId(req, res);
    if (customerId === null) return;

    const checkKey = String(req.params.checkKey ?? "");

    try {
      const item = await resolveRemediationChecklistItem(customerId, checkKey);
      if (!item) {
        res.status(404).json({ error: "Unknown or already-resolved checklist item" });
        return;
      }

      const result = await raiseChangeRequest(customerId, req.user!, buildRaiseChangeRequestInputForChecklistItem(item));
      log.info({ customerId, checkKey, code: result.code }, "change request raised from an MSP-side remediation checklist item");
      res.status(201).json({ ...result, checkKey });
    } catch (err) {
      if (err instanceof RaiseChangeRequestError) {
        res.status(err.status).json({ error: err.message, ...err.body });
        return;
      }
      log.error({ err, customerId, checkKey }, "POST /msp/customers/:customerId/remediation/checklist/:checkKey/raise-change failed");
      res.status(500).json({ error: "Failed to raise the change request" });
    }
  },
);

export default router;
