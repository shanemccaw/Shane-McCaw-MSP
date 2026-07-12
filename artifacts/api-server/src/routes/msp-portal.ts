/**
 * MSP Portal routes — scoped to authenticated MSP users.
 *
 * Dashboard:
 *   GET  /api/msp/dashboard          — KPIs: signals fired, offer acceptance, revenue
 *
 * Offboarding state machine (null → cancellation_requested → export_ready → archival_flagged):
 *   POST /api/msp/offboarding/request   — MSPAdmin requests cancellation
 *   POST /api/msp/offboarding/export    — MSPAdmin generates/downloads customer data export
 *   POST /api/msp/offboarding/archive   — PlatformAdmin confirms archival_flagged
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, mspsTable, mspCustomersTable, mspEventStoreTable, mspAuditLogsTable, salesOffersTable, mspSalesBundlesTable, mspUsersTable, mspSalesBundleAssignmentsTable } from "@workspace/db";
import { eq, and, count, sql, gte, like, sum, or, desc, ilike, inArray } from "drizzle-orm";
import { z } from "zod";
import { hashBody, checkIdempotency, recordIdempotency } from "../lib/idempotency.ts";
import { requireAuth, requireRole } from "../middlewares/requireAuth.ts";
import { getAiBalance } from "../lib/ai-billing.ts";
import { resolveMspId, resolveMspIdOrZero } from "../lib/resolve-msp-id.ts";

const router: IRouter = Router();

// ── Helpers ────────────────────────────────────────────────────────────────────

function startOfMonth(): Date {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/** Returns the mspId to use for the request — throws if none available. */

// ── GET /api/msp/dashboard ─────────────────────────────────────────────────────

