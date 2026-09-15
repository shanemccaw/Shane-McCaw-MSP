/**
 * msp-subscription-billing.ts — the MSP Console operator's account-level subscription
 * actions (Git #4110, Feature #1692 Billing).
 *
 *   POST /api/msp/:mspId/customers/:customerId/subscription/cancel        — cancel now, or at period end
 *   POST /api/msp/:mspId/customers/:customerId/subscription/discount     — a custom one-time or multi-month discount
 *   POST /api/msp/:mspId/customers/:customerId/subscription/free-month   — a 100%-off credit for N invoices
 *
 * ─── The real audit this issue asked for ──────────────────────────────────────
 * The per-customer subscription row is `tenant_subscriptions` (Git #2847,
 * tenant-scoped) — NOT `msp_subscriptions` (the MSP's own platform-tier
 * subscription, `msp_id`-unique) and NOT `invoices`/`client_services` (the legacy
 * client-portal axis, keyed on `users.id`, unrelated to the tenant axis this
 * Feature's Billing screen is scoped to per #1692).
 *
 * "Apply a discount" and "apply free month(s)" both reuse the real mechanism #4032
 * already built for testimonial-approval credits (`customer_billing_credits` +
 * `issueCreditToNextInvoice()`: a Stripe coupon attached to the tenant's active
 * subscription) rather than inventing a parallel billing concept — invoice
 * generation for a `tenant_subscriptions` row already IS this hook. #4110 extended
 * that table with `duration_months` so a credit can span more than one invoice,
 * which is what makes "free month(s)" (plural) real rather than a single-invoice
 * approximation of it.
 *
 * Auth: `requireCapability("ladder.msp-admin")` + `requireMspScope("params")`,
 * matching the level `msp/plan/change` (msp-plan-self-service.ts) already uses for
 * a real-money subscription action — cancel/discount/free-month are all
 * account-level commercial decisions, not routine operator writes. Every route
 * confirms the customer is a tenant of `:mspId` first (IDOR guard, same as
 * msp-retainer.ts), and writes a real `msp_audit_logs` entry.
 *
 * Cancel calls Stripe directly and then applies the same
 * `syncTenantSubscriptionFromStripe()` update the `customer.subscription.*` webhook
 * uses (msp-billing-webhook.ts) — so the DB and the retention gate are correct
 * immediately, not only once the webhook round-trips. A `manual`-source row (no
 * Stripe subscription — billed outside Stripe) has no Stripe call to make; it is
 * cancelled by writing the row directly, immediately only (there is no Stripe
 * schedule to defer a manual row's end to).
 */

