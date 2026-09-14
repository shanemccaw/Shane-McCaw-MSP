/**
 * portal-customer-timeline.ts
 *
 * Customer-facing tenant activity timeline. Aggregates events across several
 * existing per-domain sources into a single chronologically-ordered feed:
 *
 *   - diagnostic run completions (msp_diagnostic_runs)
 *   - warning/critical diagnostic findings (msp_diagnostic_findings) — "ok"/"info"
 *     severity findings are routine noise and excluded, mirroring the severity
 *     taxonomy the diagnostics engine already uses to decide what's actionable
 *   - significant engine score changes (tenant_engine_snapshots) — |delta| >= 5
 *     points, an arbitrary-but-reasonable bar for "worth telling the customer"
 *     on a 0-100 score, below which day-to-day noise isn't timeline-worthy
 *   - documents that have actually reached the customer (insights_generated_documents,
 *     status delivered/approved — drafts/generating/archived are internal-only)
 *   - sales offers once they've actually been sent (sales_offers, state != draft)
 *
 * Notification Center rows are deliberately NOT a separate source here: the
 * offer/document events above are the same events notification-center.ts fans
 * out to the bell for, so re-including them via notificationsTable would
 * double them up. There is no queryable "workflow run history" table in this
 * codebase (only step/template tables) — see PLATFORM_BUILD.md for this task,
 * flagged rather than fabricated.
 *
 * Each source is fetched independently, already scoped + time-bounded, then
 * merged and re-sorted so no single noisy source can crowd out the others.
 *
 * Auth: requireCapability("ladder.customer-user") — MSP JWT with Customer role.
 *
 * Routes:
 *   GET /api/portal/customer/timeline          — cursor-paginated, past-only feed (above)
 *   GET /api/portal/customer/timeline/matrix    — windowed feed backing the Overview
 *     Matrix/List timeline card (#4129); see that route's own header comment for
 *     why it's a second read rather than an extension of the one above.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { requireCapability } from "../middlewares/requireAuth.ts";
import {
  db,
  mspDiagnosticRunsTable,
  mspDiagnosticFindingsTable,
  tenantEngineSnapshotsTable,
  insightsGeneratedDocumentsTable,
  salesOffersTable,
  mspMessageCenterItemsTable,
  mspChangeRequestsTable,
  policyDecisionsTable,
} from "@workspace/db";
import { eq, and, desc, lt, gte, lte, inArray, isNotNull } from "drizzle-orm";
import { ENGINE_DEFS } from "../lib/engine-registry.ts";
import { evaluateDocGateCoverage } from "../lib/doc-gate-coverage.ts";
import { resolveCustomerUserIds } from "../lib/tenant-signals.ts";
import { resolveTenantScope } from "../lib/portal-customer-scope.ts";
import { formatChangeRequestCode } from "../lib/portal-change-control.ts";
import { logger } from "../lib/logger.ts";
const log = logger.child({ channel: "tenant.portal" });

const router: IRouter = Router();

const ENGINE_LABELS: Record<string, string> = Object.fromEntries(
  ENGINE_DEFS.map((def) => [def.key, def.label]),
);

const SCORE_DELTA_SIGNIFICANCE_THRESHOLD = 5;
const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

type TimelineEventType = "scan_completed" | "scan_failed" | "finding" | "score_change" | "document" | "offer";
type TimelineStatus = "default" | "success" | "warning" | "error" | "info";

interface TimelineEventDto {
  id: string;
  type: TimelineEventType;
  title: string;
  description?: string;
  status: TimelineStatus;
  timestamp: string;
}

function engineLabel(engineKey: string): string {
  return ENGINE_LABELS[engineKey] ?? engineKey.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── GET /api/portal/customer/timeline ──────────────────────────────────────

router.get(
  "/portal/customer/timeline",
  requireCapability("ladder.customer-user"),
  async (req: Request, res: Response) => {
    const customerId = req.user!.customerId;
    if (!customerId) {
      res.status(400).json({ error: "No customer account associated with this user" });
      return;
    }

    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? DEFAULT_LIMIT), 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);
    const before = req.query.before ? new Date(String(req.query.before)) : undefined;
    const beforeValid = before && !isNaN(before.getTime()) ? before : undefined;

    try {
      // Documents are stored under a users.id-shaped `customerId` FK that
      // actually names a login, not the customer — scope across every linked
      // login (resolveCustomerUserIds bridge), the same pattern the sibling
      // portal/dashboard route (portal-customer-engines.ts) already uses for
      // projects/clientServices/invoices/reports (#2499). Offers are NOT in
      // this class — sales_offers.customerId is a tenants.id (#2730), so it
      // filters directly against `customerId` below, no bridge.
      const customerUserIds = await resolveCustomerUserIds(customerId);

      const [runs, findings, snapshots, documents, offers] = await Promise.all([
        db
          .select({
            runId: mspDiagnosticRunsTable.runId,
            status: mspDiagnosticRunsTable.status,
            checksTotal: mspDiagnosticRunsTable.checksTotal,
            checksOk: mspDiagnosticRunsTable.checksOk,
            checksLicenseGap: mspDiagnosticRunsTable.checksLicenseGap,
            checksError: mspDiagnosticRunsTable.checksError,
            completedAt: mspDiagnosticRunsTable.completedAt,
            createdAt: mspDiagnosticRunsTable.createdAt,
          })
          .from(mspDiagnosticRunsTable)
          .where(
            and(
              eq(mspDiagnosticRunsTable.customerId, customerId),
              // "partial" included deliberately: a partial run is a real
              // finished scan (graded below via evaluateDocGateCoverage) —
              // excluding it hid every scan from tenants whose runs never
              // reach literal "completed".
              inArray(mspDiagnosticRunsTable.status, ["completed", "partial", "failed"]),
              beforeValid ? lt(mspDiagnosticRunsTable.createdAt, beforeValid) : undefined,
            ),
          )
          .orderBy(desc(mspDiagnosticRunsTable.createdAt))
          .limit(limit),

        db
          .select({
            findingId: mspDiagnosticFindingsTable.findingId,
            severity: mspDiagnosticFindingsTable.severity,
            title: mspDiagnosticFindingsTable.title,
            description: mspDiagnosticFindingsTable.description,
            createdAt: mspDiagnosticFindingsTable.createdAt,
          })
          .from(mspDiagnosticFindingsTable)
          .where(
            and(
              eq(mspDiagnosticFindingsTable.customerId, customerId),
              inArray(mspDiagnosticFindingsTable.severity, ["warning", "critical"]),
              beforeValid ? lt(mspDiagnosticFindingsTable.createdAt, beforeValid) : undefined,
            ),
          )
          .orderBy(desc(mspDiagnosticFindingsTable.createdAt))
          .limit(limit),

        db
          .select({
            id: tenantEngineSnapshotsTable.id,
            engineKey: tenantEngineSnapshotsTable.engineKey,
            score: tenantEngineSnapshotsTable.score,
            previousScore: tenantEngineSnapshotsTable.previousScore,
            delta: tenantEngineSnapshotsTable.delta,
            capturedAt: tenantEngineSnapshotsTable.capturedAt,
          })
          .from(tenantEngineSnapshotsTable)
          .where(
            and(
              eq(tenantEngineSnapshotsTable.customerId, customerId),
              beforeValid ? lt(tenantEngineSnapshotsTable.capturedAt, beforeValid) : undefined,
            ),
          )
          .orderBy(desc(tenantEngineSnapshotsTable.capturedAt))
          .limit(limit * 2), // over-fetch since most rows get filtered out below the significance threshold

        db
          .select({
            id: insightsGeneratedDocumentsTable.id,
            title: insightsGeneratedDocumentsTable.title,
            docType: insightsGeneratedDocumentsTable.docType,
            status: insightsGeneratedDocumentsTable.status,
            approvedAt: insightsGeneratedDocumentsTable.approvedAt,
            deliveredAt: insightsGeneratedDocumentsTable.deliveredAt,
            createdAt: insightsGeneratedDocumentsTable.createdAt,
          })
          .from(insightsGeneratedDocumentsTable)
          .where(
            and(
              inArray(insightsGeneratedDocumentsTable.customerId, customerUserIds),
              inArray(insightsGeneratedDocumentsTable.status, ["delivered", "approved"]),
              beforeValid ? lt(insightsGeneratedDocumentsTable.createdAt, beforeValid) : undefined,
            ),
          )
          .orderBy(desc(insightsGeneratedDocumentsTable.createdAt))
          .limit(limit),

        db
          .select({
            id: salesOffersTable.id,
            title: salesOffersTable.title,
            state: salesOffersTable.state,
            sentAt: salesOffersTable.sentAt,
            acceptedAt: salesOffersTable.acceptedAt,
            closedAt: salesOffersTable.closedAt,
            createdAt: salesOffersTable.createdAt,
          })
          .from(salesOffersTable)
          .where(
            and(
              eq(salesOffersTable.customerId, customerId),
              inArray(salesOffersTable.state, ["sent", "accepted", "rejected", "expired"]),
              beforeValid ? lt(salesOffersTable.createdAt, beforeValid) : undefined,
            ),
          )
          .orderBy(desc(salesOffersTable.createdAt))
          .limit(limit),
      ]);

      const events: TimelineEventDto[] = [];

      for (const run of runs) {
        const at = run.completedAt ?? run.createdAt;
        if (run.status === "completed" || run.status === "partial") {
          // Graded, not literal-status: a "partial" run with sufficient real
          // evaluable coverage (evaluateDocGateCoverage) reads as a successful
          // scan; a near-dark partial run is shown honestly as limited coverage.
          const cov = evaluateDocGateCoverage({
            checksOk: run.checksOk ?? 0,
            checksLicenseGap: run.checksLicenseGap ?? 0,
            checksError: run.checksError ?? 0,
            checksTotal: run.checksTotal ?? 0,
          });
          const sufficient = run.status === "completed" || cov.proceed;
          events.push({
            id: `run:${run.runId}`,
            type: "scan_completed",
            title: sufficient ? "Security scan completed" : "Security scan finished with limited coverage",
            description: run.checksTotal > 0 ? `${run.checksOk} of ${run.checksTotal} checks passed` : undefined,
            status: sufficient ? "success" : "warning",
            timestamp: at.toISOString(),
          });
        } else if (run.status === "failed") {
          events.push({
            id: `run:${run.runId}`,
            type: "scan_failed",
            title: "Security scan couldn't complete",
            status: "warning",
            timestamp: at.toISOString(),
          });
        }
      }

      for (const finding of findings) {
        events.push({
          id: `finding:${finding.findingId}`,
          type: "finding",
          title: finding.title,
          description: finding.description ?? undefined,
          status: finding.severity === "critical" ? "error" : "warning",
          timestamp: finding.createdAt.toISOString(),
        });
      }

      for (const snap of snapshots) {
        if (snap.delta == null || Math.abs(snap.delta) < SCORE_DELTA_SIGNIFICANCE_THRESHOLD) continue;
        const label = engineLabel(snap.engineKey);
        const improved = snap.delta > 0;
        events.push({
          id: `score:${snap.id}`,
          type: "score_change",
          title: `${label} score ${improved ? "improved" : "declined"}`,
          description: snap.previousScore != null ? `${snap.previousScore} → ${snap.score} (${improved ? "+" : ""}${snap.delta} pts)` : undefined,
          status: improved ? "success" : "warning",
          timestamp: snap.capturedAt.toISOString(),
        });
      }

      for (const doc of documents) {
        const at = doc.deliveredAt ?? doc.approvedAt ?? doc.createdAt;
        events.push({
          id: `document:${doc.id}`,
          type: "document",
          title: `New document ready: ${doc.title}`,
          status: "success",
          timestamp: at.toISOString(),
        });
      }

      for (const offer of offers) {
        let title: string;
        let status: TimelineStatus;
        let at: Date;
        switch (offer.state) {
          case "accepted":
            title = `Offer accepted: ${offer.title}`;
            status = "success";
            at = offer.acceptedAt ?? offer.closedAt ?? offer.sentAt ?? offer.createdAt;
            break;
          case "rejected":
            title = `Offer declined: ${offer.title}`;
            status = "default";
            at = offer.closedAt ?? offer.sentAt ?? offer.createdAt;
            break;
          case "expired":
            title = `Offer expired: ${offer.title}`;
            status = "default";
            at = offer.closedAt ?? offer.sentAt ?? offer.createdAt;
            break;
          default:
            title = `New offer: ${offer.title}`;
            status = "info";
            at = offer.sentAt ?? offer.createdAt;
        }
        events.push({ id: `offer:${offer.id}`, type: "offer", title, status, timestamp: at.toISOString() });
      }

      events.sort((a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0));
      const page = events.slice(0, limit);

      // Any source hitting its own fetch cap means there could be older events
      // in that source beyond what we pulled — keep offering a next page until
      // every source came back under its cap.
      const moreAvailable =
        runs.length >= limit || findings.length >= limit || documents.length >= limit || offers.length >= limit || snapshots.length >= limit * 2;
      const nextCursor = page.length > 0 && moreAvailable ? page[page.length - 1].timestamp : null;

      res.json({ events: page, nextCursor });
    } catch (err) {
      log.error({ err, customerId }, "portal-customer-timeline: failed to load timeline");
      res.status(500).json({ error: "Unable to load your activity timeline right now. Please try again shortly." });
    }
  },
);

// ── GET /api/portal/customer/timeline/matrix ────────────────────────────────
//
// Backs the Overview page's Matrix/List timeline card (#4129), separate from
// the cursor-paginated feed above. That feed is deliberately past-only (its
// `before` cursor assumes monotonic backward traversal); this one needs a
// forward-looking window too — an upcoming policy review or a booked change
// window is never "older than X", it hasn't happened yet. So this is a
// second, windowed (not paginated) read across FIVE sources: the same
// Scans/Findings queried directly above, plus three real per-item-dated
// sources the design's own matrix now expects (Microsoft Changes, Change
// Windows, Policy Reviews) that the 5-source feed above never carried.
//
// Deliberately NOT reusing GET /api/portal/message-center for the Microsoft
// Changes lane: that route computes wave placement/scoring/density over the
// customer's ENTIRE corpus (hundreds of posts on a real tenant) and returns
// only a capped, per-wave-shaped subset — built for a paged reading surface,
// not a "give me what's dated in this window" query. Querying
// `msp_message_center_items` directly here, the same way the route above
// queries its own five tables directly, avoids paying for that shaping work
// on every Overview load and avoids a pagination-shape mismatch between the
// two surfaces.

const MATRIX_DEFAULT_BACK_DAYS = 14;
const MATRIX_DEFAULT_FWD_DAYS = 21;
const MATRIX_MAX_WINDOW_DAYS = 120;
const MATRIX_SOURCE_LIMIT = 80;
// Message Center corpora run into the hundreds on a real tenant (portal-
// message-center.ts's own header: "the live testbed tenant holds 501
// items") — over-fetch on the indexed lastModifiedDateTime column, then
// resolve each row's real `publishedAt` (startDateTime ?? lastModifiedDateTime)
// and re-filter to the exact window in JS, the same over-fetch-then-filter
// shape the score-delta source above already uses.
const MC_FETCH_LIMIT = 300;

type MatrixScanStatus = "success" | "warning";
type MatrixFindingStatus = "warning" | "error";
type MatrixPolicyStatus = "default" | "warning" | "error";

interface MatrixScanDto {
  id: string;
  title: string;
  status: MatrixScanStatus;
  timestamp: string;
}
interface MatrixFindingDto {
  id: string;
  title: string;
  status: MatrixFindingStatus;
  timestamp: string;
}
interface MatrixMicrosoftChangeDto {
  id: string;
  title: string;
  workload: string;
  timestamp: string;
}
interface MatrixChangeWindowDto {
  id: string;
  code: string;
  title: string;
  status: string;
  scheduledStart: string;
  scheduledEnd: string | null;
}
interface MatrixPolicyReviewDto {
  id: string;
  title: string;
  status: MatrixPolicyStatus;
  reviewDueAt: string;
}

router.get(
  "/portal/customer/timeline/matrix",
  requireCapability("ladder.customer-user"),
  async (req: Request, res: Response) => {
    const customerId = req.user!.customerId;
    if (!customerId) {
      res.status(400).json({ error: "No customer account associated with this user" });
      return;
    }

    const back = Math.min(
      Math.max(parseInt(String(req.query.back ?? MATRIX_DEFAULT_BACK_DAYS), 10) || MATRIX_DEFAULT_BACK_DAYS, 1),
      MATRIX_MAX_WINDOW_DAYS,
    );
    const fwd = Math.min(
      Math.max(parseInt(String(req.query.fwd ?? MATRIX_DEFAULT_FWD_DAYS), 10) || MATRIX_DEFAULT_FWD_DAYS, 1),
      MATRIX_MAX_WINDOW_DAYS,
    );
    const now = new Date();
    const DAY_MS = 24 * 60 * 60 * 1000;
    const windowStart = new Date(now.getTime() - back * DAY_MS);
    const windowEnd = new Date(now.getTime() + fwd * DAY_MS);

    try {
      // Change Windows and Policy Reviews are MSP-era (mspId, tenantId)-keyed
      // tables (see portal-customer-scope.ts's header) — an unresolvable scope
      // means genuinely none exist for this customer, not a permission
      // failure, matching every other route reading these two tables.
      const scope = await resolveTenantScope(customerId);

      const [runs, findings, mcRows, ccRows, polRows] = await Promise.all([
        db
          .select({
            runId: mspDiagnosticRunsTable.runId,
            status: mspDiagnosticRunsTable.status,
            checksTotal: mspDiagnosticRunsTable.checksTotal,
            checksOk: mspDiagnosticRunsTable.checksOk,
            checksLicenseGap: mspDiagnosticRunsTable.checksLicenseGap,
            checksError: mspDiagnosticRunsTable.checksError,
            completedAt: mspDiagnosticRunsTable.completedAt,
            createdAt: mspDiagnosticRunsTable.createdAt,
          })
          .from(mspDiagnosticRunsTable)
          .where(
            and(
              eq(mspDiagnosticRunsTable.customerId, customerId),
              inArray(mspDiagnosticRunsTable.status, ["completed", "partial", "failed"]),
              gte(mspDiagnosticRunsTable.createdAt, windowStart),
            ),
          )
          .orderBy(desc(mspDiagnosticRunsTable.createdAt))
          .limit(MATRIX_SOURCE_LIMIT),

        db
          .select({
            findingId: mspDiagnosticFindingsTable.findingId,
            severity: mspDiagnosticFindingsTable.severity,
            title: mspDiagnosticFindingsTable.title,
            createdAt: mspDiagnosticFindingsTable.createdAt,
          })
          .from(mspDiagnosticFindingsTable)
          .where(
            and(
              eq(mspDiagnosticFindingsTable.customerId, customerId),
              inArray(mspDiagnosticFindingsTable.severity, ["warning", "critical"]),
              gte(mspDiagnosticFindingsTable.createdAt, windowStart),
            ),
          )
          .orderBy(desc(mspDiagnosticFindingsTable.createdAt))
          .limit(MATRIX_SOURCE_LIMIT),

        scope
          ? db
              .select({
                graphMessageId: mspMessageCenterItemsTable.graphMessageId,
                title: mspMessageCenterItemsTable.title,
                services: mspMessageCenterItemsTable.services,
                startDateTime: mspMessageCenterItemsTable.startDateTime,
                lastModifiedDateTime: mspMessageCenterItemsTable.lastModifiedDateTime,
              })
              .from(mspMessageCenterItemsTable)
              .where(
                and(
                  eq(mspMessageCenterItemsTable.customerId, scope.customerId),
                  eq(mspMessageCenterItemsTable.mspId, scope.mspId),
                  gte(mspMessageCenterItemsTable.lastModifiedDateTime, windowStart),
                ),
              )
              .orderBy(desc(mspMessageCenterItemsTable.lastModifiedDateTime))
              .limit(MC_FETCH_LIMIT)
          : Promise.resolve([]),

        scope
          ? db
              .select({
                id: mspChangeRequestsTable.id,
                title: mspChangeRequestsTable.title,
                status: mspChangeRequestsTable.status,
                scheduledStart: mspChangeRequestsTable.scheduledStart,
                scheduledEnd: mspChangeRequestsTable.scheduledEnd,
              })
              .from(mspChangeRequestsTable)
              .where(
                and(
                  eq(mspChangeRequestsTable.mspId, scope.mspId),
                  eq(mspChangeRequestsTable.tenantId, scope.tenantId),
                  isNotNull(mspChangeRequestsTable.scheduledStart),
                  gte(mspChangeRequestsTable.scheduledStart, windowStart),
                  lte(mspChangeRequestsTable.scheduledStart, windowEnd),
                ),
              )
              .orderBy(desc(mspChangeRequestsTable.scheduledStart))
              .limit(MATRIX_SOURCE_LIMIT)
          : Promise.resolve([]),

        scope
          ? db
              .select({
                id: policyDecisionsTable.id,
                title: policyDecisionsTable.title,
                reviewState: policyDecisionsTable.reviewState,
                reviewDueAt: policyDecisionsTable.reviewDueAt,
              })
              .from(policyDecisionsTable)
              .where(
                and(
                  eq(policyDecisionsTable.mspId, scope.mspId),
                  eq(policyDecisionsTable.tenantId, scope.tenantId),
                  isNotNull(policyDecisionsTable.reviewDueAt),
                  gte(policyDecisionsTable.reviewDueAt, windowStart),
                  lte(policyDecisionsTable.reviewDueAt, windowEnd),
                ),
              )
              .orderBy(desc(policyDecisionsTable.reviewDueAt))
              .limit(MATRIX_SOURCE_LIMIT)
          : Promise.resolve([]),
      ]);

      const scans: MatrixScanDto[] = runs.map((run) => {
        const at = run.completedAt ?? run.createdAt;
        if (run.status === "failed") {
          return { id: `run:${run.runId}`, title: "Security scan couldn't complete", status: "warning", timestamp: at.toISOString() };
        }
        const cov = evaluateDocGateCoverage({
          checksOk: run.checksOk ?? 0,
          checksLicenseGap: run.checksLicenseGap ?? 0,
          checksError: run.checksError ?? 0,
          checksTotal: run.checksTotal ?? 0,
        });
        const sufficient = run.status === "completed" || cov.proceed;
        return {
          id: `run:${run.runId}`,
          title: sufficient ? "Security scan completed" : "Security scan finished with limited coverage",
          status: sufficient ? "success" : "warning",
          timestamp: at.toISOString(),
        };
      });

      const findingsDto: MatrixFindingDto[] = findings.map((f) => ({
        id: `finding:${f.findingId}`,
        title: f.title,
        status: f.severity === "critical" ? "error" : "warning",
        timestamp: f.createdAt.toISOString(),
      }));

      const microsoftChanges: MatrixMicrosoftChangeDto[] = mcRows
        .map((r) => ({
          id: `mc:${r.graphMessageId}`,
          title: r.title,
          workload: r.services[0] ?? "General",
          at: r.startDateTime ?? r.lastModifiedDateTime,
        }))
        .filter((r) => r.at >= windowStart && r.at <= windowEnd)
        .sort((a, b) => b.at.getTime() - a.at.getTime())
        .slice(0, MATRIX_SOURCE_LIMIT)
        .map((r) => ({ id: r.id, title: r.title, workload: r.workload, timestamp: r.at.toISOString() }));

      const changeWindows: MatrixChangeWindowDto[] = ccRows.map((r) => ({
        id: `cc:${r.id}`,
        code: formatChangeRequestCode(r.id),
        title: r.title,
        status: r.status,
        // isNotNull(scheduledStart) is in the WHERE clause above, but Drizzle's
        // types don't narrow on that, so scheduledStart is asserted non-null here.
        scheduledStart: r.scheduledStart!.toISOString(),
        scheduledEnd: r.scheduledEnd?.toISOString() ?? null,
      }));

      const policyReviews: MatrixPolicyReviewDto[] = polRows.map((r) => ({
        id: `policy:${r.id}`,
        title: r.title,
        status: r.reviewState === "overdue" ? "error" : r.reviewState === "due" ? "warning" : "default",
        // isNotNull(reviewDueAt) is in the WHERE clause above; asserted for the same reason as scheduledStart.
        reviewDueAt: r.reviewDueAt!.toISOString(),
      }));

      res.json({
        windowStart: windowStart.toISOString(),
        windowEnd: windowEnd.toISOString(),
        scans,
        findings: findingsDto,
        microsoftChanges,
        changeWindows,
        policyReviews,
      });
    } catch (err) {
      log.error({ err, customerId }, "portal-customer-timeline: failed to load timeline matrix");
      res.status(500).json({ error: "Unable to load your activity timeline right now. Please try again shortly." });
    }
  },
);

export default router;