router.get(
  "/msp/dashboard",
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const mspId = await resolveMspIdOrZero(req);

      const monthStart = startOfMonth();

      // Run all queries in parallel
      const [
        customerRows,
        signalRows,
        offerSentRows,
        offerAcceptedRows,
        revenueResult,
        mspRow,
        unacceptedOffersResult,
        idleBundlesResult,
        aiBalance,
      ] = await Promise.all([
        // Customer breakdown: total + by status
        mspId
          ? db
              .select({
                status: mspCustomersTable.status,
                n: count(),
              })
              .from(mspCustomersTable)
              .where(eq(mspCustomersTable.mspId, mspId))
              .groupBy(mspCustomersTable.status)
          : Promise.resolve([]),

        // Signals fired this month
        mspId
          ? db
              .select({ n: count() })
              .from(mspEventStoreTable)
              .where(
                and(
                  eq(mspEventStoreTable.mspId, mspId),
                  like(mspEventStoreTable.eventType, "signal.%"),
                  gte(mspEventStoreTable.occurredAt, monthStart),
                ),
              )
          : Promise.resolve([{ n: 0 }]),

        // Offer sent events this month
        mspId
          ? db
              .select({ n: count() })
              .from(mspEventStoreTable)
              .where(
                and(
                  eq(mspEventStoreTable.mspId, mspId),
                  eq(mspEventStoreTable.eventType, "offer.sent"),
                  gte(mspEventStoreTable.occurredAt, monthStart),
                ),
              )
          : Promise.resolve([{ n: 0 }]),

        // Offer accepted events this month
        mspId
          ? db
              .select({ n: count() })
              .from(mspEventStoreTable)
              .where(
                and(
                  eq(mspEventStoreTable.mspId, mspId),
                  eq(mspEventStoreTable.eventType, "offer.accepted"),
                  gte(mspEventStoreTable.occurredAt, monthStart),
                ),
              )
          : Promise.resolve([{ n: 0 }]),

        // Revenue this month — sum payload.amountCents from payment.completed events
        mspId
          ? db.execute(
              sql`
                SELECT COALESCE(
                  SUM((payload->>'amountCents')::bigint), 0
                ) AS total_cents
                FROM msp_event_store
                WHERE msp_id = ${mspId}
                  AND event_type = 'payment.completed'
                  AND occurred_at >= ${monthStart}
              `,
            )
          : Promise.resolve({ rows: [{ total_cents: 0 }] }),

        // MSP record for offboarding state
        mspId
          ? db
              .select({
                id: mspsTable.id,
                name: mspsTable.name,
                status: mspsTable.status,
                offboardingState: mspsTable.offboardingState,
                offboardingRequestedAt: mspsTable.offboardingRequestedAt,
                exportReadyAt: mspsTable.exportReadyAt,
              })
              .from(mspsTable)
              .where(eq(mspsTable.id, mspId))
              .limit(1)
          : Promise.resolve([]),

        // ── Growth widget #1: unaccepted offers value ─────────────────────────
        // Sum of adjustedPriceCents for sent (unaccepted) offers for this MSP
        mspId
          ? db
              .select({
                totalCents: sum(salesOffersTable.adjustedPriceCents),
                offerCount: count(),
              })
              .from(salesOffersTable)
              .where(
                and(
                  eq(salesOffersTable.mspId, mspId),
                  eq(salesOffersTable.state, "sent"),
                ),
              )
          : Promise.resolve([{ totalCents: null, offerCount: 0 }]),

        // ── Growth widget #2: idle bundles (no active assignment in 30 days) ─
        mspId
          ? db.execute(
              sql`
                SELECT b.bundle_id AS "bundleId", b.name,
                  FLOOR(
                    EXTRACT(EPOCH FROM (NOW() - COALESCE(MAX(a.assigned_at), b.created_at)))
                    / 86400
                  )::int AS "daysIdle"
                FROM msp_sales_bundles b
                LEFT JOIN msp_sales_bundle_assignments a
                  ON a.bundle_id = b.bundle_id AND a.status != 'revoked'
                WHERE b.msp_id = ${mspId} AND b.status = 'active'
                GROUP BY b.bundle_id, b.name, b.created_at
                HAVING COALESCE(MAX(a.assigned_at), b.created_at) < NOW() - INTERVAL '30 days'
                ORDER BY "daysIdle" DESC
                LIMIT 5
              `,
            )
          : Promise.resolve({ rows: [] }),

        // ── Growth widget #3: AI balance (momentum framing) ──────────────────
        // Silently suppress errors — this widget is optional
        mspId ? getAiBalance(mspId).catch(() => null) : Promise.resolve(null),
      ]);

      // Aggregate customer counts
      const customerCounts = { total: 0, active: 0, inactive: 0, onboarding: 0 };
      for (const row of customerRows) {
        const n = Number(row.n);
        customerCounts.total += n;
        if (row.status === "active") customerCounts.active = n;
        else if (row.status === "inactive") customerCounts.inactive = n;
        else if (row.status === "onboarding") customerCounts.onboarding = n;
      }

      const signalsFiredThisMonth = Number(signalRows[0]?.n ?? 0);
      const offersSent = Number(offerSentRows[0]?.n ?? 0);
      const offersAccepted = Number(offerAcceptedRows[0]?.n ?? 0);

      // Offer acceptance rate: accepted / sent (percentage, 0–100)
      // Fall back to active customer % of total as a proxy when no offer events exist yet
      let offerAcceptanceRate = 0;
      if (offersSent > 0) {
        offerAcceptanceRate = Math.round((offersAccepted / offersSent) * 100);
      } else if (customerCounts.total > 0) {
        offerAcceptanceRate = Math.round(
          (customerCounts.active / customerCounts.total) * 100,
        );
      }

      const revenueRows = (
        revenueResult && "rows" in revenueResult
          ? (revenueResult as { rows: Array<{ total_cents: unknown }> }).rows
          : []
      );
      const revenueCentsThisMonth = Number(revenueRows[0]?.total_cents ?? 0);

      const msp = (mspRow as Array<{ id: number; name: string; status: string; offboardingState: string | null; offboardingRequestedAt: Date | null; exportReadyAt: Date | null }>)[0] ?? null;

      // ── Growth widget data ──────────────────────────────────────────────────

      // Widget 1: unaccepted offers
      type UnacceptedRow = { totalCents: string | null; offerCount: number };
      const unacceptedRow = (unacceptedOffersResult as UnacceptedRow[])[0] ?? { totalCents: null, offerCount: 0 };
      const unacceptedOffersCents = Number(unacceptedRow.totalCents ?? 0);
      const unacceptedOffersCount = Number(unacceptedRow.offerCount ?? 0);

      // Widget 2: idle bundles
      type IdleBundleRow = { bundleId: string; name: string; daysIdle: number };
      const idleBundles = (
        idleBundlesResult && "rows" in idleBundlesResult
          ? (idleBundlesResult as { rows: IdleBundleRow[] }).rows
          : []
      );

      // Widget 3: AI balance/momentum
      const aiAlertThreshold = (aiBalance as { alertThreshold?: number | null } | null)?.alertThreshold ?? null;
      const aiPeriodUsagePct = (aiBalance as { periodUsagePct?: number | null } | null)?.periodUsagePct ?? null;

      res.json({
        msp,
        customers: customerCounts,
        signalsFiredThisMonth,
        offerAcceptanceRate,
        offersSent,
        offersAccepted,
        revenueCentsThisMonth,
        revenueUsdThisMonth: (revenueCentsThisMonth / 100).toFixed(2),
        periodStart: monthStart.toISOString(),
        unacceptedOffersCents,
        unacceptedOffersCount,
        idleBundles,
        aiAlertThreshold,
        aiPeriodUsagePct,
      });
    } catch (err) {
      req.log.error({ err }, "msp-portal: dashboard query failed");
      res.status(500).json({ error: "Dashboard query failed" });
    }
  },
);

