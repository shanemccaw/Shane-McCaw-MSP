/**
 * msp-seat-pricing.ts (Git #4111)
 *
 * Automatic, seat-based customer pricing. Shane's decision (2026-09-14): the
 * customer's price is NOT manually picked by the operator — it is the real,
 * live count of active licensed users in the customer's M365 tenant, minus any
 * manual "service account" seats the operator excludes with a reason.
 *
 * Reuses, does not fork:
 *   - The live count: `resolveActiveLicensedUserCount` (license-waste-source.ts)
 *     — distinct users holding a paid, non-free SKU, sourced from the tenant's
 *     stored `/subscribedSkus` catalog + `license_assignment_snapshots` per-user
 *     rows. Never guesses; returns null when it cannot be honestly computed.
 *   - The exclusion override: `client_billing_overrides` (#4111 migration) —
 *     one row per tenant, a current-state correction, not a ledger.
 *   - The per-seat rate: a service's `typeAttributes.pricePerUserMonth`, the
 *     same field portal-marketplace.ts's `toMarketplaceService` already reads
 *     for the customer-facing per-seat "perSeat" flag.
 *   - What actually prices the customer: `tenant_subscriptions.unitAmountCents`
 *     (tenant-billing-state.ts, #2847) — the one real "what does this customer
 *     pay" fact. "Apply" below writes to it via `recordTenantSubscription`,
 *     never a second, parallel pricing concept.
 *
 * Routes:
 *   GET  /api/msp/customers/:customerId/seat-pricing
 *   PUT  /api/msp/customers/:customerId/seat-pricing/override
 *   POST /api/msp/customers/:customerId/seat-pricing/apply
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  servicesTable,
  tenantsTable,
  tenantSubscriptionsTable,
  clientBillingOverridesTable,
  mspAuditLogsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { randomUUID } from "crypto";
import { requireCapability, assertCustomerAccess } from "../middlewares/requireAuth.ts";
import { resolveActiveLicensedUserCount } from "../lib/license-waste-source.ts";
import { resolveTenantBillingState, recordTenantSubscription } from "../lib/tenant-billing-state.ts";
import { getRequestContext } from "../lib/request-context.ts";
import { logger } from "../lib/logger.ts";

const log = logger.child({ channel: "billing" });
const router: IRouter = Router();

function apiErr(res: Response, status: number, message: string): void {
  res.status(status).json({ error: message });
}

/** Resolve the target customer + its owning mspId + M365 tenant GUID, gated by staff scoping. */
async function resolveScopedCustomer(
  req: Request,
  res: Response,
  customerId: number,
): Promise<{ id: number; mspId: number; tenantGuid: string | null } | null> {
  const [customer] = await db
    .select({ id: tenantsTable.id, mspId: tenantsTable.mspId, tenantGuid: tenantsTable.tenantId })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, customerId))
    .limit(1);

  if (!customer) {
    apiErr(res, 404, "Customer not found");
    return null;
  }
  if (!(await assertCustomerAccess(req.user!, customerId))) {
    apiErr(res, 404, "Customer not found");
    return null;
  }
  return customer;
}

async function writeAudit(req: Request, params: {
  actionType: string;
  entityId: string;
  customerId: number;
  metadata?: Record<string, unknown>;
}) {
  const user = req.user!;
  await db.insert(mspAuditLogsTable).values({
    actorUserId: user.id,
    actorRole: user.mspRole ?? user.role,
    customerId: params.customerId,
    actionType: params.actionType,
    entityType: "client_billing_override",
    entityId: params.entityId,
    correlationId: getRequestContext()?.traceId ?? randomUUID(),
    ipAddress: req.ip,
    userAgent: req.get("user-agent"),
    outcome: "success",
    metadata: params.metadata,
  });
}

/**
 * A service's real per-seat monthly rate, in cents — the same
 * `typeAttributes.pricePerUserMonth` field portal-marketplace.ts's
 * `toMarketplaceService` reads, restricted to services that carry NO flat
 * price (mirroring that function's own `perSeat` condition exactly, so a
 * service is never treated as per-seat here while checkout treats it as flat
 * elsewhere).
 */
