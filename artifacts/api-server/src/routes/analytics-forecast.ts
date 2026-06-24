import { Router, type Request, type Response } from "express";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { db, revenueForecastsTable, invoicesTable, clientServicesTable, servicesTable, opportunitiesTable } from "@workspace/db";
import { eq, desc, and, gte } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";

const router = Router();

// ── GET /api/analytics/revenue/forecast ──────────────────────────────────────
// Returns the most-recently-generated forecast rows + narrative.
router.get("/api/analytics/revenue/forecast", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const rows = await db.select().from(revenueForecastsTable)
      .orderBy(desc(revenueForecastsTable.generatedAt), revenueForecastsTable.period)
      .limit(12);

    if (rows.length === 0) {
      res.json({ rows: [], narrative: null, generatedAt: null });
      return;
    }

    const generatedAt = rows[0].generatedAt;
    const narrative = rows[0].narrative ?? null;

    const sortedRows = [...rows].sort((a, b) => a.period.localeCompare(b.period));

    res.json({
      rows: sortedRows.map(r => ({
        period: r.period,
        forecast: parseFloat(r.forecast),
        lowerBound: parseFloat(r.lowerBound),
        upperBound: parseFloat(r.upperBound),
      })),
      narrative,
      generatedAt,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to fetch forecast";
    res.status(500).json({ error: msg });
  }
});