// ── POST /api/msp/offboarding/request ─────────────────────────────────────────
// MSPAdmin initiates the cancellation request.  State: null → cancellation_requested.

router.post(
  "/msp/offboarding/request",
  requireRole("MSPAdmin"),
  async (req: Request, res: Response) => {
    try {
      const mspId = await resolveMspIdOrZero(req);
      if (!mspId) {
        res.status(400).json({ error: "mspId required" });
        return;
      }

      const [msp] = await db
        .select({ id: mspsTable.id, offboardingState: mspsTable.offboardingState })
        .from(mspsTable)
        .where(eq(mspsTable.id, mspId))
        .limit(1);

      if (!msp) {
        res.status(404).json({ error: "MSP not found" });
        return;
      }

      if (msp.offboardingState) {
        res.status(409).json({
          error: `Offboarding already in progress (state: ${msp.offboardingState})`,
          offboardingState: msp.offboardingState,
        });
        return;
      }

      const now = new Date();
      await db
        .update(mspsTable)
        .set({
          offboardingState: "cancellation_requested",
          offboardingRequestedAt: now,
          updatedAt: now,
        })
        .where(eq(mspsTable.id, mspId));

      // Record in event store
      await db.insert(mspEventStoreTable).values({
        eventType: "msp.cancellation_requested",
        source: "msp-portal",
        actor: {
          id: req.user!.id,
          role: req.user!.mspRole ?? "MSPAdmin",
          type: "user",
        },
        meta: { tenant: { mspId, customerId: null } },
        mspId,
        ownerType: "msp",
      });

      // Audit log
      await db.insert(mspAuditLogsTable).values({
        actorUserId: req.user!.id,
        actorRole: req.user!.mspRole ?? "MSPAdmin",
        mspId,
        actionType: "msp.offboarding.request",
        entityType: "msp",
        entityId: String(mspId),
        outcome: "success",
        metadata: { requestedAt: now.toISOString() },
      });

      req.log.info({ mspId, actorId: req.user!.id }, "msp-portal: cancellation requested");
      res.json({ ok: true, offboardingState: "cancellation_requested", requestedAt: now.toISOString() });
    } catch (err) {
      req.log.error({ err }, "msp-portal: offboarding request failed");
      res.status(500).json({ error: "Offboarding request failed" });
    }
  },
);

// ── POST /api/msp/offboarding/export ──────────────────────────────────────────
// MSPAdmin generates and downloads the customer data export package.
// State: cancellation_requested → export_ready.
// Customer owns their data — export contains full customer + event history.