function perSeatMonthlyRateCentsOf(service: {
  priceCents: number | null;
  price: string | null;
  basePrice: string | null;
  typeAttributes: Record<string, unknown> | null;
}): number | null {
  const legacyDollars = service.price ?? service.basePrice;
  const legacyCents =
    legacyDollars != null && legacyDollars !== "" && Number.isFinite(Number(legacyDollars))
      ? Math.round(Number(legacyDollars) * 100)
      : null;
  const flatPriceCents = service.priceCents ?? legacyCents;
  if (flatPriceCents !== null) return null; // a flat-priced service is never per-seat here

  const ta = (service.typeAttributes ?? {}) as { pricePerUserMonth?: string | number | null };
  if (ta.pricePerUserMonth == null || ta.pricePerUserMonth === "") return null;
  const perUser = Number(ta.pricePerUserMonth);
  return Number.isFinite(perUser) ? Math.round(perUser * 100) : null;
}

interface SeatPricingSnapshot {
  tenantGuid: string | null;
  rawActiveLicensedUserCount: number | null;
  licenseSource: { checkKey: string; collectedAt: string | null; paidSkuPartNumbers: string[] } | null;
  excludedServiceAccountSeats: number;
  overrideReason: string | null;
  billableSeatCount: number | null;
  activeSubscription: {
    id: number;
    serviceId: number | null;
    planName: string | null;
    unitAmountCents: number | null;
    billingParty: string;
  } | null;
  perSeatRate: { serviceId: number; serviceName: string; monthlyRateCents: number } | null;
  computedMonthlyPriceCents: number | null;
}

async function buildSnapshot(customerId: number, tenantGuid: string | null): Promise<SeatPricingSnapshot> {
  const raw = tenantGuid ? await resolveActiveLicensedUserCount(tenantGuid) : null;

  const [override] = await db
    .select({
      excludedServiceAccountSeats: clientBillingOverridesTable.excludedServiceAccountSeats,
      reason: clientBillingOverridesTable.reason,
    })
    .from(clientBillingOverridesTable)
    .where(eq(clientBillingOverridesTable.tenantId, customerId))
    .limit(1);
  const excludedServiceAccountSeats = override?.excludedServiceAccountSeats ?? 0;

  const billingState = await resolveTenantBillingState(customerId);
  const activeSubscription = billingState?.activeSubscription ?? null;

  let perSeatRate: SeatPricingSnapshot["perSeatRate"] = null;
  if (activeSubscription?.serviceId != null) {
    const [service] = await db
      .select({
        id: servicesTable.id,
        name: servicesTable.name,
        priceCents: servicesTable.priceCents,
        price: servicesTable.price,
        basePrice: servicesTable.basePrice,
        typeAttributes: servicesTable.typeAttributes,
      })
      .from(servicesTable)
      .where(eq(servicesTable.id, activeSubscription.serviceId))
      .limit(1);
    if (service) {
      const rate = perSeatMonthlyRateCentsOf(service);
      if (rate != null) perSeatRate = { serviceId: service.id, serviceName: service.name, monthlyRateCents: rate };
    }
  }

  const billableSeatCount = raw ? Math.max(0, raw.count - excludedServiceAccountSeats) : null;
  const computedMonthlyPriceCents =
    billableSeatCount != null && perSeatRate ? billableSeatCount * perSeatRate.monthlyRateCents : null;

  return {
    tenantGuid,
    rawActiveLicensedUserCount: raw?.count ?? null,
    licenseSource: raw
      ? {
          checkKey: raw.checkKey,
          collectedAt: raw.collectedAt ? raw.collectedAt.toISOString() : null,
          paidSkuPartNumbers: raw.paidSkuPartNumbers,
        }
      : null,
    excludedServiceAccountSeats,
    overrideReason: override?.reason ?? null,
    billableSeatCount,
    activeSubscription: activeSubscription
      ? {
          id: activeSubscription.id,
          serviceId: activeSubscription.serviceId,
          planName: activeSubscription.planName,
          unitAmountCents: activeSubscription.unitAmountCents,
          billingParty: activeSubscription.billingParty,
        }
      : null,
    perSeatRate,
    computedMonthlyPriceCents,
  };
}

// ── GET /api/msp/customers/:customerId/seat-pricing ───────────────────────────

