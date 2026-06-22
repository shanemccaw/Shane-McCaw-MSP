import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db, analyticsSessionsTable, analyticsPageviewsTable, analyticsSiteEventsTable } from "@workspace/db";
import { requireAdmin } from "../middlewares/requireAuth";

const router = Router();

const publicLimiter = rateLimit({ windowMs: 60_000, max: 300, standardHeaders: true, legacyHeaders: false });
const adminLimiter = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false });

// ─── Helpers ──────────────────────────────────────────────────────────────────
function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

function rangeStart(range: string): Date {
  if (range === "today") { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
  if (range === "7d") return daysAgo(7);
  if (range === "90d") return daysAgo(90);
  return daysAgo(30); // default 30d
}

// ─── Public: session ──────────────────────────────────────────────────────────
const sessionSchema = z.object({
  sessionId: z.string().uuid(),
  entryPage: z.string().max(500).optional(),
  referrer: z.string().max(500).optional(),
  utmSource: z.string().max(200).optional(),
  utmMedium: z.string().max(200).optional(),
  utmCampaign: z.string().max(200).optional(),
  utmContent: z.string().max(200).optional(),
  utmTerm: z.string().max(200).optional(),
  deviceType: z.string().max(50).optional(),
  browser: z.string().max(100).optional(),
});

router.post("/analytics/session", publicLimiter, async (req, res) => {
  const parsed = sessionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload" });
  const d = parsed.data;
  try {
    await db.insert(analyticsSessionsTable)
      .values({
        sessionId: d.sessionId,
        entryPage: d.entryPage ?? "/",
        referrer: d.referrer,
        utmSource: d.utmSource,
        utmMedium: d.utmMedium,
        utmCampaign: d.utmCampaign,
        utmContent: d.utmContent,
        utmTerm: d.utmTerm,
        deviceType: d.deviceType,
        browser: d.browser,
      })
      .onConflictDoUpdate({
        target: analyticsSessionsTable.sessionId,
        set: { lastSeenAt: new Date() },
      });
  } catch { /* non-fatal */ }
  return res.json({ ok: true });
});

// ─── Public: pageview ─────────────────────────────────────────────────────────
const pageviewSchema = z.object({
  sessionId: z.string().uuid(),
  page: z.string().max(500),
  title: z.string().max(500).optional(),
  durationSeconds: z.number().int().min(0).max(86400).optional(),
  maxScrollPct: z.number().int().min(0).max(100).optional(),
  pageviewId: z.number().int().optional(),
  exit: z.boolean().optional(),
});

router.post("/analytics/pageview", publicLimiter, async (req, res) => {
  const parsed = pageviewSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload" });
  const d = parsed.data;
  try {
    if (d.exit && d.pageviewId) {
      await db.execute(sql`
        UPDATE analytics_pageviews
        SET exited_at = now(),
            duration_seconds = ${d.durationSeconds ?? 0},
            max_scroll_pct = ${d.maxScrollPct ?? 0}
        WHERE id = ${d.pageviewId}
      `);
      await db.execute(sql`
        UPDATE analytics_sessions
        SET last_seen_at = now(),
            total_seconds = total_seconds + ${d.durationSeconds ?? 0},
            is_bounce = CASE WHEN (SELECT count(*) FROM analytics_pageviews WHERE session_id = ${d.sessionId}) > 1 THEN false ELSE is_bounce END
        WHERE session_id = ${d.sessionId}
      `);
      return res.json({ ok: true });
    }
    const [row] = await db.insert(analyticsPageviewsTable)
      .values({
        sessionId: d.sessionId,
        page: d.page,
        title: d.title,
        maxScrollPct: d.maxScrollPct ?? 0,
      })
      .returning({ id: analyticsPageviewsTable.id });
    return res.json({ ok: true, pageviewId: row?.id });
  } catch { return res.json({ ok: true }); }
});

// ─── Public: event ────────────────────────────────────────────────────────────
const eventSchema = z.object({
  sessionId: z.string().uuid(),
  page: z.string().max(500),
  eventType: z.enum(["click", "cta_click", "outbound_click", "form_submit", "scroll_milestone"]),
  elementLabel: z.string().max(500).optional(),
  elementHref: z.string().max(500).optional(),
  metadata: z.record(z.unknown()).optional(),
});

router.post("/analytics/event", publicLimiter, async (req, res) => {
  const parsed = eventSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload" });
  const d = parsed.data;
  try {
    await db.insert(analyticsSiteEventsTable).values({
      sessionId: d.sessionId,
      page: d.page,
      eventType: d.eventType,
      elementLabel: d.elementLabel,
      elementHref: d.elementHref,
      metadata: d.metadata ?? {},
    });
  } catch { /* non-fatal */ }
  return res.json({ ok: true });
});

// ─── Public: batch (used on beforeunload via sendBeacon) ──────────────────────
const batchSchema = z.array(
  z.object({
    type: z.enum(["session", "pageview", "event"]),
    payload: z.record(z.unknown()),
  })
).max(20);

router.post("/analytics/batch", publicLimiter, async (req, res) => {
  const parsed = batchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload" });
  for (const item of parsed.data) {
    try {
      if (item.type === "pageview") {
        const pv = pageviewSchema.safeParse(item.payload);
        if (pv.success && pv.data.exit && pv.data.pageviewId) {
          await db.execute(sql`
            UPDATE analytics_pageviews
            SET exited_at = now(),
                duration_seconds = ${pv.data.durationSeconds ?? 0},
                max_scroll_pct = ${pv.data.maxScrollPct ?? 0}
            WHERE id = ${pv.data.pageviewId}
          `);
          await db.execute(sql`
            UPDATE analytics_sessions
            SET last_seen_at = now(),
                total_seconds = total_seconds + ${pv.data.durationSeconds ?? 0},
                is_bounce = CASE WHEN (SELECT count(*) FROM analytics_pageviews WHERE session_id = ${pv.data.sessionId}) > 1 THEN false ELSE is_bounce END
            WHERE session_id = ${pv.data.sessionId}
          `);
        }
      } else if (item.type === "event") {
        const ev = eventSchema.safeParse(item.payload);
        if (ev.success) {
          await db.insert(analyticsSiteEventsTable).values({
            sessionId: ev.data.sessionId,
            page: ev.data.page,
            eventType: ev.data.eventType,
            elementLabel: ev.data.elementLabel,
            elementHref: ev.data.elementHref,
            metadata: ev.data.metadata ?? {},
          });
        }
      }
    } catch { /* skip failed items */ }
  }
  return res.json({ ok: true });
});

// ─── Admin: KPIs ──────────────────────────────────────────────────────────────
router.get("/admin/analytics/kpis", adminLimiter, requireAdmin, async (req, res) => {
  const range = String(req.query.range ?? "30d");
  const since = rangeStart(range);
  try {
    const [visitors] = await db.execute<{ count: string }>(sql`
      SELECT count(*)::text as count FROM analytics_sessions WHERE started_at >= ${since}
    `);
    const [pageviews] = await db.execute<{ count: string }>(sql`
      SELECT count(*)::text as count FROM analytics_pageviews WHERE entered_at >= ${since}
    `);
    const [avgTime] = await db.execute<{ avg: string | null }>(sql`
      SELECT round(avg(duration_seconds))::text as avg FROM analytics_pageviews
      WHERE entered_at >= ${since} AND duration_seconds IS NOT NULL AND duration_seconds > 0
    `);
    const [bounceRow] = await db.execute<{ rate: string | null }>(sql`
      SELECT round(100.0 * count(*) FILTER (WHERE is_bounce) / nullif(count(*), 0))::text as rate
      FROM analytics_sessions WHERE started_at >= ${since}
    `);
    return res.json({
      visitors: parseInt(visitors?.count ?? "0"),
      pageviews: parseInt(pageviews?.count ?? "0"),
      avgTimeOnPage: parseInt(avgTime?.avg ?? "0"),
      bounceRate: parseFloat(bounceRow?.rate ?? "0"),
    });
  } catch (err) {
    req.log.warn({ err }, "analytics kpis failed");
    return res.status(500).json({ error: "Failed" });
  }
});

// ─── Admin: pageviews time series ─────────────────────────────────────────────
router.get("/admin/analytics/pageviews-series", adminLimiter, requireAdmin, async (req, res) => {
  const range = String(req.query.range ?? "30d");
  const since = rangeStart(range);
  try {
    const rows = await db.execute<{ date: string; count: string }>(sql`
      SELECT to_char(entered_at, 'YYYY-MM-DD') as date, count(*)::text as count
      FROM analytics_pageviews
      WHERE entered_at >= ${since}
      GROUP BY date ORDER BY date
    `);
    return res.json(rows.map(r => ({ date: r.date, views: parseInt(r.count) })));
  } catch (err) {
    req.log.warn({ err }, "analytics series failed");
    return res.status(500).json({ error: "Failed" });
  }
});

// ─── Admin: top pages ─────────────────────────────────────────────────────────
router.get("/admin/analytics/top-pages", adminLimiter, requireAdmin, async (req, res) => {
  const range = String(req.query.range ?? "30d");
  const since = rangeStart(range);
  try {
    const rows = await db.execute<{ page: string; views: string; avg_duration: string | null; bounces: string; total_sessions: string }>(sql`
      SELECT
        pv.page,
        count(*)::text as views,
        round(avg(pv.duration_seconds) FILTER (WHERE pv.duration_seconds > 0))::text as avg_duration,
        count(*) FILTER (WHERE s.is_bounce)::text as bounces,
        count(distinct pv.session_id)::text as total_sessions
      FROM analytics_pageviews pv
      LEFT JOIN analytics_sessions s ON s.session_id = pv.session_id
      WHERE pv.entered_at >= ${since}
      GROUP BY pv.page
      ORDER BY count(*) DESC
      LIMIT 20
    `);
    return res.json(rows.map(r => ({
      page: r.page,
      views: parseInt(r.views),
      avgDuration: r.avg_duration ? parseInt(r.avg_duration) : null,
      bounceRate: r.total_sessions !== "0" ? Math.round((parseInt(r.bounces) / parseInt(r.total_sessions)) * 100) : 0,
    })));
  } catch (err) {
    req.log.warn({ err }, "analytics top pages failed");
    return res.status(500).json({ error: "Failed" });
  }
});

// ─── Admin: top events / CTAs ─────────────────────────────────────────────────
router.get("/admin/analytics/top-events", adminLimiter, requireAdmin, async (req, res) => {
  const range = String(req.query.range ?? "30d");
  const since = rangeStart(range);
  try {
    const rows = await db.execute<{ event_type: string; element_label: string | null; page: string; count: string }>(sql`
      SELECT event_type, element_label, page, count(*)::text as count
      FROM analytics_site_events
      WHERE created_at >= ${since}
      GROUP BY event_type, element_label, page
      ORDER BY count(*) DESC
      LIMIT 30
    `);
    return res.json(rows.map(r => ({
      eventType: r.event_type,
      label: r.element_label ?? "(no label)",
      page: r.page,
      count: parseInt(r.count),
    })));
  } catch (err) {
    req.log.warn({ err }, "analytics top events failed");
    return res.status(500).json({ error: "Failed" });
  }
});

// ─── Admin: traffic sources ───────────────────────────────────────────────────
router.get("/admin/analytics/top-referrers", adminLimiter, requireAdmin, async (req, res) => {
  const range = String(req.query.range ?? "30d");
  const since = rangeStart(range);
  try {
    const [total] = await db.execute<{ count: string }>(sql`
      SELECT count(*)::text as count FROM analytics_sessions WHERE started_at >= ${since}
    `);
    const totalSessions = parseInt(total?.count ?? "1") || 1;
    const rows = await db.execute<{ source: string | null; count: string }>(sql`
      SELECT
        COALESCE(utm_source,
          CASE WHEN referrer IS NULL OR referrer = '' THEN 'direct'
               WHEN referrer LIKE '%google%' THEN 'google'
               WHEN referrer LIKE '%linkedin%' THEN 'linkedin'
               WHEN referrer LIKE '%bing%' THEN 'bing'
               ELSE regexp_replace(referrer, '^https?://([^/]+).*', '\\1')
          END
        ) as source,
        count(*)::text as count
      FROM analytics_sessions
      WHERE started_at >= ${since}
      GROUP BY source ORDER BY count(*) DESC LIMIT 20
    `);
    return res.json(rows.map(r => ({
      source: r.source ?? "direct",
      sessions: parseInt(r.count),
      pct: Math.round((parseInt(r.count) / totalSessions) * 100),
    })));
  } catch (err) {
    req.log.warn({ err }, "analytics referrers failed");
    return res.status(500).json({ error: "Failed" });
  }
});

// ─── Admin: outbound links ────────────────────────────────────────────────────
router.get("/admin/analytics/top-links", adminLimiter, requireAdmin, async (req, res) => {
  const range = String(req.query.range ?? "30d");
  const since = rangeStart(range);
  try {
    const rows = await db.execute<{ href: string | null; label: string | null; count: string }>(sql`
      SELECT element_href as href, element_label as label, count(*)::text as count
      FROM analytics_site_events
      WHERE event_type = 'outbound_click' AND created_at >= ${since}
      GROUP BY element_href, element_label ORDER BY count(*) DESC LIMIT 20
    `);
    return res.json(rows.map(r => ({ href: r.href ?? "", label: r.label ?? "", count: parseInt(r.count) })));
  } catch (err) {
    req.log.warn({ err }, "analytics top links failed");
    return res.status(500).json({ error: "Failed" });
  }
});

// ─── Admin: live visitors ─────────────────────────────────────────────────────
router.get("/admin/analytics/live", adminLimiter, requireAdmin, async (req, res) => {
  try {
    const cutoff = new Date(Date.now() - 5 * 60 * 1000);
    const [row] = await db.execute<{ count: string }>(sql`
      SELECT count(*)::text as count FROM analytics_sessions WHERE last_seen_at >= ${cutoff}
    `);
    return res.json({ live: parseInt(row?.count ?? "0") });
  } catch (err) {
    req.log.warn({ err }, "analytics live failed");
    return res.status(500).json({ error: "Failed" });
  }
});

export default router;
