// artifacts/api-server/src/routes/admin-ai-billing.ts
//
// PlatformAdmin AI Billing surface (initiative:
// ai-cost-governance-billing-rollup, Phase 3 / Issue #51). Read-only rollups
// over the ai_usage_events rows that Phase 1 (#49) guaranteed get written and
// Phase 2 (#50) expanded for full traceability.
//
// THIS IS NOT THE MSP-FACING VIEW. artifacts/msp-portal/src/pages/ai-billing.tsx
// is an MSP looking at its OWN allowance; everything here is platform-wide and
// requireAdmin-gated. Nothing in this file is reachable by an MSP.
//
// Three endpoints:
//   GET /admin/ai-billing/events   — filterable, paginated full-detail ledger
//   GET /admin/ai-billing/summary  — period rollup (seeds the StatusBar totals)
//   GET /admin/ai-billing/recent   — last N transactions (StatusBar popovers)
//
// The live delta that rides on top of the summary totals is pushed on the
// "ai-cost" SSE hub channel — see the broadcast in lib/ai-billing.ts's
// recordAiUsage(). This file does no pushing; it only seeds and backfills.

import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  aiUsageEventsTable,
  mspsTable,
  mspCustomersTable,
} from "@workspace/db";
import { and, count, desc, eq, gte, lt, lte, sum, type SQL } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";
import {
  parseBoundedInt,
  parseDateParam,
  parseIdParam,
  parseRange,
  parseTzOffsetMinutes,
  resolveRangeBounds,
  rollupBy,
} from "../lib/ai-billing-rollup.ts";

const router: IRouter = Router();
const log = logger.child({ channel: "engine.ai-cost-governance" });

const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 50;
const MAX_RECENT = 50;

// Full-detail projection: what caused the call, what it produced, who pays.
// Every column the Phase 2 schema expansion added is surfaced — the point of
// this page is that a cost line is explainable without a DB console.
const EVENT_COLUMNS = {
  id: aiUsageEventsTable.id,
  eventId: aiUsageEventsTable.eventId,
  occurredAt: aiUsageEventsTable.occurredAt,
  mspId: aiUsageEventsTable.mspId,
  customerId: aiUsageEventsTable.customerId,
  nodeType: aiUsageEventsTable.nodeType,
  feature: aiUsageEventsTable.feature,
  triggerSource: aiUsageEventsTable.triggerSource,
  generatedArtifactType: aiUsageEventsTable.generatedArtifactType,
  generatedArtifactName: aiUsageEventsTable.generatedArtifactName,
  generatedArtifactId: aiUsageEventsTable.generatedArtifactId,
  costCents: aiUsageEventsTable.costCents,
  costOwner: aiUsageEventsTable.costOwner,
  promptTokens: aiUsageEventsTable.promptTokens,
  completionTokens: aiUsageEventsTable.completionTokens,
  totalTokens: aiUsageEventsTable.totalTokens,
  model: aiUsageEventsTable.model,
  runId: aiUsageEventsTable.runId,
  correlationId: aiUsageEventsTable.correlationId,
} as const;

/** Shape returned to the client for one usage event. */
type EventRow = {
  [K in keyof typeof EVENT_COLUMNS]: unknown;
} & { mspName: string | null; customerName: string | null };

/**
 * Build the WHERE clause shared by /events and its total count, so the page of
 * rows and the row count can never be filtered differently.
 */
