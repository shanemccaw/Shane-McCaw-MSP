import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { sql, eq } from "drizzle-orm";
import { db, analyticsSessionsTable, analyticsPageviewsTable, analyticsSiteEventsTable } from "@workspace/db";
import { requireAdmin } from "../middlewares/requireAuth";
import { ingestIntentEvent, recomputeAndPersistHotScore, findLeadByEmail, isHighValuePage } from "../lib/lead-intent";
import { evaluateEngagementOfferForLead } from "../lib/engagement-offer-engine.ts";
import { logger } from "../lib/logger";

const router = Router();
const log = logger.child({ channel: "growth.website-analytics" });

const publicLimiter = rateLimit({ windowMs: 60_000, max: 300, standardHeaders: true, legacyHeaders: false });
const adminLimiter = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false });

// ─── DB helper ────────────────────────────────────────────────────────────────
// drizzle-orm/node-postgres db.execute() returns a node-postgres QueryResult,
// NOT a plain array. Access .rows to get the array of typed records.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function execRows<T>(query: Parameters<typeof db.execute>[0]): Promise<T[]> {
  const result = await db.execute(query) as unknown as { rows: T[] };
  return result.rows ?? [];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Resolve query params to a [since, until] date window.
 * Presets: today | 7d | 30d | 90d
 * Custom:  ?start=YYYY-MM-DD&end=YYYY-MM-DD (both required for custom mode)
 */
function resolveRange(query: Record<string, unknown>): { since: Date; until: Date } {
  const until = new Date();

  // Custom range: both start and end must be supplied
  if (query["start"] && query["end"]) {
    const s = new Date(String(query["start"]));
    const e = new Date(String(query["end"]));
    // Validate and clamp (refuse future end, refuse start > end)
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

// ─── Schemas ──────────────────────────────────────────────────────────────────
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
  country: z.string().max(100).optional(),
});

const pageviewSchema = z.object({
  sessionId: z.string().uuid(),
  page: z.string().max(500),
  title: z.string().max(500).optional(),
  durationSeconds: z.number().int().min(0).max(86400).optional(),
  maxScrollPct: z.number().int().min(0).max(100).optional(),
  pageviewId: z.number().int().optional(),
  exit: z.boolean().optional(),
});

const eventSchema = z.object({
  sessionId: z.string().uuid(),
  page: z.string().max(500),
  eventType: z.enum([
    "click", "nav_click", "cta_click", "outbound_click", "form_submit", "scroll_milestone",
    // Form-field-level tracking
    "form_viewed", "form_started", "form_abandoned", "field_focus", "field_blur", "field_error", "field_autofill_detected",
    // Error / friction tracking
    "error_404", "error_js", "error_api", "broken_link_click", "slow_page_load", "form_submission_failed",
    // Lightweight behavioral tracking (not full heatmap/session-replay — just discrete signal events)
    "rage_click", "dead_click", "idle_timeout",
    // CTA visibility/hover, pricing interaction granularity, funnel drop-off (website-rebuild-reference-v2.md §4)
    "cta_visible", "cta_hover", "plan_compare_interaction", "funnel_stage",
  ]),
  elementLabel: z.string().max(500).optional(),
  elementHref: z.string().max(500).optional(),
  metadata: z.record(z.unknown()).optional(),
});

// ─── Session helpers ──────────────────────────────────────────────────────────
async function upsertSession(d: z.infer<typeof sessionSchema>): Promise<void> {
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
      country: d.country,
    })
    .onConflictDoUpdate({
      target: analyticsSessionsTable.sessionId,
      set: { lastSeenAt: new Date() },
    });
}

