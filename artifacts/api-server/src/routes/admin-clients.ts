import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  usersTable,
  projectsTable,
  kanbanTasksTable,
  emailsTable,
  clientM365ProfilesTable,
  clientAppRegistrationsTable,
  // #135 (Decommission Legacy CRM Phase A): quiz results are read from
  // `lead_staging` (#83's unified pre-Zoho table), not the legacy `quiz_leads`.
  // `lead_staging` also holds non-quiz leads (contact form, purchase, …), so
  // every query below filters on `quizType IS NOT NULL` — without it a
  // contact-form lead would surface as a quiz result with totalScore 0.
  // Identity is the normalised email, per #81's resolution path: `lead_staging`
  // has no user/tenant FK at all.
  leadStagingTable,
  clientHealthHistoryTable,
  azureTenantCredentialsTable,
  accountSetupTokensTable,
  invoicesTable,
  contractsTable,
  messagesTable,
  clientServicesTable,
  reportsTable,
  statusReportsTable,
  scriptRunResultsTable,
  quizLeadsTable,
  insightsGeneratedDocumentsTable,
  projectUpdatesTable,
  documentsTable,
  workflowStepsTable,
  notificationsTable,
  impersonationTokensTable,
  passwordResetTokensTable,
  emailDomainRulesTable,
  clientDocumentsTable,
  mfaEnrollmentsTable,
  mfaChallengesTable,
  webauthnCredentialsTable,
  webauthnChallengesTable,
} from "@workspace/db";
import { eq, and, desc, count, inArray, sql, isNotNull, isNull, asc } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";
import { getSecretValue, getSecretMetadata } from "../lib/azure-keyvault";
import { testClientCredentials } from "../lib/azure-credentials";
import { createAuditLog } from "../lib/audit";
import { sendEmail, sendEmailFromTemplate, brandedEmail, appRegExpiryAlertEmail } from "../lib/mailer";
import { mtAppCredentialsPresent, createConsentInviteForEmail } from "../lib/consent-invite";
import { buildAccountSetupUrl, getMspPortalBaseUrl } from "../lib/portal-url";
import { getStripeKey } from "../lib/stripe";
import { generateM365ProfilePdf } from "../lib/m365-profile-pdf";

