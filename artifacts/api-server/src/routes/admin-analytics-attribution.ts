import { Router, type IRouter, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { requireAdmin } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";

// Multi-touch attribution reporting, built on analytics_sessions.identified_email.
//
// KNOWN DATA-MODEL LIMIT (confirmed via lib/db/src/schema/index.ts + the
// /analytics/session upsert in routes/analytics.ts): session_id is a durable,
// 2-year-cookie visitor id — one row per browser, ever. The upsert only bumps
// last_seen_at on repeat visits; utm_source/utm_medium/utm_campaign/referrer are
// frozen at that browser's very first-ever page load and never overwritten. So a
// lead's "touches" here are real, distinct identified browsers/devices over time
// (e.g. first found via a phone, later filled a form on a laptop from a different
// campaign) — not every individual return visit from the same browser, since
// same-browser return visits don't get their own UTM-carrying row. First-touch and
// last-touch below are honest given that grain; true per-visit multi-touch would
// need a new per-visit touchpoint table (not built here — flagged, not faked).
const log = logger.child({ channel: "growth.website-analytics" });

const router: IRouter = Router();
const adminLimiter = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false });

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

interface TouchRow {
  identified_email: string;
  touch_count: string;
  first_utm_source: string | null;
  first_utm_medium: string | null;
  first_utm_campaign: string | null;
  first_referrer: string | null;
  first_entry_page: string | null;
  first_touch_at: string;
  last_utm_source: string | null;
  last_utm_medium: string | null;
  last_utm_campaign: string | null;
  last_referrer: string | null;
  last_entry_page: string | null;
  last_touch_at: string;
  lead_name: string | null;
  lead_status: string | null;
}

// ─── Admin: per-lead first/last-touch rollup (filterable by date range / email) ─
router.get("/admin/analytics/attribution/leads", adminLimiter, requireAdmin, async (req: Request, res: Response) => {
  const { since, until } = resolveRange(req.query as Record<string, unknown>);
  const rawEmail = req.query["email"];
  const email = typeof rawEmail === "string" && rawEmail.trim() ? rawEmail.trim().toLowerCase() : null;
  const rawPage = req.query["page"];
  const page = typeof rawPage === "string" && Number.isFinite(Number(rawPage)) ? Math.max(1, parseInt(rawPage, 10)) : 1;
  const pageSize = 50;
  const offset = (page - 1) * pageSize;

  try {
    const rows = await execRows<TouchRow>(sql`
      WITH touches AS (
        SELECT session_id, identified_email, utm_source, utm_medium, utm_campaign, referrer, entry_page, started_at
        FROM analytics_sessions
        WHERE identified_email IS NOT NULL
          AND started_at >= ${since} AND started_at <= ${until}
          ${email ? sql`AND identified_email ILIKE ${`%${email}%`}` : sql``}
      ),
      first_touch AS (
        SELECT DISTINCT ON (identified_email) identified_email, utm_source, utm_medium, utm_campaign, referrer, entry_page, started_at
        FROM touches ORDER BY identified_email, started_at ASC
      ),
      last_touch AS (
        SELECT DISTINCT ON (identified_email) identified_email, utm_source, utm_medium, utm_campaign, referrer, entry_page, started_at
        FROM touches ORDER BY identified_email, started_at DESC
      ),
      counts AS (
        SELECT identified_email, count(*)::text AS touch_count FROM touches GROUP BY identified_email
      )
      SELECT
        c.identified_email,
        c.touch_count,
        ft.utm_source AS first_utm_source, ft.utm_medium AS first_utm_medium, ft.utm_campaign AS first_utm_campaign,
        ft.referrer AS first_referrer, ft.entry_page AS first_entry_page, ft.started_at AS first_touch_at,
        lt.utm_source AS last_utm_source, lt.utm_medium AS last_utm_medium, lt.utm_campaign AS last_utm_campaign,
        lt.referrer AS last_referrer, lt.entry_page AS last_entry_page, lt.started_at AS last_touch_at,
        l.name AS lead_name, l.status AS lead_status
      FROM counts c
      JOIN first_touch ft ON ft.identified_email = c.identified_email
      JOIN last_touch lt ON lt.identified_email = c.identified_email
      LEFT JOIN leads l ON lower(l.email) = c.identified_email
      ORDER BY lt.started_at DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `);

    const [totalRow] = await execRows<{ count: string }>(sql`
      SELECT count(DISTINCT identified_email)::text AS count
      FROM analytics_sessions
      WHERE identified_email IS NOT NULL
        AND started_at >= ${since} AND started_at <= ${until}
        ${email ? sql`AND identified_email ILIKE ${`%${email}%`}` : sql``}
    `);

    return res.json({
      leads: rows.map(r => ({
        email: r.identified_email,
        leadName: r.lead_name,
        leadStatus: r.lead_status,
        touchCount: parseInt(r.touch_count),
        firstTouch: {
          utmSource: r.first_utm_source, utmMedium: r.first_utm_medium, utmCampaign: r.first_utm_campaign,
          referrer: r.first_referrer, entryPage: r.first_entry_page, at: r.first_touch_at,
        },
        lastTouch: {
          utmSource: r.last_utm_source, utmMedium: r.last_utm_medium, utmCampaign: r.last_utm_campaign,
          referrer: r.last_referrer, entryPage: r.last_entry_page, at: r.last_touch_at,
        },
      })),
      page,
      pageSize,
      total: parseInt(totalRow?.count ?? "0"),
    });
  } catch (err) {
    log.warn({ err }, "attribution lead rollup failed");
    return res.status(500).json({ error: "Failed to load attribution report" });
  }
});

// ─── Admin: one lead's full multi-touch path, every identified browser/device ──
router.get("/admin/analytics/attribution/leads/:email", adminLimiter, requireAdmin, async (req: Request, res: Response) => {
  const rawEmail = req.params["email"];
  const email = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : "";
  if (!email) return res.status(400).json({ error: "email is required" });

  try {
    const touches = await execRows<{
      session_id: string; utm_source: string | null; utm_medium: string | null; utm_campaign: string | null;
      utm_content: string | null; utm_term: string | null; referrer: string | null; entry_page: string;
      device_type: string | null; browser: string | null; country: string | null;
      started_at: string; last_seen_at: string; total_seconds: number;
    }>(sql`
      SELECT session_id, utm_source, utm_medium, utm_campaign, utm_content, utm_term, referrer, entry_page,
             device_type, browser, country, started_at, last_seen_at, total_seconds
      FROM analytics_sessions
      WHERE identified_email = ${email}
      ORDER BY started_at ASC
    `);

    if (touches.length === 0) return res.status(404).json({ error: "No attributed touches found for this lead" });

    const path = touches.map(t => ({
      sessionId: t.session_id,
      utmSource: t.utm_source,
      utmMedium: t.utm_medium,
      utmCampaign: t.utm_campaign,
      utmContent: t.utm_content,
      utmTerm: t.utm_term,
      referrer: t.referrer,
      entryPage: t.entry_page,
      deviceType: t.device_type,
      browser: t.browser,
      country: t.country,
      startedAt: t.started_at,
      lastSeenAt: t.last_seen_at,
      totalSeconds: t.total_seconds,
    }));

    return res.json({
      email,
      touchCount: path.length,
      firstTouch: path[0],
      lastTouch: path[path.length - 1],
      path,
    });
  } catch (err) {
    log.warn({ err, email }, "attribution lead detail failed");
    return res.status(500).json({ error: "Failed to load lead attribution path" });
  }
});

export default router;