async function finishPageview(pv: z.infer<typeof pageviewSchema>): Promise<void> {
  if (!pv.pageviewId) return;
  // Use execRows for raw SQL — drizzle/node-postgres returns QueryResult not array
  await execRows(sql`
    UPDATE analytics_pageviews
    SET exited_at = now(),
        duration_seconds = ${pv.durationSeconds ?? 0},
        max_scroll_pct = ${pv.maxScrollPct ?? 0}
    WHERE id = ${pv.pageviewId}
  `);
  await execRows(sql`
    UPDATE analytics_sessions
    SET last_seen_at = now(),
        total_seconds = total_seconds + ${pv.durationSeconds ?? 0},
        is_bounce = CASE
          WHEN (SELECT count(*) FROM analytics_pageviews WHERE session_id = ${pv.sessionId}) > 1
          THEN false ELSE is_bounce END
    WHERE session_id = ${pv.sessionId}
  `);
}

// ─── Public: session ──────────────────────────────────────────────────────────
router.post("/analytics/session", publicLimiter, async (req, res) => {
  const parsed = sessionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload" });
  try { await upsertSession(parsed.data); } catch { /* non-fatal */ }
  return res.json({ ok: true });
});

// ─── Public: identify — links a session to a known lead email ─────────────────
const identifySchema = z.object({
  sessionId: z.string().uuid(),
  email: z.string().email().max(500),
});

router.post("/analytics/identify", publicLimiter, async (req, res) => {
  const parsed = identifySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload" });
  try {
    await db.update(analyticsSessionsTable)
      .set({ identifiedEmail: parsed.data.email.toLowerCase().trim() })
      .where(eq(analyticsSessionsTable.sessionId, parsed.data.sessionId));
  } catch { /* non-fatal */ }
  return res.json({ ok: true });
});

// ─── Internal helper — fire site_visit intent event when a known lead hits a high-value page ──
async function maybeFireIntentEvent(sessionId: string, page: string): Promise<void> {
  try {
    const normalised = page.split("?")[0]?.replace(/\/$/, "") || "/";
    if (!(await isHighValuePage(normalised))) return;
    const [session] = await execRows<{ identified_email: string | null }>(
      sql`SELECT identified_email FROM analytics_sessions WHERE session_id = ${sessionId} LIMIT 1`
    );
    const email = session?.identified_email;
    if (!email) return;
    const lead = await findLeadByEmail(email);
    if (!lead) return;
    // Dedup: only fire one site_visit per (leadId, page, sessionId) triplet
    const [existing] = await execRows<{ id: number }>(sql`
      SELECT id FROM lead_intent_events
      WHERE lead_id = ${lead.id}
        AND event_type = 'site_visit'
        AND metadata->>'sessionId' = ${sessionId}
        AND metadata->>'page' = ${normalised}
      LIMIT 1
    `);
    if (existing) return;
    await ingestIntentEvent(lead.id, "site_visit", { page: normalised, sessionId });
    void evaluateEngagementOfferForLead(lead.id).catch(() => { /* non-fatal — never block the pageview response */ });
  } catch { /* non-fatal — never block the pageview response */ }
}

// ─── Internal helper — fire cta_click / form_submit intent events for identified leads ──
// Dedup is enforced at the DB layer via a partial unique index on
// (lead_id, event_type, metadata->>'sessionId', metadata->>'page').
// We use INSERT ... ON CONFLICT DO NOTHING so concurrent requests are safe — no
// read-then-insert race. Only if a row was actually inserted do we recompute the score.
async function maybeFireCtaFormIntentEvent(
  sessionId: string,
  page: string,
  eventType: "cta_click" | "form_submit",
  elementLabel?: string,
): Promise<void> {
  try {
    const normalised = page.split("?")[0]?.replace(/\/$/, "") || "/";
    const [session] = await execRows<{ identified_email: string | null }>(
      sql`SELECT identified_email FROM analytics_sessions WHERE session_id = ${sessionId} LIMIT 1`
    );
    const email = session?.identified_email;
    if (!email) return;
    const lead = await findLeadByEmail(email);
    if (!lead) return;
    // Atomic insert — the unique index on (lead_id, event_type, sessionId, page)
    // guarantees idempotency under concurrent requests; conflicting rows are silently dropped.
    const metadataJson = JSON.stringify({ page: normalised, sessionId, elementLabel });
    const [inserted] = await execRows<{ id: number }>(sql`
      INSERT INTO lead_intent_events (lead_id, event_type, metadata, occurred_at)
      VALUES (${lead.id}, ${eventType}, ${metadataJson}::jsonb, now())
      ON CONFLICT DO NOTHING
      RETURNING id
    `);
    // Only recompute score when a row was actually written (not a duplicate)
    if (!inserted) return;
    await recomputeAndPersistHotScore(lead.id);
    void evaluateEngagementOfferForLead(lead.id).catch(() => { /* non-fatal — never block the event response */ });
  } catch { /* non-fatal — never block the event response */ }
}

