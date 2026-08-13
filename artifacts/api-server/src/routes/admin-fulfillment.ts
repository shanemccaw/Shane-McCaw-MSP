import { Router, type IRouter, type Request, type Response } from "express";
import { db, invoicesTable, usersTable, quickWinPresentationsTable, clientServicesTable, servicesTable, fulfillmentQueueTable, fulfillmentSlaConfigTable, type FulfillmentDeliveryStatus, FULFILLMENT_DELIVERY_STATUSES, FULFILLMENT_SOURCE_TYPES } from "@workspace/db";
import { resolveCatalogPricing } from "../lib/catalog-pricing.ts";
import { eq, and, ne, desc, asc, count, inArray, isNotNull, or, lt, ilike, type SQL } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth.ts";
import { createAuditLog } from "../lib/audit.ts";
import { logger } from "../lib/logger.ts";
const log = logger.child({ channel: "admin.fulfillment" });

const router: IRouter = Router();

function deriveSlaDate(purchasedAt: Date | null, thresholdDays: number): Date | null {
  if (!purchasedAt) return null;
  const d = new Date(purchasedAt.getTime());
  d.setDate(d.getDate() + thresholdDays);
  return d;
}

async function getSlaThresholds(): Promise<Record<string, number>> {
  try {
    const rows = await db.select().from(fulfillmentSlaConfigTable);
    const map: Record<string, number> = { default: 7, offer: 7, sow: 7, bundle: 7 };
    for (const r of rows) {
      map[r.key] = r.thresholdDays;
    }
    return map;
  } catch {
    return { default: 7, offer: 7, sow: 7, bundle: 7 };
  }
}

router.get("/admin/fulfillment-queue", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { status, sourceType, overdue, q } = req.query as Record<string, string | undefined>;
    const page = Math.max(1, parseInt(String(req.query.page ?? ""), 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query.pageSize ?? ""), 10) || 25));

    // Filtered at the SQL level (status/sourceType/overdue/q) so total/byStatus
    // reflect the post-filter set and LIMIT/OFFSET pages correctly — mirrors
    // the same-table /msp/:mspId/fulfillment-queue route below.
    const conditions: SQL[] = [];
    if (status && (FULFILLMENT_DELIVERY_STATUSES as readonly string[]).includes(status)) {
      conditions.push(eq(fulfillmentQueueTable.deliveryStatus, status as FulfillmentDeliveryStatus));
    }
    if (sourceType && (FULFILLMENT_SOURCE_TYPES as readonly string[]).includes(sourceType)) {
      conditions.push(eq(fulfillmentQueueTable.sourceType, sourceType as typeof FULFILLMENT_SOURCE_TYPES[number]));
    }
    const ql = q?.trim();
    if (ql) {
      conditions.push(
        or(
          ilike(fulfillmentQueueTable.clientName, `%${ql}%`),
          ilike(fulfillmentQueueTable.clientEmail, `%${ql}%`),
          ilike(fulfillmentQueueTable.customerName, `%${ql}%`),
          ilike(fulfillmentQueueTable.mspName, `%${ql}%`),
          ilike(fulfillmentQueueTable.itemTitle, `%${ql}%`),
        ) as SQL,
      );
    }

    const now = new Date();
    const overdueConditions: SQL[] = [
      isNotNull(fulfillmentQueueTable.slaDueAt),
      lt(fulfillmentQueueTable.slaDueAt, now),
      ne(fulfillmentQueueTable.deliveryStatus, "delivered"),
    ];
    const listConditions = overdue === "1" ? [...conditions, ...overdueConditions] : conditions;
    const whereClause = listConditions.length > 0 ? and(...listConditions) : undefined;

    const [rows, [totalRow], [overdueRow], byStatusRows] = await Promise.all([
      db.select()
        .from(fulfillmentQueueTable)
        .where(whereClause)
        .orderBy(desc(fulfillmentQueueTable.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      db.select({ n: count() }).from(fulfillmentQueueTable).where(whereClause),
      db.select({ n: count() }).from(fulfillmentQueueTable)
        .where(and(...conditions, ...overdueConditions)),
      db.select({ status: fulfillmentQueueTable.deliveryStatus, n: count() })
        .from(fulfillmentQueueTable)
        .where(whereClause)
        .groupBy(fulfillmentQueueTable.deliveryStatus),
    ]);

    const byStatus = { not_started: 0, in_progress: 0, delivered: 0, blocked: 0 } as Record<FulfillmentDeliveryStatus, number>;
    for (const r of byStatusRows) {
      byStatus[r.status as FulfillmentDeliveryStatus] = r.n;
    }

    const enriched = rows.map(r => ({
      ...r,
      isOverdue: r.slaDueAt != null && new Date(r.slaDueAt) < now && r.deliveryStatus !== "delivered",
    }));

    res.json({
      items: enriched,
      meta: {
        total: totalRow?.n ?? 0,
        overdue: overdueRow?.n ?? 0,
        byStatus,
        page,
        pageSize,
      },
    });
  } catch (err) {
    req.log.error({ err }, "admin: fulfillment-queue list failed");
    res.status(500).json({ error: "Failed to load fulfillment queue" });
  }
});

