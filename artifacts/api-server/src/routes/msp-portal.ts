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
import { db, mspsTable, mspCustomersTable, mspEventStoreTable, mspAuditLogsTable, salesOffersTable, mspSalesBundlesTable } from "@workspace/db";
import { eq, and, count, sql, gte, like, sum, or, desc, ilike } from "drizzle-orm";
import { requireAuth, requireRole } from "../middlewares/requireAuth.ts";
import { getAiBalance } from "../lib/ai-billing.ts";
import { logger } from "../lib/logger.ts";
import { resolveMspIdOrZero } from "../lib/resolve-msp-id.ts";

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
      logger.error({ err }, "msp-portal: dashboard query failed");
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

      logger.info({ mspId, actorId: req.user!.id }, "msp-portal: cancellation requested");
      res.json({ ok: true, offboardingState: "cancellation_requested", requestedAt: now.toISOString() });
    } catch (err) {
      logger.error({ err }, "msp-portal: offboarding request failed");
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

      logger.info({ mspId, customerCount: customers.length }, "msp-portal: export generated");
      res.json({ ok: true, offboardingState: "export_ready", export: exportPackage });
    } catch (err) {
      logger.error({ err }, "msp-portal: export failed");
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

      logger.info({ mspId: targetMspId, actorId: req.user!.id }, "msp-portal: MSP archived");
      res.json({ ok: true, offboardingState: "archival_flagged", archivedAt: now.toISOString() });
    } catch (err) {
      logger.error({ err }, "msp-portal: archive failed");
      res.status(500).json({ error: "Archive operation failed" });
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
      const mspId = resolveMspId(req);

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
      logger.error({ err }, "msp-portal: customer list failed");
      res.status(500).json({ error: "Failed to fetch customers" });
    }
  },
);

export default router;
