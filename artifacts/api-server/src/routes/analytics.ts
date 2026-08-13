// Admin Panel Analytics dashboard (#118), GA4-sourced.
//
// Replaces the homegrown site-analytics tables retired in #123 (417b89d8),
// which deleted this file entirely along with analytics_sessions/
// analytics_pageviews/analytics_site_events ingestion. Traffic tracking now
// lives in GA4 (gtag), not this database — these routes are read-only
// reporting against the GA4 Data API.
//
// Card-click reporting (Portal Engagement tab) is rebuilt on a GA4 custom
// event (`card_click`, event-scoped custom dimension `card_name`) rather
// than the old presentation_doc_views-backed first-click/client/project
// breakdown — aggregate counts only, no client/project filtering, per
// Shane's explicit scope decision on #118. Querying it requires Shane to
// register `card_name` as an event-scoped custom dimension in the GA4
// console first (not retroactive) — not done as part of this change.
//
// GA4's Data API has no clientId/user dimension, so lead_staging.ga4ClientId
// (#116) cannot be joined against these reports — true per-lead attribution
// would require BigQuery export, which this epic deliberately does not use.
// The Traffic Sources section below is an aggregate source/medium/campaign
// breakdown, not a per-lead view.

import { Router, type Response } from "express";
import { requireAdmin } from "../middlewares/requireAuth";
import {
  ga4CredentialsPresent,
  resolveGa4DateRange,
  rowValue,
  runReport,
  runRealtimeReport,
  type Ga4Row,
} from "../lib/ga4-client.ts";
import { logger } from "../lib/logger";

const router = Router();
const log = logger.child({ channel: "growth.website-analytics" });

const CARD_CLICK_EVENT_FILTER = {
  filter: { fieldName: "eventName", stringFilter: { matchType: "EXACT" as const, value: "card_click" } },
};

function notConfigured(res: Response): void {
  res.status(503).json({ error: "GA4 is not configured yet" });
}

// ─── Admin: KPIs ──────────────────────────────────────────────────────────────
router.get("/admin/analytics/kpis", requireAdmin, async (req, res) => {
  if (!ga4CredentialsPresent()) return notConfigured(res);
  try {
    const dateRange = resolveGa4DateRange(req.query as Record<string, unknown>);
    const response = await runReport({
      dateRanges: [dateRange],
      metrics: [
        { name: "activeUsers" },
        { name: "screenPageViews" },
        { name: "averageSessionDuration" },
        { name: "bounceRate" },
      ],
    });
    const row = response.rows?.[0];
    const visitors = row ? Math.round(Number(rowValue(row, "metric", 0)) || 0) : 0;
    const pageviews = row ? Math.round(Number(rowValue(row, "metric", 1)) || 0) : 0;
    const avgTimeOnPage = row ? Math.round(Number(rowValue(row, "metric", 2)) || 0) : 0;
    const bounceRate = row ? Math.round((Number(rowValue(row, "metric", 3)) || 0) * 100) : 0;
    return res.json({ visitors, pageviews, avgTimeOnPage, bounceRate });
  } catch (err) {
    log.warn({ err }, "analytics kpis failed");
    return res.status(500).json({ error: "Failed" });
  }
});

// ─── Admin: pageviews time series ─────────────────────────────────────────────
router.get("/admin/analytics/pageviews-series", requireAdmin, async (req, res) => {
  if (!ga4CredentialsPresent()) return notConfigured(res);
  try {
    const dateRange = resolveGa4DateRange(req.query as Record<string, unknown>);
    const response = await runReport({
      dateRanges: [dateRange],
      dimensions: [{ name: "date" }],
      metrics: [{ name: "screenPageViews" }],
      orderBys: [{ dimension: { dimensionName: "date" } }],
    });
    const rows = response.rows ?? [];
    return res.json(rows.map(r => ({
      date: ga4DateToIso(rowValue(r, "dimension", 0)),
      views: Math.round(Number(rowValue(r, "metric", 0)) || 0),
    })));
  } catch (err) {
    log.warn({ err }, "analytics pageviews-series failed");
    return res.status(500).json({ error: "Failed" });
  }
});

// ─── Admin: top pages ─────────────────────────────────────────────────────────
router.get("/admin/analytics/top-pages", requireAdmin, async (req, res) => {
  if (!ga4CredentialsPresent()) return notConfigured(res);
  try {
    const dateRange = resolveGa4DateRange(req.query as Record<string, unknown>);
    const response = await runReport({
      dateRanges: [dateRange],
      dimensions: [{ name: "pagePath" }],
      metrics: [{ name: "screenPageViews" }, { name: "averageSessionDuration" }, { name: "bounceRate" }],
      orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
      limit: 20,
    });
    const rows = response.rows ?? [];
    return res.json(rows.map(r => ({
      page: rowValue(r, "dimension", 0) || "/",
      views: Math.round(Number(rowValue(r, "metric", 0)) || 0),
      avgDuration: Math.round(Number(rowValue(r, "metric", 1)) || 0) || null,
      bounceRate: Math.round((Number(rowValue(r, "metric", 2)) || 0) * 100),
    })));
  } catch (err) {
    log.warn({ err }, "analytics top-pages failed");
    return res.status(500).json({ error: "Failed" });
  }
});