const router: IRouter = Router();
const log = logger.child({ channel: "admin.clients" });

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
          email: leadStagingTable.email,
          totalScore: leadStagingTable.totalScore,
          tier: leadStagingTable.tier,
          categoryScores: leadStagingTable.categoryScores,
          quizType: leadStagingTable.quizType,
          createdAt: leadStagingTable.createdAt,
        })
        .from(leadStagingTable)
        .where(and(
          inArray(leadStagingTable.email, clientEmails),
          isNotNull(leadStagingTable.quizType),
        ))
        .orderBy(desc(leadStagingTable.createdAt)),

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
    log.error({ err }, "Failed to fetch enriched clients");
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
    log.error({ err }, "Failed to fetch clients with azure credentials");
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
        .from(leadStagingTable)
        .where(and(
          eq(leadStagingTable.email, client.email),
          isNotNull(leadStagingTable.quizType),
        ))
        .orderBy(desc(leadStagingTable.createdAt))
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
    log.error({ err }, "Failed to fetch client command center");
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
        id: leadStagingTable.id,
        quizType: leadStagingTable.quizType,
        totalScore: leadStagingTable.totalScore,
        tier: leadStagingTable.tier,
        categoryScores: leadStagingTable.categoryScores,
        createdAt: leadStagingTable.createdAt,
      })
      .from(leadStagingTable)
      .where(and(
        eq(leadStagingTable.email, client.email),
        isNotNull(leadStagingTable.quizType),
      ))
      .orderBy(desc(leadStagingTable.createdAt));

    res.json(quizRows);
  } catch (err) {
    log.error({ err }, "Failed to fetch client quiz results");
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
    log.error({ err }, "Failed to fetch client health summary");
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

function m365BoolScore(fields: (boolean | undefined)[]): number {
  if (fields.length === 0) return 0;
  return Math.round((fields.filter(f => f === true).length / fields.length) * 100);
}

type M365ScoreCategory = "security" | "compliance" | "copilot" | "governance" | "productivity";

function computeM365Scores(profile: Record<string, unknown>): Record<M365ScoreCategory, number> {
  const v = profile as {
    mfaEnforced?: boolean; conditionalAccessEnabled?: boolean; intuneEnabled?: boolean;
    hasAADP1orP2?: boolean; hasDefender?: boolean; hasDLP?: boolean; usesComplianceCenter?: boolean;
    sensitivityLabelsConfigured?: boolean; hasRetentionPolicies?: boolean; hasInsiderRisk?: boolean;
    hasCopilotLicenses?: boolean; activeUserPercent?: string; allUsersLicensed?: boolean;
  };
  const pct = parseInt(v.activeUserPercent ?? "0", 10);
  return {
    security: m365BoolScore([v.mfaEnforced, v.conditionalAccessEnabled, v.intuneEnabled, v.hasAADP1orP2, v.hasDefender, v.hasDLP, v.usesComplianceCenter, v.sensitivityLabelsConfigured, v.hasRetentionPolicies]),
    compliance: m365BoolScore([v.hasDLP, v.usesComplianceCenter, v.sensitivityLabelsConfigured, v.hasRetentionPolicies, v.hasInsiderRisk]),
    copilot: m365BoolScore([v.hasCopilotLicenses, v.mfaEnforced, v.sensitivityLabelsConfigured, v.hasDLP, v.hasRetentionPolicies]),
    governance: m365BoolScore([v.hasRetentionPolicies, v.sensitivityLabelsConfigured, v.usesComplianceCenter, v.conditionalAccessEnabled]),
    productivity: Math.min((isNaN(pct) ? 60 : pct) + (v.allUsersLicensed ? 10 : 0), 100),
  };
}

router.patch("/admin/clients/:id/app-registration", requireAdmin, async (req: Request, res: Response) => {
  const clientId = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(clientId)) { res.status(400).json({ error: "Invalid client ID" }); return; }

  const { status } = req.body as { status?: string };
  if (status !== "verified" && status !== "submitted" && status !== "pending") {
    res.status(400).json({ error: "status must be pending, submitted, or verified" });
    return;
  }

  const now = new Date();
  const [existing] = await db.select().from(clientAppRegistrationsTable)
    .where(eq(clientAppRegistrationsTable.clientUserId, clientId));

  if (!existing) { res.status(404).json({ error: "No App Registration found for this client" }); return; }

  // Fetch client name for audit log label
  const [clientUser] = await db.select({ name: usersTable.name, email: usersTable.email })
    .from(usersTable).where(eq(usersTable.id, clientId)).limit(1);
  const clientLabel = clientUser?.name ?? clientUser?.email ?? String(clientId);

  // When marking as verified, test the credentials against Azure first
  if (status === "verified") {
    let testResult: { ok: true } | { ok: false; reason: string };
    try {
      const clientSecret = await getSecretValue(existing.keyVaultSecretName);
      testResult = await testClientCredentials(existing.tenantId, existing.azureClientId, clientSecret);
    } catch (err) {
      req.log.warn({ err, clientId }, "app-registration verify: failed to retrieve secret from Key Vault");
      res.status(503).json({ error: "Could not retrieve credentials from Key Vault. Check Key Vault access and try again." });
      return;
    }
    if (!testResult.ok) {
      req.log.warn({ clientId, reason: testResult.reason }, "app-registration verify: Azure credential test failed");
      void createAuditLog({
        actorUserId: req.user!.id,
        actorName: req.user!.name ?? req.user!.email,
        actorRole: "admin",
        actionType: "credential_verification_failed",
        entityType: "app_registration",
        entityId: clientId,
        entityLabel: clientLabel,
        clientId,
        metadata: {
          tenantId: existing.tenantId,
          azureClientId: existing.azureClientId,
          outcome: "failed",
          errorMessage: testResult.reason.slice(0, 500),
        },
      });
      res.status(400).json({ error: testResult.reason });
      return;
    }
  }

  const updates: Partial<typeof clientAppRegistrationsTable.$inferInsert> = {
    status: status as "pending" | "submitted" | "verified",
    updatedAt: now,
  };
  if (status === "verified") { updates.verifiedAt = now; updates.connectionTestedAt = now; }
  if (status !== "verified") updates.verifiedAt = null;

  await db.update(clientAppRegistrationsTable)
    .set(updates)
    .where(eq(clientAppRegistrationsTable.clientUserId, clientId));

  // After a successful verification, read the Key Vault secret expiry
  // and send Shane an email alert if it expires within 30 days.
  if (status === "verified") {
    void createAuditLog({
      actorUserId: req.user!.id,
      actorName: req.user!.name ?? req.user!.email,
      actorRole: "admin",
      actionType: "credential_verification_passed",
      entityType: "app_registration",
      entityId: clientId,
      entityLabel: clientLabel,
      clientId,
      metadata: {
        tenantId: existing.tenantId,
        azureClientId: existing.azureClientId,
        outcome: "passed",
        verifiedAt: now.toISOString(),
      },
    });

    try {
      const meta = await getSecretMetadata(existing.keyVaultSecretName);
      if (meta.expiresOn) {
        const daysLeft = Math.ceil((meta.expiresOn.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
        const EMAIL_ALERT_THRESHOLD_DAYS = 30;
        if (daysLeft <= EMAIL_ALERT_THRESHOLD_DAYS) {
          const adminEmail = process.env.ADMIN_EMAIL ?? process.env.CRM_ADMIN_EMAIL;
          if (adminEmail) {
            const adminPanelOrigin = process.env.REPLIT_DOMAINS
              ? `https://${process.env.REPLIT_DOMAINS.split(",")[0]}`
              : "http://localhost:80";
            const adminPanelUrl = `${adminPanelOrigin}/admin-panel/crm/clients/${clientId}`;
            const expiresOn = meta.expiresOn;
            void (async () => {
              const html = await brandedEmail(appRegExpiryAlertEmail({
                clientName: clientUser?.name ?? "",
                clientEmail: clientUser?.email ?? "",
                tenantId: existing.tenantId,
                azureClientId: existing.azureClientId,
                expiresOn,
                daysLeft,
                adminPanelUrl,
              }));
              await sendEmail(
                adminEmail,
                daysLeft <= 0
                  ? `⚠️ App Registration secret EXPIRED — ${clientLabel}`
                  : `⚠️ App Registration secret expiring in ${daysLeft} day${daysLeft !== 1 ? "s" : ""} — ${clientLabel}`,
                html,
                { skipWrapper: true },
              );
            })();
            req.log.info({ clientId, daysLeft }, "app-registration: sent expiry alert email to admin");
          }
        }
      }
    } catch (err) {
      req.log.warn({ err, clientId }, "app-registration: could not read secret metadata for expiry check");
    }
  }

  res.json({ ok: true, status });
});

router.get("/admin/clients/:id/app-registration", requireAdmin, async (req: Request, res: Response) => {
  const clientId = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(clientId)) { res.status(400).json({ error: "Invalid client ID" }); return; }

  const [row] = await db.select().from(clientAppRegistrationsTable)
    .where(eq(clientAppRegistrationsTable.clientUserId, clientId));

  if (!row) { res.json(null); return; }

  // Best-effort: read secret expiry from Key Vault metadata.
  // Fails gracefully (expiresOn: null) if Azure is not configured or the secret is gone.
  let expiresOn: string | null = null;
  try {
    const meta = await getSecretMetadata(row.keyVaultSecretName);
    expiresOn = meta.expiresOn ? meta.expiresOn.toISOString() : null;
  } catch (err) {
    req.log.warn({ err, clientId }, "app-registration GET: could not read secret metadata");
  }

  res.json({
    status: row.status,
    tenantId: row.tenantId,
    azureClientId: row.azureClientId,
    keyVaultSecretName: row.keyVaultSecretName,
    submittedAt: row.submittedAt,
    verifiedAt: row.verifiedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    expiresOn,
    permissionCheck: row.permissionCheck ?? null,
  });
});

router.delete("/admin/clients/:id/app-registration", requireAdmin, async (req: Request, res: Response) => {
  const clientId = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(clientId)) { res.status(400).json({ error: "Invalid client ID" }); return; }

  const [existing] = await db.select().from(clientAppRegistrationsTable)
    .where(eq(clientAppRegistrationsTable.clientUserId, clientId));

  if (!existing) { res.status(404).json({ error: "No App Registration found for this client" }); return; }

  const [clientUser] = await db.select({ name: usersTable.name, email: usersTable.email })
    .from(usersTable).where(eq(usersTable.id, clientId)).limit(1);
  const clientLabel = clientUser?.name ?? clientUser?.email ?? String(clientId);

  await db.delete(clientAppRegistrationsTable)
    .where(eq(clientAppRegistrationsTable.clientUserId, clientId));

  void createAuditLog({
    actorUserId: req.user!.id,
    actorName: req.user!.name ?? req.user!.email,
    actorRole: "admin",
    actionType: "app_registration_deleted",
    entityType: "app_registration",
    entityId: clientId,
    entityLabel: clientLabel,
    clientId,
    metadata: {
      tenantId: existing.tenantId,
      azureClientId: existing.azureClientId,
      previousStatus: existing.status,
    },
  });

  req.log.info({ clientId }, "app-registration: deleted by admin");

  res.json({ ok: true });
});