router.patch("/admin/fulfillment-queue/:id/status", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.id ?? ""), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

    const { deliveryStatus, statusNote } = req.body as { deliveryStatus?: string; statusNote?: string | null };
    if (!deliveryStatus || !(FULFILLMENT_DELIVERY_STATUSES as readonly string[]).includes(deliveryStatus)) {
      res.status(400).json({ error: `deliveryStatus must be one of: ${FULFILLMENT_DELIVERY_STATUSES.join(", ")}` });
      return;
    }

    const [existing] = await db.select().from(fulfillmentQueueTable)
      .where(eq(fulfillmentQueueTable.id, id)).limit(1);
    if (!existing) { res.status(404).json({ error: "Queue item not found" }); return; }

    const previousStatus = existing.deliveryStatus;
    const now = new Date();

    await db.update(fulfillmentQueueTable)
      .set({
        deliveryStatus: deliveryStatus as FulfillmentDeliveryStatus,
        statusNote: statusNote ?? null,
        statusUpdatedAt: now,
        statusUpdatedByUserId: req.user?.id ?? null,
        updatedAt: now,
      })
      .where(eq(fulfillmentQueueTable.id, id));

    await createAuditLog({
      actorUserId: req.user?.id ?? null,
      actorName: req.user?.email ?? "admin",
      actorRole: "admin",
      actionType: "fulfillment_status_update",
      entityType: "fulfillment_queue",
      entityId: id,
      entityLabel: existing.itemTitle,
      metadata: {
        previousStatus,
        newStatus: deliveryStatus,
        statusNote: statusNote ?? null,
        clientEmail: existing.clientEmail,
        sourceType: existing.sourceType,
        sourceId: existing.sourceId,
      },
    });

    req.log.info({ id, previousStatus, newStatus: deliveryStatus }, "admin: fulfillment status updated");
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "admin: fulfillment status update failed");
    res.status(500).json({ error: "Failed to update fulfillment status" });
  }
});

