import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { requireAdmin } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";

/**
 * Heatmap visualization for the raw click/scroll capture already live on the
 * public website (website-rebuild-reference-v2.md §4 — rage_click, dead_click,
 * idle_timeout, plus general click/nav_click/cta_click/outbound_click, all of
 * which carry {x, y} pageX/pageY coordinates in analytics_site_events.metadata,
 * confirmed via artifacts/shane-mccaw-consulting/src/lib/analytics.ts).
 *
 * Known data limitation, not fixed here (would require a frontend tracker
 * change, out of this task's scope): viewport width is never captured, only
 * document-relative click coordinates. x is normalized to a percentage of an
 * assumed reference width per device_type bucket (desktop/tablet/mobile — the
 * only device granularity analytics_sessions actually stores) so cross-device
 * clicks land in roughly the right column; this is an approximation, not an
 * exact per-visitor viewport measurement. There is no continuous mousemove
 * capture either — "mouse position" data is click coordinates only.
 */

const router = Router();
const log = logger.child({ channel: "growth.website-analytics" });

const adminLimiter = rateLimit({ windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false });

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

// ─── Constants ──────────────────────────────────────────────────────────────
const GRID_COLS = 24;
const GRID_ROWS = 32;
const REFERENCE_WIDTH_PX: Record<string, number> = { desktop: 1440, tablet: 834, mobile: 390 };
const DEFAULT_REFERENCE_WIDTH_PX = REFERENCE_WIDTH_PX["desktop"];

// Hardcoded, not user-controlled — safe to inline as a raw SQL literal list.
const CLICK_TYPES_SQL_LIST = "'click','cta_click','nav_click','outbound_click'";
const FRICTION_TYPES_SQL_LIST = "'rage_click','dead_click'";
const ALL_POSITIONED_TYPES_SQL_LIST = `${CLICK_TYPES_SQL_LIST},${FRICTION_TYPES_SQL_LIST}`;

const deviceTypeSchema = z.enum(["all", "desktop", "tablet", "mobile"]).default("all");

// ─── Admin: which pages have positioned click data (page picker) ─────────────
router.get("/admin/analytics/heatmap/pages", adminLimiter, requireAdmin, async (req, res) => {
  const { since, until } = resolveRange(req.query as Record<string, unknown>);
  try {
    const rows = await execRows<{ page: string; events: string; pageviews: string }>(sql`
      SELECT
        e.page,
        count(*)::text AS events,
        (SELECT count(*) FROM analytics_pageviews pv WHERE pv.page = e.page AND pv.entered_at >= ${since} AND pv.entered_at <= ${until})::text AS pageviews
      FROM analytics_site_events e
      WHERE e.event_type IN (${sql.raw(ALL_POSITIONED_TYPES_SQL_LIST)})
        AND e.metadata->>'x' IS NOT NULL AND e.metadata->>'y' IS NOT NULL
        AND e.created_at >= ${since} AND e.created_at <= ${until}
      GROUP BY e.page
      ORDER BY count(*) DESC
      LIMIT 50
    `);
    return res.json(rows.map(r => ({ page: r.page, positionedEvents: parseInt(r.events), pageviews: parseInt(r.pageviews) })));
  } catch (err) {
    req.log.warn({ err }, "heatmap pages failed");
    return res.status(500).json({ error: "Failed" });
  }
});