router.get(
  "/msp/customers/:customerId/seat-pricing",
  requireCapability("ladder.msp-operator"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const customerId = parseInt(req.params["customerId"] as string, 10);
      if (isNaN(customerId)) { apiErr(res, 400, "Invalid customerId"); return; }

      const customer = await resolveScopedCustomer(req, res, customerId);
      if (!customer) return;

      const snapshot = await buildSnapshot(customer.id, customer.tenantGuid);
      res.json({ customerId: customer.id, ...snapshot });
    } catch (err) {
      log.error({ err }, "msp-seat-pricing: GET seat-pricing failed");
      apiErr(res, 500, "Failed to resolve seat pricing");
    }
  },
);

// ── PUT /api/msp/customers/:customerId/seat-pricing/override ─────────────────

const setOverrideSchema = z.object({
  excludedServiceAccountSeats: z.number().int().min(0).max(100000),
  reason: z.string().trim().max(500).optional(),
});

router.put(
  "/msp/customers/:customerId/seat-pricing/override",
  requireCapability("ladder.msp-admin"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const customerId = parseInt(req.params["customerId"] as string, 10);
      if (isNaN(customerId)) { apiErr(res, 400, "Invalid customerId"); return; }

      const customer = await resolveScopedCustomer(req, res, customerId);
      if (!customer) return;

      const parsed = setOverrideSchema.safeParse(req.body);
      if (!parsed.success) { apiErr(res, 400, parsed.error.issues[0]?.message ?? "Invalid body"); return; }
      const { excludedServiceAccountSeats, reason } = parsed.data;
      if (excludedServiceAccountSeats > 0 && !reason) {
        apiErr(res, 400, "reason is required when excludedServiceAccountSeats is above zero");
        return;
      }

      const [before] = await db
        .select({
          excludedServiceAccountSeats: clientBillingOverridesTable.excludedServiceAccountSeats,
          reason: clientBillingOverridesTable.reason,
        })
        .from(clientBillingOverridesTable)
        .where(eq(clientBillingOverridesTable.tenantId, customerId))
        .limit(1);

      const now = new Date();
      await db
        .insert(clientBillingOverridesTable)
        .values({
          tenantId: customerId,
          excludedServiceAccountSeats,
          reason: reason ?? null,
          setByUserId: req.user!.id,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: clientBillingOverridesTable.tenantId,
          set: { excludedServiceAccountSeats, reason: reason ?? null, setByUserId: req.user!.id, updatedAt: now },
        });

      await writeAudit(req, {
        actionType: "seat_pricing.override_set",
        entityId: String(customerId),
        customerId,
        metadata: {
          before: { excludedServiceAccountSeats: before?.excludedServiceAccountSeats ?? 0, reason: before?.reason ?? null },
          after: { excludedServiceAccountSeats, reason: reason ?? null },
        },
      });

      const snapshot = await buildSnapshot(customer.id, customer.tenantGuid);
      res.json({ customerId: customer.id, ...snapshot });
    } catch (err) {
      log.error({ err }, "msp-seat-pricing: PUT override failed");
      apiErr(res, 500, "Failed to set service-account seat exclusion");
    }
  },
);

// ── POST /api/msp/customers/:customerId/seat-pricing/apply ───────────────────
// Writes the live computed price onto the customer's actual subscription
// (tenant_subscriptions.unitAmountCents) — the one real "what does this
// customer pay" fact (tenant-billing-state.ts, #2847). Refuses a
// Stripe-synced subscription outright: its unitAmountCents is overwritten by
// every webhook replay (syncTenantSubscriptionFromStripe), so a direct write
// here would silently lose to the next sync rather than actually price the
// customer.

const applySchema = z.object({
  /** Required only when the customer has no existing subscription to update. */
  serviceId: z.number().int().positive().optional(),
});