// ── POST /api/analytics/revenue/forecast/generate ────────────────────────────
// Reads historical revenue data, computes a 12-month linear+seasonal forecast,
// calls Claude for a narrative, persists, and returns the result.
router.post("/api/analytics/revenue/forecast/generate", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const now = new Date();
    const twoYearsAgo = new Date(now);
    twoYearsAgo.setFullYear(now.getFullYear() - 2);

    const [paidInvoices, activeSubscriptions, pipelineOpps] = await Promise.all([
      db.select({ amount: invoicesTable.amount, paidAt: invoicesTable.paidAt, billingType: servicesTable.billingType })
        .from(invoicesTable)
        .leftJoin(clientServicesTable, eq(invoicesTable.stripeSessionId, clientServicesTable.stripeSubscriptionId))
        .leftJoin(servicesTable, eq(clientServicesTable.serviceId, servicesTable.id))
        .where(and(eq(invoicesTable.status, "paid"), gte(invoicesTable.paidAt, twoYearsAgo)))
        .limit(500),
      db.select({ serviceId: clientServicesTable.serviceId })
        .from(clientServicesTable)
        .where(eq(clientServicesTable.status, "active"))
        .innerJoin(servicesTable, and(
          eq(clientServicesTable.serviceId, servicesTable.id),
          eq(servicesTable.billingType, "recurring_monthly"),
        )),
      db.select({ scoreSnapshot: opportunitiesTable.scoreSnapshot })
        .from(opportunitiesTable)
        .orderBy(desc(opportunitiesTable.createdAt))
        .limit(20),
    ]);

    // Build historical monthly revenue map (YYYY-MM → amount)
    const monthlyMap: Record<string, number> = {};
    for (const inv of paidInvoices) {
      if (!inv.paidAt) continue;
      const key = inv.paidAt.toISOString().slice(0, 7);
      monthlyMap[key] = (monthlyMap[key] ?? 0) + parseFloat(inv.amount);
    }

    // Fill last 12 months (some may be zero)
    const historicalMonths: Array<{ period: string; revenue: number }> = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      historicalMonths.push({ period: key, revenue: monthlyMap[key] ?? 0 });
    }

    // Simple linear regression over historical data
    const n = historicalMonths.length;
    const xVals = historicalMonths.map((_, i) => i);
    const yVals = historicalMonths.map(m => m.revenue);
    const xMean = xVals.reduce((a, b) => a + b, 0) / n;
    const yMean = yVals.reduce((a, b) => a + b, 0) / n;
    const slope = xVals.reduce((sum, x, i) => sum + (x - xMean) * (yVals[i] - yMean), 0)
      / (xVals.reduce((sum, x) => sum + (x - xMean) ** 2, 0) || 1);
    const intercept = yMean - slope * xMean;

    // Standard deviation for confidence bands (±1 std deviation)
    const residuals = yVals.map((y, i) => y - (intercept + slope * i));
    const stdDev = Math.sqrt(residuals.reduce((s, r) => s + r ** 2, 0) / n);

    // MRR baseline from active subscriptions
    const mrrEstimate = activeSubscriptions.length * 2500; // conservative per-sub estimate

    // Pipeline conversion estimate: sum high-score opps with 20% close rate
    const pipelineContribution = pipelineOpps
      .filter(o => o.scoreSnapshot >= 70)
      .reduce((s, o) => s + (o.scoreSnapshot / 100) * 5000 * 0.2, 0);

    // Build 12-month forecast
    const forecastRows: Array<{ period: string; forecast: number; lowerBound: number; upperBound: number }> = [];
    for (let i = 1; i <= 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const period = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const xForecast = n + i - 1;
      const trendValue = intercept + slope * xForecast;

      // Seasonal smoothing: month-of-year weight based on historical average
      const monthOfYear = d.getMonth();
      const sameMonthRevs = historicalMonths.filter(m => parseInt(m.period.slice(5, 7)) - 1 === monthOfYear);
      const seasonalAdj = sameMonthRevs.length > 0
        ? (sameMonthRevs.reduce((s, m) => s + m.revenue, 0) / sameMonthRevs.length - yMean) * 0.3
        : 0;

      const baseForecast = Math.max(0, trendValue + seasonalAdj + mrrEstimate + pipelineContribution / 12);
      const lower = Math.max(0, baseForecast - stdDev * 1.5);
      const upper = baseForecast + stdDev * 1.5;

      forecastRows.push({ period, forecast: Math.round(baseForecast), lowerBound: Math.round(lower), upperBound: Math.round(upper) });
    }

    // Ask Claude for a narrative summary
    const historicalSummary = historicalMonths.slice(-6).map(m => `${m.period}: $${m.revenue.toLocaleString()}`).join(", ");
    const forecastSummary = forecastRows.slice(0, 3).map(r => `${r.period}: $${r.forecast.toLocaleString()} (range $${r.lowerBound.toLocaleString()}–$${r.upperBound.toLocaleString()})`).join(", ");

    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 512,
      messages: [
        {
          role: "user",
          content: `You are Shane McCaw's revenue analyst. Write a 2-3 sentence plain-language narrative summarizing the 12-month revenue forecast below. Mention the trajectory (growing/flat/declining), highlight the 3-month outlook, and note any risk. Be concise and direct — no fluff.

Historical (last 6 months): ${historicalSummary}
Forecast (next 3 months): ${forecastSummary}
MRR baseline from ${activeSubscriptions.length} active recurring subscriptions.
Pipeline contribution from ${pipelineOpps.filter(o => o.scoreSnapshot >= 70).length} high-scoring opportunities.

Narrative:`,
        },
      ],
    });

    const narrativeBlock = msg.content[0];
    const narrative = narrativeBlock.type === "text" ? narrativeBlock.text.trim() : null;

    // Persist: delete old forecasts (keep last batch only per period)
    // We store generatedAt on each row — all rows from the same generation share the same timestamp
    const genAt = new Date();

    const toInsert = forecastRows.map((r, idx) => ({
      period: r.period,
      forecast: String(r.forecast),
      lowerBound: String(r.lowerBound),
      upperBound: String(r.upperBound),
      narrative: idx === 0 ? narrative ?? undefined : undefined,
      generatedAt: genAt,
    }));

    const inserted = await db.insert(revenueForecastsTable).values(toInsert).returning();

    res.json({
      rows: forecastRows,
      narrative,
      generatedAt: genAt,
      stored: inserted.length,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "Forecast generation failed";
    res.status(500).json({ error: errMsg });
  }
});

export default router;