// ─── Public: pageview ─────────────────────────────────────────────────────────
router.post("/analytics/pageview", publicLimiter, async (req, res) => {
  const parsed = pageviewSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload" });
  const d = parsed.data;
  try {
    if (d.exit && d.pageviewId) {
      await finishPageview(d);
      return res.json({ ok: true });
    }
    const [row] = await db.insert(analyticsPageviewsTable)
      .values({ sessionId: d.sessionId, page: d.page, title: d.title, maxScrollPct: d.maxScrollPct ?? 0 })
      .returning({ id: analyticsPageviewsTable.id });
    void maybeFireIntentEvent(d.sessionId, d.page);
    return res.json({ ok: true, pageviewId: row?.id });
  } catch { return res.json({ ok: true }); }
});

// ─── Public: event ────────────────────────────────────────────────────────────
router.post("/analytics/event", publicLimiter, async (req, res) => {
  const parsed = eventSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload" });
  const d = parsed.data;
  try {
    await db.insert(analyticsSiteEventsTable).values({
      sessionId: d.sessionId, page: d.page, eventType: d.eventType,
      elementLabel: d.elementLabel, elementHref: d.elementHref, metadata: d.metadata ?? {},
    });
    log.info({ eventType: d.eventType, page: d.page }, "analytics event recorded");
  } catch { /* non-fatal */ }
  // Fire deduplicated intent events for high-signal event types
  if (d.eventType === "cta_click" || d.eventType === "form_submit") {
    void maybeFireCtaFormIntentEvent(d.sessionId, d.page, d.eventType, d.elementLabel);
  }
  return res.json({ ok: true });
});

// ─── Public: batch ────────────────────────────────────────────────────────────
const batchSchema = z.array(
  z.object({ type: z.enum(["session", "pageview", "event"]), payload: z.record(z.unknown()) })
).max(20);

router.post("/analytics/batch", publicLimiter, async (req, res) => {
  const parsed = batchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload" });
  for (const item of parsed.data) {
    try {
      if (item.type === "session") {
        const s = sessionSchema.safeParse(item.payload);
        if (s.success) await upsertSession(s.data);
      } else if (item.type === "pageview") {
        const pv = pageviewSchema.safeParse(item.payload);
        if (pv.success && pv.data.exit) await finishPageview(pv.data);
      } else if (item.type === "event") {
        const ev = eventSchema.safeParse(item.payload);
        if (ev.success) {
          await db.insert(analyticsSiteEventsTable).values({
            sessionId: ev.data.sessionId, page: ev.data.page, eventType: ev.data.eventType,
            elementLabel: ev.data.elementLabel, elementHref: ev.data.elementHref, metadata: ev.data.metadata ?? {},
          });
          if (ev.data.eventType === "cta_click" || ev.data.eventType === "form_submit") {
            void maybeFireCtaFormIntentEvent(ev.data.sessionId, ev.data.page, ev.data.eventType, ev.data.elementLabel);
          }
        }
      }
    } catch { /* skip failed items */ }
  }
  return res.json({ ok: true });
});

