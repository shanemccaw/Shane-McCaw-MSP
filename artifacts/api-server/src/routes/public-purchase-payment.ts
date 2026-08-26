/**
 * public-purchase-payment.ts — real Stripe payment for Buy.tsx purchase
 * sessions (Git #1307, Phase 2 of #1302; parent #1093).
 *
 * public-assessment-payment.ts backs exactly one product: the $5,000 Copilot
 * Assessment, where the session's productSlug resolves to one fixed price.
 * Buy.tsx sells three product types with variable pricing, and this pair
 * generalizes the same real-payment pattern to them:
 *
 *   POST /api/public/purchase/payment-intent     create (or recover) the intent
 *   POST /api/public/purchase/payment-confirmed  server-verified success callback
 *
 * A NEW pair rather than an in-place generalization, on the same reasoning
 * #1310 recorded for public-assessment-account.ts: the assessment file is the
 * live $5,000 funnel and stays byte-identical — collapse it onto this
 * generalized pair only once this path is battle-proven. The proven building
 * blocks are shared, not forked: ensureFlowStripeCustomer, the catalog-pricing
 * resolvers, and the metadata-bound confirm handshake.
 *
 * ── Product types and where each price comes from ─────────────────────────────
 * The product type is resolved from the SESSION's own services row (never from
 * caller input), discriminated by `services.category` — the one reliable
 * discriminator, per #1312's write-consent gate: `service_type` is NULL on
 * 7 of the 12 sellable pack rows and on architect-advisory-retainer.
 *
 *   - category "monitoring" (tier × seats): the session's productSlug names a
 *     specific tier-band row (e.g. monitoring-growth-smb) whose entire price
 *     lives in type_attributes. Priced via resolveTypeAttributesMonthlyPriceCents
 *     at the SESSION's own seat count — the one real function that computes an
 *     actual Stripe charge for a monitoring tier (Monitoring.tsx's own comment),
 *     never duplicated here. seatBandViolationMessage refuses a seat count
 *     outside the purchased band row rather than silently mispricing it.
 *   - category "retainer": fixed monthly price straight off the services row
 *     (resolveServicePriceCents; advisory/essentials/growth/enterprise are all
 *     real rows).
 *   - category "config_pack" (one or more Quick-Start Packs, summed): the
 *     session's own pack plus any `packSlugs` the request adds. EVERY slug must
 *     resolve to a real, public, positively-priced `config_pack` services row —
 *     the same "real backend fulfillment" definition #1304 (availability
 *     gating) and #1312 (write-consent gate) settled on. A slug the catalog
 *     cannot vouch for (the not-yet-real packs: MFA, Oversharing, Copilot at
 *     the time of writing) fails the WHOLE request, fail-closed.
 *   - anything else — including the assessments, which stay on their own
 *     /public/flow routes — is refused (product_not_supported), fail-closed.
 *
 * ── What is NOT trusted from the client (all preserved from #435) ─────────────
 *   - The amount. There is no price field on either request; every cent is
 *     resolved server-side from the catalog rows named by the session (and,
 *     for packs only, by validated slugs). `packSlugs` chooses WHAT is bought,
 *     never what it costs.
 *   - The success claim. /payment-confirmed retrieves the PaymentIntent from
 *     Stripe and requires status "succeeded" AND that its server-written
 *     metadata names this exact checkout session and this exact flow.
 *
 * ── Idempotent intent recovery ────────────────────────────────────────────────
 * The Stripe idempotency key derives from the session id plus the priced shape
 * of the order (customer/save-card/amount/item set), so a reload or retry
 * recovers the SAME intent (alreadyPaid short-circuits a paid-then-reloaded
 * buyer), while a changed pack selection or a catalog price edit mints a fresh
 * intent instead of erroring a replayed key with different parameters.
 * Unconfirmed intents left behind by a change of mind are never charged.
 *
 * ── The consent gate, generalized for #1311's skip branch ─────────────────────
 * The assessment flow requires status "consented" + a tenant GUID before
 * payment. That holds here for Monitoring and Packs (read consent REQUIRED),
 * but a Retainer session may lawfully skip the connection: #1311's skip route
 * stamps checkout_sessions.consent_skipped_at ONLY for products whose
 * requirement is optional, so this route accepts a stamped skip as the
 * consent-equivalent gate rather than re-deriving the requirement and risking
 * drift. A skipped session has no tenant GUID — the charge degrades to an
 * anonymous PaymentIntent exactly like the pre-#490 assessment path. The
 * column ships in #1311's manual migration; its read is guarded so an
 * un-migrated database degrades to consent-required instead of a 500.
 *
 * ── Recurring products are charged one month, card kept on file ───────────────
 * Monitoring and Retainer are monthly products; this pair charges the first
 * month as the one-time PaymentIntent and asks Stripe to attach the card to
 * the resolved customer (`setup_future_usage: "off_session"`, the same
 * sequencing #490 proved) so later provisioning can create the real
 * subscription without a second card entry. Stripe renders its own mandate
 * text for it — the honest disclosure that the card is being kept on file.
 * Packs are genuinely one-time and never ask. Subscription creation itself is
 * fulfilment/provisioning work, deliberately out of scope here — same "known
 * gap, nothing here pretends it has happened" stance as the #435 file header.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { createHash } from "node:crypto";
import { db, checkoutSessionsTable, servicesTable, tenantsTable } from "@workspace/db";
import { and, eq, gte, inArray } from "drizzle-orm";
import { z } from "zod";
import { getStripeKey, getStripePublishableKey } from "../lib/stripe.ts";
import {
  isServiceFree,
  resolveServicePriceCents,
  resolveTypeAttributesMonthlyPriceCents,
  seatBandViolationMessage,
} from "../lib/catalog-pricing.ts";
import { createAuditLog } from "../lib/audit.ts";
import { logger } from "../lib/logger.ts";
import { sendEmail, purchaseConfirmationEmail } from "../lib/mailer.ts";
import { markAssessmentLeadPurchased } from "../lib/crm-pipeline.ts";
import { ensureFlowStripeCustomer } from "../lib/assessment-flow-rescan-addon.ts";

const log = logger.child({ channel: "billing" });

const router: IRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Server-written intent tag /payment-confirmed requires back verbatim. */
export const PURCHASE_FLOW_TAG = "buy_purchase_flow";