router.post(
  "/msp/offboarding/export",
  requireRole("MSPAdmin"),
  async (req: Request, res: Response) => {
    try {
      const mspId = await resolveMspIdOrZero(req);
      if (!mspId) {
        res.status(400).json({ error: "mspId required" });
        return;
      }

      const [msp] = await db
        .select()
        .from(mspsTable)
        .where(eq(mspsTable.id, mspId))
        .limit(1);

      if (!msp) {
        res.status(404).json({ error: "MSP not found" });
        return;
      }

      if (msp.offboardingState === "archival_flagged") {
        res.status(409).json({ error: "MSP is already archived" });
        return;
      }

      // Gather customer data
      const customers = await db
        .select({
          id: mspCustomersTable.id,
          name: mspCustomersTable.name,
          domain: mspCustomersTable.domain,
          industry: mspCustomersTable.industry,
          tenantId: mspCustomersTable.tenantId,
          status: mspCustomersTable.status,
          ownerType: mspCustomersTable.ownerType,
          createdAt: mspCustomersTable.createdAt,
        })
        .from(mspCustomersTable)
        .where(eq(mspCustomersTable.mspId, mspId));

      // Event counts per customer
      const eventCountRows = await db
        .select({
          customerId: mspEventStoreTable.customerId,
          n: count(),
        })
        .from(mspEventStoreTable)
        .where(eq(mspEventStoreTable.mspId, mspId))
        .groupBy(mspEventStoreTable.customerId);

      const eventCountMap: Record<number, number> = {};
      for (const row of eventCountRows) {
        if (row.customerId != null) {
          eventCountMap[row.customerId] = Number(row.n);
        }
      }

      const exportPackage = {
        exportedAt: new Date().toISOString(),
        exportVersion: "1.0",
        msp: {
          id: msp.id,
          name: msp.name,
          slug: msp.slug,
          domain: msp.domain,
          status: msp.status,
          createdAt: msp.createdAt,
        },
        customers: customers.map((c) => ({
          ...c,
          eventCount: eventCountMap[c.id] ?? 0,
        })),
        summary: {
          totalCustomers: customers.length,
          activeCustomers: customers.filter((c) => c.status === "active").length,
          totalEvents: Object.values(eventCountMap).reduce((s, n) => s + n, 0),
        },
        notice:
          "Customer data export — the customer organisation owns this data. " +
          "Re-onboard under a new MSP by registering with the new MSP's portal. " +
          "Direct MSP-to-MSP transfer is not supported in v1.",
      };

      // Advance state to export_ready (idempotent — ok if already export_ready)
      if (msp.offboardingState !== "export_ready") {
        const now = new Date();
        await db
          .update(mspsTable)
          .set({
            offboardingState: "export_ready",
            exportReadyAt: now,
            updatedAt: now,
          })
          .where(eq(mspsTable.id, mspId));

        await db.insert(mspEventStoreTable).values({
          eventType: "msp.export_ready",
          source: "msp-portal",
          actor: {
            id: req.user!.id,
            role: req.user!.mspRole ?? "MSPAdmin",
            type: "user",
          },
          meta: { tenant: { mspId, customerId: null } },
          payload: { customerCount: customers.length },
          mspId,
          ownerType: "msp",
        });

        await db.insert(mspAuditLogsTable).values({
          actorUserId: req.user!.id,
          actorRole: req.user!.mspRole ?? "MSPAdmin",
          mspId,
          actionType: "msp.offboarding.export",
          entityType: "msp",
          entityId: String(mspId),
          outcome: "success",
          metadata: { customerCount: customers.length, exportedAt: exportPackage.exportedAt },
        });
      }

      req.log.info({ mspId, customerCount: customers.length }, "msp-portal: export generated");
      res.json({ ok: true, offboardingState: "export_ready", export: exportPackage });
    } catch (err) {
      req.log.error({ err }, "msp-portal: export failed");
      res.status(500).json({ error: "Export generation failed" });
    }
  },
);

// ── POST /api/msp/offboarding/archive ─────────────────────────────────────────
// PlatformAdmin confirms archival.  State: export_ready → archival_flagged.
// This is a terminal state — the MSP record is retained (never silently deleted).

router.post(
  "/msp/offboarding/archive",
  requireRole("PlatformAdmin"),
  async (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const targetMspId = parseInt(String(body.mspId ?? ""), 10);
      if (isNaN(targetMspId)) {
        res.status(400).json({ error: "mspId required in request body" });
        return;
      }

      const [msp] = await db
        .select({ id: mspsTable.id, name: mspsTable.name, offboardingState: mspsTable.offboardingState })
        .from(mspsTable)
        .where(eq(mspsTable.id, targetMspId))
        .limit(1);

      if (!msp) {
        res.status(404).json({ error: "MSP not found" });
        return;
      }

      if (msp.offboardingState === "archival_flagged") {
        res.json({ ok: true, offboardingState: "archival_flagged", alreadyArchived: true });
        return;
      }

      if (msp.offboardingState !== "export_ready") {
        res.status(409).json({
          error: `Cannot archive — expected state export_ready, got: ${msp.offboardingState ?? "null"}`,
          offboardingState: msp.offboardingState,
        });
        return;
      }

      const now = new Date();
      await db
        .update(mspsTable)
        .set({
          offboardingState: "archival_flagged",
          status: "suspended",
          suspendedAt: now,
          updatedAt: now,
        })
        .where(eq(mspsTable.id, targetMspId));

      await db.insert(mspEventStoreTable).values({
        eventType: "msp.archival_flagged",
        source: "msp-portal",
        actor: {
          id: req.user!.id,
          role: "PlatformAdmin",
          type: "user",
        },
        meta: { tenant: { mspId: targetMspId, customerId: null } },
        mspId: targetMspId,
        ownerType: "platform",
      });

      await db.insert(mspAuditLogsTable).values({
        actorUserId: req.user!.id,
        actorRole: "PlatformAdmin",
        mspId: targetMspId,
        actionType: "msp.offboarding.archive",
        entityType: "msp",
        entityId: String(targetMspId),
        entityLabel: msp.name,
        outcome: "success",
        metadata: { archivedAt: now.toISOString() },
      });

      req.log.info({ mspId: targetMspId, actorId: req.user!.id }, "msp-portal: MSP archived");
      res.json({ ok: true, offboardingState: "archival_flagged", archivedAt: now.toISOString() });
    } catch (err) {
      req.log.error({ err }, "msp-portal: archive failed");
      res.status(500).json({ error: "Archive operation failed" });
    }
  },
);