function buildEventFilters(req: Request): SQL[] {
  const conditions: SQL[] = [];

  const mspId = parseIdParam(req.query.mspId);
  if (mspId != null) conditions.push(eq(aiUsageEventsTable.mspId, mspId));

  const customerId = parseIdParam(req.query.customerId);
  if (customerId != null) conditions.push(eq(aiUsageEventsTable.customerId, customerId));

  const from = parseDateParam(req.query.from);
  if (from) conditions.push(gte(aiUsageEventsTable.occurredAt, from));

  const to = parseDateParam(req.query.to);
  if (to) conditions.push(lte(aiUsageEventsTable.occurredAt, to));

  // nodeType and feature are separate columns but one filter concept in the UI
  // ("what kind of call was this"), so each is matched on its own column.
  const nodeType = typeof req.query.nodeType === "string" ? req.query.nodeType.trim() : "";
  if (nodeType) conditions.push(eq(aiUsageEventsTable.nodeType, nodeType));

  const feature = typeof req.query.feature === "string" ? req.query.feature.trim() : "";
  if (feature) conditions.push(eq(aiUsageEventsTable.feature, feature));

  const costOwner = typeof req.query.costOwner === "string" ? req.query.costOwner.trim() : "";
  if (costOwner === "msp" || costOwner === "platform") {
    conditions.push(eq(aiUsageEventsTable.costOwner, costOwner));
  }

  const artifactType =
    typeof req.query.generatedArtifactType === "string"
      ? req.query.generatedArtifactType.trim()
      : "";
  if (artifactType) {
    conditions.push(eq(aiUsageEventsTable.generatedArtifactType, artifactType));
  }

  return conditions;
}

// ─── GET /admin/ai-billing/events ────────────────────────────────────────────
// Paginated, filterable ledger. Returns the full traceability row: what caused
// the call (nodeType / feature / triggerSource), what it generated
// (generatedArtifact*), which customer and MSP it belongs to, cost, tokens,
// model, and the correlationId that ties it to everything else in the run.
router.get("/admin/ai-billing/events", requireAdmin, async (req: Request, res: Response) => {
  const limit = parseBoundedInt(req.query.limit, DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);
  const offset = parseBoundedInt(req.query.offset, 0, 0, Number.MAX_SAFE_INTEGER);

  try {
    const conditions = buildEventFilters(req);
    const where = conditions.length ? and(...conditions) : undefined;

    const [rows, [totalRow], [costRow]] = await Promise.all([
      db
        .select({
          ...EVENT_COLUMNS,
          mspName: mspsTable.name,
          customerName: mspCustomersTable.name,
        })
        .from(aiUsageEventsTable)
        // LEFT joins, not inner: a platform-owned call legitimately has a null
        // mspId, and a non-customer-specific call a null customerId. An inner
        // join here would silently drop exactly the rows this page exists to
        // make visible.
        .leftJoin(mspsTable, eq(mspsTable.id, aiUsageEventsTable.mspId))
        .leftJoin(mspCustomersTable, eq(mspCustomersTable.id, aiUsageEventsTable.customerId))
        .where(where)
        .orderBy(desc(aiUsageEventsTable.occurredAt), desc(aiUsageEventsTable.id))
        .limit(limit)
        .offset(offset),
      db.select({ value: count() }).from(aiUsageEventsTable).where(where),
      db
        .select({ value: sum(aiUsageEventsTable.costCents) })
        .from(aiUsageEventsTable)
        .where(where),
    ]);

    res.json({
      events: rows as EventRow[],
      total: Number(totalRow?.value ?? 0),
      // Cost of the WHOLE filtered set, not just this page — so the table
      // footer can state what the current filter actually costs without the
      // caller paging through every row to add it up.
      filteredCostCents: Number(costRow?.value ?? 0),
      limit,
      offset,
    });
  } catch (err) {
    log.error({ err }, "ai-billing: failed to list usage events");
    res.status(500).json({ error: "Failed to load AI usage events" });
  }
});

