import { Router, type Request, type Response } from "express";
import { db, usersTable, leadsTable, projectsTable, invoicesTable, clientServicesTable, servicesTable, projectUpdatesTable, messagesTable } from "@workspace/db";
import { eq, desc, count } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";

const router = Router();

router.get("/admin/overview", requireAdmin, async (_req: Request, res: Response) => {
  const now = new Date();
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const quarterStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
  const prevQuarterStart = new Date(quarterStart.getFullYear(), quarterStart.getMonth() - 3, 1);

  const [
    clientRows,
    allLeads,
    activeProjectCountRows,
    allInvoices,
    allClientServices,
    activeProjects,
    recentLeads,
    recentUpdates,
    recentMessages,
  ] = await Promise.all([
    db.select({ cnt: count() }).from(usersTable).where(eq(usersTable.role, "client")),
    db.select().from(leadsTable).orderBy(desc(leadsTable.createdAt)),
    db.select({ cnt: count() }).from(projectsTable).where(eq(projectsTable.status, "active")),
    db.select().from(invoicesTable),
    db.select({ cs: clientServicesTable, service: servicesTable })
      .from(clientServicesTable)
      .innerJoin(servicesTable, eq(clientServicesTable.serviceId, servicesTable.id)),
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
  ]);

  const clientCount = clientRows[0]?.cnt ?? 0;
  const activeProjectCount = activeProjectCountRows[0]?.cnt ?? 0;

  // Stale leads: new or contacted, older than 14 days
  const staleLeads = allLeads.filter(l =>
    new Date(l.createdAt) < fourteenDaysAgo && ["new", "contacted"].includes(l.status)
  );

  // Invoice calculations
  const paidInvoices = allInvoices.filter(i => i.status === "paid");
  const overdueInvoices = allInvoices.filter(i => i.status === "overdue");
  const unpaidInvoices = allInvoices.filter(i => ["due", "overdue"].includes(i.status));

  const totalRevenuePaid = paidInvoices.reduce((s, i) => s + parseFloat(i.amount), 0);
  const totalRevenueOutstanding = unpaidInvoices.reduce((s, i) => s + parseFloat(i.amount), 0);
  const overdueValue = overdueInvoices.reduce((s, i) => s + parseFloat(i.amount), 0);

  // MRR: active recurring services
  const recurringServices = allClientServices.filter(r =>
    r.cs.status === "active" && r.service.billingType === "recurring_monthly"
  );
  const mrr = recurringServices.reduce((s, r) =>
    s + parseFloat(r.service.basePrice ?? r.service.price ?? "0"), 0
  );

  // Revenue by month (trailing 12) — from paid invoices + purchases
  const months: Array<{ month: string; oneTime: number; recurring: number }> = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({
      month: d.toLocaleString("en-US", { month: "short", year: "2-digit" }),
      oneTime: 0,
      recurring: 0,
    });
  }

  const getMonthIdx = (date: Date) => {
    const monthsAgo = (now.getFullYear() - date.getFullYear()) * 12 + (now.getMonth() - date.getMonth());
    return 11 - monthsAgo;
  };

  for (const inv of paidInvoices) {
    const paidAt = inv.paidAt ? new Date(inv.paidAt) : new Date(inv.createdAt);
    const idx = getMonthIdx(paidAt);
    if (idx >= 0 && idx <= 11) months[idx].oneTime += parseFloat(inv.amount);
  }

  for (const row of allClientServices) {
    const purchasedAt = new Date(row.cs.purchasedAt);
    const idx = getMonthIdx(purchasedAt);
    if (idx >= 0 && idx <= 11) {
      const price = parseFloat(row.service.basePrice ?? row.service.price ?? "0");
      if (row.service.billingType === "recurring_monthly") {
        months[idx].recurring += price;
      } else {
        months[idx].oneTime += price;
      }
    }
  }

  // Clients without active projects
  const clientsWithActiveProjects = new Set(
    activeProjects.map(r => r.p.clientUserId).filter((id): id is number => id !== null)
  );
  const clientsWithoutProjectsCount = Math.max(0, Number(clientCount) - clientsWithActiveProjects.size);

  // Top service by purchase volume
  const serviceRevenue: Record<number, { name: string; revenue: number }> = {};
  for (const row of allClientServices) {
    const price = parseFloat(row.service.basePrice ?? row.service.price ?? "0");
    if (!serviceRevenue[row.service.id]) {
      serviceRevenue[row.service.id] = { name: row.service.name, revenue: 0 };
    }
    serviceRevenue[row.service.id].revenue += price;
  }
  const topService = Object.values(serviceRevenue).sort((a, b) => b.revenue - a.revenue)[0] ?? null;

  // Deal size by quarter (use paid invoices)
  const currQuarterDeals = paidInvoices.filter(i => i.paidAt && new Date(i.paidAt) >= quarterStart);
  const prevQuarterDeals = paidInvoices.filter(i =>
    i.paidAt && new Date(i.paidAt) >= prevQuarterStart && new Date(i.paidAt) < quarterStart
  );
  const avgDeal = (deals: typeof paidInvoices) =>
    deals.length > 0 ? deals.reduce((s, i) => s + parseFloat(i.amount), 0) / deals.length : 0;

  // MRR trend: compare now vs 3 months ago (services purchased before 3 months ago)
  const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1);
  const mrrThreeMonthsAgo = allClientServices
    .filter(r => r.cs.status === "active" && r.service.billingType === "recurring_monthly" && new Date(r.cs.purchasedAt) <= threeMonthsAgo)
    .reduce((s, r) => s + parseFloat(r.service.basePrice ?? r.service.price ?? "0"), 0);

  // Recent activity feed
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

  activity.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  res.json({
    clientCount: Number(clientCount),
    leadCount: allLeads.length,
    staleLeadCount: staleLeads.length,
    activeProjectCount: Number(activeProjectCount),
    mrr: Math.round(mrr * 100) / 100,
    arr: Math.round(mrr * 12 * 100) / 100,
    totalRevenuePaid: Math.round(totalRevenuePaid * 100) / 100,
    totalRevenueOutstanding: Math.round(totalRevenueOutstanding * 100) / 100,
    overdueInvoiceCount: overdueInvoices.length,
    overdueInvoiceValue: Math.round(overdueValue * 100) / 100,
    clientsWithoutProjectsCount,
    revenueByMonth: months,
    recentActivity: activity.slice(0, 8),
    activeProjects: activeProjects.map(r => ({
      id: r.p.id,
      title: r.p.title,
      clientName: r.u ? (r.u.name ?? r.u.email) : null,
      status: r.p.status,
      phase: r.p.phase,
      progress: r.p.progress,
      endDate: r.p.endDate ? r.p.endDate.toISOString() : null,
    })),
    topService,
    currQuarterAvgDeal: Math.round(avgDeal(currQuarterDeals) * 100) / 100,
    prevQuarterAvgDeal: Math.round(avgDeal(prevQuarterDeals) * 100) / 100,
    leadFunnel: {
      leads: allLeads.length,
      clients: Number(clientCount),
      activeProjects: Number(activeProjectCount),
    },
    mrrTrend: {
      current: Math.round(mrr * 100) / 100,
      threeMonthsAgo: Math.round(mrrThreeMonthsAgo * 100) / 100,
    },
  });
});

export default router;
