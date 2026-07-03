import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  usersTable,
  projectsTable,
  kanbanTasksTable,
  emailsTable,
  clientM365ProfilesTable,
  clientAppRegistrationsTable,
  quizLeadsTable,
  clientHealthHistoryTable,
  azureTenantCredentialsTable,
} from "@workspace/db";
import { eq, and, desc, count, inArray, sql, isNotNull, isNull, asc } from "drizzle-orm";
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

    const [projectRows, taskRows, quizRows, m365Rows, lastEmailRows, lastTaskRows, appRegRows] = await Promise.all([
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
          categoryScores: quizLeadsTable.categoryScores,
          quizType: quizLeadsTable.quizType,
          createdAt: quizLeadsTable.createdAt,
        })
        .from(quizLeadsTable)
        .where(inArray(quizLeadsTable.email, clientEmails))
        .orderBy(desc(quizLeadsTable.createdAt)),

      db
        .select({
          clientId: clientM365ProfilesTable.clientId,
          profile: clientM365ProfilesTable.profile,
        })
        .from(clientM365ProfilesTable)
        .where(inArray(clientM365ProfilesTable.clientId, clientIds)),

      db
        .select({
          linkedUserId: emailsTable.linkedUserId,
          lastAt: sql<string>`MAX(${emailsTable.receivedAt})`,
        })
        .from(emailsTable)
        .where(and(isNotNull(emailsTable.linkedUserId), inArray(emailsTable.linkedUserId, clientIds)))
        .groupBy(emailsTable.linkedUserId),

      db
        .select({
          clientUserId: projectsTable.clientUserId,
          lastAt: sql<string>`MAX(${kanbanTasksTable.updatedAt})`,
        })
        .from(kanbanTasksTable)
        .innerJoin(projectsTable, eq(kanbanTasksTable.projectId, projectsTable.id))
        .where(inArray(projectsTable.clientUserId, clientIds))
        .groupBy(projectsTable.clientUserId),

      db
        .select({
          clientUserId: clientAppRegistrationsTable.clientUserId,
          status: clientAppRegistrationsTable.status,
        })
        .from(clientAppRegistrationsTable)
        .where(inArray(clientAppRegistrationsTable.clientUserId, clientIds)),
    ]);

    const projectMap = new Map(projectRows.map(p => [p.clientUserId, p]));
    const taskMap = new Map(taskRows.map(t => [t.clientUserId, t]));
    const quizMap = new Map<string, (typeof quizRows)[0]>();
    for (const q of quizRows) {
      if (!quizMap.has(q.email)) quizMap.set(q.email, q);
    }
    const m365Map = new Map(m365Rows.map(r => [r.clientId, r.profile as Record<string, unknown>]));
    const lastEmailMap = new Map(lastEmailRows.map(r => [r.linkedUserId, r.lastAt]));
    const lastTaskMap = new Map(lastTaskRows.map(r => [r.clientUserId, r.lastAt]));
    const appRegMap = new Map(appRegRows.map(r => [r.clientUserId, r.status as "pending" | "submitted" | "verified"]));

    const enriched = clients.map(c => {
      const proj = projectMap.get(c.id);
      const tasks = taskMap.get(c.id);
      const quiz = quizMap.get(c.email);
      const mp = m365Map.get(c.id) ?? {};
      const appRegStatus = appRegMap.get(c.id) ?? null;
      const hasM365Profile = m365Map.has(c.id);
      const cs = (quiz?.categoryScores ?? {}) as Record<string, number>;

      // Compute seven scores from quiz category scores + m365 profile
      const governanceScore = typeof cs.changeManagement === "number" ? cs.changeManagement : null;
      const securityScore = typeof cs.infrastructure === "number" ? cs.infrastructure : null;
      const complianceScore = typeof cs.data === "number" ? cs.data : null;
      const copilotReadinessScore = typeof cs.aiLiteracy === "number" ? cs.aiLiteracy : null;
      const powerPlatformScore = typeof cs.businessProcess === "number" ? cs.businessProcess : null;
      const externalSharingScore = mp.externalSharingEnabled === false ? 90 : mp.externalSharingEnabled === true ? 45 : null;
      const shadowItScore = typeof mp.currentAITools === "string" && (mp.currentAITools as string).trim() ? 55 : typeof mp.currentAITools === "string" ? 80 : null;

      // Extract M365 profile header fields
      const industry = typeof mp.industry === "string" && mp.industry ? mp.industry : null;
      const licenseTier = typeof mp.licenseTier === "string" && mp.licenseTier ? mp.licenseTier :
        Array.isArray(mp.licenseSKUs) ? ((mp.licenseSKUs as string[])[0] ?? null) : null;
      const employeeCount = typeof mp.employeeCount === "number" ? mp.employeeCount :
        typeof mp.employeeCount === "string" ? parseInt(mp.employeeCount as string, 10) || null : null;
      const tenantAge = typeof mp.tenantAge === "number" ? mp.tenantAge : null;
      const itTeamSize = typeof mp.itTeamSize === "number" ? mp.itTeamSize : null;

      // Last activity = max(latest email, latest task)
      const lastEmailAt = lastEmailMap.get(c.id) ?? null;
      const lastTaskAt = lastTaskMap.get(c.id) ?? null;
      const lastActivityAt = lastEmailAt && lastTaskAt
        ? (new Date(lastEmailAt) > new Date(lastTaskAt) ? lastEmailAt : lastTaskAt)
        : lastEmailAt ?? lastTaskAt;

      // AI risk level (based on governance/security/compliance scores)
      const riskScores = [governanceScore, securityScore, complianceScore].filter((s): s is number => s !== null);
      const aiRiskLevel: "high" | "medium" | "low" | null = riskScores.length === 0 ? null :
        riskScores.some(s => s < 40) ? "high" :
        riskScores.some(s => s < 70) ? "medium" : "low";

      // AI opportunity level (based on copilot/power platform scores)
      const oppScores = [copilotReadinessScore, powerPlatformScore].filter((s): s is number => s !== null);
      const aiOpportunityLevel: "high" | "medium" | "low" | null = oppScores.length === 0 ? null :
        oppScores.some(s => s >= 70) ? "high" :
        oppScores.some(s => s >= 40) ? "medium" : "low";

      return {
        ...c,
        passwordHash: undefined,
        projectCount: Number(proj?.total ?? 0),
        activeProjectCount: Number(proj?.active ?? 0),
        openTaskCount: Number(tasks?.openTasks ?? 0),
        quizScore: quiz?.totalScore ?? null,
        quizTier: quiz?.tier ?? null,
        industry,
        licenseTier,
        employeeCount,
        tenantAge,
        itTeamSize,
        governanceScore,
        securityScore,
        complianceScore,
        copilotReadinessScore,
        powerPlatformScore,
        externalSharingScore,
        shadowItScore,
        lastActivityAt,
        aiRiskLevel,
        aiOpportunityLevel,
        appRegStatus,
        hasM365Profile,
      };
    });

    res.json(enriched);
  } catch (err) {
    logger.error({ err }, "Failed to fetch enriched clients");
    res.status(500).json({ error: "Failed to fetch clients" });
  }
});

