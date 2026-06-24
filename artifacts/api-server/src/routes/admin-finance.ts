import { Router, type Request, type Response } from "express";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import {
  db, invoicesTable, usersTable, projectsTable, contractsTable,
} from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";

const router = Router();

function agingBucket(dueDate: Date | null): string | null {
  if (!dueDate) return null;
  const days = Math.floor((Date.now() - new Date(dueDate).getTime()) / (1000 * 60 * 60 * 24));
  if (days <= 30) return "0-30 days";
  if (days <= 60) return "31-60 days";
  if (days <= 90) return "61-90 days";
  return "90+ days";
}

// ── GET /admin/invoices/:id ──────────────────────────────────────────────────
router.get("/admin/invoices/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [invoice] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, id));
  if (!invoice) { res.status(404).json({ error: "Not found" }); return; }

  const [client] = await db.select({
    id: usersTable.id,
    name: usersTable.name,
    email: usersTable.email,
    company: usersTable.company,
  }).from(usersTable).where(eq(usersTable.id, invoice.clientUserId));

  const project = invoice.projectId
    ? ((await db.select({
        id: projectsTable.id,
        title: projectsTable.title,
        status: projectsTable.status,
        projectType: projectsTable.projectType,
      }).from(projectsTable).where(eq(projectsTable.id, invoice.projectId)))[0] ?? null)
    : null;

  const contractWhere = invoice.projectId
    ? and(eq(contractsTable.userId, invoice.clientUserId), eq(contractsTable.projectId, invoice.projectId))
    : eq(contractsTable.userId, invoice.clientUserId);

  const [contract] = await db.select({
    id: contractsTable.id,
    contractVersion: contractsTable.contractVersion,
    signedAt: contractsTable.signedAt,
    serviceId: contractsTable.serviceId,
    projectId: contractsTable.projectId,
    stripeSessionId: contractsTable.stripeSessionId,
    pdfFilename: contractsTable.pdfFilename,
  }).from(contractsTable).where(contractWhere).orderBy(desc(contractsTable.signedAt)).limit(1);

  const aging = invoice.status === "overdue" ? agingBucket(invoice.dueDate) : null;

  res.json({
    ...invoice,
    client: client ?? null,
    project,
    contract: contract ?? null,
    agingBucket: aging,
  });
});

