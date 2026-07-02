/**
 * admin-kanban-escalation.ts
 *
 * POST /api/admin/kanban/check-escalations
 *   Manually trigger the escalation check. Returns a summary of what was sent.
 *   Protected by the admin password header.
 *
 * This is the same function that runs on the daily internal schedule
 * (see src/index.ts). Useful for testing and for external cron triggers
 * (GitHub Actions, Azure Logic Apps, etc.).
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { requireAdmin } from "../middlewares/requireAuth";
import { checkManualScriptEscalations } from "../lib/manual-script-escalation";
import { reconcileStalledPhases } from "../lib/kanban-auto-fire";
import { emitWorkflowEvent } from "../lib/workflow-executor";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.post(
  "/admin/kanban/check-escalations",
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const result = await checkManualScriptEscalations();
      req.log.info(
        { result },
        "admin triggered manual script escalation check",
      );
      res.json({
        ok: true,
        checked: result.checked,
        alerted: result.alerted,
        cardIds: result.cardIds,
        message:
          result.alerted === 0
            ? "No overdue cards found — no email sent."
            : `Alert sent for ${result.alerted} overdue card${result.alerted !== 1 ? "s" : ""}.`,
      });
    } catch (err) {
      logger.error({ err }, "admin-kanban-escalation: unexpected error");
      res.status(500).json({ error: "Failed to run escalation check" });
    }
  },
);

/**
 * POST /api/admin/kanban/trigger-auto-fire
 *   Manually trigger auto-fire for a specific client (by clientUserId).
 *   Also useful after fixing template runbook mappings on an already-spawned phase.
 *   Body: { clientUserId: number }
 */
router.post(
  "/admin/kanban/trigger-auto-fire",
  requireAdmin,
  async (req: Request, res: Response) => {
    const { clientUserId } = req.body as { clientUserId?: unknown };
    if (typeof clientUserId !== "number" || !Number.isInteger(clientUserId) || clientUserId <= 0) {
      res.status(400).json({ error: "clientUserId must be a positive integer" });
      return;
    }
    try {
      // Emit workflow event — the Kanban Auto-fire workflow picks this up
      void emitWorkflowEvent("kanban.card_moved", { clientUserId, action: "script" });
      void emitWorkflowEvent("kanban.card_moved", { clientUserId, action: "document" });
      req.log.info({ clientUserId }, "admin triggered auto-fire via workflow event for client");
      res.json({ ok: true, message: `Auto-fire triggered for clientUserId ${clientUserId}` });
    } catch (err) {
      logger.error({ err, clientUserId }, "admin-kanban-escalation: trigger-auto-fire unexpected error");
      res.status(500).json({ error: "Failed to trigger auto-fire" });
    }
  },
);

/**
 * POST /api/admin/kanban/reconcile-stalled-phases
 *   Run the stalled-phase reconciler immediately.
 *   Finds any in_progress workflow step with backlog script cards but no running job,
 *   and kicks off auto-fire for the affected clients.
 */
router.post(
  "/admin/kanban/reconcile-stalled-phases",
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      await reconcileStalledPhases();
      req.log.info({}, "admin triggered reconcile-stalled-phases");
      res.json({ ok: true, message: "Stalled-phase reconciliation complete — check server logs for details" });
    } catch (err) {
      logger.error({ err }, "admin-kanban-escalation: reconcile-stalled-phases unexpected error");
      res.status(500).json({ error: "Failed to run stalled-phase reconciler" });
    }
  },
);

export default router;