import { randomUUID } from "crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  tenantsTable,
  tenantSubscriptionsTable,
  customerBillingCreditsTable,
  mspAuditLogsTable,
  type CustomerBillingCredit,
} from "@workspace/db";
import { TENANT_SUBSCRIPTION_ACTIVE_STATUSES, type TenantSubscriptionStatus } from "@workspace/db/schema";
import { and, eq, desc, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { requireCapability, requireMspScope } from "../middlewares/requireAuth.ts";
import { getRequestContext } from "../lib/request-context.ts";
import { logger } from "../lib/logger.ts";
import { getStripeKey } from "../lib/stripe.ts";
import { syncTenantSubscriptionFromStripe } from "../lib/tenant-billing-state.ts";
import { syncTenantsAfterStatusWrite } from "../lib/retention/subscription-state.ts";
import { issueCreditToNextInvoice, validateCreditDiscount } from "../lib/testimonial-credit.ts";
import { toTenantSubscriptionStatus } from "./msp-billing-webhook.ts";
import { serializeCredit } from "./admin-testimonials.ts";

const log = logger.child({ channel: "billing" });

const router: IRouter = Router();

const ACTIVE_SUBSCRIPTION_STATUSES: TenantSubscriptionStatus[] = [...TENANT_SUBSCRIPTION_ACTIVE_STATUSES];

function parseId(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function zodMessage(error: z.ZodError): string {
  return error.issues.map((i) => i.message).join("; ");
}

/** The customer, only if it is a tenant of this MSP. */
async function findMspCustomer(mspId: number, customerId: number) {
  const [customer] = await db
    .select({ id: tenantsTable.id, name: tenantsTable.customerName })
    .from(tenantsTable)
    .where(and(eq(tenantsTable.id, customerId), eq(tenantsTable.mspId, mspId)))
    .limit(1);
  return customer ?? null;
}

/** Parse :mspId/:customerId and resolve the customer; answers the response itself on failure. */
async function resolveCustomerOrRespond(req: Request, res: Response) {
  const mspId = parseId(req.params.mspId);
  const customerId = parseId(req.params.customerId);
  if (mspId == null || customerId == null) {
    res.status(400).json({ error: "Invalid mspId or customerId" });
    return null;
  }
  const customer = await findMspCustomer(mspId, customerId);
  if (!customer) {
    res.status(404).json({ error: "Customer not found" });
    return null;
  }
  return { mspId, customerId, customerName: customer.name };
}

/** Non-fatal: the real write already committed; an audit failure is logged, not surfaced. */
async function audit(
  req: Request,
  scope: { mspId: number; customerId: number; customerName: string },
  actionType: string,
  entityType: string,
  entityId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  try {
    await db.insert(mspAuditLogsTable).values({
      actorUserId: req.user?.id ?? null,
      actorRole: req.user?.mspRole ?? null,
      mspId: scope.mspId,
      customerId: scope.customerId,
      actionType,
      entityType,
      entityId,
      entityLabel: scope.customerName,
      correlationId: getRequestContext()?.traceId ?? randomUUID(),
      ipAddress: req.ip ?? req.socket?.remoteAddress ?? null,
      userAgent: req.headers["user-agent"] ?? null,
      outcome: "success",
      metadata,
    });
  } catch (err) {
    log.warn({ err, actionType, entityId }, "msp-subscription-billing: audit write failed (non-fatal)");
  }
}

/** The tenant's current subscription row, latest-ending first — same tie-break as `resolveTenantBillingState`. */
async function findActiveSubscription(tenantId: number) {
  const [row] = await db
    .select()
    .from(tenantSubscriptionsTable)
    .where(and(
      eq(tenantSubscriptionsTable.tenantId, tenantId),
      inArray(tenantSubscriptionsTable.status, ACTIVE_SUBSCRIPTION_STATUSES),
    ))
    .orderBy(sql`${tenantSubscriptionsTable.currentPeriodEnd} DESC NULLS LAST`, desc(tenantSubscriptionsTable.id))
    .limit(1);
  return row ?? null;
}

function subscriptionToWire(row: typeof tenantSubscriptionsTable.$inferSelect) {
  return {
    id: row.id,
    status: row.status,
    planName: row.planName,
    billingParty: row.billingParty,
    source: row.source,
    unitAmountCents: row.unitAmountCents,
    currency: row.currency,
    currentPeriodStart: row.currentPeriodStart instanceof Date ? row.currentPeriodStart.toISOString() : row.currentPeriodStart,
    currentPeriodEnd: row.currentPeriodEnd instanceof Date ? row.currentPeriodEnd.toISOString() : row.currentPeriodEnd,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    canceledAt: row.canceledAt instanceof Date ? row.canceledAt.toISOString() : row.canceledAt,
    endedAt: row.endedAt instanceof Date ? row.endedAt.toISOString() : row.endedAt,
  };
}

// ── GET /msp/:mspId/customers/:customerId/subscription ────────────────────────
// Read-only (#2609, wiring this route surface into the MSP Console UI): the
// tenant's current subscription, if any, plus its recent operator-issued
// credit history — so the UI can render real state before offering
// cancel/discount/free-month. #4110 shipped the three write routes only; no
// GET existed for the operator to see what they're about to act on.
router.get(
  "/msp/:mspId/customers/:customerId/subscription",
  requireCapability("ladder.msp-operator"),
  requireMspScope("params"),
  async (req: Request, res: Response) => {
    try {
      const scope = await resolveCustomerOrRespond(req, res);
      if (!scope) return;
      const { customerId, customerName } = scope;

      const subscription = await findActiveSubscription(customerId);
      const credits = await db
        .select()
        .from(customerBillingCreditsTable)
        .where(eq(customerBillingCreditsTable.tenantId, customerId))
        .orderBy(desc(customerBillingCreditsTable.createdAt))
        .limit(20);

      res.json({
        customerId,
        customerName,
        subscription: subscription ? subscriptionToWire(subscription) : null,
        credits: credits.map((c) => ({ ...serializeCredit(c), source: c.source, createdAt: c.createdAt })),
      });
    } catch (err) {
      log.error({ err }, "GET /msp/:mspId/customers/:customerId/subscription failed");
      res.status(500).json({ error: "Failed to fetch subscription" });
    }
  },
);

// ── POST /msp/:mspId/customers/:customerId/subscription/cancel ────────────────
const cancelSchema = z.object({
  atPeriodEnd: z.boolean().optional().default(false),
  reason: z.string().max(4000).nullable().optional(),
});

router.post(
  "/msp/:mspId/customers/:customerId/subscription/cancel",
  requireCapability("ladder.msp-admin"),
  requireMspScope("params"),
  async (req: Request, res: Response) => {
    try {
      const parsed = cancelSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: zodMessage(parsed.error) });
        return;
      }
      const scope = await resolveCustomerOrRespond(req, res);
      if (!scope) return;
      const { mspId, customerId } = scope;
      const { atPeriodEnd, reason } = parsed.data;

      const subscription = await findActiveSubscription(customerId);
      if (!subscription) {
        res.status(404).json({ error: "This customer has no active subscription to cancel." });
        return;
      }

      let updatedRow: typeof tenantSubscriptionsTable.$inferSelect;

      if (subscription.stripeSubscriptionId) {
        let stripeKey: string;
        try {
          stripeKey = getStripeKey();
        } catch (err) {
          res.status(500).json({ error: err instanceof Error ? err.message : "Stripe is not configured" });
          return;
        }
        const { default: Stripe } = await import("stripe");
        const stripe = new Stripe(stripeKey);

        const stripeSub = atPeriodEnd
          ? await stripe.subscriptions.update(subscription.stripeSubscriptionId, { cancel_at_period_end: true })
          : await stripe.subscriptions.cancel(subscription.stripeSubscriptionId);

        const raw = stripeSub as unknown as {
          current_period_start?: number;
          current_period_end?: number;
          canceled_at?: number | null;
          ended_at?: number | null;
        };
        const mappedStatus = toTenantSubscriptionStatus(stripeSub.status) ?? subscription.status;

        await syncTenantSubscriptionFromStripe({
          stripeSubscriptionId: subscription.stripeSubscriptionId,
          status: mappedStatus,
          currentPeriodStart: raw.current_period_start ? new Date(raw.current_period_start * 1000) : undefined,
          currentPeriodEnd: raw.current_period_end ? new Date(raw.current_period_end * 1000) : undefined,
          cancelAtPeriodEnd: stripeSub.cancel_at_period_end ?? undefined,
          canceledAt: raw.canceled_at ? new Date(raw.canceled_at * 1000) : undefined,
          endedAt: raw.ended_at ? new Date(raw.ended_at * 1000) : undefined,
        });

        const [refreshed] = await db
          .select()
          .from(tenantSubscriptionsTable)
          .where(eq(tenantSubscriptionsTable.id, subscription.id))
          .limit(1);
        updatedRow = refreshed ?? subscription;
      } else {
        if (atPeriodEnd) {
          res.status(400).json({
            error: "This subscription has no Stripe billing behind it, so there is no period end to cancel at — cancel immediately instead.",
          });
          return;
        }
        const now = new Date();
        const [row] = await db
          .update(tenantSubscriptionsTable)
          .set({ status: "canceled", canceledAt: now, endedAt: now, updatedAt: now })
          .where(eq(tenantSubscriptionsTable.id, subscription.id))
          .returning();
        updatedRow = row!;
      }

      await syncTenantsAfterStatusWrite([customerId]);

      await audit(req, scope, "SUBSCRIPTION_CANCELED", "tenant_subscription", String(subscription.id), {
        atPeriodEnd,
        reason: reason ?? null,
        previousStatus: subscription.status,
        newStatus: updatedRow.status,
        source: subscription.source,
        stripeSubscriptionId: subscription.stripeSubscriptionId,
      });
      log.info(
        { mspId, customerId, subscriptionId: subscription.id, atPeriodEnd, newStatus: updatedRow.status },
        "msp subscription canceled",
      );
      res.json({ subscription: subscriptionToWire(updatedRow) });
    } catch (err) {
      log.error({ err }, "POST /msp/:mspId/customers/:customerId/subscription/cancel failed");
      res.status(500).json({ error: "Failed to cancel subscription" });
    }
  },
);