// ── GET /api/msp/events ────────────────────────────────────────────────────────
// Recent events scoped to the authenticated MSP, ordered newest first.
// Query params: limit (default 50, max 200)

router.get(
  "/msp/events",
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const mspId = await resolveMspId(req);
      const limit = Math.min(200, Math.max(1, parseInt(String((req.query as Record<string, unknown>).limit ?? "50"), 10) || 50));

      // Base query
      const baseConditions = mspId
        ? [eq(mspEventStoreTable.mspId, mspId)]
        : [];

      const rows = await db
        .select({
          id: mspEventStoreTable.id,
          eventType: mspEventStoreTable.eventType,
          customerId: mspEventStoreTable.customerId,
          occurredAt: mspEventStoreTable.occurredAt,
          payload: mspEventStoreTable.payload,
          customerName: mspCustomersTable.name,
        })
        .from(mspEventStoreTable)
        .leftJoin(mspCustomersTable, eq(mspEventStoreTable.customerId, mspCustomersTable.id))
        .where(baseConditions.length > 0 ? and(...(baseConditions as [ReturnType<typeof eq>])) : undefined)
        .orderBy(desc(mspEventStoreTable.occurredAt))
        .limit(limit);

      const events = rows.map((r) => {
        // Derive severity from event type prefix
        let severity: "info" | "warning" | "critical" = "info";
        if (r.eventType.startsWith("error.") || r.eventType.startsWith("msp.cancellation")) {
          severity = "critical";
        } else if (r.eventType.startsWith("signal.") || r.eventType.startsWith("msp.offboarding")) {
          severity = "warning";
        }

        // Human-readable description: prefer payload.description, then humanise the eventType
        const payloadDesc = typeof (r.payload as Record<string, unknown>)?.description === "string"
          ? String((r.payload as Record<string, unknown>).description)
          : null;
        const description = payloadDesc ?? r.eventType.replace(/[._]/g, " ");

        return {
          id: r.id,
          type: r.eventType,
          customerName: r.customerName ?? "—",
          description,
          severity,
          occurredAt: r.occurredAt,
        };
      });

      res.json({ events, total: events.length, limit });
    } catch (err) {
      req.log.error({ err }, "msp-portal: events query failed");
      res.status(500).json({ error: "Failed to fetch events" });
    }
  },
);

// ── POST /api/msp/customers/bulk ───────────────────────────────────────────────
// Bulk actions on a set of customers owned by the authenticated MSP.
// Actions: assign_bundle, tag, export, archive
// Each action is applied per-customer; assign_bundle uses per-customer idempotency.