// ─── Admin: KPIs ──────────────────────────────────────────────────────────────
router.get("/admin/analytics/kpis", adminLimiter, requireAdmin, async (req, res) => {
  const { since, until } = resolveRange(req.query as Record<string, unknown>);
  try {
    const [visitors] = await execRows<{ count: string }>(sql`
      SELECT count(*)::text as count FROM analytics_sessions
      WHERE started_at >= ${since} AND started_at <= ${until}
    `);
    const [pageviews] = await execRows<{ count: string }>(sql`
      SELECT count(*)::text as count FROM analytics_pageviews
      WHERE entered_at >= ${since} AND entered_at <= ${until}
    `);
    const [avgTime] = await execRows<{ avg: string | null }>(sql`
      SELECT round(avg(duration_seconds))::text as avg FROM analytics_pageviews
      WHERE entered_at >= ${since} AND entered_at <= ${until}
        AND duration_seconds IS NOT NULL AND duration_seconds > 0
    `);
    const [bounceRow] = await execRows<{ rate: string | null }>(sql`
      SELECT round(100.0 * count(*) FILTER (WHERE is_bounce) / nullif(count(*), 0))::text as rate
      FROM analytics_sessions WHERE started_at >= ${since} AND started_at <= ${until}
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
  const { since, until } = resolveRange(req.query as Record<string, unknown>);
  try {
    const rows = await execRows<{ date: string; count: string }>(sql`
      SELECT to_char(entered_at, 'YYYY-MM-DD') as date, count(*)::text as count
      FROM analytics_pageviews
      WHERE entered_at >= ${since} AND entered_at <= ${until}
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
  const { since, until } = resolveRange(req.query as Record<string, unknown>);
  try {
    const rows = await execRows<{ page: string; views: string; avg_duration: string | null; bounces: string; total_sessions: string }>(sql`
      SELECT
        pv.page, count(*)::text as views,
        round(avg(pv.duration_seconds) FILTER (WHERE pv.duration_seconds > 0))::text as avg_duration,
        count(*) FILTER (WHERE s.is_bounce)::text as bounces,
        count(distinct pv.session_id)::text as total_sessions
      FROM analytics_pageviews pv
      LEFT JOIN analytics_sessions s ON s.session_id = pv.session_id
      WHERE pv.entered_at >= ${since} AND pv.entered_at <= ${until}
      GROUP BY pv.page ORDER BY count(*) DESC LIMIT 20
    `);
    return res.json(rows.map(r => ({
      page: r.page, views: parseInt(r.views),
      avgDuration: r.avg_duration ? parseInt(r.avg_duration) : null,
      bounceRate: r.total_sessions !== "0" ? Math.round((parseInt(r.bounces) / parseInt(r.total_sessions)) * 100) : 0,
    })));
  } catch (err) {
    req.log.warn({ err }, "analytics top pages failed");
    return res.status(500).json({ error: "Failed" });
  }
});

// ─── Admin: top events / clicks ───────────────────────────────────────────────
router.get("/admin/analytics/top-events", adminLimiter, requireAdmin, async (req, res) => {
  const { since, until } = resolveRange(req.query as Record<string, unknown>);
  try {
    const rows = await execRows<{ event_type: string; element_label: string | null; page: string; count: string }>(sql`
      SELECT event_type, element_label, page, count(*)::text as count
      FROM analytics_site_events
      WHERE created_at >= ${since} AND created_at <= ${until}
      GROUP BY event_type, element_label, page ORDER BY count(*) DESC LIMIT 30
    `);
    return res.json(rows.map(r => ({
      eventType: r.event_type, label: r.element_label ?? "(no label)", page: r.page, count: parseInt(r.count),
    })));
  } catch (err) {
    req.log.warn({ err }, "analytics top events failed");
    return res.status(500).json({ error: "Failed" });
  }
});

// ─── Admin: top CTAs with CTR ─────────────────────────────────────────────────
router.get("/admin/analytics/top-ctas", adminLimiter, requireAdmin, async (req, res) => {
  const { since, until } = resolveRange(req.query as Record<string, unknown>);
  try {
    const rows = await execRows<{ page: string; label: string | null; clicks: string; page_views: string }>(sql`
      SELECT
        e.page,
        e.element_label as label,
        count(*)::text as clicks,
        (SELECT count(*) FROM analytics_pageviews pv2
         WHERE pv2.page = e.page AND pv2.entered_at >= ${since} AND pv2.entered_at <= ${until})::text as page_views
      FROM analytics_site_events e
      WHERE e.event_type IN ('cta_click', 'nav_click')
        AND e.created_at >= ${since} AND e.created_at <= ${until}
      GROUP BY e.page, e.element_label
      ORDER BY count(*) DESC LIMIT 25
    `);
    return res.json(rows.map(r => {
      const clicks = parseInt(r.clicks);
      const pageViews = parseInt(r.page_views ?? "0");
      return {
        page: r.page,
        label: r.label ?? "(unlabeled)",
        clicks,
        pageViews,
        ctr: pageViews > 0 ? Math.round((clicks / pageViews) * 1000) / 10 : 0,
      };
    }));
  } catch (err) {
    req.log.warn({ err }, "analytics top ctas failed");
    return res.status(500).json({ error: "Failed" });
  }
});

// ─── Admin: traffic sources ───────────────────────────────────────────────────
router.get("/admin/analytics/top-referrers", adminLimiter, requireAdmin, async (req, res) => {
  const { since, until } = resolveRange(req.query as Record<string, unknown>);
  try {
    const [total] = await execRows<{ count: string }>(sql`
      SELECT count(*)::text as count FROM analytics_sessions
      WHERE started_at >= ${since} AND started_at <= ${until}
    `);
    const totalSessions = parseInt(total?.count ?? "1") || 1;
    const rows = await execRows<{ source: string | null; count: string }>(sql`
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
      WHERE started_at >= ${since} AND started_at <= ${until}
      GROUP BY source ORDER BY count(*) DESC LIMIT 20
    `);
    return res.json(rows.map(r => ({
      source: r.source ?? "direct", sessions: parseInt(r.count),
      pct: Math.round((parseInt(r.count) / totalSessions) * 100),
    })));
  } catch (err) {
    req.log.warn({ err }, "analytics referrers failed");
    return res.status(500).json({ error: "Failed" });
  }
});

// ─── Admin: outbound links ────────────────────────────────────────────────────
router.get("/admin/analytics/top-links", adminLimiter, requireAdmin, async (req, res) => {
  const { since, until } = resolveRange(req.query as Record<string, unknown>);
  try {
    const rows = await execRows<{ href: string | null; label: string | null; count: string }>(sql`
      SELECT element_href as href, element_label as label, count(*)::text as count
      FROM analytics_site_events
      WHERE event_type = 'outbound_click'
        AND created_at >= ${since} AND created_at <= ${until}
      GROUP BY element_href, element_label ORDER BY count(*) DESC LIMIT 20
    `);
    // Allowlist only http/https schemes — strip anything else to prevent javascript: injection
    return res.json(rows.map(r => {
      const raw = r.href ?? "";
      const safeHref = /^https?:\/\//i.test(raw) ? raw : "";
      return { href: safeHref, label: r.label ?? "", count: parseInt(r.count) };
    }));
  } catch (err) {
    req.log.warn({ err }, "analytics top links failed");
    return res.status(500).json({ error: "Failed" });
  }
});

// ─── Admin: overview card first-click breakdown ───────────────────────────────
// For each presentation that has at least one card_click event in the window,
// pick the FIRST card clicked (by viewed_at ASC), then aggregate across all
// presentations to produce a per-card count + percentage.
// Optional query params: clientId (integer), projectId (integer)
router.get("/admin/analytics/card-clicks", adminLimiter, requireAdmin, async (req, res) => {
  const { since, until } = resolveRange(req.query as Record<string, unknown>);
  const rawClientId = req.query["clientId"];
  const rawProjectId = req.query["projectId"];
  const clientId = rawClientId && !isNaN(Number(rawClientId)) ? Number(rawClientId) : null;
  const projectId = rawProjectId && !isNaN(Number(rawProjectId)) ? Number(rawProjectId) : null;

  try {
    let rows: { card_name: string; first_click_count: string }[];

    if (clientId !== null) {
      rows = await execRows<{ card_name: string; first_click_count: string }>(sql`
        WITH first_clicks AS (
          SELECT DISTINCT ON (pdv.presentation_id)
            pdv.presentation_id,
            pdv.card_name
          FROM presentation_doc_views pdv
          JOIN quick_win_presentations qwp ON qwp.id = pdv.presentation_id
          WHERE pdv.event_type = 'card_click'
            AND pdv.card_name IS NOT NULL
            AND pdv.viewed_at >= ${since}
            AND pdv.viewed_at <= ${until}
            AND qwp.client_user_id = ${clientId}
          ORDER BY pdv.presentation_id, pdv.viewed_at ASC
        )
        SELECT card_name, count(*)::text AS first_click_count
        FROM first_clicks
        GROUP BY card_name
        ORDER BY count(*) DESC
      `);
    } else if (projectId !== null) {
      rows = await execRows<{ card_name: string; first_click_count: string }>(sql`
        WITH first_clicks AS (
          SELECT DISTINCT ON (pdv.presentation_id)
            pdv.presentation_id,
            pdv.card_name
          FROM presentation_doc_views pdv
          JOIN quick_win_presentations qwp ON qwp.id = pdv.presentation_id
          WHERE pdv.event_type = 'card_click'
            AND pdv.card_name IS NOT NULL
            AND pdv.viewed_at >= ${since}
            AND pdv.viewed_at <= ${until}
            AND qwp.project_id = ${projectId}
          ORDER BY pdv.presentation_id, pdv.viewed_at ASC
        )
        SELECT card_name, count(*)::text AS first_click_count
        FROM first_clicks
        GROUP BY card_name
        ORDER BY count(*) DESC
      `);
    } else {
      rows = await execRows<{ card_name: string; first_click_count: string }>(sql`
        WITH first_clicks AS (
          SELECT DISTINCT ON (presentation_id)
            presentation_id,
            card_name
          FROM presentation_doc_views
          WHERE event_type = 'card_click'
            AND card_name IS NOT NULL
            AND viewed_at >= ${since}
            AND viewed_at <= ${until}
          ORDER BY presentation_id, viewed_at ASC
        )
        SELECT
          card_name,
          count(*)::text AS first_click_count
        FROM first_clicks
        GROUP BY card_name
        ORDER BY count(*) DESC
      `);
    }

    const total = rows.reduce((s, r) => s + parseInt(r.first_click_count), 0);
    return res.json(rows.map(r => ({
      cardName: r.card_name,
      firstClicks: parseInt(r.first_click_count),
      pct: total > 0 ? Math.round((parseInt(r.first_click_count) / total) * 1000) / 10 : 0,
    })));
  } catch (err) {
    req.log.warn({ err }, "analytics card-clicks failed");
    return res.status(500).json({ error: "Failed" });
  }
});

// ─── Admin: card-click first-click trend (weekly / monthly buckets) ───────────
// Returns per-period counts broken down by card name so the frontend can render
// a stacked bar chart. Auto-selects weekly buckets for ≤90-day ranges and
// monthly buckets otherwise (override with ?bucket=week or ?bucket=month).
// Optional query params: clientId (integer), projectId (integer)
router.get("/admin/analytics/card-clicks/trend", adminLimiter, requireAdmin, async (req, res) => {
  const { since, until } = resolveRange(req.query as Record<string, unknown>);
  const rawClientId = req.query["clientId"];
  const rawProjectId = req.query["projectId"];
  const clientId = rawClientId && !isNaN(Number(rawClientId)) ? Number(rawClientId) : null;
  const projectId = rawProjectId && !isNaN(Number(rawProjectId)) ? Number(rawProjectId) : null;

  // Auto-pick granularity: weekly for ≤90d, monthly for longer spans
  const spanDays = Math.round((until.getTime() - since.getTime()) / 86_400_000);
  const rawBucket = req.query["bucket"];
  const granularity = (rawBucket === "week" || rawBucket === "month")
    ? rawBucket
    : spanDays <= 90 ? "week" : "month";

  // Date format for period label depends on granularity
  const pgTrunc = granularity === "week" ? "week" : "month";
  const pgFmt = granularity === "week" ? "YYYY-MM-DD" : "YYYY-MM";

  try {
    type TrendRow = { period: string; card_name: string; cnt: string };
    let rows: TrendRow[];

    if (clientId !== null) {
      rows = await execRows<TrendRow>(sql`
        WITH first_clicks AS (
          SELECT DISTINCT ON (pdv.presentation_id)
            pdv.presentation_id,
            pdv.card_name,
            date_trunc(${pgTrunc}, pdv.viewed_at) AS bucket
          FROM presentation_doc_views pdv
          JOIN quick_win_presentations qwp ON qwp.id = pdv.presentation_id
          WHERE pdv.event_type = 'card_click'
            AND pdv.card_name IS NOT NULL
            AND pdv.viewed_at >= ${since}
            AND pdv.viewed_at <= ${until}
            AND qwp.client_user_id = ${clientId}
          ORDER BY pdv.presentation_id, pdv.viewed_at ASC
        )
        SELECT
          to_char(bucket, ${pgFmt}) AS period,
          card_name,
          count(*)::text AS cnt
        FROM first_clicks
        GROUP BY bucket, card_name
        ORDER BY bucket, card_name
      `);
    } else if (projectId !== null) {
      rows = await execRows<TrendRow>(sql`
        WITH first_clicks AS (
          SELECT DISTINCT ON (pdv.presentation_id)
            pdv.presentation_id,
            pdv.card_name,
            date_trunc(${pgTrunc}, pdv.viewed_at) AS bucket
          FROM presentation_doc_views pdv
          JOIN quick_win_presentations qwp ON qwp.id = pdv.presentation_id
          WHERE pdv.event_type = 'card_click'
            AND pdv.card_name IS NOT NULL
            AND pdv.viewed_at >= ${since}
            AND pdv.viewed_at <= ${until}
            AND qwp.project_id = ${projectId}
          ORDER BY pdv.presentation_id, pdv.viewed_at ASC
        )
        SELECT
          to_char(bucket, ${pgFmt}) AS period,
          card_name,
          count(*)::text AS cnt
        FROM first_clicks
        GROUP BY bucket, card_name
        ORDER BY bucket, card_name
      `);
    } else {
      rows = await execRows<TrendRow>(sql`
        WITH first_clicks AS (
          SELECT DISTINCT ON (presentation_id)
            presentation_id,
            card_name,
            date_trunc(${pgTrunc}, viewed_at) AS bucket
          FROM presentation_doc_views
          WHERE event_type = 'card_click'
            AND card_name IS NOT NULL
            AND viewed_at >= ${since}
            AND viewed_at <= ${until}
          ORDER BY presentation_id, viewed_at ASC
        )
        SELECT
          to_char(bucket, ${pgFmt}) AS period,
          card_name,
          count(*)::text AS cnt
        FROM first_clicks
        GROUP BY bucket, card_name
        ORDER BY bucket, card_name
      `);
    }

    // Pivot into { period, [cardName]: count } objects for Recharts
    const periodMap = new Map<string, Record<string, string | number>>();
    const cardNames = new Set<string>();
    for (const row of rows) {
      cardNames.add(row.card_name);
      const existing = periodMap.get(row.period);
      const entry: Record<string, string | number> = existing ?? { period: row.period };
      entry[row.card_name] = parseInt(row.cnt);
      periodMap.set(row.period, entry);
    }

    return res.json({
      granularity,
      cardNames: Array.from(cardNames).sort(),
      periods: Array.from(periodMap.values()),
    });
  } catch (err) {
    req.log.warn({ err }, "analytics card-clicks/trend failed");
    return res.status(500).json({ error: "Failed" });
  }
});

// ─── Admin: card-click filter options (clients + projects with data) ──────────
// Returns the distinct set of clients and projects that have at least one
// card_click event — used to populate the filter dropdown on the engagement tab.
router.get("/admin/analytics/card-clicks/filters", adminLimiter, requireAdmin, async (req, res) => {
  try {
    const clients = await execRows<{ id: string; name: string | null; email: string }>(sql`
      SELECT DISTINCT u.id::text, u.name, u.email
      FROM presentation_doc_views pdv
      JOIN quick_win_presentations qwp ON qwp.id = pdv.presentation_id
      JOIN users u ON u.id = qwp.client_user_id
      WHERE pdv.event_type = 'card_click'
        AND qwp.client_user_id IS NOT NULL
      ORDER BY u.name, u.email
    `);

    const projects = await execRows<{ id: string; title: string }>(sql`
      SELECT DISTINCT p.id::text, p.title
      FROM presentation_doc_views pdv
      JOIN quick_win_presentations qwp ON qwp.id = pdv.presentation_id
      JOIN projects p ON p.id = qwp.project_id
      WHERE pdv.event_type = 'card_click'
        AND qwp.project_id IS NOT NULL
      ORDER BY p.title
    `);

    return res.json({
      clients: clients.map(c => ({ id: parseInt(c.id), label: c.name ?? c.email })),
      projects: projects.map(p => ({ id: parseInt(p.id), label: p.title })),
    });
  } catch (err) {
    req.log.warn({ err }, "analytics card-clicks/filters failed");
    return res.status(500).json({ error: "Failed" });
  }
});

// ─── Admin: live visitors ─────────────────────────────────────────────────────
router.get("/admin/analytics/live", adminLimiter, requireAdmin, async (req, res) => {
  try {
    const cutoff = new Date(Date.now() - 5 * 60 * 1000);
    const [row] = await execRows<{ count: string }>(sql`
      SELECT count(*)::text as count FROM analytics_sessions WHERE last_seen_at >= ${cutoff}
    `);
    return res.json({ live: parseInt(row?.count ?? "0") });
  } catch (err) {
    req.log.warn({ err }, "analytics live failed");
    return res.status(500).json({ error: "Failed" });
  }
});

// ─── Admin: live visitors — SSE stream ────────────────────────────────────────
// Pushes { live: number } every 5 seconds. Auth is Bearer JWT (requireAdmin),
// so the client must use fetchWithAuth rather than native EventSource.
router.get("/admin/analytics/live-stream", requireAdmin, (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (live: number): void => {
    res.write(`data: ${JSON.stringify({ live })}\n\n`);
  };

  const push = (): void => {
    const cutoff = new Date(Date.now() - 5 * 60 * 1000);
    execRows<{ count: string }>(sql`
      SELECT count(*)::text as count FROM analytics_sessions WHERE last_seen_at >= ${cutoff}
    `)
      .then(([row]) => send(parseInt(row?.count ?? "0")))
      .catch(() => send(0));
  };

  push();
  const interval = setInterval(push, 5_000);

  req.on("close", () => {
    clearInterval(interval);
  });
});

export default router;