export type PurchaseProductType = "monitoring" | "retainer" | "pack";

type PurchaseLineItem = {
  serviceId: number;
  slug: string;
  name: string;
  amountCents: number;
};

type ResolvedPurchase = {
  sessionId: string;
  status: string;
  email: string;
  fullName: string;
  company: string | null;
  /** The Entra tenant GUID stamped by the consent callback; null on a skipped-consent retainer. */
  tenantId: string | null;
  /** `tenants.id`, when the GUID has a local row — enables the Stripe customer, never blocks the sale. */
  tenantRowId: number | null;
  seats: number;
  productType: PurchaseProductType;
  productSlug: string;
  /** "month" for the recurring products, null for the one-time pack charge. */
  billingInterval: "month" | null;
  items: PurchaseLineItem[];
  amountCents: number;
  displayName: string;
};

const CATEGORY_TO_TYPE: Record<string, PurchaseProductType> = {
  monitoring: "monitoring",
  retainer: "retainer",
  config_pack: "pack",
};

/**
 * #1311's skip column ships in a manual migration Shane runs himself. Guarded
 * read: on an un-migrated database this logs and reports "not skipped", which
 * fails CLOSED back to the consent_required gate — never a 500, and never a
 * skip the database cannot prove.
 */
async function loadConsentSkippedAt(sessionId: string): Promise<Date | null> {
  try {
    const [row] = await db
      .select({ consentSkippedAt: checkoutSessionsTable.consentSkippedAt })
      .from(checkoutSessionsTable)
      .where(eq(checkoutSessionsTable.id, sessionId))
      .limit(1);
    return row?.consentSkippedAt ?? null;
  } catch (err) {
    log.error(
      { err, checkoutSessionId: sessionId },
      "purchase payment: consent_skipped_at unreadable — treating as not skipped (has the #1311 migration run?)",
    );
    return null;
  }
}

const packServiceColumns = {
  id: servicesTable.id,
  slug: servicesTable.slug,
  name: servicesTable.name,
  category: servicesTable.category,
  visibility: servicesTable.visibility,
  priceCents: servicesTable.priceCents,
  price: servicesTable.price,
  basePrice: servicesTable.basePrice,
  isFreeOffering: servicesTable.isFreeOffering,
  typeAttributes: servicesTable.typeAttributes,
};

/**
 * Resolve a session + its server-priced order, or respond and return null.
 *
 * `extraPackSlugs` is the ONLY client-chosen part of the order (which packs,
 * never their price), and only a pack session may carry it. At confirm time the
 * caller passes the intent's own server-written pack set back through here so
 * both endpoints price identically.
 */
