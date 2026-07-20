/**
 * msp-customer-timeline.ts
 *
 * MSP Cross-Tenant Timeline — a chronological activity feed across every
 * customer in the caller's own MSP book, so MSP staff aren't stuck opening
 * each customer's individual Activity Timeline to see what's happened.
 *
 * Mirrors the exact event sources and significance filtering already proven
 * in portal-customer-timeline.ts (the customer-facing single-tenant version)
 * — same five sources, same severity/threshold/status cutoffs — extended
 * across the MSP's book instead of a single customerId. That file is left
 * untouched; this is a parallel MSP-scoped aggregation, the same relationship
 * msp-alerts.ts has to portal-mission-control.ts's single-customer triage.
 *
 *   - diagnostic run completions (msp_diagnostic_runs)
 *   - warning/critical diagnostic findings (msp_diagnostic_findings)
 *   - significant engine score changes (tenant_engine_snapshots) — |delta| >= 5
 *   - documents that have actually reached the customer (insights_generated_documents,
 *     status delivered/approved)
 *   - sales offers once they've actually been sent (sales_offers, state != draft)
 *
 * Data-model note: insights_generated_documents.customerId and
 * sales_offers.customerId are both users.id, NOT msp_customers.id — bridged
 * via msp_users the same way msp-documents-hub.ts already does.
 *
 * Scoping: mspId from resolveMspIdStrict (session JWT only, no ?mspId=
 * override) + resolveStaffScopedCustomerIds (a scoped MSP staff member only
 * sees events for their assigned customers; 0 scope rows = unrestricted).
 *
 * Auth: requireRole("MSPOperator") — MSPOperator+ (MSPAdmin, PlatformAdmin).
 *
 * Routes:
 *   GET /api/msp/timeline
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  mspCustomersTable,
  mspUsersTable,
  mspDiagnosticRunsTable,
  mspDiagnosticFindingsTable,
  tenantEngineSnapshotsTable,
  insightsGeneratedDocumentsTable,
  salesOffersTable,
} from "@workspace/db";
import { eq, and, desc, lt, inArray } from "drizzle-orm";
import { requireRole, resolveStaffScopedCustomerIds } from "../middlewares/requireAuth";
import { resolveMspIdStrict } from "../lib/resolve-msp-id.ts";
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

interface CrossTenantTimelineEventDto {
  id: string;
  type: TimelineEventType;
  title: string;
  description?: string;
  status: TimelineStatus;
  timestamp: string;
  customerId: number | null;
  customerName: string | null;
  deepLink: string | null;
}

function engineLabel(engineKey: string): string {
  return ENGINE_LABELS[engineKey] ?? engineKey.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** userId(users.id) -> { mspCustomerId, mspCustomerName } for every customer in mspId's book. */
async function loadCustomerBridge(mspId: number) {
  const rows = await db
    .select({
      userId: mspUsersTable.userId,
      customerId: mspUsersTable.customerId,
      customerName: mspCustomersTable.name,
    })
    .from(mspUsersTable)
    .leftJoin(mspCustomersTable, eq(mspUsersTable.customerId, mspCustomersTable.id))
    .where(eq(mspUsersTable.mspId, mspId));

  const byUserId = new Map<number, { customerId: number | null; customerName: string | null }>();
  for (const row of rows) {
    byUserId.set(row.userId, { customerId: row.customerId, customerName: row.customerName ?? null });
  }
  return byUserId;
}

// ── GET /api/msp/timeline ───────────────────────────────────────────────────