router.get("/admin/clients", requireAdmin, async (_req: Request, res: Response) => {
  const clients = await db.select().from(usersTable)
    .where(eq(usersTable.role, "client"))
    .orderBy(desc(usersTable.createdAt));
  res.json(clients.map(c => ({ ...c, passwordHash: undefined })));
});

router.get("/admin/clients/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const [client] = await db.select().from(usersTable)
    .where(and(eq(usersTable.id, id), eq(usersTable.role, "client")));
  if (!client) { res.status(404).json({ error: "Client not found" }); return; }
  res.json({ ...client, passwordHash: undefined });
});

router.post("/admin/clients", requireAdmin, async (req: Request, res: Response) => {
  const { email, name } = req.body as { email?: string; name?: string };
  if (!email) { res.status(400).json({ error: "email is required" }); return; }

  const normalizedEmail = email.toLowerCase().trim();

  const [existing] = await db.select({ id: usersTable.id }).from(usersTable)
    .where(eq(usersTable.email, normalizedEmail)).limit(1);
  if (existing) { res.status(409).json({ error: "An account with this email already exists" }); return; }

  if (!mtAppCredentialsPresent()) {
    res.status(503).json({
      error: "Multi-tenant app credentials not configured (MT_APP_CLIENT_ID / MT_APP_CLIENT_SECRET)",
    });
    return;
  }

  const invite = await createConsentInviteForEmail(req, { email: normalizedEmail, name });

  void createAuditLog({
    actorUserId: req.user!.id,
    actorName: req.user!.name ?? req.user!.email,
    actorRole: "admin",
    actionType: "consent_invite_created",
    entityType: "consent_invite",
    entityLabel: normalizedEmail,
    metadata: { invitedEmail: normalizedEmail, invitedName: name ?? null, expiresAt: invite.expiresAt, source: "admin_add_client" },
  });

  // Send the consent invite to the client (Exchange Online / Graph mailer).
  try {
    void sendEmailFromTemplate(
      "consent-invite",
      normalizedEmail,
      { clientName: name ?? normalizedEmail, consentLink: invite.consentUrl },
      "Connect your Microsoft 365 to get started with Shane McCaw Consulting",
      `<p>Hi ${name ?? ""},</p><p>Shane McCaw Consulting uses a secure connection to your Microsoft 365 environment to set up your client workspace. Ask your Microsoft 365 administrator to open the link below and approve the connection — your portal account is created the moment it's approved:</p><p style="margin:24px 0;"><a href="${invite.consentUrl}" style="display:inline-block;background:#0078D4;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:6px;">Connect Microsoft 365 →</a></p><p style="color:#888;font-size:13px;">This link is single-use and expires in 72 hours.</p><p>— Shane McCaw</p>`,
    ).catch((e) => req.log.warn({ err: e, invitedEmail: normalizedEmail, template: "consent-invite" }, "admin-add-client: consent invite email failed (non-fatal)"));
  } catch (err) {
    req.log.warn({ err, invitedEmail: normalizedEmail }, "admin-add-client: failed to send consent invite email");
  }

  // 202, not 201: nothing exists yet — the account is created at consent
  // time. consentUrl is returned so the admin can also share the link
  // directly (e.g. if the email lands in spam).
  res.status(202).json({
    ok: true,
    invited: true,
    email: normalizedEmail,
    consentUrl: invite.consentUrl,
    expiresAt: invite.expiresAt,
  });
});

