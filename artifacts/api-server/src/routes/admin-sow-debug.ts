import { Router, type IRouter, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { db, usersTable, projectsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";
import { generateConsolidatedSowDocument } from "../lib/consolidated-sow-generator";
import { getSowDebugRun, listSowDebugRuns } from "../lib/sow-debug-log-buffer";

const router: IRouter = Router();

// ── GET /admin/sow-debug/clients ─────────────────────────────────────────────
// Client + project picker data for the SOW Generation Debug page.
router.get("/admin/sow-debug/clients", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const clients = await db
      .select({
        id: usersTable.id,
        name: usersTable.name,
        email: usersTable.email,
        company: usersTable.company,
      })
      .from(usersTable)
      .where(eq(usersTable.role, "client"))
      .orderBy(desc(usersTable.createdAt));

    const projects = await db
      .select({
        id: projectsTable.id,
        title: projectsTable.title,
        clientUserId: projectsTable.clientUserId,
      })
      .from(projectsTable);

    const projectsByClient = new Map<number, Array<{ id: number; title: string }>>();
    for (const p of projects) {
      if (p.clientUserId == null) continue;
      const list = projectsByClient.get(p.clientUserId) ?? [];
      list.push({ id: p.id, title: p.title });
      projectsByClient.set(p.clientUserId, list);
    }

    res.json({
      clients: clients.map(c => ({
        ...c,
        projects: projectsByClient.get(c.id) ?? [],
      })),
    });
  } catch (err) {
    logger.error({ err }, "admin-sow-debug: failed to load clients");
    res.status(500).json({ error: "Failed to load clients" });
  }
});

// ── POST /admin/sow-debug/generate ───────────────────────────────────────────
// Runs a full, non-persisted (testMode) SOW generation and returns the HTML plus
// a correlationId used to fetch captured signal/log detail via GET /runs/:id.
router.post("/admin/sow-debug/generate", requireAdmin, async (req: Request, res: Response) => {
  const { clientUserId, projectId, title } = req.body as {
    clientUserId?: number;
    projectId?: number | null;
    title?: string;
  };
  if (!clientUserId || typeof clientUserId !== "number") {
    res.status(400).json({ error: "clientUserId is required" });
    return;
  }

  const correlationId = randomUUID();
  try {
    const result = await generateConsolidatedSowDocument({
      clientUserId,
      projectId: projectId ?? null,
      title: title?.trim() || "Statement of Work (Debug)",
      runId: correlationId,
      testMode: true,
    });
    res.json({
      correlationId,
      htmlContent: result.htmlContent ?? "",
      sowTotal: result.sowTotal,
      clientName: result.clientName,
    });
  } catch (err) {
    logger.error({ err, clientUserId, projectId, correlationId }, "admin-sow-debug: generation failed");
    res.status(500).json({
      error: err instanceof Error ? err.message : "SOW generation failed",
      correlationId,
    });
  }
});

// ── GET /admin/sow-debug/runs/:correlationId ─────────────────────────────────
// Returns the captured signal snapshot + step logs for a prior debug generation run.
router.get("/admin/sow-debug/runs/:correlationId", requireAdmin, (req: Request, res: Response) => {
  const { correlationId } = req.params;
  const run = getSowDebugRun(String(correlationId ?? ""));
  if (!run) {
    res.status(404).json({ error: "Run not found — it may have expired from the in-memory buffer" });
    return;
  }
  res.json({ run });
});

// ── GET /admin/sow-debug/runs ─────────────────────────────────────────────────
// Lists recent runs (most recent first) for a quick history dropdown.
router.get("/admin/sow-debug/runs", requireAdmin, (_req: Request, res: Response) => {
  res.json({ runs: listSowDebugRuns() });
});

export default router;