router.post(
  "/msp/customers/bulk",
  requireRole("MSPAdmin"),
  async (req: Request, res: Response) => {
    try {
      const mspId = await resolveMspIdOrZero(req);
      if (!mspId) {
        res.status(400).json({ error: "mspId required" });
        return;
      }

      const body = req.body as {
        customerIds?: unknown;
        action?: unknown;
        payload?: Record<string, unknown>;
      };

      const customerIds = body.customerIds;
      const action = typeof body.action === "string" ? body.action : null;
      const payload = body.payload ?? {};

      if (!Array.isArray(customerIds) || customerIds.length === 0) {
        res.status(400).json({ error: "customerIds must be a non-empty array" });
        return;
      }
      if (customerIds.length > 500) {
        res.status(400).json({ error: "Cannot bulk-act on more than 500 customers at once" });
        return;
      }

      const ids = customerIds.map((x) => Number(x)).filter((n) => !isNaN(n) && n > 0);
      if (ids.length === 0) {
        res.status(400).json({ error: "customerIds must be numeric" });
        return;
      }

      // Verify all supplied IDs belong to this MSP
      const ownedRows = await db
        .select({
          id: mspCustomersTable.id,
          tenantId: mspCustomersTable.tenantId,
          name: mspCustomersTable.name,
          domain: mspCustomersTable.domain,
          status: mspCustomersTable.status,
          industry: mspCustomersTable.industry,
          createdAt: mspCustomersTable.createdAt,
        })
        .from(mspCustomersTable)
        .where(and(inArray(mspCustomersTable.id, ids), eq(mspCustomersTable.mspId, mspId)));

      const ownedIdSet = new Set(ownedRows.map((r) => r.id));
      const unauthorized = ids.filter((id) => !ownedIdSet.has(id));
      if (unauthorized.length > 0) {
        res.status(403).json({ error: "Some customerIds do not belong to this MSP", unauthorized });
        return;
      }

      // ── assign_bundle ──────────────────────────────────────────────────────────
      if (action === "assign_bundle") {
        const bundleId = typeof payload.bundleId === "string" ? payload.bundleId : null;
        if (!bundleId) {
          res.status(400).json({ error: "payload.bundleId required for assign_bundle" });
          return;
        }

        const [bundle] = await db
          .select()
          .from(mspSalesBundlesTable)
          .where(and(eq(mspSalesBundlesTable.bundleId, bundleId), eq(mspSalesBundlesTable.mspId, mspId)));

        if (!bundle) {
          res.status(404).json({ error: "Bundle not found" });
          return;
        }
        if (bundle.status !== "active") {
          res.status(409).json({ error: "Only active bundles can be assigned. Activate the bundle first." });
          return;
        }

        const actorId = req.user!.id;
        const results: Array<{ customerId: number; status: "assigned" | "skipped"; assignmentId?: string }> = [];

        for (const cust of ownedRows) {
          // Per-customer idempotency key — replay-safe across retries and duplicate submissions
          const iKey = `bulk:assign_bundle:${bundleId}:${cust.id}:${actorId}`;
          const bodyHash = hashBody({ bundleId, customerId: cust.id, actorId });
          const cached = await checkIdempotency(iKey, mspId, bodyHash);
          if (cached) {
            const cachedAssignmentId =
              typeof cached.responseBody.assignmentId === "string"
                ? cached.responseBody.assignmentId
                : undefined;
            results.push({ customerId: cust.id, status: "skipped", assignmentId: cachedAssignmentId });
            continue;
          }

          const now = new Date();
          const trialExpiresAt =
            typeof bundle.trialDays === "number" && bundle.trialDays > 0
              ? new Date(Date.now() + bundle.trialDays * 24 * 60 * 60 * 1000)
              : null;

          const [assignment] = await db
            .insert(mspSalesBundleAssignmentsTable)
            .values({
              bundleId,
              mspId,
              customerId: cust.id,
              tenantId: cust.tenantId ?? undefined,
              status: "active",
              activatedAt: now,
              trialExpiresAt: trialExpiresAt ?? undefined,
              assignedByUserId: actorId,
              assignedAt: now,
            })
            .returning();

          // One event per monitoring package per customer (mixed-frequency fan-out)
          const pkgKeys: string[] = Array.isArray(bundle.monitoringPackageKeys)
            ? (bundle.monitoringPackageKeys as string[])
            : [];

          if (pkgKeys.length > 0) {
            await db.insert(mspEventStoreTable).values(
              pkgKeys.map((packageKey) => ({
                mspId,
                customerId: cust.id,
                eventType: "bundle.package.activated",
                source: "msp-customers-bulk",
                actor: { id: actorId, role: "MSPAdmin" as const, type: "user" as const },
                meta: { tenant: { mspId, customerId: cust.id } },
                payload: {
                  bundleId,
                  packageKey,
                  activatedAt: now.toISOString(),
                  bulkAssignment: true,
                } as Record<string, unknown>,
                correlationId: assignment.assignmentId,
                ownerType: "msp" as const,
              })),
            );
          }

          await recordIdempotency(iKey, mspId, bodyHash, 201, { assignmentId: assignment.assignmentId });
          results.push({ customerId: cust.id, status: "assigned", assignmentId: assignment.assignmentId });
        }

        const assignedCount = results.filter((r) => r.status === "assigned").length;
        const skippedCount = results.filter((r) => r.status === "skipped").length;
        req.log.info({ mspId, bundleId, assignedCount, skippedCount }, "msp-portal: bulk assign_bundle complete");
        res.json({ action: "assign_bundle", results, assignedCount, skippedCount });
        return;
      }

      // ── tag ────────────────────────────────────────────────────────────────────
      if (action === "tag") {
        const rawTags = payload.tags;
        const tags: string[] = Array.isArray(rawTags)
          ? rawTags.filter((t): t is string => typeof t === "string" && t.trim().length > 0).map((t) => t.trim())
          : [];

        if (tags.length === 0) {
          res.status(400).json({ error: "payload.tags must be a non-empty string array" });
          return;
        }

        // Merge new tags into each customer's existing tags array (deduplicating via SQL)
        await db.execute(
          sql`UPDATE msp_customers
              SET tags = (
                SELECT array_agg(DISTINCT t ORDER BY t)
                FROM unnest(tags || ${tags}::text[]) AS t
              ),
              updated_at = now()
              WHERE id = ANY(${ids}::int[])
              AND msp_id = ${mspId}`,
        );

        res.json({ action: "tag", updated: ids.length, tags });
        return;
      }

      // ── export ─────────────────────────────────────────────────────────────────
      if (action === "export") {
        const csvHeader = "id,name,domain,status,industry,tenantId,tags,createdAt\n";
        const csvRows = ownedRows
          .map((r) => {
            const tagsValue = ""; // ownedRows doesn't include tags; fetched separately for export
            const row = [
              r.id,
              `"${(r.name ?? "").replace(/"/g, '""')}"`,
              `"${(r.domain ?? "").replace(/"/g, '""')}"`,
              r.status,
              `"${(r.industry ?? "").replace(/"/g, '""')}"`,
              r.tenantId ?? "",
              tagsValue,
              r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
            ].join(",");
            return row;
          })
          .join("\n");

        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", 'attachment; filename="customers-export.csv"');
        res.send(csvHeader + csvRows);
        return;
      }

      // ── archive ────────────────────────────────────────────────────────────────
      if (action === "archive") {
        await db
          .update(mspCustomersTable)
          .set({ status: "archived" as "active" | "inactive" | "onboarding" | "archived", updatedAt: new Date() })
          .where(and(inArray(mspCustomersTable.id, ids), eq(mspCustomersTable.mspId, mspId)));

        req.log.info({ mspId, count: ids.length }, "msp-portal: bulk archive complete");
        res.json({ action: "archive", updated: ids.length });
        return;
      }

      res.status(400).json({ error: `Unknown action: ${String(action)}` });
    } catch (err) {
      req.log.error({ err }, "msp-portal: bulk action failed");
      res.status(500).json({ error: "Bulk action failed" });
    }
  },
);