router.post("/admin/clients/:id/resend-invite", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.id ?? ""), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid client ID" }); return; }

    const [client] = await db.select().from(usersTable)
      .where(and(eq(usersTable.id, id), eq(usersTable.role, "client"))).limit(1);
    if (!client) { res.status(404).json({ error: "Client not found" }); return; }

    // Force a fresh token: delete any existing tokens (expired, used, or still valid)
    // so the resent link is always a brand-new 72-hour window.
    await db.delete(accountSetupTokensTable).where(eq(accountSetupTokensTable.userId, id));

    const { randomBytes } = await import("crypto");
    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);
    await db.insert(accountSetupTokensTable).values({ userId: id, token, expiresAt });

    const setupUrl = buildAccountSetupUrl(token);

    await sendEmailFromTemplate(
      "account-setup",
      client.email,
      { setupLink: setupUrl, clientName: client.name ?? client.email },
      "Your Shane McCaw Consulting portal invite (resent)",
      `<p>Hi ${client.name ?? ""},</p><p>Here is a new link to set up your portal password:</p><p style="margin:24px 0;"><a href="${setupUrl}" style="display:inline-block;background:#0078D4;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:6px;">Set up my portal →</a></p><p style="color:#888;font-size:13px;">This link expires in 72 hours.</p><p>— Shane McCaw</p>`,
    );

    void createAuditLog({
      actorUserId: req.user!.id,
      actorName: req.user!.name ?? req.user!.email,
      actorRole: "admin",
      actionType: "client_invite_resent",
      entityType: "user",
      entityId: client.id,
      entityLabel: client.name ?? client.email,
    });

    res.json({ ok: true });
  } catch (err) {
    req.log.error(err, "Failed to resend client invite");
    res.status(500).json({ error: "Failed to resend invite" });
  }
});

