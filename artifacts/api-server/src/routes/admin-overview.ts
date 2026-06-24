import { Router, type Request, type Response } from "express";
import {
  db, usersTable, leadsTable, projectsTable, invoicesTable, clientServicesTable,
  servicesTable, projectUpdatesTable, messagesTable, shareEventsTable,
  checklistDownloadsTable, statusReportsTable, opportunitiesTable, kanbanTasksTable,
  runbookJobHistoryTable, quizLeadsTable,
} from "@workspace/db";
import { eq, desc, count, isNull, and, gte, sql } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";
import { anthropic } from "@workspace/integrations-anthropic-ai";

const router = Router();

// ── Helpers ────────────────────────────────────────────────────────────────────

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function weekKey(d: Date): string {
  const day = d.getDay();
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((day + 6) % 7));
  return monday.toISOString().slice(0, 10);
}

function getMonthIdx(date: Date, now: Date): number {
  const monthsAgo = (now.getFullYear() - date.getFullYear()) * 12 + (now.getMonth() - date.getMonth());
  return 11 - monthsAgo;
}

// ── GET /admin/overview ────────────────────────────────────────────────────────

router.get("/admin/overview", requireAdmin, async (_req: Request, res: Response) => {
  const now = new Date();
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const yearStart = new Date(now.getFullYear(), 0, 1);

  const [
    clientRows,
    allLeads,
    allProjectsRaw,
    allInvoices,
    allClientServices,
    allOpportunities,
    activeProjectsJoined,
    recentLeads,
    recentUpdates,
    recentMessages,
    pendingQuestionsRows,
    recentKanbanTasks,
    recentRunbooks,
    recentStatusReports,
    recentAssessments,
  ] = await Promise.all([
    db.select({ cnt: count() }).from(usersTable).where(eq(usersTable.role, "client")),
    db.select().from(leadsTable).orderBy(desc(leadsTable.createdAt)),
    db.select().from(projectsTable),
    db.select().from(invoicesTable),
    db.select({ cs: clientServicesTable, service: servicesTable })
      .from(clientServicesTable)
      .innerJoin(servicesTable, eq(clientServicesTable.serviceId, servicesTable.id)),
    db.select().from(opportunitiesTable),
    db.select({ p: projectsTable, u: usersTable })
      .from(projectsTable)
      .leftJoin(usersTable, eq(projectsTable.clientUserId, usersTable.id))
      .where(eq(projectsTable.status, "active"))
      .orderBy(desc(projectsTable.updatedAt))
      .limit(10),
    db.select().from(leadsTable).orderBy(desc(leadsTable.createdAt)).limit(5),
    db.select({ pu: projectUpdatesTable, p: projectsTable })
      .from(projectUpdatesTable)
      .innerJoin(projectsTable, eq(projectUpdatesTable.projectId, projectsTable.id))
      .orderBy(desc(projectUpdatesTable.createdAt))
      .limit(5),
    db.select({ m: messagesTable, u: usersTable })
      .from(messagesTable)
      .innerJoin(usersTable, eq(messagesTable.clientUserId, usersTable.id))
      .where(eq(messagesTable.readByAdmin, false))
      .orderBy(desc(messagesTable.createdAt))
      .limit(3),
    db.select({
      id: statusReportsTable.id,
      title: statusReportsTable.title,
      clientQuestion: statusReportsTable.clientQuestion,
      projectId: statusReportsTable.projectId,
      updatedAt: statusReportsTable.updatedAt,
      projectTitle: projectsTable.title,
      clientName: usersTable.name,
      clientEmail: usersTable.email,
    })
      .from(statusReportsTable)
      .leftJoin(projectsTable, eq(statusReportsTable.projectId, projectsTable.id))
      .leftJoin(usersTable, eq(statusReportsTable.clientUserId, usersTable.id))
      .where(and(
        eq(statusReportsTable.clientStatus, "has_questions"),
        isNull(statusReportsTable.adminReply),
      ))
      .orderBy(desc(statusReportsTable.updatedAt)),
    db.select().from(kanbanTasksTable)
      .where(gte(kanbanTasksTable.updatedAt, thirtyDaysAgo))
      .orderBy(desc(kanbanTasksTable.updatedAt)),
    db.select().from(runbookJobHistoryTable)
      .orderBy(desc(runbookJobHistoryTable.createdAt))
      .limit(5),
    // Recent status reports (with client name) for the Reports panel
    db.select({
      id: statusReportsTable.id,
      title: statusReportsTable.title,
      period: statusReportsTable.period,
      reportStatus: statusReportsTable.reportStatus,
      reportDate: statusReportsTable.reportDate,
      sentAt: statusReportsTable.sentAt,
      createdAt: statusReportsTable.createdAt,
      updatedAt: statusReportsTable.updatedAt,
      projectTitle: projectsTable.title,
      clientName: usersTable.name,
      clientEmail: usersTable.email,
    })
      .from(statusReportsTable)
      .leftJoin(projectsTable, eq(statusReportsTable.projectId, projectsTable.id))
      .leftJoin(usersTable, eq(statusReportsTable.clientUserId, usersTable.id))
      .orderBy(desc(statusReportsTable.updatedAt))
      .limit(6),
    // Recent assessments (quiz leads) for unified activity feed
    db.select({
      id: quizLeadsTable.id,
      name: quizLeadsTable.name,
      company: quizLeadsTable.company,
      tier: quizLeadsTable.tier,
      totalScore: quizLeadsTable.totalScore,
      createdAt: quizLeadsTable.createdAt,
    })
      .from(quizLeadsTable)
      .orderBy(desc(quizLeadsTable.createdAt))
      .limit(3),
  ]);

  const clientCount = Number(clientRows[0]?.cnt ?? 0);

  // Active projects (all, no limit) for overdue calculation
  const allActiveProjects = allProjectsRaw.filter(p => p.status === "active");
  const activeProjectCount = allActiveProjects.length;

  const openLeads = allLeads.filter(l => !["converted", "archived"].includes(l.status));
  const staleLeads = openLeads.filter(l => new Date(l.createdAt) < fourteenDaysAgo);

  // Build opportunity lookup by leadId (to enrich pipeline stages)
  const oppByLeadId = new Map<number, typeof allOpportunities[0]>();
  for (const opp of allOpportunities) {
    if (!oppByLeadId.has(opp.leadId)) oppByLeadId.set(opp.leadId, opp);
  }

  // 5-stage pipeline funnel mapped from DB stages:
  //   Lead → AQL (Qualified) → SQL without opp (Proposal) → SQL with opp (Negotiation) → Won (Clients)
  const pipelineLead = openLeads.filter(l => l.stage === "Lead").length;
  const pipelineQualified = openLeads.filter(l => l.stage === "AQL").length;
  const sqlLeads = openLeads.filter(l => l.stage === "SQL");
  const pipelineProposal = sqlLeads.filter(l => !oppByLeadId.has(l.id)).length;
  const pipelineNegotiation = sqlLeads.filter(l => oppByLeadId.has(l.id)).length;
  const pipelineWon = clientCount; // converted leads

  const leadsByStage = {
    Lead: pipelineLead,
    Qualified: pipelineQualified,
    Proposal: pipelineProposal,
    Negotiation: pipelineNegotiation,
    Won: pipelineWon,
  };

  // Velocity trend: monthly new leads (total + qualified = AQL/SQL) — last 6 months
  const velocityTrend: Array<{ month: string; qualified: number; total: number }> = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const next = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    const monthLeads = allLeads.filter(l => {
      const created = new Date(l.createdAt);
      return created >= d && created < next;
    });
    velocityTrend.push({
      month: d.toLocaleString("en-US", { month: "short", year: "2-digit" }),
      qualified: monthLeads.filter(l => l.stage === "AQL" || l.stage === "SQL").length,
      total: monthLeads.length,
    });
  }

  // Revenue calculations
  const paidInvoices = allInvoices.filter(i => i.status === "paid");
  const overdueInvoices = allInvoices.filter(i => i.status === "overdue");
  const dueInvoices = allInvoices.filter(i => i.status === "due");
  const unpaidInvoices = allInvoices.filter(i => ["due", "overdue"].includes(i.status));

  const invoicePaidRevenue = paidInvoices.reduce((s, i) => s + parseFloat(i.amount), 0);
  const purchaseRevenue = allClientServices.reduce((s, r) => {
    const price = parseFloat(r.service.basePrice ?? r.service.price ?? "0");
    return s + price;
  }, 0);

  const totalRevenuePaid = invoicePaidRevenue + purchaseRevenue;
  const totalRevenueOutstanding = unpaidInvoices.reduce((s, i) => s + parseFloat(i.amount), 0);
  const overdueValue = overdueInvoices.reduce((s, i) => s + parseFloat(i.amount), 0);

  // Revenue by month (trailing 12)
  const months: Array<{ month: string; oneTime: number; recurring: number }> = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({
      month: d.toLocaleString("en-US", { month: "short", year: "2-digit" }),
      oneTime: 0,
      recurring: 0,
    });
  }

  for (const inv of paidInvoices) {
    const paidAt = inv.paidAt ? new Date(inv.paidAt) : new Date(inv.createdAt);
    const idx = getMonthIdx(paidAt, now);
    if (idx >= 0 && idx <= 11) months[idx]!.oneTime += parseFloat(inv.amount);
  }

  for (const row of allClientServices) {
    const purchasedAt = new Date(row.cs.purchasedAt);
    const idx = getMonthIdx(purchasedAt, now);
    if (idx >= 0 && idx <= 11) {
      const price = parseFloat(row.service.basePrice ?? row.service.price ?? "0");
      if (row.service.billingType === "recurring_monthly") {
        months[idx]!.recurring += price;
      } else {
        months[idx]!.oneTime += price;
      }
    }
  }

  // YTD revenue
  const ytdRevenue = paidInvoices
    .filter(i => {
      const d = i.paidAt ? new Date(i.paidAt) : new Date(i.createdAt);
      return d >= yearStart;
    })
    .reduce((s, i) => s + parseFloat(i.amount), 0)
    + allClientServices
    .filter(r => new Date(r.cs.purchasedAt) >= yearStart)
    .reduce((s, r) => s + parseFloat(r.service.basePrice ?? r.service.price ?? "0"), 0);

  const currentMonthRevenue = (months[11]?.oneTime ?? 0) + (months[11]?.recurring ?? 0);
  const prevMonthRevenue = (months[10]?.oneTime ?? 0) + (months[10]?.recurring ?? 0);

  // Invoice revenue by service type — derived from invoices:
  // For each client, compute total paid invoices, then distribute proportionally across their services.
  // Group the result by service name.
  const clientInvoiceRevenue: Record<number, number> = {};
  for (const inv of paidInvoices) {
    clientInvoiceRevenue[inv.clientUserId] = (clientInvoiceRevenue[inv.clientUserId] ?? 0) + parseFloat(inv.amount);
  }
  // For each client, find their services and distribute invoice revenue proportionally
  const clientServicesByClient: Record<number, Array<{ name: string; price: number }>> = {};
  for (const row of allClientServices) {
    const cid = row.cs.clientUserId;
    if (!clientServicesByClient[cid]) clientServicesByClient[cid] = [];
    const price = parseFloat(row.service.basePrice ?? row.service.price ?? "0");
    clientServicesByClient[cid]!.push({ name: row.service.name, price });
  }
  const invoiceRevenueByService: Record<string, number> = {};
  for (const [clientIdStr, invRev] of Object.entries(clientInvoiceRevenue)) {
    const clientId = parseInt(clientIdStr, 10);
    const services = clientServicesByClient[clientId];
    if (!services || services.length === 0) {
      // Unattributed invoice revenue — attribute to a generic bucket
      invoiceRevenueByService["Other / One-off"] = (invoiceRevenueByService["Other / One-off"] ?? 0) + invRev;
      continue;
    }
    const totalServicePrice = services.reduce((s, sv) => s + sv.price, 0);
    for (const svc of services) {
      const share = totalServicePrice > 0 ? (svc.price / totalServicePrice) * invRev : invRev / services.length;
      invoiceRevenueByService[svc.name] = (invoiceRevenueByService[svc.name] ?? 0) + share;
    }
  }
  const topInvoiceServices = Object.entries(invoiceRevenueByService)
    .map(([name, revenue]) => ({
      name: name.length > 22 ? name.slice(0, 22) + "…" : name,
      revenue: Math.round(revenue),
    }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 6);

  // MRR / ARR
  const recurringServices = allClientServices.filter(r =>
    r.cs.status === "active" && r.service.billingType === "recurring_monthly"
  );
  const mrr = recurringServices.reduce((s, r) =>
    s + parseFloat(r.service.basePrice ?? r.service.price ?? "0"), 0
  );
  const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1);
  const mrrThreeMonthsAgo = allClientServices
    .filter(r =>
      r.cs.status === "active" &&
      r.service.billingType === "recurring_monthly" &&
      new Date(r.cs.purchasedAt) <= threeMonthsAgo
    )
    .reduce((s, r) => s + parseFloat(r.service.basePrice ?? r.service.price ?? "0"), 0);

  const clientsWithActiveProjectSet = new Set(
    allActiveProjects.map(p => p.clientUserId).filter((id): id is number => id !== null)
  );
  const clientsWithoutProjectsCount = Math.max(0, clientCount - clientsWithActiveProjectSet.size);

  const quarterStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
  const prevQuarterStart = new Date(quarterStart.getFullYear(), quarterStart.getMonth() - 3, 1);
  const currQuarterDeals = paidInvoices.filter(i => i.paidAt && new Date(i.paidAt) >= quarterStart);
  const prevQuarterDeals = paidInvoices.filter(i =>
    i.paidAt && new Date(i.paidAt) >= prevQuarterStart && new Date(i.paidAt) < quarterStart
  );
  const avgDeal = (deals: typeof paidInvoices) =>
    deals.length > 0 ? deals.reduce((s, i) => s + parseFloat(i.amount), 0) / deals.length : 0;

  // Burndown: task completions per day (last 30 days)
  const burndownMap: Record<string, { completed: number; created: number }> = {};
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    burndownMap[dayKey(d)] = { completed: 0, created: 0 };
  }
  for (const task of recentKanbanTasks) {
    const createdKey = dayKey(new Date(task.createdAt));
    if (createdKey in burndownMap) burndownMap[createdKey]!.created += 1;
    if (task.column === "completed") {
      const updKey = dayKey(new Date(task.updatedAt));
      if (updKey in burndownMap) burndownMap[updKey]!.completed += 1;
    }
  }
  // Compute cumulative remaining (total created so far minus total completed)
  let cumCreated = 0;
  let cumCompleted = 0;
  const burndown = Object.entries(burndownMap).map(([date, v]) => {
    cumCreated += v.created;
    cumCompleted += v.completed;
    return { date, completed: v.completed, remaining: Math.max(0, cumCreated - cumCompleted) };
  });

  // Weekly completions (last 6 weeks) — sparkline for velocity KPI card
  const weeklyMap: Record<string, number> = {};
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i * 7);
    weeklyMap[weekKey(d)] = 0;
  }
  for (const task of recentKanbanTasks) {
    if (task.column === "completed") {
      const wk = weekKey(new Date(task.updatedAt));
      if (wk in weeklyMap) weeklyMap[wk]! += 1;
    }
  }
  const weeklyCompletions = Object.values(weeklyMap);

  // Task stats
  const tasksThisWeek = recentKanbanTasks.filter(t => new Date(t.updatedAt) >= sevenDaysAgo);
  const completedThisWeek = tasksThisWeek.filter(t => t.column === "completed").length;
  const createdThisWeek = recentKanbanTasks.filter(t => new Date(t.createdAt) >= sevenDaysAgo).length;

  // Overdue projects — computed from ALL projects (no row limit)
  const overdueProjectCount = allActiveProjects.filter(p => p.endDate && new Date(p.endDate) < now).length;

  const avgProjectDurationDays = allActiveProjects.length > 0
    ? Math.round(
        allActiveProjects.reduce((sum, p) => {
          const created = new Date(p.createdAt);
          const days = Math.floor((now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));
          return sum + days;
        }, 0) / allActiveProjects.length
      )
    : 0;

  // Project velocity score (0–100): completion rate × avg progress
  const completedLast30 = recentKanbanTasks.filter(t => t.column === "completed").length;
  const createdLast30 = recentKanbanTasks.length;
  const completionRate = createdLast30 > 0 ? completedLast30 / createdLast30 : 0;
  const avgProgress = allActiveProjects.length > 0
    ? allActiveProjects.reduce((s, p) => s + p.progress, 0) / allActiveProjects.length
    : 0;
  const projectVelocityScore = Math.round(completionRate * (avgProgress / 100) * 100);

  // Unified activity feed
  const activity: Array<{ type: string; title: string; timestamp: string; linkPath?: string }> = [];

  for (const lead of recentLeads.slice(0, 3)) {
    activity.push({
      type: "lead",
      title: `New lead: ${lead.name}${lead.company ? ` (${lead.company})` : ""}`,
      timestamp: lead.createdAt.toISOString(),
      linkPath: "/crm/leads",
    });
  }

  for (const row of allClientServices
    .filter(r => new Date(r.cs.purchasedAt) >= thirtyDaysAgo)
    .sort((a, b) => new Date(b.cs.purchasedAt).getTime() - new Date(a.cs.purchasedAt).getTime())
    .slice(0, 3)
  ) {
    activity.push({
      type: "purchase",
      title: `New purchase: ${row.service.name}`,
      timestamp: new Date(row.cs.purchasedAt).toISOString(),
      linkPath: "/crm/purchases",
    });
  }

  for (const row of recentUpdates.slice(0, 3)) {
    activity.push({
      type: "project",
      title: `${row.p.title}: ${row.pu.content.slice(0, 70)}${row.pu.content.length > 70 ? "…" : ""}`,
      timestamp: row.pu.createdAt.toISOString(),
      linkPath: `/crm/projects/${row.p.id}`,
    });
  }

  for (const row of recentMessages.slice(0, 2)) {
    activity.push({
      type: "message",
      title: `New message from ${row.u.name ?? row.u.email}`,
      timestamp: row.m.createdAt.toISOString(),
      linkPath: "/crm/messages",
    });
  }

  for (const job of recentRunbooks.slice(0, 2)) {
    activity.push({
      type: "runbook",
      title: `Script run: ${job.runbookName} — ${job.customerName} (${job.status})`,
      timestamp: job.createdAt.toISOString(),
      linkPath: "/admin-panel/script-runner",
    });
  }

  // Completed kanban tasks (last 30 days)
  for (const task of recentKanbanTasks.filter(t => t.column === "completed").slice(0, 3)) {
    activity.push({
      type: "task",
      title: `Task completed: ${task.title}`,
      timestamp: task.updatedAt.toISOString(),
      linkPath: task.projectId ? `/crm/projects/${task.projectId}` : undefined,
    });
  }

  // Copilot / readiness assessments submitted
  for (const assessment of recentAssessments.slice(0, 2)) {
    activity.push({
      type: "assessment",
      title: `Assessment: ${assessment.name}${assessment.company ? ` (${assessment.company})` : ""} — ${assessment.tier} (${assessment.totalScore}%)`,
      timestamp: assessment.createdAt.toISOString(),
      linkPath: "/admin-panel/quiz-leads",
    });
  }

  activity.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  res.json({
    clientCount,
    leadCount: allLeads.length,
    openLeadCount: openLeads.length,
    staleLeadCount: staleLeads.length,
    leadsByStage,         // { Lead, Qualified, Proposal, Negotiation, Won }
    velocityTrend,        // [{ month, qualified, total }] last 6 months
    activeProjectCount,
    mrr: Math.round(mrr * 100) / 100,
    arr: Math.round(mrr * 12 * 100) / 100,
    totalRevenuePaid: Math.round(totalRevenuePaid * 100) / 100,
    invoicePaidRevenue: Math.round(invoicePaidRevenue * 100) / 100,
    purchaseRevenue: Math.round(purchaseRevenue * 100) / 100,
    totalRevenueOutstanding: Math.round(totalRevenueOutstanding * 100) / 100,
    unpaidInvoiceCount: unpaidInvoices.length,
    unpaidInvoiceValue: Math.round(totalRevenueOutstanding * 100) / 100,
    dueInvoiceCount: dueInvoices.length,
    overdueInvoiceCount: overdueInvoices.length,
    overdueInvoiceValue: Math.round(overdueValue * 100) / 100,
    clientsWithoutProjectsCount,
    revenueByMonth: months,
    revenueTrend: {
      currentMonth: Math.round(currentMonthRevenue * 100) / 100,
      prevMonth: Math.round(prevMonthRevenue * 100) / 100,
    },
    ytdRevenue: Math.round(ytdRevenue * 100) / 100,
    topInvoiceServices,  // invoice revenue attributed to service type (for Revenue Trends right panel)
    recentActivity: activity.slice(0, 10),
    recentStatusReports: recentStatusReports.map(r => ({
      id: r.id,
      title: r.title,
      period: r.period,
      reportStatus: r.reportStatus,
      clientName: r.clientName ?? r.clientEmail?.split("@")[0] ?? null,
      projectTitle: r.projectTitle ?? null,
      sentAt: r.sentAt?.toISOString() ?? null,
      updatedAt: r.updatedAt.toISOString(),
    })),
    activeProjects: activeProjectsJoined.map(r => ({
      id: r.p.id,
      title: r.p.title,
      clientName: r.u ? (r.u.name ?? r.u.email) : null,
      status: r.p.status,
      phase: r.p.phase,
      progress: r.p.progress,
      endDate: r.p.endDate ? r.p.endDate.toISOString() : null,
    })),
    currQuarterAvgDeal: Math.round(avgDeal(currQuarterDeals) * 100) / 100,
    prevQuarterAvgDeal: Math.round(avgDeal(prevQuarterDeals) * 100) / 100,
    mrrTrend: {
      current: Math.round(mrr * 100) / 100,
      threeMonthsAgo: Math.round(mrrThreeMonthsAgo * 100) / 100,
    },
    burndown,
    weeklyCompletions,   // [n, n, n, n, n, n] last 6 weeks for sparkline
    taskStats: {
      completedThisWeek,
      createdThisWeek,
      overdueProjectCount,
      avgProjectDurationDays,
      projectVelocityScore,
      avgProgress: Math.round(avgProgress),
    },
    pendingQuestions: pendingQuestionsRows.map(r => ({
      id: r.id,
      title: r.title,
      clientQuestion: r.clientQuestion,
      projectId: r.projectId,
      projectTitle: r.projectTitle ?? null,
      clientName: r.clientName ?? r.clientEmail ?? "Unknown client",
      updatedAt: r.updatedAt.toISOString(),
    })),
  });
});

