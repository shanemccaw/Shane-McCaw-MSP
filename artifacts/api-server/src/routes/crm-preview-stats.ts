import { Router, type Request, type Response } from "express";
import {
  db, usersTable, clientServicesTable, projectsTable,
} from "@workspace/db";
import { eq, count } from "drizzle-orm";

const router = Router();

router.get("/crm/preview-stats", async (_req: Request, res: Response) => {
  try {
    const [
      clientRows,
      activeServiceRows,
      totalServiceRows,
      plannedRows,
      inProgressRows,
      doneRows,
      totalProjectRows,
    ] = await Promise.all([
      db.select({ n: count() }).from(usersTable).where(eq(usersTable.role, "client")),
      db.select({ n: count() }).from(clientServicesTable).where(eq(clientServicesTable.status, "active")),
      db.select({ n: count() }).from(clientServicesTable),
      db.select({ n: count() }).from(projectsTable).where(eq(projectsTable.status, "on_hold")),
      db.select({ n: count() }).from(projectsTable).where(eq(projectsTable.status, "active")),
      db.select({ n: count() }).from(projectsTable).where(eq(projectsTable.status, "completed")),
      db.select({ n: count() }).from(projectsTable),
    ]);

    const clientCount = Number(clientRows[0]?.n ?? 0);
    const activeServiceCount = Number(activeServiceRows[0]?.n ?? 0);
    const totalServiceCount = Number(totalServiceRows[0]?.n ?? 0);
    const planned = Number(plannedRows[0]?.n ?? 0);
    const inProgress = Number(inProgressRows[0]?.n ?? 0);
    const done = Number(doneRows[0]?.n ?? 0);
    const totalProjects = Number(totalProjectRows[0]?.n ?? 0);

    const completionPct = totalProjects > 0
      ? Math.round((done / totalProjects) * 100)
      : null;

    const servicePct = totalServiceCount > 0
      ? Math.round((activeServiceCount / totalServiceCount) * 100)
      : null;

    res.json({
      clientCount,
      activeServiceCount,
      completionPct,
      servicePct,
      projectCounts: {
        planned,
        inProgress,
        done,
        total: planned + inProgress + done,
      },
    });
  } catch {
    res.status(500).json({ error: "Failed to fetch preview stats" });
  }
});

export default router;