async function resolvePurchaseOrder(
  rawSessionId: unknown,
  extraPackSlugs: string[] | undefined,
  res: Response,
): Promise<ResolvedPurchase | null> {
  const sessionId = typeof rawSessionId === "string" ? rawSessionId : "";
  if (!UUID_RE.test(sessionId)) {
    res.status(400).json({ error: "session_invalid" });
    return null;
  }

  const [session] = await db
    .select({
      id: checkoutSessionsTable.id,
      status: checkoutSessionsTable.status,
      email: checkoutSessionsTable.email,
      fullName: checkoutSessionsTable.fullName,
      company: checkoutSessionsTable.company,
      tenantId: checkoutSessionsTable.tenantId,
      productSlug: checkoutSessionsTable.productSlug,
      seats: checkoutSessionsTable.seats,
    })
    .from(checkoutSessionsTable)
    .where(
      and(
        eq(checkoutSessionsTable.id, sessionId),
        gte(checkoutSessionsTable.expiresAt, new Date()),
      ),
    )
    .limit(1);

  if (!session) {
    res.status(404).json({ error: "session_expired" });
    return null;
  }

  // The payment ordering gate. "consented" (+ the tenant GUID the callback
  // stamps) is the assessment flow's rule, kept verbatim; a #1311 stamped skip
  // is the one lawful alternative — the skip route only ever stamps it for
  // products whose read-consent requirement is optional (Retainer), so the
  // stamp itself is the proof and this route does not re-derive the
  // requirement (single source of truth, no drift).
  const consented = !!session.tenantId?.trim() && (session.status === "consented" || session.status === "paid");
  if (!consented) {
    const skippedAt = await loadConsentSkippedAt(session.id);
    if (!skippedAt) {
      res.status(409).json({ error: "consent_required" });
      return null;
    }
  }

  const [service] = await db
    .select(packServiceColumns)
    .from(servicesTable)
    .where(eq(servicesTable.slug, session.productSlug))
    .limit(1);

  if (!service) {
    log.error(
      { sessionId, productSlug: session.productSlug },
      "purchase payment: session names a product with no catalog row",
    );
    res.status(404).json({ error: "product_not_found" });
    return null;
  }

  const productType = CATEGORY_TO_TYPE[service.category ?? ""];
  if (!productType) {
    // Fail closed: assessments stay on /public/flow/*, and a category this
    // route has no pricing rule for must never guess at a charge.
    log.warn(
      { sessionId, productSlug: session.productSlug, category: service.category },
      "purchase payment: REFUSED — session product's category has no pricing rule on this route",
    );
    res.status(409).json({ error: "product_not_supported" });
    return null;
  }

  if (extraPackSlugs?.length && productType !== "pack") {
    res.status(400).json({ error: "packs_not_applicable" });
    return null;
  }

  const seats = Math.max(1, session.seats ?? 1);
  let items: PurchaseLineItem[];
  let billingInterval: "month" | null;

  if (productType === "monitoring") {
    if (isServiceFree(service)) {
      res.status(409).json({ error: "service_is_free" });
      return null;
    }
    const bandViolation = seatBandViolationMessage(service, seats);
    if (bandViolation) {
      log.warn(
        { sessionId, productSlug: session.productSlug, seats },
        "purchase payment: REFUSED — seat count outside the purchased tier row's band",
      );
      res.status(409).json({ error: "seat_band_mismatch", message: bandViolation });
      return null;
    }
    const amountCents = resolveTypeAttributesMonthlyPriceCents(service, seats);
    if (amountCents <= 0) {
      log.error(
        { sessionId, serviceId: service.id, seats },
        "purchase payment: monitoring tier resolved to a zero amount",
      );
      res.status(409).json({ error: "price_unresolved" });
      return null;
    }
    items = [{ serviceId: service.id, slug: session.productSlug, name: service.name, amountCents }];
    billingInterval = "month";
  } else if (productType === "retainer") {
    if (isServiceFree(service)) {
      res.status(409).json({ error: "service_is_free" });
      return null;
    }
    const amountCents = resolveServicePriceCents(service);
    if (amountCents <= 0) {
      log.error(
        { sessionId, serviceId: service.id },
        "purchase payment: retainer tier resolved to a zero amount",
      );
      res.status(409).json({ error: "price_unresolved" });
      return null;
    }
    items = [{ serviceId: service.id, slug: session.productSlug, name: service.name, amountCents }];
    billingInterval = "month";
  } else {
    // Packs: the session's own pack plus any validated extras, summed. Every
    // slug must be a real, public, positively-priced config_pack row — one
    // rogue slug fails the whole order rather than silently shrinking it.
    const requestedSlugs = [...new Set([session.productSlug, ...(extraPackSlugs ?? [])])];
    const rows = await db
      .select(packServiceColumns)
      .from(servicesTable)
      .where(inArray(servicesTable.slug, requestedSlugs));

    const bySlug = new Map(rows.map((r) => [r.slug, r]));
    const rejected = requestedSlugs.filter((slug) => {
      const row = bySlug.get(slug);
      return !row || row.category !== "config_pack" || row.visibility !== "public";
    });
    if (rejected.length > 0) {
      log.warn(
        { sessionId, rejected },
        "purchase payment: REFUSED — pack slug(s) with no real, public config_pack row behind them",
      );
      res.status(404).json({ error: "pack_not_found", packSlugs: rejected });
      return null;
    }

    items = [];
    for (const slug of requestedSlugs) {
      const row = bySlug.get(slug)!;
      if (isServiceFree(row)) {
        res.status(409).json({ error: "service_is_free", packSlug: slug });
        return null;
      }
      const amountCents = resolveServicePriceCents(row);
      if (amountCents <= 0) {
        log.error({ sessionId, serviceId: row.id, packSlug: slug }, "purchase payment: pack resolved to a zero amount");
        res.status(409).json({ error: "price_unresolved", packSlug: slug });
        return null;
      }
      items.push({ serviceId: row.id, slug, name: row.name, amountCents });
    }
    billingInterval = null;
  }

  const amountCents = items.reduce((sum, item) => sum + item.amountCents, 0);
  const displayName =
    items.length === 1 ? items[0].name : `${items.length} Quick-Start Packs`;

  // Pre-#490-safe columns only; the stripe_customer_id read lives inside
  // ensureFlowStripeCustomer, which the caller guards.
  const [tenantRow] = session.tenantId
    ? await db
        .select({ id: tenantsTable.id })
        .from(tenantsTable)
        .where(eq(tenantsTable.tenantId, session.tenantId))
        .limit(1)
    : [];

  return {
    sessionId: session.id,
    status: session.status,
    email: session.email,
    fullName: session.fullName,
    company: session.company,
    tenantId: session.tenantId,
    tenantRowId: tenantRow?.id ?? null,
    seats,
    productType,
    productSlug: session.productSlug,
    billingInterval,
    items,
    amountCents,
    displayName,
  };
}

