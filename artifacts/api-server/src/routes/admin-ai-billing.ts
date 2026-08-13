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
// Four endpoints:
//   GET /admin/ai-billing/events    — filterable, paginated full-detail ledger
//   GET /admin/ai-billing/summary   — period rollup (seeds the StatusBar totals)
//   GET /admin/ai-billing/recent    — last N transactions (StatusBar popovers)
//   GET /admin/ai-billing/analytics — Phase 4 (#52): trend series over time,
//       cost per customer / MSP / document type, and anomaly flagging
//   GET /admin/ai-billing/lead-analytics — Phase 4.1 (#81): cost per lead and
//       cost per assessment run, over the same window and the same filters
//
// The live delta that rides on top of the summary totals is pushed on the
// "ai-cost" SSE hub channel — see the broadcast in lib/ai-billing.ts's
// recordAiUsage(). This file does no pushing; it only seeds and backfills.

import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  aiUsageEventsTable,
  leadStagingTable,
  mspDiagnosticRunsTable,
  mspsTable,
  tenantsTable,
  usersTable,
} from "@workspace/db";
import {
  and,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
  sql,
  sum,
  type SQL,
} from "drizzle-orm";
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
import {
  BUCKET_NOUN,
  DEFAULT_DIMENSION_LIMIT,
  bucketTimeSeries,
  parseBucketCount,
  parseTrendBucket,
  resolveTrendWindow,
  rollupDimension,
} from "../lib/ai-billing-analytics.ts";
import { scanCostAnomalies } from "../lib/ai-cost-anomaly.ts";
import {
  resolveTenantLeads,
  rollupCostPerAssessmentRun,
  rollupCostPerLead,
  type AssessmentRunInput,
  type TenantLeadLink,
} from "../lib/ai-lead-attribution.ts";

const router: IRouter = Router();
const log = logger.child({ channel: "engine.ai-cost-governance" });

const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 50;
const MAX_RECENT = 50;

// Hard ceiling on the rows /analytics will pull into memory for one request.
// Exceeding it does not silently truncate: the response says so, and the buckets
// that fell outside what was actually read are marked partial so the anomaly
// rule refuses to judge them or to use them as a baseline.
const MAX_ANALYTICS_ROWS = 50_000;

// Phase 4.1 (#81) ceilings for the cost-per-lead identity chain. Each is
// reported in the response when it bites, for the same reason MAX_ANALYTICS_ROWS
// is: a capped attribution that looks complete would overstate how much spend
// this platform can actually trace back to a lead.
const MAX_IDENTITY_TENANTS = 2_000;
const MAX_IDENTITY_LINK_ROWS = 20_000;
const MAX_ASSESSMENT_RUNS = 5_000;

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
 * The non-date half of the filter set: everything that narrows WHICH calls are
 * in scope, as opposed to WHEN they happened.
 *
 * Split out so /analytics can honour exactly the same filters as /events while
 * owning its own time window (it derives one from bucket + count rather than
 * taking from/to). One definition means a filtered chart and a filtered ledger
 * can never disagree about what "this MSP's spend" includes.
 */
function buildDimensionFilters(req: Request): SQL[] {
  const conditions: SQL[] = [];

  const mspId = parseIdParam(req.query.mspId);
  if (mspId != null) conditions.push(eq(aiUsageEventsTable.mspId, mspId));

  const customerId = parseIdParam(req.query.customerId);
  if (customerId != null) conditions.push(eq(aiUsageEventsTable.customerId, customerId));

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

/**
 * Build the WHERE clause shared by /events and its total count, so the page of
 * rows and the row count can never be filtered differently.
 */
function buildEventFilters(req: Request): SQL[] {
  const conditions = buildDimensionFilters(req);

  const from = parseDateParam(req.query.from);
  if (from) conditions.push(gte(aiUsageEventsTable.occurredAt, from));

  const to = parseDateParam(req.query.to);
  if (to) conditions.push(lte(aiUsageEventsTable.occurredAt, to));

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
          customerName: tenantsTable.customerName,
        })
        .from(aiUsageEventsTable)
        // LEFT joins, not inner: a platform-owned call legitimately has a null
        // mspId, and a non-customer-specific call a null customerId. An inner
        // join here would silently drop exactly the rows this page exists to
        // make visible.
        .leftJoin(mspsTable, eq(mspsTable.id, aiUsageEventsTable.mspId))
        .leftJoin(tenantsTable, eq(tenantsTable.id, aiUsageEventsTable.customerId))
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
        customerName: tenantsTable.customerName,
      })
      .from(aiUsageEventsTable)
      .leftJoin(mspsTable, eq(mspsTable.id, aiUsageEventsTable.mspId))
      .leftJoin(tenantsTable, eq(tenantsTable.id, aiUsageEventsTable.customerId))
      .orderBy(desc(aiUsageEventsTable.occurredAt), desc(aiUsageEventsTable.id))
      .limit(limit);

    res.json({ events: rows as EventRow[] });
  } catch (err) {
    log.error({ err }, "ai-billing: failed to load recent usage events");
    res.status(500).json({ error: "Failed to load recent AI usage" });
  }
});