router.post("/admin/fulfillment-queue/sync", requireAdmin, async (req: Request, res: Response) => {
  try {
    const thresholds = await getSlaThresholds();
    let added = 0;
    let errors = 0;
    const errorSamples: Array<{ sourceType: string; sourceId: string; error: string }> = [];

    // A genuine duplicate (unique-violation, Postgres 23505) is the ONLY error
    // we skip silently — that is the expected, benign outcome of a re-run. Any
    // other error (schema drift, constraint failure, etc.) is a real problem and
    // must be surfaced, not swallowed: previously every insert error was treated
    // as "duplicate skip", which masked the wholesale_charged_cents/customer_quote_cents
    // schema drift entirely and made a fully-broken sync report { added: 0 }.
    const isUniqueViolation = (e: unknown): boolean => {
      const err = e as { code?: string; cause?: { code?: string } } | null;
      return err?.code === "23505" || err?.cause?.code === "23505";
    };
    const recordSyncError = (sourceType: string, sourceId: string, err: unknown): void => {
      errors++;
      if (errorSamples.length < 10) {
        errorSamples.push({ sourceType, sourceId, error: err instanceof Error ? err.message : String(err) });
      }
      log.error({ err, sourceType, sourceId }, "admin: fulfillment-queue sync insert failed");
    };

    // Resolve mspId/customerId for a batch of client user ids straight off the
    // users rows (msp_users was absorbed into users — #92; customerId here is
    // users.tenant_id, the tenants.id every customer-scoped read keys on).
    // Returns a map keyed by userId; an unscoped user resolves to nulls, and
    // the caller logs a warning + inserts mspId NULL rather than failing (so
    // orphaned rows are visible, not silent).
    const resolveMspLinks = async (
      userIds: number[],
    ): Promise<Map<number, { mspId: number | null; customerId: number | null }>> => {
      if (userIds.length === 0) return new Map();
      const rows = await db
        .select({ userId: usersTable.id, mspId: usersTable.mspId, customerId: usersTable.tenantId })
        .from(usersTable)
        .where(inArray(usersTable.id, userIds));
      return new Map(rows.map(r => [r.userId, { mspId: r.mspId, customerId: r.customerId }]));
    };

    // ── 1. OFFER path — paid invoices ────────────────────────────────────────
    const paidInvoices = await db
      .select({
        id: invoicesTable.id,
        invoiceNumber: invoicesTable.invoiceNumber,
        description: invoicesTable.description,
        amount: invoicesTable.amount,
        paidAt: invoicesTable.paidAt,
        clientUserId: invoicesTable.clientUserId,
        projectId: invoicesTable.projectId,
      })
      .from(invoicesTable)
      .where(and(eq(invoicesTable.status, "paid"), isNotNull(invoicesTable.paidAt)));

    // Bulk-fetch client info
    const offerClientIds = [...new Set(paidInvoices.map(i => i.clientUserId).filter((id): id is number => id != null))];
    const offerClients = offerClientIds.length > 0
      ? await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email })
          .from(usersTable).where(inArray(usersTable.id, offerClientIds))
      : [];
    const offerClientMap = new Map(offerClients.map(c => [c.id, c]));
    const offerMspLinks = await resolveMspLinks(offerClientIds);

    for (const inv of paidInvoices) {
      const client = inv.clientUserId ? offerClientMap.get(inv.clientUserId) : null;
      const mspLink = inv.clientUserId != null ? offerMspLinks.get(inv.clientUserId) : undefined;
      if (inv.clientUserId != null && !mspLink) {
        log.warn({ clientUserId: inv.clientUserId, sourceType: "offer", sourceId: String(inv.id) },
          "admin: fulfillment-queue sync — no msp_users row for clientUserId; inserting with mspId NULL");
      }
      const purchasedAt = inv.paidAt ? new Date(inv.paidAt) : null;
      const threshold = thresholds["offer"] ?? thresholds["default"] ?? 7;
      const slaDueAt = deriveSlaDate(purchasedAt, threshold);
      const amountCents = inv.amount ? Math.round(parseFloat(String(inv.amount)) * 100) : null;
      const pricing = resolveCatalogPricing({ priceCents: amountCents ?? 0 });
      const wholesaleChargedCents = amountCents !== null ? pricing.wholesaleCostCents : null;
      const customerQuoteCents = amountCents !== null ? pricing.retailPriceCents : null;

      try {
        await db.insert(fulfillmentQueueTable).values({
          sourceType: "offer",
          sourceId: String(inv.id),
          clientUserId: inv.clientUserId ?? null,
          mspId: mspLink?.mspId ?? null,
          customerId: mspLink?.customerId ?? null,
          clientName: client?.name ?? null,
          clientEmail: client?.email ?? null,
          itemTitle: inv.description ?? inv.invoiceNumber ?? `Invoice #${inv.id}`,
          purchasedAt,
          purchaseAmountCents: amountCents,
          wholesaleChargedCents,
          customerQuoteCents,
          projectId: inv.projectId ?? null,
          invoiceId: inv.id,
          slaDueAt,
          slaThresholdDays: threshold,
        }).onConflictDoNothing();
        added++;
      } catch (err) {
        if (!isUniqueViolation(err)) recordSyncError("offer", String(inv.id), err);
      }
    }

    // ── 2. SOW path — signed + paid presentations ────────────────────────────
    const signedPresentations = await db
      .select({
        id: quickWinPresentationsTable.id,
        clientUserId: quickWinPresentationsTable.clientUserId,
        projectId: quickWinPresentationsTable.projectId,
        scopedTotalPrice: quickWinPresentationsTable.scopedTotalPrice,
        signedAt: quickWinPresentationsTable.signedAt,
        signerName: quickWinPresentationsTable.signerName,
        status: quickWinPresentationsTable.status,
      })
      .from(quickWinPresentationsTable)
      .where(inArray(quickWinPresentationsTable.status, ["signed", "paid"]));

    const sowClientIds = [...new Set(signedPresentations.map(p => p.clientUserId).filter((id): id is number => id != null))];
    const sowClients = sowClientIds.length > 0
      ? await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email })
          .from(usersTable).where(inArray(usersTable.id, sowClientIds))
      : [];
    const sowClientMap = new Map(sowClients.map(c => [c.id, c]));
    const sowMspLinks = await resolveMspLinks(sowClientIds);

    for (const pres of signedPresentations) {
      const client = pres.clientUserId ? sowClientMap.get(pres.clientUserId) : null;
      const mspLink = pres.clientUserId != null ? sowMspLinks.get(pres.clientUserId) : undefined;
      if (pres.clientUserId != null && !mspLink) {
        log.warn({ clientUserId: pres.clientUserId, sourceType: "sow", sourceId: String(pres.id) },
          "admin: fulfillment-queue sync — no msp_users row for clientUserId; inserting with mspId NULL");
      }
      const purchasedAt = pres.signedAt ? new Date(pres.signedAt) : null;
      const threshold = thresholds["sow"] ?? thresholds["default"] ?? 14;
      const slaDueAt = deriveSlaDate(purchasedAt, threshold);
      const clientLabel = pres.signerName ?? client?.name ?? client?.email ?? `Client #${pres.clientUserId}`;
      const pricing = resolveCatalogPricing({ priceCents: pres.scopedTotalPrice ?? 0 });
      const wholesaleChargedCents = pres.scopedTotalPrice !== null ? pricing.wholesaleCostCents : null;
      const customerQuoteCents = pres.scopedTotalPrice !== null ? pricing.retailPriceCents : null;

      try {
        await db.insert(fulfillmentQueueTable).values({
          sourceType: "sow",
          sourceId: String(pres.id),
          clientUserId: pres.clientUserId ?? null,
          mspId: mspLink?.mspId ?? null,
          customerId: mspLink?.customerId ?? null,
          clientName: client?.name ?? pres.signerName ?? null,
          clientEmail: client?.email ?? null,
          itemTitle: `SOW — ${clientLabel}`,
          purchasedAt,
          purchaseAmountCents: pres.scopedTotalPrice ?? null,
          wholesaleChargedCents,
          customerQuoteCents,
          projectId: pres.projectId ?? null,
          presentationId: pres.id,
          slaDueAt,
          slaThresholdDays: threshold,
        }).onConflictDoNothing();
        added++;
      } catch (err) {
        if (!isUniqueViolation(err)) recordSyncError("sow", String(pres.id), err);
      }
    }

    // ── 3. BUNDLE path — active client services ───────────────────────────────
    const activeServices = await db
      .select({
        id: clientServicesTable.id,
        clientUserId: clientServicesTable.clientUserId,
        serviceId: clientServicesTable.serviceId,
        projectId: clientServicesTable.projectId,
        status: clientServicesTable.status,
        purchasedAt: clientServicesTable.purchasedAt,
      })
      .from(clientServicesTable)
      .where(eq(clientServicesTable.status, "active"));

    const bundleClientIds = [...new Set(activeServices.map(s => s.clientUserId).filter((id): id is number => id != null))];
    const bundleServiceIds = [...new Set(activeServices.map(s => s.serviceId).filter((id): id is number => id != null))];

    const [bundleClients, bundleServices] = await Promise.all([
      bundleClientIds.length > 0
        ? db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email })
            .from(usersTable).where(inArray(usersTable.id, bundleClientIds))
        : Promise.resolve([]),
      bundleServiceIds.length > 0
        ? db.select({
            id: servicesTable.id,
            name: servicesTable.name,
            description: servicesTable.description,
            priceCents: servicesTable.priceCents,
            internalCostCents: servicesTable.internalCostCents,
          })
            .from(servicesTable).where(inArray(servicesTable.id, bundleServiceIds))
        : Promise.resolve([]),
    ]);

    const bundleClientMap = new Map(bundleClients.map(c => [c.id, c]));
    const bundleServiceMap = new Map(bundleServices.map(s => [s.id, s]));
    const bundleMspLinks = await resolveMspLinks(bundleClientIds);

    for (const svc of activeServices) {
      const client = svc.clientUserId ? bundleClientMap.get(svc.clientUserId) : null;
      const service = svc.serviceId ? bundleServiceMap.get(svc.serviceId) : null;
      const mspLink = svc.clientUserId != null ? bundleMspLinks.get(svc.clientUserId) : undefined;
      if (svc.clientUserId != null && !mspLink) {
        log.warn({ clientUserId: svc.clientUserId, sourceType: "bundle", sourceId: String(svc.id) },
          "admin: fulfillment-queue sync — no msp_users row for clientUserId; inserting with mspId NULL");
      }
      const purchasedAt = svc.purchasedAt ? new Date(String(svc.purchasedAt)) : null;
      const threshold = thresholds["bundle"] ?? thresholds["default"] ?? 10;
      const slaDueAt = deriveSlaDate(purchasedAt, threshold);
      const pricing = resolveCatalogPricing({
        priceCents: service?.priceCents ?? 0,
        internalCostCents: service?.internalCostCents,
      });
      const wholesaleChargedCents = service?.priceCents !== undefined && service?.priceCents !== null ? pricing.wholesaleCostCents : null;
      const customerQuoteCents = service?.priceCents !== undefined && service?.priceCents !== null ? pricing.retailPriceCents : null;

      try {
        await db.insert(fulfillmentQueueTable).values({
          sourceType: "bundle",
          sourceId: String(svc.id),
          clientUserId: svc.clientUserId ?? null,
          mspId: mspLink?.mspId ?? null,
          customerId: mspLink?.customerId ?? null,
          clientName: client?.name ?? null,
          clientEmail: client?.email ?? null,
          itemTitle: service?.name ?? `Service #${svc.serviceId}`,
          itemDescription: service?.description ?? null,
          purchasedAt,
          wholesaleChargedCents,
          customerQuoteCents,
          projectId: svc.projectId ?? null,
          slaDueAt,
          slaThresholdDays: threshold,
        }).onConflictDoNothing();
        added++;
      } catch (err) {
        if (!isUniqueViolation(err)) recordSyncError("bundle", String(svc.id), err);
      }
    }

    req.log.info({ added, errors }, "admin: fulfillment-queue sync completed");
    res.json({ ok: true, added, errors, errorSamples });
  } catch (err) {
    req.log.error({ err }, "admin: fulfillment-queue sync failed");
    res.status(500).json({ error: "Sync failed" });
  }
});