router.patch("/admin/clients/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const { name, company, phone, email } = req.body as { name?: string; company?: string; phone?: string; email?: string };
  const updates: Partial<typeof usersTable.$inferInsert> = {};
  if (name !== undefined) updates.name = name;
  if (company !== undefined) updates.company = company;
  if (phone !== undefined) updates.phone = phone;
  if (email !== undefined) updates.email = email.toLowerCase().trim();

  const [updated] = await db.update(usersTable).set(updates).where(and(eq(usersTable.id, id), eq(usersTable.role, "client"))).returning();
  if (!updated) { res.status(404).json({ error: "Client not found" }); return; }
  res.json({ ...updated, passwordHash: undefined });
});

router.get("/admin/clients/:id/delete-preview", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.id ?? ""), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

    const [client] = await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email })
      .from(usersTable)
      .where(and(eq(usersTable.id, id), eq(usersTable.role, "client"))).limit(1);
    if (!client) { res.status(404).json({ error: "Client not found" }); return; }

    const [
      projectRows,
      invoiceRows,
      contractRows,
      messageRows,
      serviceRows,
      reportRows,
      statusReportRows,
      scriptRunRows,
      azureCredRows,
      quizLeadRows,
      generatedDocRows,
    ] = await Promise.all([
      db.select({ id: projectsTable.id }).from(projectsTable).where(eq(projectsTable.clientUserId, id)),
      db.select({ id: invoicesTable.id, status: invoicesTable.status }).from(invoicesTable).where(eq(invoicesTable.clientUserId, id)),
      db.select({ id: contractsTable.id }).from(contractsTable).where(eq(contractsTable.userId, id)),
      db.select({ id: messagesTable.id }).from(messagesTable).where(eq(messagesTable.clientUserId, id)),
      db.select({ id: clientServicesTable.id, stripeSubscriptionId: clientServicesTable.stripeSubscriptionId })
        .from(clientServicesTable).where(eq(clientServicesTable.clientUserId, id)),
      db.select({ id: reportsTable.id }).from(reportsTable).where(eq(reportsTable.clientUserId, id)),
      db.select({ id: statusReportsTable.id }).from(statusReportsTable).where(eq(statusReportsTable.clientUserId, id)),
      db.select({ id: scriptRunResultsTable.id }).from(scriptRunResultsTable).where(eq(scriptRunResultsTable.customerId, id)),
      db.select({ id: azureTenantCredentialsTable.id }).from(azureTenantCredentialsTable).where(eq(azureTenantCredentialsTable.clientUserId, id)),
      db.select({ id: quizLeadsTable.id }).from(quizLeadsTable).where(eq(quizLeadsTable.email, client.email)),
      db.select({ id: insightsGeneratedDocumentsTable.id }).from(insightsGeneratedDocumentsTable).where(eq(insightsGeneratedDocumentsTable.customerId, id)),
    ]);

    const unpaidInvoices = invoiceRows.filter(inv => inv.status === "due" || inv.status === "overdue").length;
    const hasActiveStripeSubscription = serviceRows.some(s => s.stripeSubscriptionId != null);

    res.json({
      projects: projectRows.length,
      invoices: invoiceRows.length,
      unpaidInvoices,
      contracts: contractRows.length,
      messages: messageRows.length,
      services: serviceRows.length,
      reports: reportRows.length,
      statusReports: statusReportRows.length,
      hasActiveStripeSubscription,
      scriptRunResults: scriptRunRows.length,
      azureCredentials: azureCredRows.length,
      quizLeads: quizLeadRows.length,
      generatedDocuments: generatedDocRows.length,
      // msp_users was absorbed into users (#92) — deleting the users row IS the
      // msp_users deletion now, so there is no separate row to count. Kept at 0
      // (not dropped) so the admin delete-preview UI shape is unchanged.
      mspUsers: 0,
    });
  } catch (err) {
    req.log.error(err, "Failed to fetch client delete preview");
    res.status(500).json({ error: "Failed to fetch delete preview" });
  }
});