// ─── GET /admin/ai-billing/analytics ─────────────────────────────────────────
// Phase 4 (#52). The decision-useful layer over the same rows /events lists:
//
//   ?bucket=day|week|month   size of each trend bucket        (default day)
//   ?buckets=N               how many buckets back            (per-size bounds)
//   ?tzOffsetMinutes=N       viewer's offset, as Phase 3 uses
//   ?limit=N                 top-N per dimension              (default 8)
//   plus every non-date filter /events accepts (mspId, customerId, costOwner,
//   feature, nodeType, generatedArtifactType), so a chart can be scoped exactly
//   like the ledger below it.
//
// Deliberately NOT parameterised: the anomaly rule. Letting a caller pass its
// own factor would turn "no anomalies" into a statement about the query string
// rather than about spend. The rule is server-owned and echoed back in full
// (including its direction) so the page can print it verbatim.
//
// Cost per LEAD is not here — it lives on /lead-analytics below, added by Phase
// 4.1 (#81) once the Zoho CRM lead-integration work (#82/#83) landed
// `lead_staging`. It is a separate endpoint rather than more fields on this one
// because it needs two extra identity queries that this endpoint should not pay
// for on every chart refresh.
router.get("/admin/ai-billing/analytics", requireAdmin, async (req: Request, res: Response) => {
  const bucket = parseTrendBucket(req.query.bucket);
  const bucketCount = parseBucketCount(req.query.buckets, bucket);
  const tzOffsetMinutes = parseTzOffsetMinutes(req.query.tzOffsetMinutes);
  const dimensionLimit = parseBoundedInt(req.query.limit, DEFAULT_DIMENSION_LIMIT, 3, 25);
  const now = new Date();
  const window = resolveTrendWindow(bucket, bucketCount, tzOffsetMinutes, now);

  try {
    const conditions = [
      gte(aiUsageEventsTable.occurredAt, window.start),
      lt(aiUsageEventsTable.occurredAt, window.end),
      ...buildDimensionFilters(req),
    ];

    // Newest first, with one row of headroom past the ceiling: if the extra row
    // comes back the window was bigger than we read, and the OLDEST end is what
    // got clipped — which is exactly what `observedFrom` below then declares.
    const scanned = await db
      .select({
        occurredAt: aiUsageEventsTable.occurredAt,
        costCents: aiUsageEventsTable.costCents,
        customerId: aiUsageEventsTable.customerId,
        mspId: aiUsageEventsTable.mspId,
        generatedArtifactType: aiUsageEventsTable.generatedArtifactType,
        customerName: tenantsTable.customerName,
        mspName: mspsTable.name,
      })
      .from(aiUsageEventsTable)
      .leftJoin(mspsTable, eq(mspsTable.id, aiUsageEventsTable.mspId))
      .leftJoin(tenantsTable, eq(tenantsTable.id, aiUsageEventsTable.customerId))
      .where(and(...conditions))
      .orderBy(desc(aiUsageEventsTable.occurredAt))
      .limit(MAX_ANALYTICS_ROWS + 1);

    const truncated = scanned.length > MAX_ANALYTICS_ROWS;
    const rows = truncated ? scanned.slice(0, MAX_ANALYTICS_ROWS) : scanned;

    // When the scan was clipped, the earliest row we hold is the earliest instant
    // we can honestly speak about. Everything before it is unread, not empty.
    let observedFrom: Date | null = null;
    if (truncated) {
      let earliest = Number.POSITIVE_INFINITY;
      for (const r of rows) {
        const ms = r.occurredAt instanceof Date ? r.occurredAt.getTime() : NaN;
        if (Number.isFinite(ms) && ms < earliest) earliest = ms;
      }
      observedFrom = Number.isFinite(earliest) ? new Date(earliest) : window.end;
      log.warn(
        { bucket, bucketCount, rowLimit: MAX_ANALYTICS_ROWS },
        "ai-billing: analytics row scan hit its ceiling; older buckets reported as partial",
      );
    }

    const series = bucketTimeSeries(rows, {
      bucket,
      window,
      tzOffsetMinutes,
      now,
      observedFrom,
    });

    res.json({
      bucket,
      bucketCount,
      periodStart: window.start.toISOString(),
      periodEnd: window.end.toISOString(),
      // Totals over what was read — reconciles with the series and with every
      // dimension rollup below, because all four are derived from these rows.
      totalCostCents: rows.reduce((acc, r) => acc + (r.costCents ?? 0), 0),
      eventCount: rows.length,
      coverage: {
        rowsScanned: rows.length,
        rowLimit: MAX_ANALYTICS_ROWS,
        truncated,
        observedFrom: observedFrom?.toISOString() ?? null,
      },
      series,
      byCustomer: rollupDimension(rows, "customer", dimensionLimit),
      byMsp: rollupDimension(rows, "msp", dimensionLimit),
      byArtifactType: rollupDimension(rows, "artifactType", dimensionLimit),
      anomalies: scanCostAnomalies(series, {}, BUCKET_NOUN[bucket]),
    });
  } catch (err) {
    log.error({ err, bucket, bucketCount }, "ai-billing: failed to build usage analytics");
    res.status(500).json({ error: "Failed to load AI usage analytics" });
  }
});

