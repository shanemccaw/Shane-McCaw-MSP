import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  usersTable,
  projectsTable,
  kanbanTasksTable,
  emailsTable,
  clientM365ProfilesTable,
  quizLeadsTable,
} from "@workspace/db";
import { eq, and, desc, count, inArray, sql } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ─── GET /admin/clients/enriched ─────────────────────────────────────────────
// Returns all clients with project counts, open task counts, and quiz scores.
router.get("/admin/clients/enriched", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const clients = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.role, "client"))
      .orderBy(desc(usersTable.createdAt));

    if (clients.length === 0) {
      res.json([]);
      return;
    }

    const clientIds = clients.map(c => c.id).filter((id): id is number => id !== null);
    const clientEmails = clients.map(c => c.email);

    const [projectRows, taskRows, quizRows] = await Promise.all([
      db
        .select({
          clientUserId: projectsTable.clientUserId,
          total: count(),
          active: sql<number>`COUNT(*) FILTER (WHERE ${projectsTable.status} = 'active')`,
        })
        .from(projectsTable)
        .where(inArray(projectsTable.clientUserId, clientIds))
        .groupBy(projectsTable.clientUserId),

      db
        .select({
          clientUserId: projectsTable.clientUserId,
          openTasks: count(),
        })
        .from(kanbanTasksTable)
        .innerJoin(projectsTable, eq(kanbanTasksTable.projectId, projectsTable.id))
        .where(
          and(
            inArray(projectsTable.clientUserId, clientIds),
            inArray(kanbanTasksTable.column, ["backlog", "in_progress", "waiting_on_customer"])
          )
        )
        .groupBy(projectsTable.clientUserId),

      db
        .select({
          email: quizLeadsTable.email,
          totalScore: quizLeadsTable.totalScore,
          tier: quizLeadsTable.tier,
          createdAt: quizLeadsTable.createdAt,
        })
        .from(quizLeadsTable)
        .where(inArray(quizLeadsTable.email, clientEmails))
        .orderBy(desc(quizLeadsTable.createdAt)),
    ]);

    const projectMap = new Map(projectRows.map(p => [p.clientUserId, p]));
    const taskMap = new Map(taskRows.map(t => [t.clientUserId, t]));
    const quizMap = new Map<string, (typeof quizRows)[0]>();
    for (const q of quizRows) {
      if (!quizMap.has(q.email)) quizMap.set(q.email, q);
    }

    const enriched = clients.map(c => {
      const proj = projectMap.get(c.id);
      const tasks = taskMap.get(c.id);
      const quiz = quizMap.get(c.email);
      return {
        ...c,
        passwordHash: undefined,
        projectCount: Number(proj?.total ?? 0),
        activeProjectCount: Number(proj?.active ?? 0),
        openTaskCount: Number(tasks?.openTasks ?? 0),
        quizScore: quiz?.totalScore ?? null,
        quizTier: quiz?.tier ?? null,
      };
    });

    res.json(enriched);
  } catch (err) {
    logger.error({ err }, "Failed to fetch enriched clients");
    res.status(500).json({ error: "Failed to fetch clients" });
  }
});

// ─── GET /admin/clients/:id/command-center ────────────────────────────────────
// Full detail payload for the client command center view.
router.get("/admin/clients/:id/command-center", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params["id"] ?? ""), 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid ID" });
      return;
    }

    const [client] = await db
      .select()
      .from(usersTable)
      .where(and(eq(usersTable.id, id), eq(usersTable.role, "client")))
      .limit(1);

    if (!client) {
      res.status(404).json({ error: "Client not found" });
      return;
    }

    const [projects, recentTasks, recentEmails, quizRows, m365Rows] = await Promise.all([
      db
        .select({
          id: projectsTable.id,
          title: projectsTable.title,
          status: projectsTable.status,
          phase: projectsTable.phase,
          progress: projectsTable.progress,
          projectType: projectsTable.projectType,
          startDate: projectsTable.startDate,
          endDate: projectsTable.endDate,
          updatedAt: projectsTable.updatedAt,
          createdAt: projectsTable.createdAt,
        })
        .from(projectsTable)
        .where(eq(projectsTable.clientUserId, id))
        .orderBy(desc(projectsTable.updatedAt))
        .limit(20),

      db
        .select({
          id: kanbanTasksTable.id,
          title: kanbanTasksTable.title,
          column: kanbanTasksTable.column,
          priority: kanbanTasksTable.priority,
          dueDate: kanbanTasksTable.dueDate,
          projectId: kanbanTasksTable.projectId,
          projectTitle: projectsTable.title,
          updatedAt: kanbanTasksTable.updatedAt,
        })
        .from(kanbanTasksTable)
        .innerJoin(projectsTable, eq(kanbanTasksTable.projectId, projectsTable.id))
        .where(eq(projectsTable.clientUserId, id))
        .orderBy(desc(kanbanTasksTable.updatedAt))
        .limit(12),

      db
        .select({
          id: emailsTable.id,
          subject: emailsTable.subject,
          senderAddress: emailsTable.senderAddress,
          receivedAt: emailsTable.receivedAt,
          bodyPreview: emailsTable.bodyPreview,
        })
        .from(emailsTable)
        .where(eq(emailsTable.linkedUserId, id))
        .orderBy(desc(emailsTable.receivedAt))
        .limit(6),

      db
        .select()
        .from(quizLeadsTable)
        .where(eq(quizLeadsTable.email, client.email))
        .orderBy(desc(quizLeadsTable.createdAt))
        .limit(1),

      db
        .select()
        .from(clientM365ProfilesTable)
        .where(eq(clientM365ProfilesTable.clientId, id))
        .limit(1),
    ]);

    const projectIds = projects.map(p => p.id);
    const taskCountsPerProject: Record<number, { total: number; open: number }> = {};

    if (projectIds.length > 0) {
      const taskCounts = await db
        .select({
          projectId: kanbanTasksTable.projectId,
          column: kanbanTasksTable.column,
          cnt: count(),
        })
        .from(kanbanTasksTable)
        .where(inArray(kanbanTasksTable.projectId, projectIds))
        .groupBy(kanbanTasksTable.projectId, kanbanTasksTable.column);

      for (const row of taskCounts) {
        if (!taskCountsPerProject[row.projectId]) {
          taskCountsPerProject[row.projectId] = { total: 0, open: 0 };
        }
        taskCountsPerProject[row.projectId].total += Number(row.cnt);
        if (row.column !== "completed") {
          taskCountsPerProject[row.projectId].open += Number(row.cnt);
        }
      }
    }

    res.json({
      client: { ...client, passwordHash: undefined },
      projects: projects.map(p => ({
        ...p,
        taskCounts: taskCountsPerProject[p.id] ?? { total: 0, open: 0 },
      })),
      recentTasks,
      recentEmails,
      quiz: quizRows[0] ?? null,
      m365Profile: m365Rows[0]?.profile ?? null,
    });
  } catch (err) {
    logger.error({ err }, "Failed to fetch client command center");
    res.status(500).json({ error: "Failed to fetch client data" });
  }
});

export default router;