// ─── Admin: aggregated heatmap grid + scroll-depth for one page ──────────────
router.get("/admin/analytics/heatmap", adminLimiter, requireAdmin, async (req, res) => {
  const pageParsed = z.string().min(1).max(500).safeParse(req.query["page"]);
  if (!pageParsed.success) return res.status(400).json({ error: "page query param is required" });
  const page = pageParsed.data;

  const deviceParsed = deviceTypeSchema.safeParse(req.query["deviceType"]);
  const deviceType = deviceParsed.success ? deviceParsed.data : "all";

  const { since, until } = resolveRange(req.query as Record<string, unknown>);

  try {
    // Estimate page height from the 99th percentile of observed click y-coordinates
    // (document-relative pageY) — clamped to a sane range so a single outlier click
    // (e.g. a hidden footer element) can't blow out the whole grid's row scale.
    const [boundsRow] = await execRows<{ max_y: string | null }>(sql`
      SELECT GREATEST(400, LEAST(20000, COALESCE(
        percentile_cont(0.99) WITHIN GROUP (ORDER BY (e.metadata->>'y')::numeric), 800
      )))::text AS max_y
      FROM analytics_site_events e
      LEFT JOIN analytics_sessions s ON s.session_id = e.session_id
      WHERE e.page = ${page}
        AND e.created_at >= ${since} AND e.created_at <= ${until}
        AND e.event_type IN (${sql.raw(ALL_POSITIONED_TYPES_SQL_LIST)})
        AND e.metadata->>'x' IS NOT NULL AND e.metadata->>'y' IS NOT NULL
        ${deviceType === "all" ? sql`` : sql`AND s.device_type = ${deviceType}`}
    `);
    const maxYPx = Math.round(parseFloat(boundsRow?.max_y ?? "800"));

    const cellRows = await execRows<{ kind: string; col: number; row: number; cnt: string }>(sql`
      WITH points AS (
        SELECT
          (e.metadata->>'x')::numeric AS x,
          (e.metadata->>'y')::numeric AS y,
          CASE s.device_type
            WHEN 'desktop' THEN ${REFERENCE_WIDTH_PX["desktop"]}
            WHEN 'tablet' THEN ${REFERENCE_WIDTH_PX["tablet"]}
            WHEN 'mobile' THEN ${REFERENCE_WIDTH_PX["mobile"]}
            ELSE ${DEFAULT_REFERENCE_WIDTH_PX}
          END AS ref_width,
          CASE WHEN e.event_type IN (${sql.raw(FRICTION_TYPES_SQL_LIST)}) THEN 'friction' ELSE 'click' END AS kind
        FROM analytics_site_events e
        LEFT JOIN analytics_sessions s ON s.session_id = e.session_id
        WHERE e.page = ${page}
          AND e.created_at >= ${since} AND e.created_at <= ${until}
          AND e.event_type IN (${sql.raw(ALL_POSITIONED_TYPES_SQL_LIST)})
          AND e.metadata->>'x' IS NOT NULL AND e.metadata->>'y' IS NOT NULL
          ${deviceType === "all" ? sql`` : sql`AND s.device_type = ${deviceType}`}
      )
      SELECT
        kind,
        LEAST(${GRID_COLS - 1}, FLOOR(LEAST(100, GREATEST(0, x / ref_width * 100)) / (100.0 / ${GRID_COLS})))::int AS col,
        LEAST(${GRID_ROWS - 1}, FLOOR(LEAST(100, GREATEST(0, y / ${maxYPx} * 100)) / (100.0 / ${GRID_ROWS})))::int AS row,
        count(*)::text AS cnt
      FROM points
      GROUP BY kind, col, row
    `);

    const clickCells: { col: number; row: number; count: number }[] = [];
    const frictionCells: { col: number; row: number; count: number }[] = [];
    let totalClicks = 0;
    let totalFriction = 0;
    for (const r of cellRows) {
      const count = parseInt(r.cnt);
      const cell = { col: r.col, row: r.row, count };
      if (r.kind === "friction") { frictionCells.push(cell); totalFriction += count; }
      else { clickCells.push(cell); totalClicks += count; }
    }

    // Continuous scroll-depth: analytics_pageviews.max_scroll_pct is captured on every
    // page exit (not just at the 25/50/75/100% milestone events), so this is a real
    // cumulative "% of visitors who scrolled at least this far" curve, not an
    // approximation from the coarser milestone events.
    const scrollRows = await execRows<{ band: string; reached: string; total: string }>(sql`
      WITH pv AS (
        SELECT max_scroll_pct FROM analytics_pageviews
        WHERE page = ${page} AND entered_at >= ${since} AND entered_at <= ${until}
      )
      SELECT
        band::text AS band,
        (SELECT count(*) FROM pv WHERE max_scroll_pct >= band)::text AS reached,
        (SELECT count(*) FROM pv)::text AS total
      FROM generate_series(0, 90, 10) AS band
      ORDER BY band
    `);
    const totalPageviews = parseInt(scrollRows[0]?.total ?? "0");
    const scrollDepth = scrollRows.map(r => ({
      bandPct: parseInt(r.band),
      reachedPct: totalPageviews > 0 ? Math.round((parseInt(r.reached) / totalPageviews) * 1000) / 10 : 0,
    }));

    log.info({ page, deviceType, totalClicks, totalFriction, totalPageviews }, "heatmap aggregated");

    return res.json({
      page,
      range: { since: since.toISOString(), until: until.toISOString() },
      deviceTypeFilter: deviceType,
      grid: { cols: GRID_COLS, rows: GRID_ROWS },
      referenceWidthsPx: REFERENCE_WIDTH_PX,
      maxYPx,
      totals: { clicks: totalClicks, friction: totalFriction, pageviews: totalPageviews },
      clickCells,
      frictionCells,
      scrollDepth,
    });
  } catch (err) {
    req.log.warn({ err }, "heatmap aggregation failed");
    return res.status(500).json({ error: "Failed" });
  }
});

export default router;
