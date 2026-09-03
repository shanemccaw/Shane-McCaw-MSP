/**
 * admin-drift.ts — the READ surface over the Configuration Drift engine's
 * itemized `drift_events` (#1270 producer, #1290 open/resolved/reopened
 * lifecycle). The MCP `get_microsoft_drift` tool ("what is Microsoft doing to
 * us this week") wraps this — before this file there was NO read endpoint over
 * drift_events at all, only the producer (drift-collector.ts) and the
 * `drift:*` dashboard resolver branch.
 *
 *   GET /api/admin/drift/events
 *     Cross-tenant list of drift events for the operator, newest first, with a
 *     rolled-up summary. Defaults to the last 7 days of ACTIVE drift (open +
 *     reopened) so the common "what changed on my customers' tenants this week"
 *     question needs no params. The summary foregrounds UNAPPROVED change —
 *     drift with no linked CR — because that is the risk the engine exists to
 *     surface (see deriveVerdict in drift-collector.ts).
 *
 * requireAdmin: this is a PlatformAdmin/operator cross-tenant view (drift_events
 * is keyed on the free-text M365 tenant id, not on the platform customer id), so
 * it is deliberately not customer-scoped — same gate the sibling admin-clients /
 * admin-observability read routes sit behind.
 *
 * Read-only. The events themselves are written only by the collector on a real
 * scan; nothing here mutates drift_events.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, driftEventsTable, DRIFT_EVENT_VERDICTS, DRIFT_EVENT_STATUSES } from "@workspace/db";
import { and, desc, eq, gte, inArray, type SQL } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth.ts";
import { apiError, ApiErrorCode } from "../lib/api-helpers.ts";
import { logger } from "../lib/logger.ts";

const log = logger.child({ channel: "engine.dashboard" });

const router: IRouter = Router();

const DEFAULT_WINDOW_DAYS = 7;
const MAX_WINDOW_DAYS = 365;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

// "active" is the union the default view cares about — settings that are
// currently drifted (never resolved, or resolved then drifted again).
const ACTIVE_STATUSES = ["open", "reopened"] as const;

// GET /api/admin/drift/events
router.get("/admin/drift/events", requireAdmin, async (req: Request, res: Response) => {
  try {
    const q = req.query as Record<string, unknown>;

    const conditions: SQL[] = [];

    // ── Time window (detectedAt) ──────────────────────────────────────────────
    // sinceDays=0 (or "all") disables the window so a caller can pull the full
    // history; otherwise clamp to a sane range and default to the last week.
    const rawSince = String(q["sinceDays"] ?? "").trim();
    let windowDays: number | null = DEFAULT_WINDOW_DAYS;
    if (rawSince === "all" || rawSince === "0") {
      windowDays = null;
    } else if (rawSince) {
      const parsed = parseInt(rawSince, 10);
      if (!Number.isNaN(parsed) && parsed > 0) windowDays = Math.min(parsed, MAX_WINDOW_DAYS);
    }
    let since: Date | null = null;
    if (windowDays !== null) {
      since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
      conditions.push(gte(driftEventsTable.detectedAt, since));
    }

    // ── tenantId (free-text M365 tenant id) ───────────────────────────────────
    const tenantId = String(q["tenantId"] ?? "").trim();
    if (tenantId) conditions.push(eq(driftEventsTable.tenantId, tenantId));

    // ── domainKey (e.g. "ca-policy") ──────────────────────────────────────────
    const domainKey = String(q["domainKey"] ?? "").trim();
    if (domainKey) conditions.push(eq(driftEventsTable.domainKey, domainKey));

    // ── status filter ─────────────────────────────────────────────────────────
    // Default "active" (open+reopened). "all" removes the status filter. A single
    // valid status narrows to it. Anything else falls back to the active default.
    const statusParam = String(q["status"] ?? "active").trim();
    let statusLabel = statusParam;
    if (statusParam === "all") {
      statusLabel = "all";
    } else if ((DRIFT_EVENT_STATUSES as readonly string[]).includes(statusParam)) {
      conditions.push(eq(driftEventsTable.status, statusParam as (typeof DRIFT_EVENT_STATUSES)[number]));
    } else {
      statusLabel = "active";
      conditions.push(inArray(driftEventsTable.status, [...ACTIVE_STATUSES]));
    }

    // ── verdict filter ─────────────────────────────────────────────────────────
    const verdictParam = String(q["verdict"] ?? "").trim();
    if (verdictParam && (DRIFT_EVENT_VERDICTS as readonly string[]).includes(verdictParam)) {
      conditions.push(eq(driftEventsTable.verdict, verdictParam as (typeof DRIFT_EVENT_VERDICTS)[number]));
    }

    const limit = q["limit"]
      ? Math.min(MAX_LIMIT, Math.max(1, parseInt(String(q["limit"]), 10) || DEFAULT_LIMIT))
      : DEFAULT_LIMIT;

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const rows = await db
      .select()
      .from(driftEventsTable)
      .where(where)
      .orderBy(desc(driftEventsTable.detectedAt))
      .limit(limit);

    // ── Roll-up over the returned set ─────────────────────────────────────────
    const byStatus: Record<string, number> = {};
    const byVerdict: Record<string, number> = {};
    const byDomain: Record<string, number> = {};
    const tenants = new Set<string>();
    let unapprovedChanges = 0;
    for (const r of rows) {
      byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
      byVerdict[r.verdict] = (byVerdict[r.verdict] ?? 0) + 1;
      byDomain[r.domainKey] = (byDomain[r.domainKey] ?? 0) + 1;
      tenants.add(r.tenantId);
      // The engine's whole point: a change with no CR covering it (unattributed
      // or attributed-but-unapproved) that is still deviating from baseline.
      if (
        (r.status === "open" || r.status === "reopened") &&
        r.verdict !== "approved" &&
        r.verdict !== "informational"
      ) {
        unapprovedChanges += 1;
      }
    }

    res.json({
      windowDays,
      since: since ? since.toISOString() : null,
      filters: {
        tenantId: tenantId || null,
        domainKey: domainKey || null,
        status: statusLabel,
        verdict: verdictParam || null,
      },
      summary: {
        total: rows.length,
        limit,
        truncated: rows.length === limit,
        byStatus,
        byVerdict,
        byDomain,
        tenantsAffected: tenants.size,
        // Headline number for "what is Microsoft doing to us": currently-drifted
        // settings with no approved change covering them.
        unapprovedChanges,
      },
      events: rows.map((r) => ({
        id: r.id,
        eventId: r.eventId,
        tenantId: r.tenantId,
        domainKey: r.domainKey,
        setting: r.setting,
        op: r.op,
        oldValue: r.oldValue ?? null,
        newValue: r.newValue ?? null,
        changedBy: r.changedBy ?? null,
        verdict: r.verdict,
        crRef: r.crRef ?? null,
        // #1505 — the real FK behind crRef above.
        changeRequestId: r.changeRequestId ?? null,
        status: r.status,
        reopenCount: r.reopenCount,
        baselineSnapshotId: r.baselineSnapshotId ?? null,
        detectedAt: r.detectedAt instanceof Date ? r.detectedAt.toISOString() : r.detectedAt,
        resolvedAt: r.resolvedAt instanceof Date ? r.resolvedAt.toISOString() : (r.resolvedAt ?? null),
        reopenedAt: r.reopenedAt instanceof Date ? r.reopenedAt.toISOString() : (r.reopenedAt ?? null),
      })),
    });
  } catch (err: unknown) {
    log.error({ err }, "GET /api/admin/drift/events failed");
    const msg = err instanceof Error ? err.message : String(err);
    apiError(res, 500, ApiErrorCode.INTERNAL, msg);
  }
});

export default router;