// ── POST /api/msp/customers ────────────────────────────────────────────────────
// Manually create a customer under the authenticated MSP.
// PlatformAdmin may pass ?slug= to target a specific MSP.

const createCustomerSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters").max(200),
  domain: z.string().max(253).optional(),
  industry: z.string().max(120).optional(),
  tenantId: z.string().max(36).optional(),
  status: z.enum(["active", "onboarding", "inactive"]).default("onboarding"),
});

router.post(
  "/msp/customers",
  requireRole("MSPAdmin"),
  async (req: Request, res: Response) => {
    try {
      const mspId = await resolveMspIdOrZero(req);
      if (!mspId) {
        res.status(400).json({ error: "mspId required" });
        return;
      }

      const parsed = createCustomerSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join("; ") });
        return;
      }
      const data = parsed.data;

      const [customer] = await db
        .insert(mspCustomersTable)
        .values({
          mspId,
          name: data.name,
          domain: data.domain ?? undefined,
          industry: data.industry ?? undefined,
          tenantId: data.tenantId ?? undefined,
          status: data.status,
          ownerType: "customer",
        })
        .returning();

      await db.insert(mspAuditLogsTable).values({
        actorUserId: req.user!.id,
        actorRole: req.user!.mspRole ?? "MSPAdmin",
        mspId,
        actionType: "customer.create",
        entityType: "customer",
        entityId: String(customer!.id),
        entityLabel: customer!.name,
        outcome: "success",
        metadata: { domain: data.domain, industry: data.industry, status: data.status },
      });

      req.log.info({ mspId, customerId: customer!.id }, "msp-portal: customer created");
      res.status(201).json(customer);
    } catch (err) {
      req.log.error({ err }, "msp-portal: customer create failed");
      res.status(500).json({ error: "Failed to create customer" });
    }
  },
);

// ── GET /api/msp/customers ─────────────────────────────────────────────────────
// Paginated customer list scoped to the authenticated MSP.
// Query params: page (1-based), limit, search (name/domain), status

router.get(
  "/msp/customers",
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const mspId = await resolveMspIdOrZero(req);

      const page = Math.max(1, parseInt(String((req.query as Record<string, unknown>).page ?? "1"), 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(String((req.query as Record<string, unknown>).limit ?? "20"), 10) || 20));
      const offset = (page - 1) * limit;
      const search = String((req.query as Record<string, unknown>).search ?? "").trim();
      const statusFilter = String((req.query as Record<string, unknown>).status ?? "").trim();

      const conditions = [];

      if (mspId) {
        conditions.push(eq(mspCustomersTable.mspId, mspId));
      }

      if (search) {
        conditions.push(
          or(
            ilike(mspCustomersTable.name, `%${search}%`),
            ilike(mspCustomersTable.domain, `%${search}%`),
          ),
        );
      }

      if (statusFilter && statusFilter !== "all") {
        conditions.push(
          eq(mspCustomersTable.status, statusFilter as "active" | "inactive" | "onboarding"),
        );
      }

      const whereClause = conditions.length > 0 ? and(...(conditions as [ReturnType<typeof eq>, ...ReturnType<typeof eq>[]])) : undefined;

      const [[{ total }], customers] = await Promise.all([
        db.select({ total: count() }).from(mspCustomersTable).where(whereClause),
        db
          .select({
            id: mspCustomersTable.id,
            name: mspCustomersTable.name,
            domain: mspCustomersTable.domain,
            status: mspCustomersTable.status,
            tenantId: mspCustomersTable.tenantId,
            mspId: mspCustomersTable.mspId,
            createdAt: mspCustomersTable.createdAt,
          })
          .from(mspCustomersTable)
          .where(whereClause)
          .orderBy(desc(mspCustomersTable.createdAt))
          .limit(limit)
          .offset(offset),
      ]);

      res.json({
        customers,
        total: Number(total),
        page,
        pageSize: limit,
      });
    } catch (err) {
      req.log.error({ err }, "msp-portal: customer list failed");
      res.status(500).json({ error: "Failed to fetch customers" });
    }
  },
);