/**
 * The Stripe Customer both this charge and any later subscription hang off, or
 * null when it cannot be resolved. Never throws: a customer is an ENHANCEMENT
 * to the charge and its absence (a skipped-consent retainer has no tenant at
 * all) degrades to an anonymous PaymentIntent rather than blocking the sale.
 */
async function resolvePurchaseCustomerId(
  stripe: import("stripe").Stripe,
  order: ResolvedPurchase,
): Promise<string | null> {
  if (order.tenantRowId == null) {
    log.info(
      { checkoutSessionId: order.sessionId, tenantId: order.tenantId, productType: order.productType },
      "purchase payment: no tenants row for this session — charging without a Stripe customer",
    );
    return null;
  }
  try {
    return await ensureFlowStripeCustomer(stripe, {
      tenantRowId: order.tenantRowId,
      tenantGuid: order.tenantId,
      email: order.email,
      fullName: order.fullName,
      company: order.company,
    });
  } catch (err) {
    log.error(
      { err, checkoutSessionId: order.sessionId, tenantRowId: order.tenantRowId },
      "purchase payment: Stripe customer could not be resolved — falling back to an anonymous PaymentIntent",
    );
    return null;
  }
}

// ── POST /api/public/purchase/payment-intent ──────────────────────────────────

const paymentIntentSchema = z.object({
  sessionId: z.string(),
  // Which ADDITIONAL packs, for a pack session only — what is bought, never
  // what it costs. Bounded well above the real catalog's pack count; every
  // slug is still validated against the catalog before it prices anything.
  packSlugs: z.array(z.string().trim().min(1).max(120)).max(24).optional(),
});

