import { Router, type Request, type Response } from "express";
import { db, usersTable, leadsTable, projectsTable, invoicesTable, clientServicesTable, servicesTable, projectUpdatesTable, messagesTable } from "@workspace/db";
import { eq, desc, count } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";
import { anthropic } from "@workspace/integrations-anthropic-ai";

const router = Router();

router.get("/admin/overview", requireAdmin, async (_req: Request, res: Response) => {
  const now = new Date();
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const quarterStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
  const prevQuarterStart = new Date(quarterStart.getFullYear(), quarterStart.getMonth() - 3, 1);
  const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1);
  const oneMonthAgo = new Date(now.getFullYear(), now.getMonth() - 1, 1);

  const [
    clientRows,
    allLeads,
    activeProjectCountRows,
    allInvoices,
    allClientServices,
    activeProjects,
    clientsWithActiveProjectsRows,
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
    // Limit 10 only for display purposes in "Projects at a glance"
    db.select({ p: projectsTable, u: usersTable })
      .from(projectsTable)
      .leftJoin(usersTable, eq(projectsTable.clientUserId, usersTable.id))
      .where(eq(projectsTable.status, "active"))
      .orderBy(desc(projectsTable.updatedAt))
      .limit(10),
    // Full distinct list for the clientsWithoutProjects count (no limit)
    db.selectDistinct({ clientUserId: projectsTable.clientUserId })
      .from(projectsTable)
      .where(eq(projectsTable.status, "active")),
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

  const clientCount = Number(clientRows[0]?.cnt ?? 0);
  const activeProjectCount = Number(activeProjectCountRows[0]?.cnt ?? 0);

  // Open leads = active pipeline statuses (not converted or archived)
  const openLeads = allLeads.filter(l => !["converted", "archived"].includes(l.status));

  // Stale leads: open pipeline leads, created more than 14 days ago
  const staleLeads = openLeads.filter(l => new Date(l.createdAt) < fourteenDaysAgo);

  // Lead age buckets (open leads only)
  const leadAgeBuckets = {
    fresh: openLeads.filter(l => new Date(l.createdAt) >= fourteenDaysAgo).length,
    stale: staleLeads.length,
    total: openLeads.length,
  };

  // Invoice calculations
  const paidInvoices = allInvoices.filter(i => i.status === "paid");
  const overdueInvoices = allInvoices.filter(i => i.status === "overdue");
  const dueInvoices = allInvoices.filter(i => i.status === "due");
  const unpaidInvoices = allInvoices.filter(i => ["due", "overdue"].includes(i.status));

  // Revenue from paid invoices
  const invoicePaidRevenue = paidInvoices.reduce((s, i) => s + parseFloat(i.amount), 0);

  // Revenue from purchases (client services = Stripe purchases)
  const purchaseRevenue = allClientServices.reduce((s, r) => {
    const price = parseFloat(r.service.basePrice ?? r.service.price ?? "0");
    return s + price;
  }, 0);

  // Total revenue = paid invoices + all purchase revenue
  const totalRevenuePaid = invoicePaidRevenue + purchaseRevenue;
  const totalRevenueOutstanding = unpaidInvoices.reduce((s, i) => s + parseFloat(i.amount), 0);
  const overdueValue = overdueInvoices.reduce((s, i) => s + parseFloat(i.amount), 0);

  // MRR: active recurring client services
  const recurringServices = allClientServices.filter(r =>
    r.cs.status === "active" && r.service.billingType === "recurring_monthly"
  );
  const mrr = recurringServices.reduce((s, r) =>
    s + parseFloat(r.service.basePrice ?? r.service.price ?? "0"), 0
  );

  // MRR 3 months ago (recurring services active before 3 months ago)
  const mrrThreeMonthsAgo = allClientServices
    .filter(r =>
      r.cs.status === "active" &&
      r.service.billingType === "recurring_monthly" &&
      new Date(r.cs.purchasedAt) <= threeMonthsAgo
    )
    .reduce((s, r) => s + parseFloat(r.service.basePrice ?? r.service.price ?? "0"), 0);

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

  // Compute month-over-month revenue trend (current month vs previous month)
  const currentMonthRevenue = (months[11]?.oneTime ?? 0) + (months[11]?.recurring ?? 0);
  const prevMonthRevenue = (months[10]?.oneTime ?? 0) + (months[10]?.recurring ?? 0);

  // Clients without active projects: correct count from full distinct query (no limit)
  const clientsWithActiveProjectSet = new Set(
    clientsWithActiveProjectsRows
      .map(r => r.clientUserId)
      .filter((id): id is number => id !== null)
  );
  const clientsWithoutProjectsCount = Math.max(0, clientCount - clientsWithActiveProjectSet.size);

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
    clientCount,
    leadCount: allLeads.length,
    openLeadCount: openLeads.length,
    staleLeadCount: staleLeads.length,
    leadAgeBuckets,
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
      leads: openLeads.length,
      clients: clientCount,
      activeProjects: activeProjectCount,
    },
    mrrTrend: {
      current: Math.round(mrr * 100) / 100,
      threeMonthsAgo: Math.round(mrrThreeMonthsAgo * 100) / 100,
    },
  });
});