router.delete("/admin/clients/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.id ?? ""), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

    const [client] = await db.select({ id: usersTable.id, email: usersTable.email }).from(usersTable)
      .where(and(eq(usersTable.id, id), eq(usersTable.role, "client"))).limit(1);
    if (!client) { res.status(404).json({ error: "Client not found" }); return; }

    const clientProjectRows = await db.select({ id: projectsTable.id }).from(projectsTable)
      .where(eq(projectsTable.clientUserId, id));
    const projectIds = clientProjectRows.map(p => p.id);

    const clientSvcRows = await db.select({ id: clientServicesTable.id, stripeSubscriptionId: clientServicesTable.stripeSubscriptionId }).from(clientServicesTable)
      .where(eq(clientServicesTable.clientUserId, id));
    const clientSvcIds = clientSvcRows.map(s => s.id);

    const stripeSubIds = clientSvcRows.map(s => s.stripeSubscriptionId).filter((sid): sid is string => sid != null);
    if (stripeSubIds.length > 0) {
      let stripeKey: string | null = null;
      try {
        stripeKey = getStripeKey();
      } catch (err) {
        req.log.warn(err, "Stripe not configured during client delete — skipping subscription cancellation");
      }
      if (stripeKey) {
        const { default: Stripe } = await import("stripe");
        const stripe = new Stripe(stripeKey);
        for (const subId of stripeSubIds) {
          try {
            await stripe.subscriptions.cancel(subId);
            req.log.info({ stripeSubscriptionId: subId }, "Cancelled stripe subscription during client delete");
          } catch (err) {
            req.log.error(err, `Failed to cancel Stripe subscription ${subId} during client delete`);
          }
        }
      }
    }

    if (projectIds.length > 0) {
      await db.delete(kanbanTasksTable).where(inArray(kanbanTasksTable.projectId, projectIds));
      await db.delete(projectUpdatesTable).where(inArray(projectUpdatesTable.projectId, projectIds));
      await db.delete(documentsTable).where(inArray(documentsTable.projectId, projectIds));
      await db.delete(workflowStepsTable).where(inArray(workflowStepsTable.projectId, projectIds));
    }
    if (clientSvcIds.length > 0) {
      await db.delete(workflowStepsTable).where(inArray(workflowStepsTable.clientServiceId, clientSvcIds));
    }
    await db.delete(statusReportsTable).where(eq(statusReportsTable.clientUserId, id));
    await db.delete(clientServicesTable).where(eq(clientServicesTable.clientUserId, id));
    await db.delete(contractsTable).where(eq(contractsTable.userId, id));
    await db.delete(reportsTable).where(eq(reportsTable.clientUserId, id));
    await db.delete(invoicesTable).where(eq(invoicesTable.clientUserId, id));
    await db.delete(messagesTable).where(eq(messagesTable.clientUserId, id));
    await db.delete(notificationsTable).where(eq(notificationsTable.userId, id));
    await db.delete(impersonationTokensTable).where(eq(impersonationTokensTable.clientUserId, id));
    await db.delete(passwordResetTokensTable).where(eq(passwordResetTokensTable.userId, id));
    await db.update(emailsTable).set({ linkedUserId: null }).where(eq(emailsTable.linkedUserId, id));
    await db.delete(emailDomainRulesTable).where(eq(emailDomainRulesTable.linkedUserId, id));
    if (projectIds.length > 0) {
      await db.delete(projectsTable).where(inArray(projectsTable.id, projectIds));
    }
    await db.delete(scriptRunResultsTable).where(eq(scriptRunResultsTable.customerId, id));
    await db.delete(insightsGeneratedDocumentsTable).where(eq(insightsGeneratedDocumentsTable.customerId, id));
    await db.delete(clientDocumentsTable).where(eq(clientDocumentsTable.clientUserId, id));
    await db.delete(azureTenantCredentialsTable).where(eq(azureTenantCredentialsTable.clientUserId, id));
    if (client.email) {
      await db.delete(quizLeadsTable).where(eq(quizLeadsTable.email, client.email));
    }
    await db.delete(usersTable).where(eq(usersTable.id, id));

    res.status(204).end();
  } catch (err) {
    req.log.error(err, "Failed to delete client");
    res.status(500).json({ error: "Failed to delete client" });
  }
});