// ─── GET /admin/ai-billing/lead-analytics ────────────────────────────────────
// Phase 4.1 (#81). "What does a lead actually cost us, and what does one
// assessment run cost?" — the two figures the parent tracker (#48) frames the
// whole initiative around ("showing us true cost of lead generation").
//
// Takes exactly the same window parameters and the same non-date filters as
// /analytics, so a lead figure and a trend chart on one page always describe the
// same slice of spend.
//
// ── The identity chain, and why it is three queries ──────────────────────────
//
// There is no FK between `ai_usage_events` and `lead_staging` in either
// direction — see lib/ai-lead-attribution.ts's docblock for the full audit. The
// chain this endpoint walks is:
//
//     ai_usage_events.customerId (tenants.id)
//       -> users.tenantId
//         -> users.linkedLeadId -> leads.id -> lead_staging.legacyLeadId
//         -> OR lower(users.email) = lower(lead_staging.email)
//
// The identity query is scoped to the tenants that actually appear in THIS
// window's usage rows, so it costs one indexed lookup per distinct customer
// rather than a scan of every user on the platform.
//
// ── Sparse data is an empty state, not a bug ─────────────────────────────────
//
// #133 (live end-to-end verification of the Zoho CRM sync) is still open, so
// `lead_staging` may be near-empty. Separately, the audit for this phase found
// that cio-narrative-generator.ts — the AI call an assessment run actually makes
// — is NOT wrapped in withAiAttribution(), so its events carry a null customerId
// and land in `unattributed.breakdown.noCustomer`. Both show up here as honest
// zeros and explicit unattributed figures, never as a fabricated cost-per-lead.
router.get(
  "/admin/ai-billing/lead-analytics",
  requireAdmin,
  async (req: Request, res: Response) => {
    const bucket = parseTrendBucket(req.query.bucket);
    const bucketCount = parseBucketCount(req.query.buckets, bucket);
    const tzOffsetMinutes = parseTzOffsetMinutes(req.query.tzOffsetMinutes);
    const limit = parseBoundedInt(req.query.limit, DEFAULT_DIMENSION_LIMIT, 3, 25);
    const now = new Date();
    const window = resolveTrendWindow(bucket, bucketCount, tzOffsetMinutes, now);

    try {
      const conditions = [
        gte(aiUsageEventsTable.occurredAt, window.start),
        lt(aiUsageEventsTable.occurredAt, window.end),
        ...buildDimensionFilters(req),
      ];

      // Same ceiling and same truncation honesty as /analytics: a clipped scan
      // is declared, never quietly presented as the whole window.
      const scanned = await db
        .select({
          occurredAt: aiUsageEventsTable.occurredAt,
          costCents: aiUsageEventsTable.costCents,
          customerId: aiUsageEventsTable.customerId,
        })
        .from(aiUsageEventsTable)
        .where(and(...conditions))
        .orderBy(desc(aiUsageEventsTable.occurredAt))
        .limit(MAX_ANALYTICS_ROWS + 1);

      const truncated = scanned.length > MAX_ANALYTICS_ROWS;
      const rows = truncated ? scanned.slice(0, MAX_ANALYTICS_ROWS) : scanned;

      if (truncated) {
        log.warn(
          { bucket, bucketCount, rowLimit: MAX_ANALYTICS_ROWS },
          "ai-billing: lead-analytics row scan hit its ceiling; figures cover the most recent rows only",
        );
      }

      // Distinct tenants this window's spend actually touches. Bounded: past the
      // cap the identity query would stop being an indexed lookup, so it is cut
      // and the cut is reported rather than silently narrowing attribution.
      const allTenantIds = [
        ...new Set(
          rows
            .map((r) => r.customerId)
            .filter((id): id is number => typeof id === "number"),
        ),
      ];
      const tenantIds = allTenantIds.slice(0, MAX_IDENTITY_TENANTS);
      const tenantsElided = allTenantIds.length - tenantIds.length;
      if (tenantsElided > 0) {
        log.warn(
          { distinctTenants: allTenantIds.length, cap: MAX_IDENTITY_TENANTS },
          "ai-billing: lead-analytics identity resolution capped; some spend reported as unattributed",
        );
      }

      const [linkRows, runRows, [stagedRow]] = await Promise.all([
        tenantIds.length
          ? db
              .selectDistinct({
                tenantId: usersTable.tenantId,
                leadStagingId: leadStagingTable.id,
                leadName: leadStagingTable.name,
                leadEmail: leadStagingTable.email,
                leadSource: leadStagingTable.source,
              })
              .from(usersTable)
              // INNER join on purpose: a user with no resolvable lead should not
              // produce a null-lead row here. Spend for such a tenant is counted
              // as unattributed by the rollup, which is where that fact belongs.
              .innerJoin(
                leadStagingTable,
                or(
                  and(
                    isNotNull(usersTable.linkedLeadId),
                    eq(leadStagingTable.legacyLeadId, usersTable.linkedLeadId),
                  ),
                  sql`lower(${leadStagingTable.email}) = lower(${usersTable.email})`,
                ),
              )
              .where(
                and(
                  inArray(usersTable.tenantId, tenantIds),
                  isNull(leadStagingTable.deletedAt),
                ),
              )
              .limit(MAX_IDENTITY_LINK_ROWS)
          : Promise.resolve([]),

        // Runs overlapping the window at either end, not just those that both
        // started and finished inside it — a run straddling the boundary still
        // spent money in it.
        db
          .select({
            runId: mspDiagnosticRunsTable.runId,
            customerId: mspDiagnosticRunsTable.customerId,
            status: mspDiagnosticRunsTable.status,
            startedAt: mspDiagnosticRunsTable.startedAt,
            completedAt: mspDiagnosticRunsTable.completedAt,
            createdAt: mspDiagnosticRunsTable.createdAt,
          })
          .from(mspDiagnosticRunsTable)
          .where(
            and(
              lt(mspDiagnosticRunsTable.createdAt, window.end),
              or(
                isNull(mspDiagnosticRunsTable.completedAt),
                gte(mspDiagnosticRunsTable.completedAt, window.start),
              ),
            ),
          )
          .orderBy(desc(mspDiagnosticRunsTable.createdAt))
          .limit(MAX_ASSESSMENT_RUNS),

        // Lead VOLUME in the window, reported alongside lead COST. Deliberately
        // not subtracted from leadsWithSpend to manufacture a "leads with no
        // spend" figure: a lead staged years ago can incur spend today, so that
        // subtraction would not mean what it appears to mean.
        db
          .select({ value: count() })
          .from(leadStagingTable)
          .where(
            and(
              gte(leadStagingTable.createdAt, window.start),
              lt(leadStagingTable.createdAt, window.end),
              isNull(leadStagingTable.deletedAt),
            ),
          ),
      ]);

      // users.tenantId is nullable in the schema (an MSP-scoped user has none),
      // so rows without one are dropped here rather than being coerced to a
      // tenant 0 that would collect other people's spend.
      const links: TenantLeadLink[] = [];
      for (const r of linkRows) {
        if (typeof r.tenantId !== "number") continue;
        links.push({
          tenantId: r.tenantId,
          leadStagingId: r.leadStagingId,
          leadName: r.leadName,
          leadEmail: r.leadEmail,
          leadSource: r.leadSource,
        });
      }

      const resolution = resolveTenantLeads(links);

      const byLead = rollupCostPerLead(rows, resolution, limit);
      const byAssessmentRun = rollupCostPerAssessmentRun(
        rows,
        runRows as AssessmentRunInput[],
        { limit, now },
      );

      res.json({
        bucket,
        bucketCount,
        periodStart: window.start.toISOString(),
        periodEnd: window.end.toISOString(),
        totalCostCents: rows.reduce((acc, r) => acc + (r.costCents ?? 0), 0),
        eventCount: rows.length,
        coverage: {
          rowsScanned: rows.length,
          rowLimit: MAX_ANALYTICS_ROWS,
          truncated,
          distinctTenants: allTenantIds.length,
          tenantsElided,
          identityLinkRows: linkRows.length,
          identityLinksTruncated: linkRows.length >= MAX_IDENTITY_LINK_ROWS,
          assessmentRunsTruncated: runRows.length >= MAX_ASSESSMENT_RUNS,
        },
        byLead,
        byAssessmentRun,
        // Lead volume for the same window, so "cost per lead" can be read next to
        // "how many leads did we even capture" — the pairing that makes the
        // figure mean something when lead_staging is still filling up (#133).
        leadsStagedInWindow: Number(stagedRow?.value ?? 0),
      });
    } catch (err) {
      log.error({ err, bucket, bucketCount }, "ai-billing: failed to build lead analytics");
      res.status(500).json({ error: "Failed to load AI cost-per-lead analytics" });
    }
  },
);

export default router;