router.post("/admin/insights", requireAdmin, async (req: Request, res: Response) => {
  try {
    const now = new Date();
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const quarterStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);

    const [clientRows, allLeads, activeProjectCountRows, allInvoices, allClientServices] = await Promise.all([
      db.select({ cnt: count() }).from(usersTable).where(eq(usersTable.role, "client")),
      db.select().from(leadsTable).orderBy(desc(leadsTable.createdAt)),
      db.select({ cnt: count() }).from(projectsTable).where(eq(projectsTable.status, "active")),
      db.select().from(invoicesTable),
      db.select({ cs: clientServicesTable, service: servicesTable })
        .from(clientServicesTable)
        .innerJoin(servicesTable, eq(clientServicesTable.serviceId, servicesTable.id)),
    ]);

    const clientCount = Number(clientRows[0]?.cnt ?? 0);
    const activeProjectCount = Number(activeProjectCountRows[0]?.cnt ?? 0);
    const openLeads = allLeads.filter(l => !["converted", "archived"].includes(l.status));
    const staleLeads = openLeads.filter(l => new Date(l.createdAt) < fourteenDaysAgo);
    const paidInvoices = allInvoices.filter(i => i.status === "paid");
    const overdueInvoices = allInvoices.filter(i => i.status === "overdue");
    const unpaidInvoices = allInvoices.filter(i => ["due", "overdue"].includes(i.status));
    const invoicePaidRevenue = paidInvoices.reduce((s, i) => s + parseFloat(i.amount), 0);
    const purchaseRevenue = allClientServices.reduce((s, r) =>
      s + parseFloat(r.service.basePrice ?? r.service.price ?? "0"), 0);
    const totalRevenuePaid = invoicePaidRevenue + purchaseRevenue;
    const totalRevenueOutstanding = unpaidInvoices.reduce((s, i) => s + parseFloat(i.amount), 0);
    const overdueValue = overdueInvoices.reduce((s, i) => s + parseFloat(i.amount), 0);
    const mrr = allClientServices
      .filter(r => r.cs.status === "active" && r.service.billingType === "recurring_monthly")
      .reduce((s, r) => s + parseFloat(r.service.basePrice ?? r.service.price ?? "0"), 0);
    const clientsWithActiveProjectSet = new Set(allClientServices.filter(r => r.cs.status === "active").map(r => r.cs.clientUserId));
    const clientsWithoutProjectsCount = Math.max(0, clientCount - clientsWithActiveProjectSet.size);
    const currQuarterDeals = paidInvoices.filter(i => i.paidAt && new Date(i.paidAt) >= quarterStart);
    const avgDealSize = currQuarterDeals.length > 0
      ? currQuarterDeals.reduce((s, i) => s + parseFloat(i.amount), 0) / currQuarterDeals.length : 0;
    const fmtN = (n: number) => n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${n.toFixed(0)}`;

    const context = `BUSINESS METRICS — Shane McCaw Consulting (${now.toLocaleDateString("en-US", { month: "long", year: "numeric" })})

PIPELINE:
- Open leads: ${openLeads.length} of ${allLeads.length} total (${staleLeads.length} stale >14 days, no follow-up)
- Clients: ${clientCount}
- Active projects: ${activeProjectCount}
- Clients without an active project (upsell candidates): ${clientsWithoutProjectsCount}

REVENUE:
- Total paid revenue (all time): ${fmtN(totalRevenuePaid)} (${fmtN(invoicePaidRevenue)} invoices + ${fmtN(purchaseRevenue)} purchases)
- Monthly recurring revenue (MRR): ${fmtN(mrr)}
- Outstanding receivables: ${fmtN(totalRevenueOutstanding)} (${overdueInvoices.length} overdue at ${fmtN(overdueValue)})
- Avg deal size this quarter: ${avgDealSize > 0 ? fmtN(avgDealSize) : "no closed deals yet"}
- Invoices: ${paidInvoices.length} paid, ${unpaidInvoices.length} unpaid

SERVICES:
- Total client service purchases: ${allClientServices.length}
- Active recurring subscriptions: ${allClientServices.filter(r => r.cs.status === "active" && r.service.billingType === "recurring_monthly").length}`;

    const prompt = `You are a senior business analyst for Shane McCaw Consulting, a Microsoft 365 consulting practice run by a solo consultant. Analyze the business metrics below and return exactly 4 insight cards as a JSON array.

Cover these themes in order:
1. Pipeline health — lead velocity, stale follow-ups, conversion rate
2. Revenue & financial status — MRR, outstanding invoices, deal size
3. Client engagement — upsell opportunities, active project coverage, retention signals
4. Recommended next action — the single highest-impact action Shane should take today based on the data

Rules:
- Each narrative must be 2–4 specific, data-driven sentences referencing the actual numbers. No generic advice.
- The metric field must be a concise string (e.g. "7 stale leads" or "$4.2k overdue") that will be displayed as a callout badge.
- Return ONLY valid JSON, no markdown fences, no preamble.

Format:
[{"title":"...","narrative":"...","metric":"..."}]

Business data:
${context}`;

    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });

    const block = msg.content[0];
    if (block.type !== "text") { res.status(500).json({ error: "Unexpected AI response format" }); return; }

    let insights: Array<{ title: string; narrative: string; metric: string }>;
    try {
      const jsonMatch = block.text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error("No JSON array found in AI response");
      insights = JSON.parse(jsonMatch[0]) as typeof insights;
    } catch {
      res.status(500).json({ error: "Failed to parse AI response" });
      return;
    }

    res.json({ insights });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "AI insights generation failed";
    req.log.error({ err }, "POST /admin/insights failed");
    res.status(500).json({ error: errMsg });
  }
});

export default router;