// ─── GET /admin/clients/with-azure-credentials ───────────────────────────────
// Returns ALL clients (role=client), each with their linked App Registration
// (or null if none). The legacy `azureTenantCredentialsTable` fallback has been
// removed — only App Registrations submitted by clients appear here.
router.get("/admin/clients/with-azure-credentials", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const rows = await db
      .select({
        id: usersTable.id,
        name: usersTable.name,
        email: usersTable.email,
        appRegId: clientAppRegistrationsTable.id,
        appRegTenantId: clientAppRegistrationsTable.tenantId,
        appRegAzureClientId: clientAppRegistrationsTable.azureClientId,
        appRegKeyVaultSecretName: clientAppRegistrationsTable.keyVaultSecretName,
        appRegStatus: clientAppRegistrationsTable.status,
      })
      .from(usersTable)
      .leftJoin(
        clientAppRegistrationsTable,
        eq(clientAppRegistrationsTable.clientUserId, usersTable.id),
      )
      .where(eq(usersTable.role, "client"))
      .orderBy(asc(usersTable.name));

    const result = rows.map(r => ({
      id: r.id,
      name: r.name,
      email: r.email,
      appRegistration: r.appRegId != null
        ? {
            id: r.appRegId,
            tenantId: r.appRegTenantId,
            azureClientId: r.appRegAzureClientId,
            keyVaultSecretName: r.appRegKeyVaultSecretName,
            status: r.appRegStatus,
          }
        : null,
    }));

    res.json(result);
  } catch (err) {
    logger.error({ err }, "Failed to fetch clients with azure credentials");
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

    const [projects, recentTasks, recentEmails, quizRows, m365Rows, appRegRows] = await Promise.all([
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
        .limit(10),

      db
        .select()
        .from(clientM365ProfilesTable)
        .where(eq(clientM365ProfilesTable.clientId, id))
        .limit(1),

      db
        .select({
          status: clientAppRegistrationsTable.status,
        })
        .from(clientAppRegistrationsTable)
        .where(eq(clientAppRegistrationsTable.clientUserId, id))
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

    const appRegStatus = (appRegRows[0]?.status ?? null) as "pending" | "submitted" | "verified" | null;
    const hasM365Profile = m365Rows.length > 0;

    res.json({
      client: { ...client, passwordHash: undefined, appRegStatus, hasM365Profile },
      projects: projects.map(p => ({
        ...p,
        taskCounts: taskCountsPerProject[p.id] ?? { total: 0, open: 0 },
      })),
      recentTasks,
      recentEmails,
      quiz: quizRows[0] ?? null,
      quizzes: quizRows,
      m365Profile: m365Rows[0]?.profile ?? null,
      appRegStatus,
      hasM365Profile,
    });
  } catch (err) {
    logger.error({ err }, "Failed to fetch client command center");
    res.status(500).json({ error: "Failed to fetch client data" });
  }
});