// ── POST /admin/insights ───────────────────────────────────────────────────────

router.post("/admin/insights", requireAdmin, async (req: Request, res: Response) => {
  try {
    const now = new Date();
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const quarterStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
    const thirtyDaysAgoInsights = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const yearStart = new Date(now.getFullYear(), 0, 1);

    const [
      clientRows,
      allLeads,
      activeProjectCountRows,
      allInvoices,
      allClientServices,
      allShareEvents,
      allDownloads,
      allOpportunities,
      allProjects,
      recentTasks,
      quizLeadRows,
    ] = await Promise.all([
      db.select({ cnt: count() }).from(usersTable).where(eq(usersTable.role, "client")),
      db.select().from(leadsTable).orderBy(desc(leadsTable.createdAt)),
      db.select({ cnt: count() }).from(projectsTable).where(eq(projectsTable.status, "active")),
      db.select().from(invoicesTable),
      db.select({ cs: clientServicesTable, service: servicesTable })
        .from(clientServicesTable)
        .innerJoin(servicesTable, eq(clientServicesTable.serviceId, servicesTable.id)),
      db.select().from(shareEventsTable).orderBy(desc(shareEventsTable.createdAt)),
      db.select().from(checklistDownloadsTable).orderBy(desc(checklistDownloadsTable.createdAt)),
      db.select().from(opportunitiesTable).orderBy(desc(opportunitiesTable.createdAt)),
      db.select().from(projectsTable).where(eq(projectsTable.status, "active")),
      db.select().from(kanbanTasksTable)
        .where(gte(kanbanTasksTable.updatedAt, thirtyDaysAgoInsights))
        .orderBy(desc(kanbanTasksTable.updatedAt)),
      db.select().from(quizLeadsTable).orderBy(desc(quizLeadsTable.createdAt)),
    ]);

    const clientCount = Number(clientRows[0]?.cnt ?? 0);
    const openLeads = allLeads.filter(l => !["converted", "archived"].includes(l.status));
    const staleLeads = openLeads.filter(l => new Date(l.createdAt) < fourteenDaysAgo);
    const paidInvoices = allInvoices.filter(i => i.status === "paid");
    const overdueInvoices = allInvoices.filter(i => i.status === "overdue");
    const unpaidInvoices = allInvoices.filter(i => ["due", "overdue"].includes(i.status));
    const invoicePaidRevenue = paidInvoices.reduce((s, i) => s + parseFloat(i.amount), 0);
    const purchaseRevenue = allClientServices.reduce((s, r) =>
      s + parseFloat(r.service.basePrice ?? r.service.price ?? "0"), 0);
    const totalRevenuePaid = invoicePaidRevenue + purchaseRevenue;
    const ytdRevenue = paidInvoices
      .filter(i => (i.paidAt ? new Date(i.paidAt) : new Date(i.createdAt)) >= yearStart)
      .reduce((s, i) => s + parseFloat(i.amount), 0)
      + allClientServices
      .filter(r => new Date(r.cs.purchasedAt) >= yearStart)
      .reduce((s, r) => s + parseFloat(r.service.basePrice ?? r.service.price ?? "0"), 0);
    const totalRevenueOutstanding = unpaidInvoices.reduce((s, i) => s + parseFloat(i.amount), 0);
    const overdueValue = overdueInvoices.reduce((s, i) => s + parseFloat(i.amount), 0);
    const mrr = allClientServices
      .filter(r => r.cs.status === "active" && r.service.billingType === "recurring_monthly")
      .reduce((s, r) => s + parseFloat(r.service.basePrice ?? r.service.price ?? "0"), 0);

    const clientsWithoutProjectsCount = Math.max(0, clientCount -
      new Set(allProjects.filter(p => p.clientUserId !== null).map(p => p.clientUserId)).size
    );
    const currQuarterDeals = paidInvoices.filter(i => i.paidAt && new Date(i.paidAt) >= quarterStart);
    const avgDealSize = currQuarterDeals.length > 0
      ? currQuarterDeals.reduce((s, i) => s + parseFloat(i.amount), 0) / currQuarterDeals.length : 0;
    const fmtN = (n: number) => n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${n.toFixed(0)}`;

    const totalShares = allShareEvents.length;
    const sharesLast30 = allShareEvents.filter(e => new Date(e.createdAt) >= thirtyDaysAgoInsights).length;
    const totalDownloads = allDownloads.length;
    const downloadsLast30 = allDownloads.filter(d => new Date(d.createdAt) >= thirtyDaysAgoInsights).length;
    const sharesBySlug: Record<string, number> = {};
    for (const e of allShareEvents) { sharesBySlug[e.slug] = (sharesBySlug[e.slug] ?? 0) + 1; }
    const topSharedSlug = Object.entries(sharesBySlug).sort((a, b) => b[1] - a[1])[0];

    const oppByLeadId = new Map<number, typeof allOpportunities[0]>();
    for (const opp of allOpportunities) {
      if (!oppByLeadId.has(opp.leadId)) oppByLeadId.set(opp.leadId, opp);
    }
    const highScoreOpps = allOpportunities.filter(o =>
      (o.scoreSnapshot + o.scoreFit + o.scorePain + o.scoreIntent) > 60
    );
    const sqlLeads = openLeads.filter(l => l.stage === "SQL");
    const pipelineNegotiation = sqlLeads.filter(l => oppByLeadId.has(l.id)).length;
    const leadsByStage = {
      Lead: openLeads.filter(l => l.stage === "Lead").length,
      Qualified: openLeads.filter(l => l.stage === "AQL").length,
      Proposal: sqlLeads.filter(l => !oppByLeadId.has(l.id)).length,
      Negotiation: pipelineNegotiation,
    };

    // Client health context: average quiz category scores
    const categoryTotals: Record<string, { sum: number; count: number }> = {
      infrastructure: { sum: 0, count: 0 },
      data: { sum: 0, count: 0 },
      aiLiteracy: { sum: 0, count: 0 },
      changeManagement: { sum: 0, count: 0 },
      businessProcess: { sum: 0, count: 0 },
    };
    for (const ql of quizLeadRows) {
      const cs = (ql.categoryScores ?? {}) as Record<string, number>;
      for (const key of Object.keys(categoryTotals)) {
        const v = cs[key];
        if (typeof v === "number") {
          categoryTotals[key]!.sum += v;
          categoryTotals[key]!.count += 1;
        }
      }
    }
    const healthAvgs: Record<string, string> = {};
    for (const [key, { sum, count }] of Object.entries(categoryTotals)) {
      healthAvgs[key] = count > 0 ? `${Math.round(sum / count)}/100` : "no data";
    }
    const healthCategoryLabels: Record<string, string> = {
      infrastructure: "Security",
      data: "Compliance",
      aiLiteracy: "Copilot Readiness",
      changeManagement: "Governance",
      businessProcess: "Power Platform",
    };

    // Project velocity context
    const stalledProjects = allProjects.filter(p => p.progress < 20 && new Date(p.createdAt) < thirtyDaysAgoInsights);
    const lowProgressProjects = allProjects.filter(p => p.progress < 30);
    const tasksCompletedThisWeek = recentTasks.filter(t => t.column === "completed" && new Date(t.updatedAt) >= sevenDaysAgo).length;
    const tasksCreatedThisWeek = recentTasks.filter(t => new Date(t.createdAt) >= sevenDaysAgo).length;
    const tasksCompletedLast30 = recentTasks.filter(t => t.column === "completed").length;
    const avgCompletionPerWeek = Math.round(tasksCompletedLast30 / 4);
    const taskCompletionRatio = recentTasks.length > 0
      ? Math.round((tasksCompletedLast30 / recentTasks.length) * 100) : 0;
    const avgProgress = allProjects.length > 0
      ? Math.round(allProjects.reduce((s, p) => s + p.progress, 0) / allProjects.length) : 0;
    const projectVelocityScore = recentTasks.length > 0
      ? Math.round((tasksCompletedLast30 / recentTasks.length) * (avgProgress / 100) * 100) : 0;

    const healthSection = Object.entries(healthAvgs)
      .map(([key, avg]) => `  - ${healthCategoryLabels[key] ?? key}: ${avg}`)
      .join("\n");

    const context = `BUSINESS METRICS — Shane McCaw Consulting (${now.toLocaleDateString("en-US", { month: "long", year: "numeric" })})

REVENUE:
- Total paid revenue (all time): ${fmtN(totalRevenuePaid)}
- YTD revenue: ${fmtN(ytdRevenue)}
- Monthly recurring revenue (MRR): ${fmtN(mrr)}
- Outstanding receivables: ${fmtN(totalRevenueOutstanding)} (${overdueInvoices.length} overdue at ${fmtN(overdueValue)})
- Avg deal size this quarter: ${avgDealSize > 0 ? fmtN(avgDealSize) : "no closed deals yet"}

PIPELINE (5-stage CRM funnel):
- Lead (initial): ${leadsByStage.Lead}
- Qualified (AQL): ${leadsByStage.Qualified}
- Proposal (SQL): ${leadsByStage.Proposal}
- Negotiation (SQL + scored opportunity): ${leadsByStage.Negotiation}
- Active clients: ${clientCount}
- Open leads total: ${openLeads.length} (${staleLeads.length} stale >14 days)
- High-score opportunities (>60): ${highScoreOpps.length}
- Clients without an active project: ${clientsWithoutProjectsCount}

CLIENT HEALTH SCORES (avg across ${quizLeadRows.length} assessed prospects, scale 0-100):
${healthSection}
  Note: Higher is better for all dimensions.

PROJECT VELOCITY:
- Active projects: ${Number(activeProjectCountRows[0]?.cnt ?? 0)}
- Avg project progress: ${avgProgress}%
- Stalled projects (<20% after 30 days): ${stalledProjects.length}
- Projects with <30% progress: ${lowProgressProjects.length}
- Project velocity score (0-100): ${projectVelocityScore}
- Task completion ratio (last 30d): ${taskCompletionRatio}%
- Tasks completed this week: ${tasksCompletedThisWeek} (avg ${avgCompletionPerWeek}/week)
- Tasks created this week: ${tasksCreatedThisWeek}

CONTENT & ENGAGEMENT:
- Total article shares: ${totalShares} (last 30d: ${sharesLast30})
- Top shared article: ${topSharedSlug ? `"${topSharedSlug[0]}" (${topSharedSlug[1]} shares)` : "none yet"}
- Checklist downloads: ${totalDownloads} all time, ${downloadsLast30} last 30 days`;

    const prompt = `You are a senior business analyst for Shane McCaw Consulting, a Microsoft 365 consulting practice. Analyze the metrics below and return exactly 4 insight cards as a JSON array.

Cover these four themes in this exact order:
1. "3 Things to Focus on Today" — list the three highest-priority actions Shane should take right now. Ground each action in a specific number from the data.
2. "Clients Needing Attention" — identify the client or lead segments at immediate risk: stale leads, clients with no active project, overdue invoices, or low health scores. Be specific about which health dimensions are weakest.
3. "Heating Opportunities" — highlight the strongest pipeline signals: high-score opportunities, leads advancing to Proposal/Negotiation, services with strong purchase velocity, or health dimensions where clients score high.
4. "Projects at Risk" — flag specific project or task risks: stalled progress, falling completion ratios, or patterns that signal delivery risk.

Rules:
- Each narrative must be 2–4 specific, data-driven sentences referencing the actual numbers. No generic advice.
- The metric field must be a concise string highlighting one key figure (e.g. "7 stale leads", "$4.2k overdue").
- Return ONLY a valid JSON array, no markdown fences, no preamble.

Format (exactly 4 objects):
[{"title":"...","narrative":"...","metric":"..."},{"title":"...","narrative":"...","metric":"..."},{"title":"...","narrative":"...","metric":"..."},{"title":"...","narrative":"...","metric":"..."}]

Business data:
${context}`;

    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 1600,
      messages: [{ role: "user", content: prompt }],
    });

    const block = msg.content[0];
    if (block.type !== "text") { res.status(500).json({ error: "Unexpected AI response format" }); return; }

    type InsightCard = { title: string; narrative: string; metric: string };
    let rawInsights: InsightCard[];
    try {
      const jsonMatch = block.text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error("No JSON array found in AI response");
      rawInsights = JSON.parse(jsonMatch[0]) as InsightCard[];
    } catch {
      res.status(500).json({ error: "Failed to parse AI response" });
      return;
    }

    const fmtNN = (n: number) => n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${n.toFixed(0)}`;
    const fallbacks: InsightCard[] = [
      { title: "3 Things to Focus on Today", narrative: `1. Follow up with ${staleLeads.length} stale lead(s) >14 days without contact. 2. Chase ${overdueInvoices.length} overdue invoice(s) totaling ${fmtNN(overdueValue)}. 3. Reach out to ${clientsWithoutProjectsCount} client(s) without an active project.`, metric: `${staleLeads.length} stale leads` },
      { title: "Clients Needing Attention", narrative: `${clientsWithoutProjectsCount} client(s) have no active project — immediate upsell opportunities. ${staleLeads.length} leads have gone 14+ days without follow-up. Governance and Security health scores are often the weakest areas among assessed prospects.`, metric: `${clientsWithoutProjectsCount} clients at risk` },
      { title: "Heating Opportunities", narrative: `${highScoreOpps.length} qualified opportunities score above 60/100, indicating strong fit and urgency. ${pipelineNegotiation} leads are in active Negotiation stage. Copilot Readiness scores show readiness for M365 Copilot conversations.`, metric: `${highScoreOpps.length} hot opportunities` },
      { title: "Projects at Risk", narrative: `${stalledProjects.length} project(s) are stalled (<20% progress after 30 days). Task completion rate is ${taskCompletionRatio}% over the last 30 days. Average project progress is ${avgProgress}% across ${Number(activeProjectCountRows[0]?.cnt ?? 0)} active projects.`, metric: `${stalledProjects.length} stalled projects` },
    ];

    const insights: InsightCard[] = Array.from({ length: 4 }, (_, i) => {
      const card = rawInsights[i];
      if (card && typeof card.title === "string" && typeof card.narrative === "string" && typeof card.metric === "string") {
        return card;
      }
      return fallbacks[i]!;
    });

    res.json({ insights });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "AI insights generation failed";
    req.log.error({ err }, "POST /admin/insights failed");
    res.status(500).json({ error: errMsg });
  }
});

export default router;