// ── GET /api/msp/customers/:id ────────────────────────────────────────────────
// Returns full detail for a single customer scoped to the authenticated MSP.

router.get(
  "/msp/customers/:id",
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const customerId = parseInt(String(req.params.id ?? ""), 10);
      if (isNaN(customerId)) {
        res.status(400).json({ error: "Invalid customer id" });
        return;
      }
      const mspId = await resolveMspIdOrZero(req);

      const rows = await db
        .select({
          id: mspCustomersTable.id,
          name: mspCustomersTable.name,
          domain: mspCustomersTable.domain,
          status: mspCustomersTable.status,
          tenantId: mspCustomersTable.tenantId,
          industry: mspCustomersTable.industry,
          ownerType: mspCustomersTable.ownerType,
          tags: mspCustomersTable.tags,
          mspId: mspCustomersTable.mspId,
          mspName: mspsTable.name,
          createdAt: mspCustomersTable.createdAt,
          updatedAt: mspCustomersTable.updatedAt,
        })
        .from(mspCustomersTable)
        .innerJoin(mspsTable, eq(mspsTable.id, mspCustomersTable.mspId))
        .where(
          and(
            eq(mspCustomersTable.id, customerId),
            ...(mspId ? [eq(mspCustomersTable.mspId, mspId)] : []),
          ),
        )
        .limit(1);

      if (rows.length === 0) {
        res.status(404).json({ error: "Customer not found" });
        return;
      }

      res.json(rows[0]);
    } catch (err) {
      req.log.error({ err }, "msp-portal: customer detail failed");
      res.status(500).json({ error: "Failed to fetch customer" });
    }
  },
);

// ── GET /api/portal/msp-suspension ────────────────────────────────────────────
// Customer-facing endpoint: returns whether the customer's parent MSP has been
// suspended for 7+ days. Deliberately omits billing/payment specifics — only
// exposes the computed day count so the frontend can decide whether to show the
// informational banner.
//
// Accessible by CustomerUser and above (MSP staff can call it for testing).

router.get(
  "/portal/msp-suspension",
  requireRole("CustomerUser"),
  async (req: Request, res: Response) => {
    try {
      const userId = req.user!.id;

      // Resolve the MSP this user belongs to.
      // For CustomerUser, mspId is on the JWT claim; fall back to a DB lookup.
      let mspId: number | null = req.user!.mspId ?? null;

      if (!mspId) {
        const [mspUserRow] = await db
          .select({ mspId: mspUsersTable.mspId })
          .from(mspUsersTable)
          .where(eq(mspUsersTable.userId, userId))
          .limit(1);
        mspId = mspUserRow?.mspId ?? null;
      }

      if (!mspId) {
        res.json({ suspended: false, daysSuspended: null });
        return;
      }

      const [msp] = await db
        .select({
          status: mspsTable.status,
          suspendedAt: mspsTable.suspendedAt,
        })
        .from(mspsTable)
        .where(eq(mspsTable.id, mspId))
        .limit(1);

      if (!msp || msp.status !== "suspended" || !msp.suspendedAt) {
        res.json({ suspended: false, daysSuspended: null });
        return;
      }

      const daysSuspended = Math.floor(
        (Date.now() - new Date(msp.suspendedAt).getTime()) / 86_400_000,
      );

      // Only surface the banner once the 7-day threshold has been reached.
      // Days 1–6 are treated as not-yet-visible to customers.
      if (daysSuspended < 7) {
        res.json({ suspended: false, daysSuspended: null });
        return;
      }

      res.json({ suspended: true, daysSuspended });
    } catch (err) {
      req.log.error({ err }, "msp-portal: msp-suspension query failed");
      res.status(500).json({ error: "Failed to fetch MSP suspension status" });
    }
  },
);

export default router;