router.post("/public/purchase/payment-intent", async (req: Request, res: Response) => {
  const parsed = paymentIntentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "sessionId is required" });
    return;
  }

  const order = await resolvePurchaseOrder(parsed.data.sessionId, parsed.data.packSlugs, res);
  if (!order) return;

  const publishableKey = getStripePublishableKey();
  if (!publishableKey) {
    log.error({}, "purchase payment: STRIPE_PUBLISHABLE_KEY is not configured — the in-page Payment Element cannot be initialised");
    res.status(503).json({ error: "payment_unavailable" });
    return;
  }

  let stripeKey: string;
  try {
    stripeKey = getStripeKey();
  } catch (err) {
    log.error({ err }, "purchase payment: Stripe secret key is not configured");
    res.status(503).json({ error: "payment_unavailable" });
    return;
  }

  try {
    const { default: Stripe } = await import("stripe");
    const stripe = new Stripe(stripeKey);

    const customerId = await resolvePurchaseCustomerId(stripe, order);

    // Recurring products keep the card on file for the later subscription —
    // the #490 sequencing, with Stripe's own mandate text as the disclosure.
    // One-time packs never ask.
    const saveCard = order.billingInterval === "month" && !!customerId;

    // The idempotency key carries the priced shape of the order, not just its
    // id: a changed pack selection, a catalog price edit mid-session, or a
    // resolved-vs-anonymous customer each need a DIFFERENT intent, and
    // replaying a key with different parameters is an error at Stripe rather
    // than a recovery. Unconfirmed intents a change of mind leaves behind are
    // never charged.
    const itemsHash = createHash("sha256")
      .update(order.items.map((i) => i.serviceId).sort((a, b) => a - b).join("+"))
      .digest("hex")
      .slice(0, 12);
    const intentShape = `${customerId ? "cust" : "anon"}-${saveCard ? "save" : "nosave"}-${order.amountCents}-${itemsHash}`;

    const intent = await stripe.paymentIntents.create(
      {
        amount: order.amountCents,
        currency: "usd",
        automatic_payment_methods: { enabled: true },
        ...(customerId ? { customer: customerId } : {}),
        ...(saveCard ? { setup_future_usage: "off_session" as const } : {}),
        receipt_email: order.email,
        description: `${order.displayName}${order.company ? ` — ${order.company}` : ""}`,
        metadata: {
          flow: PURCHASE_FLOW_TAG,
          checkoutSessionId: order.sessionId,
          productType: order.productType,
          productSlug: order.productSlug,
          serviceIds: order.items.map((i) => i.serviceId).join(","),
          ...(order.productType === "pack"
            ? { packSlugs: order.items.map((i) => i.slug).join(",") }
            : {}),
          seats: String(order.seats),
          tenantId: order.tenantId ?? "",
          billingInterval: order.billingInterval ?? "one_time",
        },
      },
      { idempotencyKey: `buy-purchase-flow:pi:${order.sessionId}:${intentShape}` },
    );

    log.info(
      {
        checkoutSessionId: order.sessionId,
        paymentIntentId: intent.id,
        productType: order.productType,
        amountCents: order.amountCents,
        seats: order.seats,
        itemCount: order.items.length,
        status: intent.status,
        stripeCustomerId: customerId,
      },
      "purchase payment: PaymentIntent ready",
    );

    res.json({
      clientSecret: intent.client_secret,
      publishableKey,
      paymentIntentId: intent.id,
      amountCents: order.amountCents,
      productType: order.productType,
      productName: order.displayName,
      billingInterval: order.billingInterval,
      seats: order.seats,
      lineItems: order.items.map(({ slug, name, amountCents }) => ({ slug, name, amountCents })),
      // A recovered, already-succeeded intent (buyer paid, then reloaded before
      // the confirm callback landed) — the client skips straight to confirming.
      alreadyPaid: intent.status === "succeeded",
    });
  } catch (err) {
    log.error({ err, checkoutSessionId: order.sessionId }, "purchase payment: PaymentIntent creation failed");
    res.status(500).json({ error: "payment_intent_failed" });
  }
});

// ── POST /api/public/purchase/payment-confirmed ───────────────────────────────
// The success callback stripe.js's confirmPayment resolves into. The client's
// word is not evidence: the intent is re-read from Stripe and must be
// "succeeded" AND carry this exact checkout session AND this exact flow in its
// server-written metadata before the session is marked paid.

const paymentConfirmedSchema = z.object({
  sessionId: z.string(),
  paymentIntentId: z.string().min(1),
});

