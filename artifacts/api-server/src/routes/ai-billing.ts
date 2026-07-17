/**
 * ai-billing.ts
 *
 * REST API routes for MSP AI Cost Governance & Billing.
 * Mounted at /api/msp/v1/ai-billing by the msp-v1 router.
 *
 * Routes:
 *   GET  /api/msp/v1/ai-billing/balance/:mspId          — MSP balance + alert summary
 *   GET  /api/msp/v1/ai-billing/usage/:mspId            — recent usage events (paginated)
 *   GET  /api/msp/v1/ai-billing/ledger/:mspId           — ledger transaction history (paginated)
 *   POST /api/msp/v1/ai-billing/grant/:mspId            — credit monthly grant (PlatformAdmin)
 *   POST /api/msp/v1/ai-billing/purchase/:mspId         — initiate Stripe AI-block purchase
 *   POST /api/msp/v1/ai-billing/expire-grant/:mspId     — expire monthly grant (PlatformAdmin)
 *   GET  /api/msp/v1/ai-billing/admin/cross-msp-alerts  — cross-MSP alert view (PlatformAdmin)
 *   POST /api/msp/v1/ai-billing/purchase-webhook        — (internal) Stripe purchase confirmed
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  mspAiPurchasesTable,
  aiUsageEventsTable,
  aiBalanceLedgerTable,
  mspsTable,
} from "@workspace/db";
import { eq, and, desc, count, sum } from "drizzle-orm";
import { requireRole, requireMspScope } from "../middlewares/requireAuth.ts";
import { mspMutatingRateLimit } from "../middlewares/mspRateLimit.ts";
import { apiError, ApiErrorCode, parsePagination, paginatedResponse } from "../lib/api-helpers.ts";
import {
  getAiBalance,
  creditMonthlyGrant,
  activateAiPurchase,
  expireMonthlyGrant,
  getCrossMspAlertSummary,
  getRecentUsageEvents,
  getLedgerHistory,
  periodKeyFor,
} from "../lib/ai-billing.ts";
import { getStripeKey } from "../lib/stripe.ts";
import { logger } from "../lib/logger.ts";
const log = logger.child({ channel: "billing" });

function p(val: string | string[] | undefined): string {
  return Array.isArray(val) ? (val[0] ?? "") : (val ?? "");
}

const router: IRouter = Router();

// ── MSP Balance & Summary ─────────────────────────────────────────────────────

router.get(
  "/balance/:mspId",
  requireRole("MSPOperator"),
  requireMspScope("params"),
  async (req: Request, res: Response) => {
    const mspId = parseInt(p(req.params["mspId"]), 10);
    if (isNaN(mspId)) {
      apiError(res, 400, ApiErrorCode.VALIDATION, "mspId must be a number");
      return;
    }

    const summary = await getAiBalance(mspId);

    // Include recent purchases for context
    const purchases = await db
      .select()
      .from(mspAiPurchasesTable)
      .where(eq(mspAiPurchasesTable.mspId, mspId))
      .orderBy(desc(mspAiPurchasesTable.createdAt))
      .limit(10);

    res.json({ summary, recentPurchases: purchases });
  },
);

// ── Recent Usage Events ───────────────────────────────────────────────────────

router.get(
  "/usage/:mspId",
  requireRole("MSPOperator"),
  requireMspScope("params"),
  async (req: Request, res: Response) => {
    const mspId = parseInt(p(req.params["mspId"]), 10);
    if (isNaN(mspId)) {
      apiError(res, 400, ApiErrorCode.VALIDATION, "mspId must be a number");
      return;
    }

    const pg = parsePagination(req.query);

    const [{ total }] = await db
      .select({ total: count() })
      .from(aiUsageEventsTable)
      .where(eq(aiUsageEventsTable.mspId, mspId));

    const rows = await db
      .select()
      .from(aiUsageEventsTable)
      .where(eq(aiUsageEventsTable.mspId, mspId))
      .orderBy(desc(aiUsageEventsTable.occurredAt))
      .limit(pg.pageSize)
      .offset(pg.offset);

    res.json(paginatedResponse(rows, total, pg));
  },
);

// ── Ledger History ────────────────────────────────────────────────────────────

router.get(
  "/ledger/:mspId",
  requireRole("MSPOperator"),
  requireMspScope("params"),
  async (req: Request, res: Response) => {
    const mspId = parseInt(p(req.params["mspId"]), 10);
    if (isNaN(mspId)) {
      apiError(res, 400, ApiErrorCode.VALIDATION, "mspId must be a number");
      return;
    }

    const pg = parsePagination(req.query);

    const [{ total }] = await db
      .select({ total: count() })
      .from(aiBalanceLedgerTable)
      .where(eq(aiBalanceLedgerTable.mspId, mspId));

    const rows = await db
      .select()
      .from(aiBalanceLedgerTable)
      .where(eq(aiBalanceLedgerTable.mspId, mspId))
      .orderBy(desc(aiBalanceLedgerTable.createdAt))
      .limit(pg.pageSize)
      .offset(pg.offset);

    res.json(paginatedResponse(rows, total, pg));
  },
);

// ── Monthly Grant (PlatformAdmin only) ───────────────────────────────────────

router.post(
  "/grant/:mspId",
  requireRole("PlatformAdmin"),
  mspMutatingRateLimit,
  async (req: Request, res: Response) => {
    const mspId = parseInt(p(req.params["mspId"]), 10);
    if (isNaN(mspId)) {
      apiError(res, 400, ApiErrorCode.VALIDATION, "mspId must be a number");
      return;
    }

    const { grantCents, periodKey, description } = req.body as {
      grantCents?: number;
      periodKey?: string;
      description?: string;
    };

    if (!grantCents || grantCents <= 0) {
      apiError(res, 400, ApiErrorCode.VALIDATION, "grantCents must be a positive integer");
      return;
    }

    const created = await creditMonthlyGrant({
      mspId,
      grantCents: Math.round(grantCents),
      periodKey: periodKey ?? periodKeyFor(),
      description,
      createdByUserId: req.user?.id,
    });

    if (!created) {
      apiError(res, 409, ApiErrorCode.CONFLICT, `Monthly grant for period ${periodKey ?? periodKeyFor()} already exists`);
      return;
    }

    const summary = await getAiBalance(mspId);
    res.status(201).json({ ok: true, summary });
  },
);

// ── Expire Monthly Grant (PlatformAdmin only) ─────────────────────────────────

router.post(
  "/expire-grant/:mspId",
  requireRole("PlatformAdmin"),
  mspMutatingRateLimit,
  async (req: Request, res: Response) => {
    const mspId = parseInt(p(req.params["mspId"]), 10);
    if (isNaN(mspId)) {
      apiError(res, 400, ApiErrorCode.VALIDATION, "mspId must be a number");
      return;
    }

    const { periodKey } = req.body as { periodKey?: string };
    if (!periodKey) {
      apiError(res, 400, ApiErrorCode.VALIDATION, "periodKey is required (e.g. '2026-07')");
      return;
    }

    await expireMonthlyGrant({
      mspId,
      periodKey,
      createdByUserId: req.user?.id,
    });

    const summary = await getAiBalance(mspId);
    res.json({ ok: true, summary });
  },
);

// ── Initiate AI Block Purchase (Stripe Checkout) ──────────────────────────────

// Standard AI credit block options — price in cents, credit granted in cents
const AI_BLOCK_OPTIONS = [
  { id: "ai_block_500", priceCents: 500,  creditCents: 500,  label: "$5 — 500 AI credits" },
  { id: "ai_block_2000", priceCents: 2000, creditCents: 2000, label: "$20 — 2,000 AI credits" },
  { id: "ai_block_5000", priceCents: 5000, creditCents: 5000, label: "$50 — 5,000 AI credits" },
  { id: "ai_block_10000", priceCents: 10000, creditCents: 10000, label: "$100 — 10,000 AI credits" },
] as const;

router.get("/purchase-options", requireRole("MSPOperator"), async (_req: Request, res: Response) => {
  res.json({ options: AI_BLOCK_OPTIONS });
});

router.post(
  "/purchase/:mspId",
  requireRole("MSPAdmin"),
  requireMspScope("params"),
  mspMutatingRateLimit,
  async (req: Request, res: Response) => {
    const mspId = parseInt(p(req.params["mspId"]), 10);
    if (isNaN(mspId)) {
      apiError(res, 400, ApiErrorCode.VALIDATION, "mspId must be a number");
      return;
    }

    const { blockId, successUrl, cancelUrl } = req.body as {
      blockId?: string;
      successUrl?: string;
      cancelUrl?: string;
    };

    const block = AI_BLOCK_OPTIONS.find((b) => b.id === blockId);
    if (!block) {
      apiError(res, 400, ApiErrorCode.VALIDATION, `Unknown AI block option. Valid: ${AI_BLOCK_OPTIONS.map((b) => b.id).join(", ")}`);
      return;
    }

    if (!successUrl || !cancelUrl) {
      apiError(res, 400, ApiErrorCode.VALIDATION, "successUrl and cancelUrl are required");
      return;
    }

    let stripeKey: string;
    try {
      stripeKey = getStripeKey();
    } catch {
      apiError(res, 503, ApiErrorCode.INTERNAL, "Stripe is not configured");
      return;
    }

    // Look up MSP name for the Stripe checkout description
    const [msp] = await db
      .select({ name: mspsTable.name })
      .from(mspsTable)
      .where(eq(mspsTable.id, mspId))
      .limit(1);

    if (!msp) {
      apiError(res, 404, ApiErrorCode.NOT_FOUND, "MSP not found");
      return;
    }

    // Create a pending purchase row so we can link the Stripe session back to it
    const [purchase] = await db
      .insert(mspAiPurchasesTable)
      .values({
        mspId,
        pricePaidCents: block.priceCents,
        creditGrantedCents: block.creditCents,
        status: "pending",
        purchasedByUserId: req.user?.id,
      })
      .returning({ purchaseId: mspAiPurchasesTable.purchaseId });

    const purchaseId = purchase!.purchaseId;

    try {
      const { default: Stripe } = await import("stripe");
      const stripe = new Stripe(stripeKey);

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        payment_method_types: ["card"],
        line_items: [
          {
            price_data: {
              currency: "usd",
              unit_amount: block.priceCents,
              product_data: {
                name: block.label,
                description: `AI credit block for ${msp.name} — never expires`,
              },
            },
            quantity: 1,
          },
        ],
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: {
          type: "msp_ai_purchase",
          purchaseId,
          mspId: String(mspId),
        },
        client_reference_id: purchaseId,
      });

      // Update purchase row with Stripe session ID
      await db
        .update(mspAiPurchasesTable)
        .set({ stripeCheckoutSessionId: session.id, updatedAt: new Date() })
        .where(eq(mspAiPurchasesTable.purchaseId, purchaseId));

      log.info({ mspId, purchaseId, sessionId: session.id }, "ai-billing: Stripe checkout created");

      res.json({
        purchaseId,
        checkoutUrl: session.url,
        sessionId: session.id,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error({ err, mspId, purchaseId }, "ai-billing: Stripe checkout creation failed");

      // Clean up pending purchase
      await db
        .delete(mspAiPurchasesTable)
        .where(eq(mspAiPurchasesTable.purchaseId, purchaseId));

      apiError(res, 502, ApiErrorCode.INTERNAL, `Failed to create Stripe checkout: ${message}`);
    }
  },
);

// ── Internal: handle confirmed Stripe AI purchase ─────────────────────────────
// This is called from the MSP Stripe billing webhook (msp-billing-webhook.ts)
// after checkout.session.completed is received for type = "msp_ai_purchase".

router.post(
  "/purchase-webhook/activate",
  requireRole("PlatformAdmin"),
  async (req: Request, res: Response) => {
    const { purchaseId, stripePaymentIntentId, stripeCustomerId } = req.body as {
      purchaseId?: string;
      stripePaymentIntentId?: string;
      stripeCustomerId?: string;
    };

    if (!purchaseId) {
      apiError(res, 400, ApiErrorCode.VALIDATION, "purchaseId is required");
      return;
    }

    const [purchase] = await db
      .select()
      .from(mspAiPurchasesTable)
      .where(eq(mspAiPurchasesTable.purchaseId, purchaseId))
      .limit(1);

    if (!purchase) {
      apiError(res, 404, ApiErrorCode.NOT_FOUND, "Purchase not found");
      return;
    }

    if (purchase.status === "active") {
      res.json({ ok: true, alreadyActivated: true });
      return;
    }

    if (stripeCustomerId) {
      await db
        .update(mspAiPurchasesTable)
        .set({ stripeCustomerId, updatedAt: new Date() })
        .where(eq(mspAiPurchasesTable.purchaseId, purchaseId));
    }

    await activateAiPurchase({
      mspId: purchase.mspId,
      purchaseId,
      creditGrantedCents: purchase.creditGrantedCents,
      stripePaymentIntentId,
      activatedByUserId: undefined,
    });

    const summary = await getAiBalance(purchase.mspId);
    res.json({ ok: true, summary });
  },
);

// ── Admin: Cross-MSP Alert View (PlatformAdmin only) ─────────────────────────

router.get(
  "/admin/cross-msp-alerts",
  requireRole("PlatformAdmin"),
  async (_req: Request, res: Response) => {
    const alerts = await getCrossMspAlertSummary();
    res.json({ alerts, generatedAt: new Date().toISOString() });
  },
);

export default router;