// ── POST /admin/invoices/:id/ai-summary ────────────────────────────────────
router.post("/admin/invoices/:id/ai-summary", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [invoice] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, id));
  if (!invoice) { res.status(404).json({ error: "Not found" }); return; }

  const [client] = await db.select({
    name: usersTable.name, email: usersTable.email, company: usersTable.company,
  }).from(usersTable).where(eq(usersTable.id, invoice.clientUserId));

  const clientInvoices = await db.select().from(invoicesTable)
    .where(eq(invoicesTable.clientUserId, invoice.clientUserId))
    .orderBy(desc(invoicesTable.createdAt)).limit(20);

  const totalPaid = clientInvoices
    .filter(i => i.status === "paid")
    .reduce((s, i) => s + parseFloat(i.amount), 0);
  const overdueCount = clientInvoices.filter(i => i.status === "overdue").length;
  const aging = invoice.status === "overdue" ? agingBucket(invoice.dueDate) : null;
  const isRetainer = invoice.invoiceType === "retainer";

  const prompt = `You are a financial advisor for a Microsoft 365 consulting firm. Analyze this invoice and provide a concise JSON assessment.

Invoice: #${invoice.invoiceNumber}
Type: ${invoice.invoiceType}
Amount: $${invoice.amount} ${invoice.currency.toUpperCase()}
Status: ${invoice.status}${aging ? ` (aging: ${aging})` : ""}
Due: ${invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString() : "N/A"}
Coupon: ${invoice.couponCode ?? "none"}${invoice.discountAmount ? ` (discount: -$${invoice.discountAmount})` : ""}
${isRetainer ? `Subscription: ${invoice.stripeSubscriptionId ?? "N/A"}
Billing cycle: ${invoice.billingCycleStart ? new Date(invoice.billingCycleStart).toLocaleDateString() : "N/A"} – ${invoice.billingCycleEnd ? new Date(invoice.billingCycleEnd).toLocaleDateString() : "N/A"}` : ""}

Client: ${client?.name ?? "Unknown"} at ${client?.company ?? "Unknown company"}
Client lifetime value (paid): $${totalPaid.toFixed(2)}
Client overdue invoice count (all time): ${overdueCount}
Total client invoices: ${clientInvoices.length}

Return ONLY a JSON object with these exact keys:
{
  "churnProbability": ${isRetainer ? '"low"|"medium"|"high"' : "null"},
  "revenueImpact": "one sentence on revenue risk or opportunity",
  "serviceProfitabilityInsight": "one sentence on service profitability",
  "clientPurchaseBehavior": "one sentence on payment behaviour",
  "recommendedActions": ["action 1", "action 2", "action 3"]
}`;

  try {
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 700,
      messages: [{ role: "user", content: prompt }],
    });
    const text = msg.content[0]?.type === "text" ? msg.content[0].text.trim() : "{}";
    const jsonStart = text.indexOf("{");
    const jsonEnd = text.lastIndexOf("}");
    const jsonStr = jsonStart >= 0 && jsonEnd > jsonStart ? text.slice(jsonStart, jsonEnd + 1) : "{}";
    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
    res.json(parsed);
  } catch (err) {
    req.log.error({ err }, "AI invoice summary failed");
    res.status(500).json({ error: "AI summary generation failed. Please try again." });
  }
});

// ── GET /admin/finance/summary ─────────────────────────────────────────────
router.get("/admin/finance/summary", requireAdmin, async (_req: Request, res: Response) => {
  const twelveMonthsAgo = new Date();
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

  const allInvoices = await db.select().from(invoicesTable);

  const retainerActive = allInvoices.filter(
    i => i.invoiceType === "retainer" && (i.status === "due" || i.status === "paid"),
  );
  const mrr = retainerActive.reduce((s, i) => s + parseFloat(i.amount), 0);
  const arr = mrr * 12;

  const paidInvoices = allInvoices.filter(i => i.status === "paid");
  const totalRevenue = paidInvoices.reduce((s, i) => s + parseFloat(i.amount), 0);

  const overdueInvoices = allInvoices.filter(i => i.status === "overdue");
  const overdueCount = overdueInvoices.length;
  const overdueAmount = overdueInvoices.reduce((s, i) => s + parseFloat(i.amount), 0);

  const recentPaid = paidInvoices.filter(
    i => new Date(i.paidAt ?? i.createdAt) >= twelveMonthsAgo,
  );
  const byMonth: Record<string, number> = {};
  for (const inv of recentPaid) {
    const d = new Date(inv.paidAt ?? inv.createdAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    byMonth[key] = (byMonth[key] ?? 0) + parseFloat(inv.amount);
  }
  const revenueByMonth = Object.entries(byMonth)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, revenue]) => ({ month, revenue }));

  const couponMap: Record<string, { count: number; totalDiscount: number }> = {};
  for (const inv of allInvoices.filter(i => !!i.couponCode)) {
    const code = inv.couponCode!;
    if (!couponMap[code]) couponMap[code] = { count: 0, totalDiscount: 0 };
    couponMap[code].count++;
    couponMap[code].totalDiscount += parseFloat(inv.discountAmount ?? "0");
  }
  const couponUsage = Object.entries(couponMap)
    .map(([code, stats]) => ({ code, ...stats }))
    .sort((a, b) => b.count - a.count);

  res.json({ mrr, arr, totalRevenue, overdueCount, overdueAmount, revenueByMonth, couponUsage });
});

export default router;
