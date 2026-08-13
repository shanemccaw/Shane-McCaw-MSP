import { Router, type IRouter, type Request, type Response } from "express";
import { db, tenantsTable, mspsTable, usersTable, impersonationTokensTable, mspAuditLogsTable, fulfillmentQueueTable, type FulfillmentDeliveryStatus, FULFILLMENT_DELIVERY_STATUSES, FULFILLMENT_SOURCE_TYPES } from "@workspace/db";
import { eq, and, count, desc, gte, lte, isNotNull, lt, ne, ilike, or, type SQL } from "drizzle-orm";
import { requireRole, requireMspScope } from "../middlewares/requireAuth.ts";
import { getRequestContext } from "../lib/request-context.ts";
import { logger } from "../lib/logger.ts";
const log = logger.child({ channel: "tenant.portal" });

const router: IRouter = Router();

router.post(
  "/msp/:mspId/customers/:customerId/impersonate",
  requireRole("MSPOperator"),
  requireMspScope("params"),
  async (req: Request, res: Response) => {
    const mspId = parseInt(String(req.params.mspId ?? ""), 10);
    const customerId = parseInt(String(req.params.customerId ?? ""), 10);
    if (isNaN(mspId) || isNaN(customerId)) {
      res.status(400).json({ error: "Invalid mspId or customerId" });
      return;
    }

    // Confirm the customer record belongs to this MSP (IDOR prevention)
    const [customer] = await db
      .select()
      .from(tenantsTable)
      .where(and(eq(tenantsTable.id, customerId), eq(tenantsTable.mspId, mspId)))
      .limit(1);
    if (!customer) {
      log.warn(
        { actorUserId: req.user!.id, mspId, customerId },
        "impersonate_customer: customer not found for MSP",
      );
      res.status(404).json({ error: "Customer not found" });
      return;
    }

    // Resolve the slug of the MSP that owns this customer. For a PlatformAdmin
    // impersonating cross-MSP, this is the *target* MSP's slug, not the actor's
    // — the new tab must land on the customer's own MSP-scoped URL.
    const [ownerMsp] = await db
      .select({ slug: mspsTable.slug })
      .from(mspsTable)
      .where(eq(mspsTable.id, mspId))
      .limit(1);
    if (!ownerMsp) {
      log.warn(
        { actorUserId: req.user!.id, mspId, customerId },
        "impersonate_customer: owning MSP not found",
      );
      res.status(404).json({ error: "MSP not found" });
      return;
    }

    // Find the portal user linked to this customer — impersonation genuinely
    // needs a single real login, so use the canonical deterministic resolver:
    // ACTIVE rows only (never land staff in a deactivated login) with the
    // shared role-ranked/earliest-created tiebreak, instead of the old
    // unordered no-filter LIMIT 1 that picked an arbitrary (possibly
    // deactivated) user.
    const { resolveCustomerPortalUserId: resolveImpersonationTarget } = await import("../lib/tenant-signals.ts");
    const impersonationUserId = await resolveImpersonationTarget(customerId);
    if (impersonationUserId == null) {
      log.warn(
        { actorUserId: req.user!.id, mspId, customerId, targetSlug: ownerMsp.slug },
        "impersonate_customer: no active portal user found for customer",
      );
      res.status(404).json({ error: "No active portal user found for this customer" });
      return;
    }

    const [targetUser] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, impersonationUserId))
      .limit(1);
    if (!targetUser) {
      log.warn(
        { actorUserId: req.user!.id, mspId, customerId, targetSlug: ownerMsp.slug },
        "impersonate_customer: target user not found",
      );
      res.status(404).json({ error: "Target user not found" });
      return;
    }

    const actorId = req.user!.id;
    const { randomBytes, randomUUID } = await import("crypto");
    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

    await db.insert(impersonationTokensTable).values({
      token,
      clientUserId: targetUser.id,
      adminUserId: actorId,
      expiresAt,
    });

    // MSP audit log — every impersonation session is recorded
    try {
      await db.insert(mspAuditLogsTable).values({
        actorUserId: actorId,
        actorRole: req.user!.mspRole ?? "MSPAdmin",
        mspId,
        customerId,
        actionType: "IMPERSONATION_TOKEN_ISSUED",
        entityType: "customer",
        entityId: String(customerId),
        entityLabel: customer.customerName,
        correlationId: getRequestContext()?.traceId ?? randomUUID(),
        ipAddress: req.ip ?? req.socket?.remoteAddress ?? null,
        userAgent: req.headers["user-agent"] ?? null,
        outcome: "success",
        metadata: { targetUserId: targetUser.id, targetEmail: targetUser.email },
      });
    } catch {
      // Audit log is non-fatal — never interrupt the impersonation flow
    }

    log.info(
      {
        actorUserId: actorId,
        mspId,
        customerId,
        targetSlug: ownerMsp.slug,
        targetUserId: targetUser.id,
      },
      "impersonate_customer: impersonation token issued",
    );

    res.json({
      token,
      targetSlug: ownerMsp.slug,
      customer: { id: customer.id, name: customer.customerName },
      targetUser: { id: targetUser.id, email: targetUser.email, name: targetUser.name },
    });
  },
);