// ── shared: issue an operator credit (discount or free-month) ─────────────────
async function issueOperatorCredit(
  req: Request,
  res: Response,
  scope: { mspId: number; customerId: number; customerName: string },
  params: {
    source: "msp_operator_discount" | "msp_operator_free_month";
    discountType: "fixed" | "percentage";
    discountValue: number;
    durationMonths: number | null;
    reason: string | null;
    actionType: string;
    extraMetadata: Record<string, unknown>;
  },
): Promise<void> {
  const { customerId } = scope;

  const [row] = await db
    .insert(customerBillingCreditsTable)
    .values({
      tenantId: customerId,
      source: params.source,
      discountType: params.discountType,
      discountValue: params.discountValue.toFixed(2),
      durationMonths: params.durationMonths,
      issuedByUserId: req.user?.id ?? null,
    })
    .returning();

  let credit: CustomerBillingCredit;
  try {
    credit = await issueCreditToNextInvoice(row!.id);
  } catch (err) {
    log.error({ err, creditId: row!.id }, "msp-subscription-billing: credit issuance errored");
    res.status(500).json({ error: "The credit was recorded, but issuing it to Stripe errored — retry it from the customer's billing page", creditId: row!.id });
    return;
  }

  await audit(req, scope, params.actionType, "customer_billing_credit", String(credit.id), {
    reason: params.reason,
    discountType: credit.discountType,
    discountValue: credit.discountValue,
    durationMonths: credit.durationMonths,
    creditStatus: credit.status,
    failureReason: credit.failureReason,
    ...params.extraMetadata,
  });
  log.info(
    { mspId: scope.mspId, customerId, creditId: credit.id, source: params.source, status: credit.status },
    "msp subscription credit issued",
  );
  res.status(201).json({ credit: serializeCredit(credit) });
}

