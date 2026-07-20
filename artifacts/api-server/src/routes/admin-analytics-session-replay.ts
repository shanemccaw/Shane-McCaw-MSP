import { Router, type IRouter, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { requireAdmin } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";

// Recorded, reviewable-after-the-fact session reconstruction — NOT a live/real-time
// viewer. Reads analytics_sessions / analytics_pageviews / analytics_site_events
// (schema confirmed via lib/db/src/schema/index.ts) and replays them as an ordered,
// timestamped sequence for a playback UI. No new tables, no write paths added here.
const log = logger.child({ channel: "growth.website-analytics" });

const router: IRouter = Router();
const adminLimiter = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false });

// drizzle-orm/node-postgres db.execute() returns a node-postgres QueryResult, not a
// plain array — same helper pattern as routes/analytics.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function execRows<T>(query: Parameters<typeof db.execute>[0]): Promise<T[]> {
  const result = await db.execute(query) as unknown as { rows: T[] };
  return result.rows ?? [];
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

function resolveRange(query: Record<string, unknown>): { since: Date; until: Date } {
  const until = new Date();
  if (query["start"] && query["end"]) {
    const s = new Date(String(query["start"]));
    const e = new Date(String(query["end"]));
    if (!isNaN(s.getTime()) && !isNaN(e.getTime()) && s <= e) {
      s.setHours(0, 0, 0, 0);
      const end = new Date(Math.min(e.getTime(), until.getTime()));
      end.setHours(23, 59, 59, 999);
      return { since: s, until: end };
    }
  }
  const range = String(query["range"] ?? "30d");
  if (range === "today") { const d = new Date(); d.setHours(0, 0, 0, 0); return { since: d, until }; }
  if (range === "7d") return { since: daysAgo(7), until };
  if (range === "90d") return { since: daysAgo(90), until };
  return { since: daysAgo(30), until };
}

// ─── Admin: session list (filterable by lead email / date range) ──────────────
router.get("/admin/analytics/session-replay/sessions", adminLimiter, requireAdmin, async (req: Request, res: Response) => {
  const { since, until } = resolveRange(req.query as Record<string, unknown>);
  const rawEmail = req.query["email"];
  const email = typeof rawEmail === "string" && rawEmail.trim() ? rawEmail.trim().toLowerCase() : null;
  const rawPage = req.query["page"];
  const page = typeof rawPage === "string" && Number.isFinite(Number(rawPage)) ? Math.max(1, parseInt(rawPage, 10)) : 1;
  const pageSize = 50;
  const offset = (page - 1) * pageSize;

  try {
    const rows = await execRows<{
      session_id: string; identified_email: string | null; entry_page: string;
      device_type: string | null; browser: string | null; country: string | null;
      started_at: string; last_seen_at: string; total_seconds: number; is_bounce: boolean;
      pageview_count: string; event_count: string;
    }>(sql`
      SELECT
        s.session_id, s.identified_email, s.entry_page, s.device_type, s.browser, s.country,
        s.started_at, s.last_seen_at, s.total_seconds, s.is_bounce,
        (SELECT count(*) FROM analytics_pageviews pv WHERE pv.session_id = s.session_id)::text AS pageview_count,
        (SELECT count(*) FROM analytics_site_events e WHERE e.session_id = s.session_id)::text AS event_count
      FROM analytics_sessions s
      WHERE s.started_at >= ${since} AND s.started_at <= ${until}
        ${email ? sql`AND s.identified_email ILIKE ${`%${email}%`}` : sql``}
      ORDER BY s.started_at DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `);

    const [totalRow] = await execRows<{ count: string }>(sql`
      SELECT count(*)::text AS count FROM analytics_sessions s
      WHERE s.started_at >= ${since} AND s.started_at <= ${until}
        ${email ? sql`AND s.identified_email ILIKE ${`%${email}%`}` : sql``}
    `);

    return res.json({
      sessions: rows.map(r => ({
        sessionId: r.session_id,
        identifiedEmail: r.identified_email,
        entryPage: r.entry_page,
        deviceType: r.device_type,
        browser: r.browser,
        country: r.country,
        startedAt: r.started_at,
        lastSeenAt: r.last_seen_at,
        totalSeconds: r.total_seconds,
        isBounce: r.is_bounce,
        pageviewCount: parseInt(r.pageview_count),
        eventCount: parseInt(r.event_count),
      })),
      page,
      pageSize,
      total: parseInt(totalRow?.count ?? "0"),
    });
  } catch (err) {
    log.warn({ err }, "session-replay session list failed");
    return res.status(500).json({ error: "Failed to load sessions" });
  }
});