// ─── Admin: top events ────────────────────────────────────────────────────────
router.get("/admin/analytics/top-events", requireAdmin, async (req, res) => {
  if (!ga4CredentialsPresent()) return notConfigured(res);
  try {
    const dateRange = resolveGa4DateRange(req.query as Record<string, unknown>);
    const response = await runReport({
      dateRanges: [dateRange],
      dimensions: [{ name: "eventName" }],
      metrics: [{ name: "eventCount" }],
      orderBys: [{ metric: { metricName: "eventCount" }, desc: true }],
      limit: 15,
    });
    const rows = response.rows ?? [];
    return res.json(rows.map(r => ({
      eventName: rowValue(r, "dimension", 0) || "(not set)",
      count: Math.round(Number(rowValue(r, "metric", 0)) || 0),
    })));
  } catch (err) {
    log.warn({ err }, "analytics top-events failed");
    return res.status(500).json({ error: "Failed" });
  }
});

// ─── Admin: traffic sources (source / medium) ─────────────────────────────────
router.get("/admin/analytics/top-referrers", requireAdmin, async (req, res) => {
  if (!ga4CredentialsPresent()) return notConfigured(res);
  try {
    const dateRange = resolveGa4DateRange(req.query as Record<string, unknown>);
    const [totalResponse, breakdownResponse] = await Promise.all([
      runReport({ dateRanges: [dateRange], metrics: [{ name: "sessions" }] }),
      runReport({
        dateRanges: [dateRange],
        dimensions: [{ name: "sessionSource" }, { name: "sessionMedium" }],
        metrics: [{ name: "sessions" }],
        orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
        limit: 15,
      }),
    ]);
    const totalSessions = Math.round(Number(rowValue(totalResponse.rows?.[0] ?? {}, "metric", 0)) || 0) || 1;
    const rows = breakdownResponse.rows ?? [];
    return res.json(rows.map(r => {
      const sessions = Math.round(Number(rowValue(r, "metric", 0)) || 0);
      return {
        source: rowValue(r, "dimension", 0) || "(direct)",
        medium: rowValue(r, "dimension", 1) || "(none)",
        sessions,
        pct: Math.round((sessions / totalSessions) * 100),
      };
    }));
  } catch (err) {
    log.warn({ err }, "analytics top-referrers failed");
    return res.status(500).json({ error: "Failed" });
  }
});

// ─── Admin: top campaigns — folds in Attribution.tsx's function (#123 deleted ─
// that page; the issue asks to fold its UTM-campaign breakdown in here rather
// than resurrect it). Excludes GA4's "(not set)" placeholder for sessions with
// no campaign — that's noise, not a real attribution row.
router.get("/admin/analytics/top-campaigns", requireAdmin, async (req, res) => {
  if (!ga4CredentialsPresent()) return notConfigured(res);
  try {
    const dateRange = resolveGa4DateRange(req.query as Record<string, unknown>);
    const response = await runReport({
      dateRanges: [dateRange],
      dimensions: [{ name: "sessionCampaignName" }],
      metrics: [{ name: "sessions" }],
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: 20,
    });
    const rows = (response.rows ?? [])
      .map(r => ({ campaign: rowValue(r, "dimension", 0), sessions: Math.round(Number(rowValue(r, "metric", 0)) || 0) }))
      .filter(r => r.campaign && r.campaign !== "(not set)")
      .slice(0, 10);
    const total = rows.reduce((s, r) => s + r.sessions, 0) || 1;
    return res.json(rows.map(r => ({ ...r, pct: Math.round((r.sessions / total) * 100) })));
  } catch (err) {
    log.warn({ err }, "analytics top-campaigns failed");
    return res.status(500).json({ error: "Failed" });
  }
});

// ─── Admin: overview card engagement (GA4 custom event, aggregate only) ───────
router.get("/admin/analytics/card-clicks", requireAdmin, async (req, res) => {
  if (!ga4CredentialsPresent()) return notConfigured(res);
  try {
    const dateRange = resolveGa4DateRange(req.query as Record<string, unknown>);
    const response = await runReport({
      dateRanges: [dateRange],
      dimensions: [{ name: "customEvent:card_name" }],
      metrics: [{ name: "eventCount" }],
      dimensionFilter: CARD_CLICK_EVENT_FILTER,
      orderBys: [{ metric: { metricName: "eventCount" }, desc: true }],
      limit: 20,
    });
    const rows = (response.rows ?? []).map(r => ({
      cardName: rowValue(r, "dimension", 0) || "(unlabeled)",
      clicks: Math.round(Number(rowValue(r, "metric", 0)) || 0),
    }));
    const total = rows.reduce((s, r) => s + r.clicks, 0) || 1;
    return res.json(rows.map(r => ({ ...r, pct: Math.round((r.clicks / total) * 1000) / 10 })));
  } catch (err) {
    log.warn({ err }, "analytics card-clicks failed");
    return res.status(500).json({ error: "Failed" });
  }
});

