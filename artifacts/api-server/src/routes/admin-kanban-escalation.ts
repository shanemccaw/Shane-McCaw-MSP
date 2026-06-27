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

export default router;