router.get("/msp/timeline", requireRole("MSPOperator"), async (req: Request, res: Response) => {
  try {
    const mspId = resolveMspIdStrict(req);
    if (mspId === null) {
      res.status(403).json({ error: "MSP context required" });
      return;
    }

    const scopedIds = await resolveStaffScopedCustomerIds(req.user!);

    const customerIdParam = req.query.customerId ? Number(req.query.customerId) : undefined;
    const customerIdFilter = typeof customerIdParam === "number" && !isNaN(customerIdParam) ? customerIdParam : undefined;
    // A caller-requested customerId must itself respect staff scoping —
    // narrow rather than override it.
    const effectiveCustomerIds =
      customerIdFilter !== undefined
        ? scopedIds === null || scopedIds.includes(customerIdFilter)
          ? [customerIdFilter]
          : []
        : scopedIds;

    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? DEFAULT_LIMIT), 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);
    const before = req.query.before ? new Date(String(req.query.before)) : undefined;
    const beforeValid = before && !isNaN(before.getTime()) ? before : undefined;

    const customers = await db
      .select({ id: mspCustomersTable.id, name: mspCustomersTable.name })
      .from(mspCustomersTable)
      .where(
        effectiveCustomerIds === null
          ? eq(mspCustomersTable.mspId, mspId)
          : and(eq(mspCustomersTable.mspId, mspId), inArray(mspCustomersTable.id, effectiveCustomerIds)),
      );
    const customerNameById = new Map(customers.map((c) => [c.id, c.name]));

    const bridge = await loadCustomerBridge(mspId);
    const eligibleUserIds = [...bridge.entries()]
      .filter(([, v]) => (effectiveCustomerIds === null ? true : v.customerId !== null && effectiveCustomerIds.includes(v.customerId)))
      .map(([userId]) => userId);

    const [runs, findings, snapshots, documents, offers] = await Promise.all([
      db
        .select({
          runId: mspDiagnosticRunsTable.runId,
          customerId: mspDiagnosticRunsTable.customerId,
          status: mspDiagnosticRunsTable.status,
          checksTotal: mspDiagnosticRunsTable.checksTotal,
          checksOk: mspDiagnosticRunsTable.checksOk,
          completedAt: mspDiagnosticRunsTable.completedAt,
          createdAt: mspDiagnosticRunsTable.createdAt,
        })
        .from(mspDiagnosticRunsTable)
        .where(
          and(
            eq(mspDiagnosticRunsTable.mspId, mspId),
            inArray(mspDiagnosticRunsTable.status, ["completed", "failed"]),
            ...(effectiveCustomerIds === null ? [] : [inArray(mspDiagnosticRunsTable.customerId, effectiveCustomerIds)]),
            ...(beforeValid ? [lt(mspDiagnosticRunsTable.createdAt, beforeValid)] : []),
          ),
        )
        .orderBy(desc(mspDiagnosticRunsTable.createdAt))
        .limit(limit),

      db
        .select({
          findingId: mspDiagnosticFindingsTable.findingId,
          customerId: mspDiagnosticFindingsTable.customerId,
          severity: mspDiagnosticFindingsTable.severity,
          title: mspDiagnosticFindingsTable.title,
          description: mspDiagnosticFindingsTable.description,
          createdAt: mspDiagnosticFindingsTable.createdAt,
        })
        .from(mspDiagnosticFindingsTable)
        .where(
          and(
            eq(mspDiagnosticFindingsTable.mspId, mspId),
            inArray(mspDiagnosticFindingsTable.severity, ["warning", "critical"]),
            ...(effectiveCustomerIds === null ? [] : [inArray(mspDiagnosticFindingsTable.customerId, effectiveCustomerIds)]),
            ...(beforeValid ? [lt(mspDiagnosticFindingsTable.createdAt, beforeValid)] : []),
          ),
        )
        .orderBy(desc(mspDiagnosticFindingsTable.createdAt))
        .limit(limit),

      db
        .select({
          id: tenantEngineSnapshotsTable.id,
          customerId: tenantEngineSnapshotsTable.customerId,
          engineKey: tenantEngineSnapshotsTable.engineKey,
          score: tenantEngineSnapshotsTable.score,
          previousScore: tenantEngineSnapshotsTable.previousScore,
          delta: tenantEngineSnapshotsTable.delta,
          capturedAt: tenantEngineSnapshotsTable.capturedAt,
        })
        .from(tenantEngineSnapshotsTable)
        .where(
          and(
            eq(tenantEngineSnapshotsTable.mspId, mspId),
            ...(effectiveCustomerIds === null ? [] : [inArray(tenantEngineSnapshotsTable.customerId, effectiveCustomerIds)]),
            ...(beforeValid ? [lt(tenantEngineSnapshotsTable.capturedAt, beforeValid)] : []),
          ),
        )
        .orderBy(desc(tenantEngineSnapshotsTable.capturedAt))
        .limit(limit * 2), // over-fetch since most rows get filtered out below the significance threshold

      eligibleUserIds.length === 0
        ? Promise.resolve([])
        : db
            .select({
              id: insightsGeneratedDocumentsTable.id,
              customerId: insightsGeneratedDocumentsTable.customerId,
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
                inArray(insightsGeneratedDocumentsTable.customerId, eligibleUserIds),
                inArray(insightsGeneratedDocumentsTable.status, ["delivered", "approved"]),
                ...(beforeValid ? [lt(insightsGeneratedDocumentsTable.createdAt, beforeValid)] : []),
              ),
            )
            .orderBy(desc(insightsGeneratedDocumentsTable.createdAt))
            .limit(limit),

      db
        .select({
          id: salesOffersTable.id,
          customerId: salesOffersTable.customerId,
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
            eq(salesOffersTable.mspId, mspId),
            inArray(salesOffersTable.state, ["sent", "accepted", "rejected", "expired"]),
            ...(effectiveCustomerIds === null ? [] : [inArray(salesOffersTable.customerId, eligibleUserIds)]),
            ...(beforeValid ? [lt(salesOffersTable.createdAt, beforeValid)] : []),
          ),
        )
        .orderBy(desc(salesOffersTable.createdAt))
        .limit(limit),
    ]);

    function customerFor(mspCustomerId: number | null): { customerId: number | null; customerName: string | null; deepLink: string | null } {
      if (mspCustomerId === null) return { customerId: null, customerName: null, deepLink: null };
      return {
        customerId: mspCustomerId,
        customerName: customerNameById.get(mspCustomerId) ?? null,
        deepLink: `/customers/${mspCustomerId}`,
      };
    }

    const events: CrossTenantTimelineEventDto[] = [];

    for (const run of runs) {
      const at = run.completedAt ?? run.createdAt;
      const cust = customerFor(run.customerId);
      if (run.status === "completed") {
        events.push({
          id: `run:${run.runId}`,
          type: "scan_completed",
          title: "Security scan completed",
          description: run.checksTotal > 0 ? `${run.checksOk} of ${run.checksTotal} checks passed` : undefined,
          status: "success",
          timestamp: at.toISOString(),
          ...cust,
        });
      } else if (run.status === "failed") {
        events.push({
          id: `run:${run.runId}`,
          type: "scan_failed",
          title: "Security scan couldn't complete",
          status: "warning",
          timestamp: at.toISOString(),
          ...cust,
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
        ...customerFor(finding.customerId),
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
        ...customerFor(snap.customerId),
      });
    }

    for (const doc of documents) {
      const at = doc.deliveredAt ?? doc.approvedAt ?? doc.createdAt;
      const bridged = doc.customerId !== null ? bridge.get(doc.customerId) : undefined;
      events.push({
        id: `document:${doc.id}`,
        type: "document",
        title: `New document ready: ${doc.title}`,
        status: "success",
        timestamp: at.toISOString(),
        ...customerFor(bridged?.customerId ?? null),
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
      const bridged = offer.customerId !== null ? bridge.get(offer.customerId) : undefined;
      events.push({
        id: `offer:${offer.id}`,
        type: "offer",
        title,
        status,
        timestamp: at.toISOString(),
        ...customerFor(bridged?.customerId ?? null),
      });
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
    log.error({ err }, "msp-customer-timeline: failed to load cross-tenant timeline");
    res.status(500).json({ error: "Unable to load the activity timeline right now. Please try again shortly." });
  }
});

export default router;