router.get("/admin/clients/:id/m365-profile", requireAdmin, async (req: Request, res: Response) => {
  const clientId = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(clientId)) { res.status(400).json({ error: "Invalid client ID" }); return; }
  const [row] = await db.select().from(clientM365ProfilesTable).where(eq(clientM365ProfilesTable.clientId, clientId));
  res.json({ profile: row?.profile ?? null, updatedAt: row?.updatedAt ?? null });
});

router.put("/admin/clients/:id/m365-profile", requireAdmin, async (req: Request, res: Response) => {
  const clientId = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(clientId)) { res.status(400).json({ error: "Invalid client ID" }); return; }
  const { profile } = req.body as { profile: Record<string, unknown> };
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
    res.status(400).json({ error: "profile must be a plain object" }); return;
  }
  await db.insert(clientM365ProfilesTable)
    .values({ clientId, profile })
    .onConflictDoUpdate({ target: clientM365ProfilesTable.clientId, set: { profile, updatedAt: new Date() } });

  // Compute health scores and save snapshot (same logic as portal PUT)
  try {
    const scores = computeM365Scores(profile);
    const recentRows = await db
      .select({ category: clientHealthHistoryTable.category, score: clientHealthHistoryTable.score })
      .from(clientHealthHistoryTable)
      .where(eq(clientHealthHistoryTable.clientId, clientId))
      .orderBy(desc(clientHealthHistoryTable.recordedAt))
      .limit(10);
    const latestByCategory: Partial<Record<M365ScoreCategory, number>> = {};
    for (const row of recentRows) {
      const cat = row.category as M365ScoreCategory;
      if (!(cat in latestByCategory)) latestByCategory[cat] = row.score;
    }
    const hasChanged = (Object.entries(scores) as [M365ScoreCategory, number][])
      .some(([cat, score]) => latestByCategory[cat] !== score);
    if (hasChanged) {
      const now = new Date();
      await db.insert(clientHealthHistoryTable).values(
        (Object.entries(scores) as [M365ScoreCategory, number][]).map(([category, score]) => ({
          clientId,
          category,
          score,
          recordedAt: now,
        }))
      );
    }
  } catch (err) {
    req.log.warn({ err }, "admin m365-profile: failed to save health snapshot (non-fatal)");
  }

  res.json({ ok: true });
});