router.post("/public/purchase/payment-confirmed", async (req: Request, res: Response) => {
  const parsed = paymentConfirmedSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "sessionId and paymentIntentId are required" });
    return;
  }

  const order = await resolvePurchaseOrder(parsed.data.sessionId, undefined, res);
  if (!order) return;

  let stripeKey: string;
  try {
    stripeKey = getStripeKey();
  } catch {
    res.status(503).json({ error: "payment_unavailable" });
    return;
  }

  try {
    const { default: Stripe } = await import("stripe");
    const stripe = new Stripe(stripeKey);
    const intent = await stripe.paymentIntents.retrieve(parsed.data.paymentIntentId);

    if (intent.metadata?.["checkoutSessionId"] !== order.sessionId) {
      log.warn(
        { checkoutSessionId: order.sessionId, paymentIntentId: intent.id, metaSessionId: intent.metadata?.["checkoutSessionId"] },
        "purchase payment: REFUSED — PaymentIntent belongs to a different checkout session",
      );
      res.status(403).json({ error: "intent_session_mismatch" });
      return;
    }

    // Same-session intents from a DIFFERENT flow (the assessment pair writes
    // flow "home_assessment_flow") are refused too: each confirm endpoint only
    // vouches for intents its own sibling priced.
    if (intent.metadata?.["flow"] !== PURCHASE_FLOW_TAG) {
      log.warn(
        { checkoutSessionId: order.sessionId, paymentIntentId: intent.id, metaFlow: intent.metadata?.["flow"] },
        "purchase payment: REFUSED — PaymentIntent was not created by this flow",
      );
      res.status(403).json({ error: "intent_flow_mismatch" });
      return;
    }

    if (intent.status !== "succeeded") {
      log.info(
        { checkoutSessionId: order.sessionId, paymentIntentId: intent.id, status: intent.status },
        "purchase payment: confirm callback for an intent that has not succeeded",
      );
      res.status(409).json({ error: "payment_not_succeeded", status: intent.status });
      return;
    }

    // The intent's own server-written metadata is the record of WHAT was
    // bought (a pack session's full summed set may be wider than the session's
    // single productSlug). Used for the audit trail and the buyer-facing name;
    // the charged amount is always the intent's, never re-derived.
    const paidPackSlugs = (intent.metadata?.["packSlugs"] ?? "").split(",").filter(Boolean);
    const paidDisplayName =
      order.productType === "pack" && paidPackSlugs.length > 1
        ? `${paidPackSlugs.length} Quick-Start Packs`
        : order.displayName;
    const paidAmountCents = intent.amount_received || order.amountCents;

    // Already "paid" from an earlier confirm — replaying is a no-op, not an error.
    if (order.status !== "paid") {
      await db
        .update(checkoutSessionsTable)
        .set({ status: "paid", updatedAt: new Date() })
        .where(eq(checkoutSessionsTable.id, order.sessionId));

      await createAuditLog({
        actorUserId: null,
        actorName: "public:purchase-flow",
        actorRole: "client",
        actionType: "purchase_flow_payment_succeeded",
        entityType: "checkout_session",
        entityId: order.sessionId,
        metadata: {
          paymentIntentId: intent.id,
          amountCents: paidAmountCents,
          productType: order.productType,
          productSlug: order.productSlug,
          serviceIds: intent.metadata?.["serviceIds"] ?? "",
          packSlugs: paidPackSlugs,
          seats: order.seats,
          billingInterval: order.billingInterval,
          tenantId: order.tenantId,
        },
      });

      log.info(
        { checkoutSessionId: order.sessionId, paymentIntentId: intent.id, productType: order.productType, amountCents: paidAmountCents },
        "purchase payment: checkout session marked paid",
      );

      // Thank You + Invoice in one email, same as the assessment flow (#460).
      // Fire-and-forget: a mail hiccup must never fail the payment response
      // the buyer is waiting on for the next step.
      const paidAmountDollars = (paidAmountCents / 100).toFixed(2);
      void sendEmail(
        order.email,
        `Payment confirmed — ${paidDisplayName}`,
        purchaseConfirmationEmail({
          clientName: order.fullName,
          serviceName: paidDisplayName,
          amountDollars: paidAmountDollars,
        }),
        { templateName: "purchase-confirmation-buy-flow" },
      );

      // Payment-complete CRM signal (#456's marker; the buy funnel stages the
      // same lead at session creation). Non-fatal, see crm-pipeline.ts.
      void markAssessmentLeadPurchased(order.email, paidDisplayName);
    }

    res.json({
      ok: true,
      amountCents: paidAmountCents,
      email: order.email,
      productType: order.productType,
    });
  } catch (err) {
    log.error({ err, checkoutSessionId: order.sessionId }, "purchase payment: confirm failed");
    res.status(500).json({ error: "confirm_failed" });
  }
});

export default router;
