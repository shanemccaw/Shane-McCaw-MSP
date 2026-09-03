/**
 * copilot-assessment-checkout.ts
 *
 * POST /api/portal/copilot-assessment/checkout — Copilot Assessment epic
 * (#183), Phase 10 / #193. Wires SowScreen.tsx's purchase modal to a real
 * Stripe Checkout Session, using the same Stripe SDK + getStripeKey() +
 * verifyCaptchaToken() mechanism already proven in portal-checkout.ts and
 * (formerly) portal-assessment.ts's "/portal/assessment/sow/checkout" —
 * that SOW checkout route was retired with the SOW/checkout flow (#1674,
 * #1753); this route is independent of it and reused the same pattern, not
 * the route itself.
 *
 * Unlike the rest of this epic's screens, the SOW builder's scope modules
 * (SCOPE_MODULES in SowScreen.tsx) have no backing database row yet — the
 * whole wizard is still stateless client-side state (see
 * copilot-assessment.tsx's own doc comment). So this route is also
 * stateless: it takes the client's already-priced selected modules at face
 * value (same trust boundary the rest of this epic's stateless screens
 * already operate under) and turns them into a real, itemized Stripe
 * Checkout Session — one line item per selected module (recurring modules
 * get a monthly Stripe price, so a mixed cart forces "subscription" mode),
 * plus the Microsoft Assessment Partner Funding Credit applied as a real
 * Stripe coupon (same "Pattern B" traceable-discount approach
 * portal-assessment.ts uses for its pay-in-full coupon).
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { requireAuth } from "../middlewares/requireAuth.ts";
import { resolveMspId } from "../lib/resolve-msp-id.ts";
import { getStripeKey } from "../lib/stripe.ts";
import { getMspPortalBaseUrl } from "../lib/portal-url.ts";
import { verifyCaptchaToken } from "../lib/captcha.ts";
import { logger } from "../lib/logger.ts";

const log = logger.child({ channel: "billing" });

const router: IRouter = Router();

interface SelectedModule {
  id: string;
  title: string;
  priceCents: number;
  isRecurring: boolean;
}

function isValidSelectedModule(val: unknown): val is SelectedModule {
  if (!val || typeof val !== "object") return false;
  const m = val as Record<string, unknown>;
  return (
    typeof m.id === "string" &&
    m.id.length > 0 &&
    typeof m.title === "string" &&
    m.title.length > 0 &&
    typeof m.priceCents === "number" &&
    Number.isFinite(m.priceCents) &&
    m.priceCents >= 0 &&
    typeof m.isRecurring === "boolean"
  );
}

router.post(
  "/portal/copilot-assessment/checkout",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const user = req.user!;

    const body = req.body as {
      captchaToken?: string;
      companyName?: string;
      poNumber?: string;
      signerName?: string;
      readinessScore?: number;
      selectedModules?: unknown;
      creditCents?: number;
    };

    if (!body.captchaToken) {
      res.status(400).json({ error: "CAPTCHA token is required" });
      return;
    }
    const captcha = await verifyCaptchaToken(body.captchaToken);
    if (!captcha.success) {
      res.status(403).json({ error: "CAPTCHA verification failed" });
      return;
    }

    const companyName = typeof body.companyName === "string" ? body.companyName.trim() : "";
    const poNumber = typeof body.poNumber === "string" ? body.poNumber.trim() : "";
    const signerName = typeof body.signerName === "string" ? body.signerName.trim() : "";
    const readinessScore = typeof body.readinessScore === "number" && Number.isFinite(body.readinessScore)
      ? body.readinessScore
      : null;
    if (!companyName || !poNumber || !signerName || readinessScore === null) {
      res.status(400).json({ error: "companyName, poNumber, signerName, and readinessScore are required" });
      return;
    }

    if (!Array.isArray(body.selectedModules) || body.selectedModules.length === 0 || !body.selectedModules.every(isValidSelectedModule)) {
      res.status(400).json({ error: "selectedModules is required and must be a non-empty array of priced modules" });
      return;
    }
    const selectedModules = body.selectedModules as SelectedModule[];

    const creditCents = typeof body.creditCents === "number" && Number.isFinite(body.creditCents) && body.creditCents > 0
      ? Math.round(body.creditCents)
      : 0;

    let stripeKey: string;
    try {
      stripeKey = getStripeKey();
    } catch {
      res.status(503).json({ error: "Payment service is not configured. Please contact support." });
      return;
    }

    try {
      const { default: Stripe } = await import("stripe");
      const stripe = new Stripe(stripeKey);

      const hasRecurring = selectedModules.some((m) => m.isRecurring);
      const mode = hasRecurring ? "subscription" : "payment";

      const lineItems = selectedModules.map((m) => ({
        price_data: {
          currency: "usd",
          product_data: { name: m.title },
          unit_amount: m.priceCents,
          ...(m.isRecurring ? { recurring: { interval: "month" as const } } : {}),
        },
        quantity: 1,
      }));

      let discounts: Array<{ coupon: string }> = [];
      if (creditCents > 0) {
        const coupon = await stripe.coupons.create({
          amount_off: creditCents,
          currency: "usd",
          duration: "once",
          name: "Microsoft Assessment Partner Funding Credit",
          metadata: { flow: "copilot_assessment" },
        });
        discounts = [{ coupon: coupon.id }];
      }

      const mspId = await resolveMspId(req);
      const portalBase = getMspPortalBaseUrl();

      const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        customer_email: user.email,
        billing_address_collection: "required",
        ...(discounts.length > 0 && { discounts }),
        line_items: lineItems,
        mode,
        success_url: `${portalBase}/copilot-assessment/sow?payment=success`,
        cancel_url: `${portalBase}/copilot-assessment/sow?payment=cancelled`,
        metadata: {
          type: "copilot_assessment_checkout",
          userId: String(user.id),
          mspId: mspId !== null ? String(mspId) : "",
          companyName,
          poNumber,
          signerName,
          readinessScore: String(readinessScore),
          moduleIds: selectedModules.map((m) => m.id).join(","),
        },
      });

      log.info(
        { userId: user.id, sessionId: session.id, moduleCount: selectedModules.length, mode },
        "copilot-assessment-checkout: Stripe Checkout session created",
      );
      res.json({ url: session.url });
    } catch (err) {
      log.error({ err, userId: user.id }, "POST /portal/copilot-assessment/checkout failed");
      res.status(500).json({ error: "Failed to start checkout" });
    }
  },
);

export default router;