router.get("/admin/clients/:id/m365-profile/pdf", requireAdmin, async (req: Request, res: Response) => {
  const clientId = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(clientId)) { res.status(400).json({ error: "Invalid client ID" }); return; }

  const [profileRow] = await db
    .select({ profile: clientM365ProfilesTable.profile })
    .from(clientM365ProfilesTable)
    .where(eq(clientM365ProfilesTable.clientId, clientId));

  if (!profileRow) { res.status(404).json({ error: "No M365 profile found for this client" }); return; }

  const [clientRow] = await db
    .select({ name: usersTable.name, email: usersTable.email, company: usersTable.company })
    .from(usersTable)
    .where(eq(usersTable.id, clientId));

  try {
    const pdfBuffer = await generateM365ProfilePdf({
      clientName: clientRow?.name ?? null,
      clientEmail: clientRow?.email ?? "",
      clientCompany: clientRow?.company ?? null,
      generatedAt: new Date(),
      profile: profileRow.profile as Record<string, unknown>,
    });

    const safeName = (clientRow?.company ?? clientRow?.name ?? `client-${clientId}`)
      .replace(/[^a-z0-9]+/gi, "-")
      .toLowerCase();

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="m365-assessment-${safeName}.pdf"`);
    res.setHeader("Content-Length", String(pdfBuffer.length));
    res.send(pdfBuffer);
  } catch (err) {
    req.log.error(err, "Failed to generate M365 profile PDF");
    res.status(500).json({ error: "Failed to generate PDF" });
  }
});

router.get("/admin/m365-profiles", requireAdmin, async (req: Request, res: Response) => {
  try {
    const rows = await db
      .select({
        clientId: clientM365ProfilesTable.clientId,
        profile: clientM365ProfilesTable.profile,
        updatedAt: clientM365ProfilesTable.updatedAt,
        clientName: usersTable.name,
        clientEmail: usersTable.email,
        clientCompany: usersTable.company,
      })
      .from(clientM365ProfilesTable)
      .innerJoin(usersTable, eq(clientM365ProfilesTable.clientId, usersTable.id));
    res.json({ profiles: rows });
  } catch (err) {
    req.log.error(err, "Failed to fetch M365 profiles");
    res.status(500).json({ error: "Failed to fetch profiles" });
  }
});

router.delete("/admin/m365-profiles/:clientId", requireAdmin, async (req: Request, res: Response) => {
  const clientId = parseInt(String(req.params.clientId ?? ""), 10);
  if (isNaN(clientId)) { res.status(400).json({ error: "Invalid client ID" }); return; }
  try {
    const result = await db
      .delete(clientM365ProfilesTable)
      .where(eq(clientM365ProfilesTable.clientId, clientId))
      .returning({ clientId: clientM365ProfilesTable.clientId });
    if (result.length === 0) { res.status(404).json({ error: "Profile not found" }); return; }
    req.log.info({ clientId }, "admin: deleted M365 profile");
    res.json({ deleted: true, clientId });
  } catch (err) {
    req.log.error(err, "admin: failed to delete M365 profile");
    res.status(500).json({ error: "Failed to delete profile" });
  }
});

const MFA_METHOD_LABELS: Record<string, string> = {
  totp: "Authenticator App (TOTP)",
  sms: "SMS",
};

router.get("/admin/clients/:id/mfa-status", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.id ?? ""), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid client ID" }); return; }

    const [client] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(and(eq(usersTable.id, id), eq(usersTable.role, "client")))
      .limit(1);
    if (!client) { res.status(404).json({ error: "Client not found" }); return; }

    const enrollments = await db
      .select({ method: mfaEnrollmentsTable.method })
      .from(mfaEnrollmentsTable)
      .where(and(eq(mfaEnrollmentsTable.userId, id), eq(mfaEnrollmentsTable.enabled, true)));

    const passkeyCount = await db
      .select({ id: webauthnCredentialsTable.id })
      .from(webauthnCredentialsTable)
      .where(eq(webauthnCredentialsTable.userId, id));

    const methods = enrollments.map(e => e.method);
    if (passkeyCount.length > 0) methods.push("passkey");

    res.json({ methods });
  } catch (err) {
    req.log.error(err, "Failed to fetch client MFA status");
    res.status(500).json({ error: "Failed to fetch MFA status" });
  }
});

router.post("/admin/clients/:id/mfa-reset", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.id ?? ""), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid client ID" }); return; }

    const [client] = await db
      .select({ id: usersTable.id, email: usersTable.email, name: usersTable.name })
      .from(usersTable)
      .where(and(eq(usersTable.id, id), eq(usersTable.role, "client")))
      .limit(1);
    if (!client) { res.status(404).json({ error: "Client not found" }); return; }

    const enrollments = await db
      .select({ method: mfaEnrollmentsTable.method })
      .from(mfaEnrollmentsTable)
      .where(eq(mfaEnrollmentsTable.userId, id));

    const passkeyRows = await db
      .select({ id: webauthnCredentialsTable.id })
      .from(webauthnCredentialsTable)
      .where(eq(webauthnCredentialsTable.userId, id));

    const clearedMethods: string[] = enrollments.map(e => e.method);
    if (passkeyRows.length > 0) clearedMethods.push("passkey");

    await db.delete(mfaEnrollmentsTable).where(eq(mfaEnrollmentsTable.userId, id));
    await db.delete(mfaChallengesTable).where(eq(mfaChallengesTable.userId, id));
    await db.delete(webauthnCredentialsTable).where(eq(webauthnCredentialsTable.userId, id));
    await db.delete(webauthnChallengesTable).where(eq(webauthnChallengesTable.userId, id));

    const methodsList = clearedMethods
      .map(m => MFA_METHOD_LABELS[m] ?? m)
      .join(", ") || "None";

    await sendEmailFromTemplate(
      "mfa-reset",
      client.email,
      {
        clientName: client.name ?? client.email,
        methodsList,
        loginLink: getMspPortalBaseUrl(),
        securityLink: `${getMspPortalBaseUrl()}/security`,
      },
      "Your two-factor authentication has been reset",
      `<p>Hi ${client.name ?? client.email},</p><p>Your MFA has been reset. Please sign in and set up a new authentication method.</p><p><a href="${getMspPortalBaseUrl()}">Sign in to your portal</a></p>`,
    );

    req.log.info({ clientId: id, clearedMethods }, "Admin reset client MFA");
    res.json({ ok: true, clearedMethods });
  } catch (err) {
    req.log.error(err, "Failed to reset client MFA");
    res.status(500).json({ error: "Failed to reset MFA" });
  }
});

export default router;
