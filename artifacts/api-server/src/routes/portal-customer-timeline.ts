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
 * Auth: requireRole("CustomerUser") — MSP JWT with CustomerUser role.
 *
 * Routes:
 *   GET /api/portal/customer/timeline
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { requireRole } from "../middlewares/requireAuth";
import {
  db,
  mspDiagnosticRunsTable,
  mspDiagnosticFindingsTable,
  tenantEngineSnapshotsTable,
  insightsGeneratedDocumentsTable,
  salesOffersTable,
} from "@workspace/db";
import { eq, and, desc, lt, inArray } from "drizzle-orm";
import { ENGINE_DEFS } from "../lib/engine-registry";
import { logger } from "../lib/logger";
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
  requireRole("CustomerUser"),
  async (req: Request, res: Response) => {
    const customerId = req.user!.customerId;
    const userId = req.user!.id;
    if (!customerId) {
      res.status(400).json({ error: "No customer account associated with this user" });
      return;
    }

    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? DEFAULT_LIMIT), 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);
    const before = req.query.before ? new Date(String(req.query.before)) : undefined;
    const beforeValid = before && !isNaN(before.getTime()) ? before : undefined;

    try {
      const [runs, findings, snapshots, documents, offers] = await Promise.all([
        db
          .select({
            runId: mspDiagnosticRunsTable.runId,
            status: mspDiagnosticRunsTable.status,
            checksTotal: mspDiagnosticRunsTable.checksTotal,
            checksOk: mspDiagnosticRunsTable.checksOk,
            completedAt: mspDiagnosticRunsTable.completedAt,
            createdAt: mspDiagnosticRunsTable.createdAt,
          })
          .from(mspDiagnosticRunsTable)
          .where(
            and(
              eq(mspDiagnosticRunsTable.customerId, customerId),
              inArray(mspDiagnosticRunsTable.status, ["completed", "failed"]),
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
              eq(insightsGeneratedDocumentsTable.customerId, userId),
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
              eq(salesOffersTable.customerId, userId),
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
        if (run.status === "completed") {
          events.push({
            id: `run:${run.runId}`,
            type: "scan_completed",
            title: "Security scan completed",
            description: run.checksTotal > 0 ? `${run.checksOk} of ${run.checksTotal} checks passed` : undefined,
            status: "success",
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

export default router;
