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
import { db } from "@workspace/db";
import { projectsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

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

// ── Kanban board / column discovery (for Workflow Builder node config) ────────

const MARKETING_BOARD = {
  id: "marketing",
  name: "Marketing Kanban",
  columns: [
    { id: "ideas",       label: "Ideas"       },
    { id: "in_progress", label: "In Progress"  },
    { id: "scheduled",   label: "Scheduled"   },
    { id: "published",   label: "Published"   },
    { id: "completed",   label: "Completed"   },
    { id: "money_task",  label: "Money Task"  },
  ],
};

const PROJECT_COLUMNS = [
  { id: "backlog",               label: "Backlog"               },
  { id: "in_progress",           label: "In Progress"           },
  { id: "waiting_on_customer",   label: "Waiting on Customer"   },
  { id: "completed",             label: "Completed"             },
];

/**
 * GET /api/admin/kanban/boards
 * Returns the Marketing Kanban board plus all active project boards.
 */
router.get("/admin/kanban/boards", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const projects = await db
      .select({ id: projectsTable.id, title: projectsTable.title })
      .from(projectsTable)
      .where(eq(projectsTable.status, "active"))
      .orderBy(projectsTable.title);

    const projectBoards = projects.map(p => ({
      id: String(p.id),
      name: p.title,
    }));

    res.json([
      { id: MARKETING_BOARD.id, name: MARKETING_BOARD.name },
      ...projectBoards,
    ]);
  } catch (err) {
    logger.error({ err }, "admin-kanban: failed to list boards");
    res.status(500).json({ error: "Failed to list boards" });
  }
});

/**
 * GET /api/admin/kanban/:boardId/columns
 * Returns the columns/statuses for a given board.
 * boardId "marketing" → marketing status enum values
 * numeric boardId     → project kanban column enum values
 */
router.get("/admin/kanban/:boardId/columns", requireAdmin, async (req: Request, res: Response) => {
  const { boardId } = req.params as { boardId: string };
  if (boardId === "marketing") {
    res.json(MARKETING_BOARD.columns);
    return;
  }
  const projectId = parseInt(boardId, 10);
  if (isNaN(projectId)) {
    res.status(400).json({ error: "Invalid boardId — must be 'marketing' or a numeric project ID" });
    return;
  }
  res.json(PROJECT_COLUMNS);
});

export default router;