router.get("/admin/fulfillment-sla-config", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const rows = await db.select().from(fulfillmentSlaConfigTable).orderBy(asc(fulfillmentSlaConfigTable.key));
    res.json(rows.map(r => ({
      id: r.id,
      key: r.key,
      label: r.label,
      thresholdDays: r.thresholdDays,
      updatedAt: r.updatedAt,
    })));
  } catch (err) {
    res.status(500).json({ error: "Failed to load SLA config" });
  }
});

router.patch("/admin/fulfillment-sla-config/:key", requireAdmin, async (req: Request, res: Response) => {
  try {
    const key = String(req.params.key ?? "");
    const { thresholdDays } = req.body as { thresholdDays?: unknown };
    const days = typeof thresholdDays === "number" ? thresholdDays : parseInt(String(thresholdDays ?? ""), 10);
    if (isNaN(days) || days < 1 || days > 365) {
      res.status(400).json({ error: "thresholdDays must be 1–365" }); return;
    }

    const [row] = await db.select({ id: fulfillmentSlaConfigTable.id })
      .from(fulfillmentSlaConfigTable)
      .where(eq(fulfillmentSlaConfigTable.key, key))
      .limit(1);
    if (!row) { res.status(404).json({ error: "SLA config key not found" }); return; }

    await db.update(fulfillmentSlaConfigTable)
      .set({ thresholdDays: days, updatedAt: new Date(), updatedByUserId: req.user?.id ?? null })
      .where(eq(fulfillmentSlaConfigTable.key, key));

    await createAuditLog({
      actorUserId: req.user?.id ?? null,
      actorName: req.user?.email ?? "admin",
      actorRole: "admin",
      actionType: "fulfillment_sla_config_update",
      entityType: "fulfillment_sla_config",
      entityId: key,
      entityLabel: `SLA config: ${key}`,
      metadata: { thresholdDays: days },
    });

    req.log.info({ key, thresholdDays: days }, "admin: fulfillment SLA config updated");
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "admin: fulfillment SLA config update failed");
    res.status(500).json({ error: "Failed to update SLA config" });
  }
});

export default router;