// ─── Admin: card-click trend (weekly / monthly buckets) ───────────────────────
router.get("/admin/analytics/card-clicks/trend", requireAdmin, async (req, res) => {
  if (!ga4CredentialsPresent()) return notConfigured(res);
  try {
    const dateRange = resolveGa4DateRange(req.query as Record<string, unknown>);
    const response = await runReport({
      dateRanges: [dateRange],
      dimensions: [{ name: "date" }, { name: "customEvent:card_name" }],
      metrics: [{ name: "eventCount" }],
      dimensionFilter: CARD_CLICK_EVENT_FILTER,
      orderBys: [{ dimension: { dimensionName: "date" } }],
      limit: 10000,
    });
    const rows = response.rows ?? [];
    const spanDays = ga4RangeSpanDays(dateRange);
    const granularity: "week" | "month" = spanDays <= 90 ? "week" : "month";

    const periodMap = new Map<string, Record<string, string | number>>();
    const cardNames = new Set<string>();
    for (const r of rows) {
      const cardName = rowValue(r, "dimension", 1);
      if (!cardName) continue;
      cardNames.add(cardName);
      const date = parseGa4Date(rowValue(r, "dimension", 0));
      const period = granularity === "week" ? isoWeekStart(date) : monthKey(date);
      const entry = periodMap.get(period) ?? { period };
      const count = Math.round(Number(rowValue(r, "metric", 0)) || 0);
      entry[cardName] = (Number(entry[cardName]) || 0) + count;
      periodMap.set(period, entry);
    }

    return res.json({
      granularity,
      cardNames: Array.from(cardNames).sort(),
      periods: Array.from(periodMap.values()).sort((a, b) => String(a["period"]).localeCompare(String(b["period"]))),
    });
  } catch (err) {
    log.warn({ err }, "analytics card-clicks/trend failed");
    return res.status(500).json({ error: "Failed" });
  }
});

// ─── Admin: live visitors ─────────────────────────────────────────────────────
async function fetchLiveCount(): Promise<number> {
  const response = await runRealtimeReport({ metrics: [{ name: "activeUsers" }] });
  const row = response.rows?.[0];
  return row ? Math.round(Number(rowValue(row, "metric", 0)) || 0) : 0;
}

router.get("/admin/analytics/live", requireAdmin, async (_req, res) => {
  if (!ga4CredentialsPresent()) return notConfigured(res);
  try {
    return res.json({ live: await fetchLiveCount() });
  } catch (err) {
    log.warn({ err }, "analytics live failed");
    return res.status(500).json({ error: "Failed" });
  }
});

// ─── Admin: live visitors — SSE stream ────────────────────────────────────────
// Pushes { live: number } every 30s. Widened from the old DB-backed version's
// 5s cadence — GA4's Realtime API has a much tighter quota than a local query,
// and every open admin tab holds its own connection.
router.get("/admin/analytics/live-stream", requireAdmin, (_req, res) => {
  if (!ga4CredentialsPresent()) { res.status(503).end(); return; }
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (live: number): void => {
    res.write(`data: ${JSON.stringify({ live })}\n\n`);
  };

  const push = (): void => {
    fetchLiveCount().then(send).catch(() => send(0));
  };

  push();
  const interval = setInterval(push, 30_000);

  _req.on("close", () => {
    clearInterval(interval);
  });
});

// ─── Date helpers ───────────────────────────────────────────────────────────
function ga4DateToIso(yyyymmdd: string): string {
  if (!/^\d{8}$/.test(yyyymmdd)) return yyyymmdd;
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

function parseGa4Date(yyyymmdd: string): Date {
  const iso = ga4DateToIso(yyyymmdd);
  return new Date(`${iso}T00:00:00Z`);
}

function isoWeekStart(d: Date): string {
  const day = d.getUTCDay();
  const diff = (day === 0 ? -6 : 1) - day; // Monday of this week (ISO)
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() + diff);
  return monday.toISOString().slice(0, 10);
}

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function ga4RangeSpanDays(range: { startDate: string; endDate: string }): number {
  const relDays: Record<string, number> = { today: 0, "7daysAgo": 7, "30daysAgo": 30, "90daysAgo": 90 };
  if (range.startDate in relDays) return relDays[range.startDate] ?? 30;
  const start = new Date(range.startDate);
  const end = new Date(range.endDate);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return 30;
  return Math.round((end.getTime() - start.getTime()) / 86_400_000);
}

export default router;