// ─── Admin: single session — full ordered event sequence for reconstruction ───
router.get("/admin/analytics/session-replay/sessions/:sessionId", adminLimiter, requireAdmin, async (req: Request, res: Response) => {
  const { sessionId } = req.params;
  if (typeof sessionId !== "string" || !sessionId) {
    return res.status(400).json({ error: "sessionId is required" });
  }

  try {
    const [session] = await execRows<{
      session_id: string; identified_email: string | null; entry_page: string; referrer: string | null;
      utm_source: string | null; utm_medium: string | null; utm_campaign: string | null;
      device_type: string | null; browser: string | null; country: string | null;
      started_at: string; last_seen_at: string; total_seconds: number; is_bounce: boolean;
    }>(sql`
      SELECT session_id, identified_email, entry_page, referrer, utm_source, utm_medium, utm_campaign,
             device_type, browser, country, started_at, last_seen_at, total_seconds, is_bounce
      FROM analytics_sessions WHERE session_id = ${sessionId} LIMIT 1
    `);
    if (!session) return res.status(404).json({ error: "Session not found" });

    const pageviews = await execRows<{
      id: number; page: string; title: string | null;
      entered_at: string; exited_at: string | null; duration_seconds: number | null; max_scroll_pct: number;
    }>(sql`
      SELECT id, page, title, entered_at, exited_at, duration_seconds, max_scroll_pct
      FROM analytics_pageviews WHERE session_id = ${sessionId} ORDER BY entered_at ASC
    `);

    const events = await execRows<{
      id: number; page: string; event_type: string; element_label: string | null;
      element_href: string | null; metadata: Record<string, unknown> | null; created_at: string;
    }>(sql`
      SELECT id, page, event_type, element_label, element_href, metadata, created_at
      FROM analytics_site_events WHERE session_id = ${sessionId} ORDER BY created_at ASC
    `);

    // Merge pageview enter/exit boundaries with discrete site events into a single
    // chronological timeline — the raw material the playback UI scrubs through.
    type TimelineEntry = {
      ts: string;
      kind: string;
      page: string;
      label?: string | null;
      href?: string | null;
      metadata?: Record<string, unknown> | null;
      durationSeconds?: number | null;
      maxScrollPct?: number;
      title?: string | null;
    };
    const timeline: TimelineEntry[] = [];

    for (const pv of pageviews) {
      timeline.push({ ts: pv.entered_at, kind: "pageview_enter", page: pv.page, title: pv.title });
      if (pv.exited_at) {
        timeline.push({
          ts: pv.exited_at, kind: "pageview_exit", page: pv.page,
          durationSeconds: pv.duration_seconds, maxScrollPct: pv.max_scroll_pct,
        });
      }
    }
    for (const e of events) {
      timeline.push({
        ts: e.created_at, kind: e.event_type, page: e.page,
        label: e.element_label, href: e.element_href, metadata: e.metadata ?? {},
      });
    }
    timeline.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

    return res.json({
      session: {
        sessionId: session.session_id,
        identifiedEmail: session.identified_email,
        entryPage: session.entry_page,
        referrer: session.referrer,
        utmSource: session.utm_source,
        utmMedium: session.utm_medium,
        utmCampaign: session.utm_campaign,
        deviceType: session.device_type,
        browser: session.browser,
        country: session.country,
        startedAt: session.started_at,
        lastSeenAt: session.last_seen_at,
        totalSeconds: session.total_seconds,
        isBounce: session.is_bounce,
      },
      pageviews: pageviews.map(pv => ({
        id: pv.id, page: pv.page, title: pv.title,
        enteredAt: pv.entered_at, exitedAt: pv.exited_at,
        durationSeconds: pv.duration_seconds, maxScrollPct: pv.max_scroll_pct,
      })),
      timeline,
    });
  } catch (err) {
    log.warn({ err, sessionId }, "session-replay session detail failed");
    return res.status(500).json({ error: "Failed to load session" });
  }
});

export default router;