// ─── GET /admin/clients/:id/quiz-results ─────────────────────────────────────
// Returns all completed quiz submissions for a specific client (matched by email).
router.get("/admin/clients/:id/quiz-results", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params["id"] ?? ""), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

    const [client] = await db
      .select({ email: usersTable.email })
      .from(usersTable)
      .where(and(eq(usersTable.id, id), eq(usersTable.role, "client")))
      .limit(1);

    if (!client) { res.status(404).json({ error: "Client not found" }); return; }

    const quizRows = await db
      .select({
        id: quizLeadsTable.id,
        quizType: quizLeadsTable.quizType,
        totalScore: quizLeadsTable.totalScore,
        tier: quizLeadsTable.tier,
        categoryScores: quizLeadsTable.categoryScores,
        createdAt: quizLeadsTable.createdAt,
      })
      .from(quizLeadsTable)
      .where(eq(quizLeadsTable.email, client.email))
      .orderBy(desc(quizLeadsTable.createdAt));

    res.json(quizRows);
  } catch (err) {
    logger.error({ err }, "Failed to fetch client quiz results");
    res.status(500).json({ error: "Failed to fetch quiz results" });
  }
});

// ─── GET /admin/clients/:id/health/summary ────────────────────────────────────
// Returns the same health summary shape as /portal/health/summary but for any
// client (admin-scoped, Bearer password auth).
router.get("/admin/clients/:id/health/summary", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid client id" }); return; }

  const ALL_CATEGORY_LABELS: Record<string, string> = {
    security: "Security Posture",
    compliance: "Compliance Coverage",
    copilot: "Copilot Readiness",
    governance: "Governance Maturity",
    productivity: "Adoption Score",
    identity: "Identity Protection",
    collaboration: "Collaboration Score",
    data: "Data Governance",
  };

  try {
    const rows = await db
      .select({
        category: clientHealthHistoryTable.category,
        score: clientHealthHistoryTable.score,
        recordedAt: clientHealthHistoryTable.recordedAt,
        sourceKanbanTaskId: clientHealthHistoryTable.sourceKanbanTaskId,
      })
      .from(clientHealthHistoryTable)
      .where(eq(clientHealthHistoryTable.clientId, id))
      .orderBy(asc(clientHealthHistoryTable.recordedAt));

    if (rows.length === 0) {
      res.json({ hasData: false });
      return;
    }

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const allCats = [...new Set(rows.map(r => r.category))].sort();

    const categories = allCats.map(cat => {
      const catRows = rows.filter(r => r.category === cat);
      const first = catRows[0].score;
      const latest = catRows[catRows.length - 1].score;
      const recentRows = catRows.filter(r => r.recordedAt >= thirtyDaysAgo);
      const hasAlert = recentRows.length >= 2 &&
        Math.abs(recentRows[recentRows.length - 1].score - recentRows[0].score) >= 10;
      return { key: cat, label: ALL_CATEGORY_LABELS[cat] ?? cat, firstScore: first, latestScore: latest, delta: latest - first, hasAlert };
    });

    const overallFirst = categories.length > 0
      ? Math.round(categories.reduce((s, c) => s + c.firstScore, 0) / categories.length)
      : 0;
    const overallLatest = categories.length > 0
      ? Math.round(categories.reduce((s, c) => s + c.latestScore, 0) / categories.length)
      : 0;

    // Resolve kanban task titles for any automation-triggered snapshots.
    const sourceTaskIdSet = new Set<number>(
      rows.map(r => r.sourceKanbanTaskId).filter((sid): sid is number => sid != null)
    );
    const taskTitleMap = new Map<number, string>();
    if (sourceTaskIdSet.size > 0) {
      const taskRows = await db
        .select({ id: kanbanTasksTable.id, title: kanbanTasksTable.title })
        .from(kanbanTasksTable)
        .where(inArray(kanbanTasksTable.id, [...sourceTaskIdSet]));
      for (const t of taskRows) taskTitleMap.set(t.id, t.title);
    }

    const dayMap = new Map<string, { scores: number[]; sourceKanbanTaskId: number | null }>();
    for (const row of rows) {
      const day = row.recordedAt.toISOString().slice(0, 10);
      if (!dayMap.has(day)) dayMap.set(day, { scores: [], sourceKanbanTaskId: null });
      const entry = dayMap.get(day)!;
      entry.scores.push(row.score);
      if (row.sourceKanbanTaskId != null && entry.sourceKanbanTaskId == null) {
        entry.sourceKanbanTaskId = row.sourceKanbanTaskId;
      }
    }
    const timeSeries = Array.from(dayMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, entry]) => ({
        date,
        score: Math.round(entry.scores.reduce((a, b) => a + b, 0) / entry.scores.length),
        sourceTaskId: entry.sourceKanbanTaskId ?? null,
        sourceTaskTitle: entry.sourceKanbanTaskId != null ? (taskTitleMap.get(entry.sourceKanbanTaskId) ?? null) : null,
      }));

    const lastUpdated = rows[rows.length - 1].recordedAt.toISOString();

    res.json({
      hasData: true,
      overallFirst,
      overallLatest,
      overallDelta: overallLatest - overallFirst,
      lastUpdated,
      timeSeries,
      categories,
    });
  } catch (err) {
    logger.error({ err }, "Failed to fetch client health summary");
    res.status(500).json({ error: "Failed to fetch health summary" });
  }
});

// DELETE /api/admin/clients/:id/health-history — wipe all health history for a client
// (resets their /portal/onboarding/results page to the empty state)
router.delete("/admin/clients/:id/health-history", requireAdmin, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid client ID" });
    return;
  }
  try {
    const deleted = await db
      .delete(clientHealthHistoryTable)
      .where(eq(clientHealthHistoryTable.clientId, id))
      .returning({ id: clientHealthHistoryTable.id });
    req.log.info({ clientId: id, deletedCount: deleted.length }, "admin: cleared client health history");
    res.json({ deleted: deleted.length });
  } catch (err) {
    req.log.error({ err }, "admin/clients/:id/health-history DELETE failed");
    res.status(500).json({ error: "Failed to clear health history" });
  }
});

export default router;