// ── POST /msp/:mspId/customers/:customerId/subscription/discount ──────────────
const discountSchema = z.object({
  discountType: z.enum(["fixed", "percentage"]),
  discountValue: z.number(),
  durationMonths: z.number().int().min(1).max(24).nullable().optional(),
  reason: z.string().max(4000).nullable().optional(),
});

router.post(
  "/msp/:mspId/customers/:customerId/subscription/discount",
  requireCapability("ladder.msp-admin"),
  requireMspScope("params"),
  async (req: Request, res: Response) => {
    try {
      const parsed = discountSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: zodMessage(parsed.error) });
        return;
      }
      const discount = validateCreditDiscount(parsed.data.discountType, parsed.data.discountValue);
      if (!discount.ok) {
        res.status(400).json({ error: discount.error });
        return;
      }
      const scope = await resolveCustomerOrRespond(req, res);
      if (!scope) return;

      await issueOperatorCredit(req, res, scope, {
        source: "msp_operator_discount",
        discountType: discount.discountType,
        discountValue: discount.discountValue,
        durationMonths: parsed.data.durationMonths ?? null,
        reason: parsed.data.reason ?? null,
        actionType: "SUBSCRIPTION_DISCOUNT_APPLIED",
        extraMetadata: {},
      });
    } catch (err) {
      log.error({ err }, "POST /msp/:mspId/customers/:customerId/subscription/discount failed");
      res.status(500).json({ error: "Failed to apply discount" });
    }
  },
);

// ── POST /msp/:mspId/customers/:customerId/subscription/free-month ────────────
const freeMonthSchema = z.object({
  months: z.number().int().min(1).max(12).optional().default(1),
  reason: z.string().max(4000).nullable().optional(),
});

router.post(
  "/msp/:mspId/customers/:customerId/subscription/free-month",
  requireCapability("ladder.msp-admin"),
  requireMspScope("params"),
  async (req: Request, res: Response) => {
    try {
      const parsed = freeMonthSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: zodMessage(parsed.error) });
        return;
      }
      const scope = await resolveCustomerOrRespond(req, res);
      if (!scope) return;
      const { months, reason } = parsed.data;

      await issueOperatorCredit(req, res, scope, {
        source: "msp_operator_free_month",
        discountType: "percentage",
        discountValue: 100,
        durationMonths: months,
        reason: reason ?? null,
        actionType: "SUBSCRIPTION_FREE_MONTH_APPLIED",
        extraMetadata: { months },
      });
    } catch (err) {
      log.error({ err }, "POST /msp/:mspId/customers/:customerId/subscription/free-month failed");
      res.status(500).json({ error: "Failed to apply free month(s)" });
    }
  },
);

export default router;