router.post(
  "/msp/customers/:customerId/seat-pricing/apply",
  requireCapability("ladder.msp-admin"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const customerId = parseInt(req.params["customerId"] as string, 10);
      if (isNaN(customerId)) { apiErr(res, 400, "Invalid customerId"); return; }

      const customer = await resolveScopedCustomer(req, res, customerId);
      if (!customer) return;
      if (!customer.tenantGuid) {
        apiErr(res, 409, "Customer has no M365 tenant connected — nothing to price seats from");
        return;
      }

      const parsed = applySchema.safeParse(req.body ?? {});
      if (!parsed.success) { apiErr(res, 400, parsed.error.issues[0]?.message ?? "Invalid body"); return; }

      const billingState = await resolveTenantBillingState(customerId);
      const activeSubscription = billingState?.activeSubscription ?? null;

      // Resolve which service's per-seat rate this apply targets.
      let serviceId = parsed.data.serviceId ?? activeSubscription?.serviceId ?? null;
      if (!serviceId) {
        apiErr(res, 400, "serviceId is required — this customer has no active subscription to infer it from");
        return;
      }

      const [service] = await db
        .select({
          id: servicesTable.id,
          name: servicesTable.name,
          priceCents: servicesTable.priceCents,
          price: servicesTable.price,
          basePrice: servicesTable.basePrice,
          typeAttributes: servicesTable.typeAttributes,
        })
        .from(servicesTable)
        .where(eq(servicesTable.id, serviceId))
        .limit(1);
      if (!service) { apiErr(res, 404, "Service not found"); return; }

      const monthlyRateCents = perSeatMonthlyRateCentsOf(service);
      if (monthlyRateCents == null) {
        apiErr(res, 422, `"${service.name}" has no real per-seat monthly rate on file (typeAttributes.pricePerUserMonth)`);
        return;
      }

      const raw = await resolveActiveLicensedUserCount(customer.tenantGuid);
      if (!raw) {
        apiErr(res, 409, "Cannot compute a real active licensed user count for this customer yet — no priced /subscribedSkus catalog or no license_assignment_snapshots run exists");
        return;
      }

      const [override] = await db
        .select({ excludedServiceAccountSeats: clientBillingOverridesTable.excludedServiceAccountSeats })
        .from(clientBillingOverridesTable)
        .where(eq(clientBillingOverridesTable.tenantId, customerId))
        .limit(1);
      const excludedServiceAccountSeats = override?.excludedServiceAccountSeats ?? 0;
      const billableSeatCount = Math.max(0, raw.count - excludedServiceAccountSeats);
      const newUnitAmountCents = billableSeatCount * monthlyRateCents;

      // A Stripe-synced subscription's unitAmountCents is overwritten by every
      // webhook replay — writing here would silently lose, not actually price
      // the customer. Only a `manual` row (recordTenantSubscription's own
      // idempotency: no stripeSubscriptionId always inserts/updates freely) is
      // safe to drive from this live number.
      if (activeSubscription && serviceId === activeSubscription.serviceId) {
        const [subRow] = await db
          .select({ stripeSubscriptionId: tenantSubscriptionsTable.stripeSubscriptionId })
          .from(tenantSubscriptionsTable)
          .where(eq(tenantSubscriptionsTable.id, activeSubscription.id))
          .limit(1);
        if (subRow?.stripeSubscriptionId) {
          apiErr(
            res,
            409,
            "This customer's active subscription is Stripe-synced — its price is set by Stripe, not writable here. Change the Stripe price/schedule instead.",
          );
          return;
        }
      }

      const previousUnitAmountCents = activeSubscription?.serviceId === serviceId ? activeSubscription.unitAmountCents : null;

      const written = await recordTenantSubscription({
        tenantId: customer.id,
        mspId: customer.mspId,
        billingParty: activeSubscription?.billingParty ?? "customer",
        source: "manual",
        status: "active",
        serviceId,
        planName: service.name,
        unitAmountCents: newUnitAmountCents,
        billingInterval: "month",
        notes: `Seat pricing auto-computed from live M365 licensed-user count (#4111): ${raw.count} active - ${excludedServiceAccountSeats} excluded = ${billableSeatCount} billable x ${monthlyRateCents}c.`,
      });

      await writeAudit(req, {
        actionType: "seat_pricing.applied",
        entityId: String(written.id),
        customerId,
        metadata: {
          serviceId,
          rawActiveLicensedUserCount: raw.count,
          excludedServiceAccountSeats,
          billableSeatCount,
          monthlyRateCents,
          previousUnitAmountCents,
          newUnitAmountCents,
          subscriptionId: written.id,
        },
      });

      const snapshot = await buildSnapshot(customer.id, customer.tenantGuid);
      res.json({ customerId: customer.id, subscriptionId: written.id, ...snapshot });
    } catch (err) {
      log.error({ err }, "msp-seat-pricing: POST apply failed");
      apiErr(res, 500, "Failed to apply seat pricing");
    }
  },
);

export default router;
