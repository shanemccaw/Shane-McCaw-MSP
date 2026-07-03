/**
 * admin-stalled-scripts.ts
 *
 * GET /api/admin/kanban/stalled-scripts
 *   Returns all kanban task cards that have exhausted the auto-fire retry budget
 *   (completionStatus in ["auto_fire_exhausted", "auto_fire_failed"]).
 *   Each entry includes the project title and client name so the dashboard
 *   widget can link directly to the right kanban board.
 *
 *   Protected by the admin password header.
 */

import { Router, type Request, type Response } from "express";
import { db, kanbanTasksTable, projectsTable, usersTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";

const router = Router();

const STALLED_STATUSES = ["auto_fire_exhausted", "auto_fire_failed"] as const;

router.get(
  "/admin/kanban/stalled-scripts",
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const rows = await db
        .select({
          id: kanbanTasksTable.id,
          title: kanbanTasksTable.title,
          completionStatus: kanbanTasksTable.completionStatus,
          completionNotes: kanbanTasksTable.completionNotes,
          column: kanbanTasksTable.column,
          updatedAt: kanbanTasksTable.updatedAt,
          projectId: kanbanTasksTable.projectId,
          projectTitle: projectsTable.title,
          clientName: usersTable.name,
          clientEmail: usersTable.email,
        })
        .from(kanbanTasksTable)
        .leftJoin(projectsTable, eq(kanbanTasksTable.projectId, projectsTable.id))
        .leftJoin(usersTable, eq(projectsTable.clientUserId, usersTable.id))
        .where(inArray(kanbanTasksTable.completionStatus, [...STALLED_STATUSES]))
        .orderBy(kanbanTasksTable.updatedAt);

      res.json({
        count: rows.length,
        cards: rows.map(r => ({
          id: r.id,
          title: r.title,
          completionStatus: r.completionStatus,
          completionNotes: r.completionNotes,
          column: r.column,
          updatedAt: r.updatedAt.toISOString(),
          projectId: r.projectId,
          projectTitle: r.projectTitle ?? null,
          clientName: r.clientName ?? r.clientEmail?.split("@")[0] ?? null,
        })),
      });
    } catch (err) {
      logger.error({ err }, "admin-stalled-scripts: failed to fetch stalled cards");
      res.status(500).json({ error: "Failed to fetch stalled script cards" });
    }
  },
);

export default router;