router.get(
  "/msp/:mspId/fulfillment-queue",
  requireRole("MSPOperator"),
  requireMspScope("params"),
  async (req: Request, res: Response) => {
  try {
    const mspId = parseInt(String(req.params.mspId ?? ""), 10);
    if (isNaN(mspId)) { res.status(400).json({ error: "Invalid mspId" }); return; }

    const { status, sourceType, overdue, q, from, to } = req.query as Record<string, string | undefined>;
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? ""), 10) || 20));
    const offset = Math.max(0, parseInt(String(req.query.offset ?? ""), 10) || 0);

    // Every condition below is ANDed with this mspId scope — nothing in this
    // handler ever queries fulfillment_queue without it.
    const conditions: SQL[] = [eq(fulfillmentQueueTable.mspId, mspId)];

    if (status && (FULFILLMENT_DELIVERY_STATUSES as readonly string[]).includes(status)) {
      conditions.push(eq(fulfillmentQueueTable.deliveryStatus, status as FulfillmentDeliveryStatus));
    }
    if (sourceType && (FULFILLMENT_SOURCE_TYPES as readonly string[]).includes(sourceType)) {
      conditions.push(eq(fulfillmentQueueTable.sourceType, sourceType as typeof FULFILLMENT_SOURCE_TYPES[number]));
    }
    if (from) {
      const d = new Date(from);
      if (!isNaN(d.getTime())) conditions.push(gte(fulfillmentQueueTable.purchasedAt, d));
    }
    if (to) {
      const d = new Date(to);
      if (!isNaN(d.getTime())) {
        d.setHours(23, 59, 59, 999);
        conditions.push(lte(fulfillmentQueueTable.purchasedAt, d));
      }
    }
    const ql = q?.trim();
    if (ql) {
      conditions.push(
        or(
          ilike(fulfillmentQueueTable.clientName, `%${ql}%`),
          ilike(fulfillmentQueueTable.clientEmail, `%${ql}%`),
          ilike(fulfillmentQueueTable.customerName, `%${ql}%`),
          ilike(fulfillmentQueueTable.itemTitle, `%${ql}%`),
        ) as SQL,
      );
    }

    const now = new Date();
    // "Overdue" as a SQL predicate (not in-memory) so it composes correctly
    // with LIMIT/OFFSET pagination — an in-memory filter after paging would
    // make `total` and the returned page inconsistent.
    const overdueConditions: SQL[] = [
      isNotNull(fulfillmentQueueTable.slaDueAt),
      lt(fulfillmentQueueTable.slaDueAt, now),
      ne(fulfillmentQueueTable.deliveryStatus, "delivered"),
    ];
    const listConditions = overdue === "1" ? [...conditions, ...overdueConditions] : conditions;

    const [rows, [totalRow], [overdueRow]] = await Promise.all([
      db.select({
        id: fulfillmentQueueTable.id,
        sourceType: fulfillmentQueueTable.sourceType,
        sourceId: fulfillmentQueueTable.sourceId,
        customerId: fulfillmentQueueTable.customerId,
        clientName: fulfillmentQueueTable.clientName,
        clientEmail: fulfillmentQueueTable.clientEmail,
        itemTitle: fulfillmentQueueTable.itemTitle,
        itemDescription: fulfillmentQueueTable.itemDescription,
        purchasedAt: fulfillmentQueueTable.purchasedAt,
        purchaseAmountCents: fulfillmentQueueTable.purchaseAmountCents,
        wholesaleChargedCents: fulfillmentQueueTable.wholesaleChargedCents,
        customerQuoteCents: fulfillmentQueueTable.customerQuoteCents,
        deliveryStatus: fulfillmentQueueTable.deliveryStatus,
        statusNote: fulfillmentQueueTable.statusNote,
        slaDueAt: fulfillmentQueueTable.slaDueAt,
        slaThresholdDays: fulfillmentQueueTable.slaThresholdDays,
        createdAt: fulfillmentQueueTable.createdAt,
      })
        .from(fulfillmentQueueTable)
        .where(and(...listConditions))
        .orderBy(desc(fulfillmentQueueTable.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ n: count() }).from(fulfillmentQueueTable).where(and(...listConditions)),
      db.select({ n: count() }).from(fulfillmentQueueTable).where(and(...conditions, ...overdueConditions)),
    ]);

    const enriched = rows.map(r => ({
      ...r,
      isOverdue: r.slaDueAt != null && new Date(r.slaDueAt) < now && r.deliveryStatus !== "delivered",
    }));

    res.json({
      items: enriched,
      total: totalRow?.n ?? 0,
      overdueCount: overdueRow?.n ?? 0,
      limit,
      offset,
    });
  } catch (err) {
    req.log.error({ err }, "msp: fulfillment-queue list failed");
    res.status(500).json({ error: "Failed to load fulfillment queue" });
  }
});

export default router;
