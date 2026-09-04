/**
 * msp-retention-queue.ts
 *
 * The operator side of the accelerated-delete review queue (#2764, EPIC #1944
 * parts 2, 4-5). The real state machine and data model already exist —
 * `requestAcceleration` / `decideAcceleration` / `restore` in
 * `lib/retention/lifecycle.ts`, landed on #1947 — and had zero callers anywhere in
 * the codebase before this file. #1949 (the MSP console queue surface itself) was
 * closed NOT_PLANNED and reset ("artifacts/msp-console doesn't exist... real Feature
 * stubs... when someone actually starts building that Feature, not from a pre-code
 * guess"), so this route has no UI consumer yet — it exists so the mechanism is a
 * real, reachable endpoint rather than dead code, matching the rest of this
 * directory's `/api/msp/*` operator-surface family (see msp-alerts.ts for the same
 * requireRole / resolveMspIdStrict / resolveStaffScopedCustomerIds shape).
 *
 * Three real outcomes (#1944 part 2), two routes:
 *   - Agree   -> POST .../decide  { approve: true }   -> purge proceeds
 *   - Decline -> POST .../decide  { approve: false }  -> normal clock resumes
 *   - Discuss -> restore and modify -> POST .../discuss { reason }
 *     (decline-if-pending, then restore — `lifecycle.ts`'s own doc comment on
 *     `decideAcceleration` names this exact composition as the third outcome)
 *
 * Routes (MSPOperator+, mspId from JWT claim via resolveMspIdStrict, per-staff
 * customer scoping via resolveStaffScopedCustomerIds — cross-customer visibility is
 * a hard boundary for a scoped operator, #1949's own standing constraint):
 *   GET  /api/msp/retention/queue                    — pending accelerations, delete reason surfaced
 *   POST /api/msp/retention/queue/:deletionId/decide  — Agree (approve) or Decline
 *   POST /api/msp/retention/queue/:deletionId/discuss — Discuss -> restore and modify (required reason)
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, tenantsTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import { requireRole, resolveStaffScopedCustomerIds } from "../middlewares/requireAuth";
import { resolveMspIdStrict } from "../lib/resolve-msp-id.ts";
import {
  decideAcceleration,
  getDeletionById,
  listAccelerationQueue,
  restore,
  RetentionError,
  type RetentionActor,
} from "../lib/retention";
import { logger } from "../lib/logger";

const log = logger.child({ channel: "system.core" });
const router: IRouter = Router();

function actorFrom(req: Request): RetentionActor {
  const user = req.user!;
  return {
    name: user.name ?? user.email,
    role: "admin",
    userId: user.id,
    side: "operator",
  };
}

/**
 * Confirms the deletion belongs to the caller's own MSP and, when the caller is a
 * scoped operator, to one of their assigned customers — the same two checks every
 * write below needs before touching a `deletionId` that arrived as a bare URL param.
 * Returns the row so callers don't re-fetch it, or null having already written the
 * 404/403 response.
 */
async function loadScopedDeletion(
  req: Request,
  res: Response,
  mspId: number,
  deletionId: number,
) {
  const existing = await getDeletionById(deletionId);
  if (!existing || existing.mspId !== mspId) {
    res.status(404).json({ error: `Deletion ${deletionId} does not exist.` });
    return null;
  }
  const scopedIds = await resolveStaffScopedCustomerIds(req.user!);
  if (scopedIds !== null && !scopedIds.includes(existing.tenantId)) {
    // Same 404 as "doesn't exist" — a scoped operator must not learn a queue item
    // exists on a customer they're not assigned to.
    res.status(404).json({ error: `Deletion ${deletionId} does not exist.` });
    return null;
  }
  return existing;
}

router.get("/msp/retention/queue", requireRole("MSPOperator"), async (req: Request, res: Response) => {
  try {
    const mspId = resolveMspIdStrict(req);
    if (mspId === null) {
      res.status(403).json({ error: "MSP context required" });
      return;
    }
    const scopedIds = await resolveStaffScopedCustomerIds(req.user!);
    const items = await listAccelerationQueue(mspId, { tenantIds: scopedIds });

    const tenantIds = [...new Set(items.map((i) => i.tenantId))];
    const tenants = tenantIds.length
      ? await db
          .select({ id: tenantsTable.id, name: tenantsTable.customerName })
          .from(tenantsTable)
          .where(inArray(tenantsTable.id, tenantIds))
      : [];
    const tenantNameById = new Map(tenants.map((t) => [t.id, t.name]));

    res.json({
      queue: items.map((i) => ({ ...i, tenantName: tenantNameById.get(i.tenantId) ?? null })),
      total: items.length,
    });
  } catch (err) {
    log.error({ err }, "msp-retention-queue: GET /msp/retention/queue failed");
    res.status(500).json({ error: "Failed to fetch the accelerated-delete review queue" });
  }
});

router.post("/msp/retention/queue/:deletionId/decide", requireRole("MSPOperator"), async (req: Request, res: Response) => {
  try {
    const mspId = resolveMspIdStrict(req);
    if (mspId === null) {
      res.status(403).json({ error: "MSP context required" });
      return;
    }
    const deletionId = Number(req.params["deletionId"]);
    if (!Number.isInteger(deletionId)) {
      res.status(400).json({ error: "Invalid deletion id" });
      return;
    }
    if (!(await loadScopedDeletion(req, res, mspId, deletionId))) return;

    const approve = req.body?.["approve"] === true;
    const note = typeof req.body?.["note"] === "string" ? req.body["note"] : null;

    const updated = await decideAcceleration({ deletionId, approve, note, actor: actorFrom(req) });
    res.json({ deletion: updated });
  } catch (err) {
    if (err instanceof RetentionError) {
      res.status(err.httpStatus).json({ error: err.message });
      return;
    }
    log.error({ err }, "msp-retention-queue: POST /msp/retention/queue/:deletionId/decide failed");
    res.status(500).json({ error: "Failed to record the acceleration decision" });
  }
});

router.post("/msp/retention/queue/:deletionId/discuss", requireRole("MSPOperator"), async (req: Request, res: Response) => {
  try {
    const mspId = resolveMspIdStrict(req);
    if (mspId === null) {
      res.status(403).json({ error: "MSP context required" });
      return;
    }
    const deletionId = Number(req.params["deletionId"]);
    if (!Number.isInteger(deletionId)) {
      res.status(400).json({ error: "Invalid deletion id" });
      return;
    }
    const existing = await loadScopedDeletion(req, res, mspId, deletionId);
    if (!existing) return;

    const reason = typeof req.body?.["reason"] === "string" ? req.body["reason"] : "";
    const actor = actorFrom(req);

    // #1944 part 4's third outcome, exactly as `decideAcceleration`'s own doc
    // comment names it: decline (if a request is still actually pending — an
    // operator restoring a record that was never accelerated takes this same
    // route) followed by restore. `restore()` itself enforces the required
    // reason and fires the customer notification.
    if (existing.accelerationState === "pending") {
      await decideAcceleration({
        deletionId,
        approve: false,
        note: "Discussed with customer; restoring instead of purging.",
        actor,
      });
    }
    const restored = await restore({ deletionId, reason, actor });
    res.json({ deletion: restored });
  } catch (err) {
    if (err instanceof RetentionError) {
      res.status(err.httpStatus).json({ error: err.message });
      return;
    }
    log.error({ err }, "msp-retention-queue: POST /msp/retention/queue/:deletionId/discuss failed");
    res.status(500).json({ error: "Failed to restore the record" });
  }
});

export default router;