// ─── GET /admin/ai-billing/summary?range=today|month ─────────────────────────
// Period rollup: total cost, plus breakdowns by cost owner, by MSP, and by
// feature. This is what seeds the StatusBar's Today/Month totals on mount —
// SSE deltas are applied on top of it client-side.
router.get("/admin/ai-billing/summary", requireAdmin, async (req: Request, res: Response) => {
  const range = parseRange(req.query.range);
  const tzOffsetMinutes = parseTzOffsetMinutes(req.query.tzOffsetMinutes);
  const { start, end } = resolveRangeBounds(range, tzOffsetMinutes);

  try {
    // One read of the period's rows feeds the headline total AND all three
    // breakdowns (see rollupBy's note) — they are guaranteed to reconcile.
    const rows = await db
      .select({
        mspId: aiUsageEventsTable.mspId,
        costCents: aiUsageEventsTable.costCents,
        costOwner: aiUsageEventsTable.costOwner,
        nodeType: aiUsageEventsTable.nodeType,
        feature: aiUsageEventsTable.feature,
        mspName: mspsTable.name,
      })
      .from(aiUsageEventsTable)
      .leftJoin(mspsTable, eq(mspsTable.id, aiUsageEventsTable.mspId))
      .where(
        and(
          gte(aiUsageEventsTable.occurredAt, start),
          lt(aiUsageEventsTable.occurredAt, end),
        ),
      );

    const mspNameById = new Map<number, string | null>();
    for (const r of rows) {
      if (r.mspId != null) mspNameById.set(r.mspId, r.mspName ?? null);
    }

    const totalCostCents = rows.reduce((acc, r) => acc + (r.costCents ?? 0), 0);

    res.json({
      range,
      // Echo the resolved window back so the client never has to re-derive it
      // (and so a timezone mismatch is visible rather than silent).
      periodStart: start.toISOString(),
      periodEnd: end.toISOString(),
      totalCostCents,
      eventCount: rows.length,
      byCostOwner: rollupBy(rows, (r) => r.costOwner ?? "unknown", (r) => r.costCents ?? 0).map(
        (b) => ({ costOwner: b.key, costCents: b.costCents, eventCount: b.eventCount }),
      ),
      // mspId 0 is the bucket for platform-owned (null-mspId) usage. It is
      // labelled as such rather than dropped — unattributed/platform spend is
      // precisely the number worth watching.
      byMsp: rollupBy(rows, (r) => r.mspId ?? 0, (r) => r.costCents ?? 0).map((b) => ({
        mspId: b.key === 0 ? null : b.key,
        mspName: b.key === 0 ? "Platform (no MSP)" : mspNameById.get(b.key) ?? `MSP ${b.key}`,
        costCents: b.costCents,
        eventCount: b.eventCount,
      })),
      byFeature: rollupBy(
        rows,
        (r) => r.feature ?? r.nodeType ?? "unknown",
        (r) => r.costCents ?? 0,
      ).map((b) => ({ feature: b.key, costCents: b.costCents, eventCount: b.eventCount })),
    });
  } catch (err) {
    log.error({ err, range }, "ai-billing: failed to build usage summary");
    res.status(500).json({ error: "Failed to load AI usage summary" });
  }
});

// ─── GET /admin/ai-billing/recent?limit=10 ───────────────────────────────────
// Last N transactions across the whole platform. Backs both the AI Billing
// page's "recent activity" strip and the StatusBar hover popovers.
router.get("/admin/ai-billing/recent", requireAdmin, async (req: Request, res: Response) => {
  const limit = parseBoundedInt(req.query.limit, 10, 1, MAX_RECENT);

  try {
    const rows = await db
      .select({
        ...EVENT_COLUMNS,
        mspName: mspsTable.name,
        customerName: mspCustomersTable.name,
      })
      .from(aiUsageEventsTable)
      .leftJoin(mspsTable, eq(mspsTable.id, aiUsageEventsTable.mspId))
      .leftJoin(mspCustomersTable, eq(mspCustomersTable.id, aiUsageEventsTable.customerId))
      .orderBy(desc(aiUsageEventsTable.occurredAt), desc(aiUsageEventsTable.id))
      .limit(limit);

    res.json({ events: rows as EventRow[] });
  } catch (err) {
    log.error({ err }, "ai-billing: failed to load recent usage events");
    res.status(500).json({ error: "Failed to load recent AI usage" });
  }
});

export default router;
