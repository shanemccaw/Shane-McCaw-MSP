/**
 * public-free-scan-sow.ts — Git #1374 (Phase of Feature #1352, Free Scan).
 *
 *   GET  /api/public/free-scan/sow                   the computed SOW + persisted scope
 *   PUT  /api/public/free-scan/sow/scope             persist a scope change
 *   POST /api/public/free-scan/sow/sign              capture the e-signature, lock the scope
 *   POST /api/public/free-scan/sow/payment-intent    real Stripe intent for the chosen plan
 *   POST /api/public/free-scan/sow/payment-confirmed server-verified success callback
 *
 * ── Identity, and why none of these takes a customerId ────────────────────────
 * A Free Scan Prospect is deliberately never issued a JWT (#656's
 * `hasRealEntitlement()` gate — see routes/auth.ts and
 * lib/free-scan-prospect.test.ts), so every route here is unauthenticated on
 * purpose and resolves the tenant the same two ways #1358 and #1359 already do:
 *
 *   • `sessionId` — the live flow's checkout session, through the SAME
 *     `resolveFlowSession` → `resolveConsentedTenant` pair
 *     public-free-scan-results.ts uses; or
 *   • `returnToken` — the emailed return link (#1359), through
 *     `resolveFreeScanReturnLink`; or
 *   • `accountSession: true` — the paid Prospect's own scoped login (#4329),
 *     resolved from its httpOnly session cookie by `resolveAccountSession`
 *     (lib/free-scan-account.ts). That account opens this one engagement and
 *     nothing else: it is not a JWT, never touches `users` or `client_services`,
 *     and leaves #656's gate exactly as closed as it was.
 *
 * A caller never supplies a customerId and is never told one. The mutating
 * routes take their credential from the JSON BODY rather than the query string,
 * for the same reason #1359 does: it stays out of access logs and is never
 * mistaken for a bearer token by middleware.
 *
 * ── What is never trusted from the caller ────────────────────────────────────
 *   - The amount. There is no price field on any request. Every cent is
 *     re-resolved from the Products Catalog by `buildFreeScanSow` on each read
 *     and again when the PaymentIntent is created (lib/free-scan-sow.ts).
 *   - The success claim. `/payment-confirmed` re-reads the PaymentIntent from
 *     Stripe and requires status "succeeded" AND that its server-written
 *     metadata names this exact engagement and this exact flow — the same
 *     handshake public-purchase-payment.ts uses.
 *   - The required phase. Phase 1 cannot be deselected, asserted server-side in
 *     `normaliseRequestedSelection` AND again in the builder.
 *   - The scope, once signed. `signedAt` non-null makes every scope write a 409,
 *     and the signed document is served from its own snapshot thereafter.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { createHash } from "node:crypto";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { db, freeScanEngagementsTable, tenantsTable, type FreeScanEngagement } from "@workspace/db";
import { eq } from "drizzle-orm";
import { resolveFlowSession, resolveConsentedTenant } from "./consent.ts";
import { resolveFreeScanReturnLink } from "../lib/free-scan-return-link.ts";
import { resolveAccountSession } from "../lib/free-scan-account.ts";
import {
  loadOrCreateEngagement,
  normaliseRequestedSelection,
  resolveProspectContact,
  resolveSessionContact,
  selectionFromRow,
  sowForEngagement,
  chargeShapeKey,
  type FreeScanActor,
} from "../lib/free-scan-engagement.ts";
import { buildFreeScanSow, FREE_SCAN_SOW_PHASE_SLUGS } from "../lib/free-scan-sow.ts";
import { getStripeKey, getStripePublishableKey } from "../lib/stripe.ts";
import { ensureFlowStripeCustomer } from "../lib/assessment-flow-rescan-addon.ts";
import { createAuditLog } from "../lib/audit.ts";
import { logger } from "../lib/logger.ts";

const log = logger.child({ channel: "billing" });

const router: IRouter = Router();

const isDev = process.env.NODE_ENV !== "production";

/** Server-written intent tag `/payment-confirmed` requires back verbatim. */
export const FREE_SCAN_SOW_FLOW_TAG = "free_scan_sow_flow";

// The Review screen reads on every scope change and polls nothing; this only
// bounds abuse of an unauthenticated surface.
const sowLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: isDev ? 1000 : 240,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many requests. Please wait a few minutes and try again." },
});

function noStore(_req: Request, res: Response, next: () => void): void {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
}

// ── Identity ──────────────────────────────────────────────────────────────────

export const credentialSchema = z
  .object({
    sessionId: z.string().optional(),
    returnToken: z.string().max(200).optional(),
    // #4329 — the caller has no flow credential and is relying on its scoped
    // account session cookie instead. Explicit, so a request carrying nothing at
    // all is still the same 400 it always was.
    accountSession: z.literal(true).optional(),
  })
  .refine((v) => !!v.sessionId || !!v.returnToken || v.accountSession === true, {
    message: "a sessionId, returnToken or accountSession is required",
  });

/**
 * Resolve the acting Prospect from whichever door the caller used, or respond
 * and return null so callers can `if (!actor) return;`.
 *
 * Exported for the Remediate step (#1375), which is the same Prospect, the same
 * two doors and the same "never a caller-supplied customerId" rule — a second
 * copy of this would be a second place for that identity contract to drift.
 */
export async function resolveActor(
  credential: { sessionId?: string; returnToken?: string; accountSession?: true },
  res: Response,
  req: Request,
): Promise<FreeScanActor | null> {
  if (credential.sessionId) {
    const session = await resolveFlowSession(credential.sessionId, res);
    if (!session) return null;
    const tenant = await resolveConsentedTenant(session, res);
    if (!tenant) return null;
    const contact = await resolveSessionContact(session.id);
    return {
      customerId: tenant.id,
      checkoutSessionId: session.id,
      email: contact.email,
      fullName: contact.fullName,
      company: contact.company,
    };
  }

  if (!credential.returnToken && credential.accountSession === true) {
    const signedIn = await resolveAccountSession(req);
    if (!signedIn) {
      res.status(401).json({ error: "account_signin_required" });
      return null;
    }
    const { engagement, account } = signedIn;
    const contact = engagement.checkoutSessionId
      ? await resolveSessionContact(engagement.checkoutSessionId)
      : { ...(await resolveProspectContact(engagement.customerId)), company: null };
    return {
      customerId: engagement.customerId,
      checkoutSessionId: engagement.checkoutSessionId,
      // The address this account proved, which is the one it signs in with.
      email: account.email,
      fullName: contact.fullName,
      company: contact.company,
    };
  }

  const resolved = await resolveFreeScanReturnLink(credential.returnToken ?? "");
  if (!resolved.ok) {
    const status = resolved.reason === "invalid" ? 401 : resolved.reason === "expired" ? 410 : 403;
    res.status(status).json({ error: `link_${resolved.reason}` });
    return null;
  }
  const contact = await resolveProspectContact(resolved.customerId);
  return {
    customerId: resolved.customerId,
    checkoutSessionId: null,
    email: contact.email,
    fullName: contact.fullName,
    company: null,
  };
}

// ── GET /api/public/free-scan/sow ─────────────────────────────────────────────
// The read. `sessionId` on the query string matches #1358's own results route;
// a return-link caller sends its token in the body of the POST alias below,
// since a token must never reach an access log.

router.get("/public/free-scan/sow", sowLimiter, noStore, async (req: Request, res: Response) => {
  const sessionId = typeof req.query["sessionId"] === "string" ? req.query["sessionId"] : undefined;
  if (!sessionId) {
    res.status(400).json({ error: "session_invalid" });
    return;
  }
  await respondWithSow({ sessionId }, req, res);
});

// POST alias for the return-link door — same read, token in the body.
const readSchema = credentialSchema;

router.post("/public/free-scan/sow/read", sowLimiter, noStore, async (req: Request, res: Response) => {
  const parsed = readSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "credential_required" });
    return;
  }
  await respondWithSow(parsed.data, req, res);
});

async function respondWithSow(
  credential: { sessionId?: string; returnToken?: string; accountSession?: true },
  req: Request,
  res: Response,
): Promise<void> {
  const actor = await resolveActor(credential, res, req);
  if (!actor) return;

  try {
    const row = await loadOrCreateEngagement(actor);
    res.json(await sowForEngagement(row));
  } catch (err) {
    log.error({ err, customerId: actor.customerId }, "free-scan SOW: read failed");
    res.status(500).json({ error: "sow_failed" });
  }
}

// ── PUT /api/public/free-scan/sow/scope ───────────────────────────────────────

const scopeSchema = credentialSchema.and(
  z.object({
    // WHICH phases, never what they cost. Bounded to the real phase set.
    phaseSlugs: z.array(z.string().trim().min(1).max(120)).max(FREE_SCAN_SOW_PHASE_SLUGS.length),
    addons: z
      .array(
        z.object({
          addonId: z.string().trim().min(1).max(60),
          tierId: z.string().trim().min(1).max(60),
        }),
      )
      .max(8)
      .default([]),
    paymentPlan: z.enum(["full", "phased"]),
  }),
);

router.put("/public/free-scan/sow/scope", sowLimiter, noStore, async (req: Request, res: Response) => {
  const parsed = scopeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "scope_invalid" });
    return;
  }

  const actor = await resolveActor(parsed.data, res, req);
  if (!actor) return;

  try {
    const row = await loadOrCreateEngagement(actor);
    if (row.signedAt) {
      res.status(409).json({ error: "scope_locked" });
      return;
    }

    const selection = normaliseRequestedSelection({
      phaseSlugs: parsed.data.phaseSlugs,
      addons: parsed.data.addons,
      paymentPlan: parsed.data.paymentPlan,
    });

    const [updated] = await db
      .update(freeScanEngagementsTable)
      .set({
        selectedPhaseSlugs: selection.phaseSlugs,
        selectedAddons: selection.addons,
        paymentPlan: selection.paymentPlan,
        updatedAt: new Date(),
      })
      .where(eq(freeScanEngagementsTable.id, row.id))
      .returning();

    res.json(await sowForEngagement(updated ?? row));
  } catch (err) {
    log.error({ err, customerId: actor.customerId }, "free-scan SOW: scope write failed");
    res.status(500).json({ error: "scope_write_failed" });
  }
});

// ── POST /api/public/free-scan/sow/sign ───────────────────────────────────────
// Signature comes before payment, per the document's own terms. The whole
// signature block lands in one write (the table's own CHECK enforces that a
// signed row is never partial), the scope locks, and the computed SOW is
// snapshotted so the figures the customer agreed to cannot later drift.

const signSchema = credentialSchema.and(
  z.object({
    signerName: z.string().trim().min(2).max(200),
    signerRole: z.string().trim().min(2).max(200),
    // A drawn-signature PNG data URL, or the typed name rendered as one.
    signatureData: z.string().min(1).max(400_000),
    agreed: z.literal(true),
  }),
);

router.post("/public/free-scan/sow/sign", sowLimiter, noStore, async (req: Request, res: Response) => {
  const parsed = signSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "signature_invalid" });
    return;
  }

  const actor = await resolveActor(parsed.data, res, req);
  if (!actor) return;

  try {
    const row = await loadOrCreateEngagement(actor);
    if (row.signedAt) {
      // Already executed — idempotent, and never re-signed with new details.
      res.json(await sowForEngagement(row));
      return;
    }

    // Snapshot the document as it stands right now: this is what is being signed.
    const computed = await buildFreeScanSow(row.customerId, selectionFromRow(row), {
      reference: row.sowReference,
      signature: { signed: false, signedAt: null, signerName: null, signerRole: null },
      status: "draft",
    });
    if (computed.status !== "ready") {
      res.status(409).json({ error: "scan_not_ready" });
      return;
    }

    const now = new Date();
    const [updated] = await db
      .update(freeScanEngagementsTable)
      .set({
        signerName: parsed.data.signerName,
        signerRole: parsed.data.signerRole,
        signatureData: parsed.data.signatureData,
        signatureIp: req.ip ?? null,
        termsAcceptedAt: now,
        signedAt: now,
        signedSowSnapshot: computed.sow,
        agreedServicesCents: computed.sow.totals.servicesGrossCents,
        agreedRecurringMonthlyCents: computed.sow.totals.recurringMonthlyCents,
        chargedCents: computed.sow.totals.chargedNowCents,
        depositPct: computed.sow.totals.depositPct,
        status: "signed",
        updatedAt: now,
      })
      .where(eq(freeScanEngagementsTable.id, row.id))
      .returning();

    await createAuditLog({
      actorUserId: null,
      actorName: "public:free-scan",
      actorRole: "client",
      actionType: "free_scan_sow_signed",
      entityType: "free_scan_engagement",
      entityId: String(row.id),
      tenantId: row.customerId,
      metadata: {
        sowReference: row.sowReference,
        phaseSlugs: computed.sow.selection.phaseSlugs,
        paymentPlan: computed.sow.selection.paymentPlan,
        agreedServicesCents: computed.sow.totals.servicesGrossCents,
        chargedCents: computed.sow.totals.chargedNowCents,
      },
    });

    log.info(
      {
        customerId: row.customerId,
        engagementId: row.id,
        sowReference: row.sowReference,
        phases: computed.sow.totals.phasesSelected,
        chargedCents: computed.sow.totals.chargedNowCents,
      },
      "free-scan SOW: signed",
    );

    res.json(await sowForEngagement(updated ?? row));
  } catch (err) {
    log.error({ err, customerId: actor.customerId }, "free-scan SOW: signature write failed");
    res.status(500).json({ error: "signature_write_failed" });
  }
});

// ── Payment ───────────────────────────────────────────────────────────────────

/**
 * The amount this engagement is charged TODAY, re-resolved from the signed
 * snapshot rather than from the request or from a live recompute: once signed,
 * the agreed figure is what Stripe is asked for, even if the catalog moves.
 */
function chargeAmountCents(row: FreeScanEngagement): number {
  return typeof row.chargedCents === "number" ? row.chargedCents : 0;
}

/** Stripe Customer for the charge, or null — never blocks the sale. */
async function resolveEngagementCustomerId(
  stripe: import("stripe").Stripe,
  row: FreeScanEngagement,
  actor: FreeScanActor,
): Promise<string | null> {
  const [tenant] = await db
    .select({ tenantGuid: tenantsTable.tenantId })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, row.customerId))
    .limit(1);
  if (!tenant?.tenantGuid || !actor.email) return null;
  try {
    return await ensureFlowStripeCustomer(stripe, {
      tenantRowId: row.customerId,
      tenantGuid: tenant.tenantGuid,
      email: actor.email,
      fullName: actor.fullName ?? actor.email,
      company: actor.company,
    });
  } catch (err) {
    log.error(
      { err, customerId: row.customerId, engagementId: row.id },
      "free-scan SOW payment: Stripe customer could not be resolved — falling back to an anonymous PaymentIntent",
    );
    return null;
  }
}

const paymentIntentSchema = credentialSchema;

router.post("/public/free-scan/sow/payment-intent", sowLimiter, noStore, async (req: Request, res: Response) => {
  const parsed = paymentIntentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "credential_required" });
    return;
  }

  const actor = await resolveActor(parsed.data, res, req);
  if (!actor) return;

  const row = await loadOrCreateEngagement(actor);
  if (!row.signedAt) {
    // The document's own terms: signature first, then payment.
    res.status(409).json({ error: "signature_required" });
    return;
  }

  const amountCents = chargeAmountCents(row);
  if (amountCents <= 0) {
    log.error({ engagementId: row.id }, "free-scan SOW payment: signed engagement resolved to a zero charge");
    res.status(409).json({ error: "price_unresolved" });
    return;
  }

  const publishableKey = getStripePublishableKey();
  if (!publishableKey) {
    log.error({}, "free-scan SOW payment: STRIPE_PUBLISHABLE_KEY is not configured");
    res.status(503).json({ error: "payment_unavailable" });
    return;
  }

  let stripeKey: string;
  try {
    stripeKey = getStripeKey();
  } catch (err) {
    log.error({ err }, "free-scan SOW payment: Stripe secret key is not configured");
    res.status(503).json({ error: "payment_unavailable" });
    return;
  }

  try {
    const { default: Stripe } = await import("stripe");
    const stripe = new Stripe(stripeKey);
    const customerId = await resolveEngagementCustomerId(stripe, row, actor);

    // Recurring optional services (Monitoring, Retainer) bill monthly from
    // kickoff, so the card is kept on file for the later subscription — the
    // same #490 sequencing public-purchase-payment.ts uses, with Stripe's own
    // mandate text as the disclosure. Subscription creation itself is
    // provisioning work, out of scope here.
    const saveCard = (row.agreedRecurringMonthlyCents ?? 0) > 0 && !!customerId;

    const shape = createHash("sha256")
      .update(chargeShapeKey(row, amountCents, !!customerId) + (saveCard ? "|save" : "|nosave"))
      .digest("hex")
      .slice(0, 16);

    const intent = await stripe.paymentIntents.create(
      {
        amount: amountCents,
        currency: "usd",
        automatic_payment_methods: { enabled: true },
        ...(customerId ? { customer: customerId } : {}),
        ...(saveCard ? { setup_future_usage: "off_session" as const } : {}),
        ...(actor.email ? { receipt_email: actor.email } : {}),
        description: `Statement of Work ${row.sowReference}${actor.company ? ` — ${actor.company}` : ""}`,
        metadata: {
          flow: FREE_SCAN_SOW_FLOW_TAG,
          engagementId: String(row.id),
          customerId: String(row.customerId),
          sowReference: row.sowReference,
          paymentPlan: row.paymentPlan,
          phaseSlugs: (row.selectedPhaseSlugs ?? []).join(","),
          checkoutSessionId: row.checkoutSessionId ?? "",
          agreedServicesCents: String(row.agreedServicesCents ?? 0),
          recurringMonthlyCents: String(row.agreedRecurringMonthlyCents ?? 0),
        },
      },
      { idempotencyKey: `free-scan-sow:pi:${row.id}:${shape}` },
    );

    log.info(
      {
        customerId: row.customerId,
        engagementId: row.id,
        paymentIntentId: intent.id,
        amountCents,
        paymentPlan: row.paymentPlan,
        status: intent.status,
      },
      "free-scan SOW payment: PaymentIntent ready",
    );

    res.json({
      clientSecret: intent.client_secret,
      publishableKey,
      paymentIntentId: intent.id,
      amountCents,
      paymentPlan: row.paymentPlan,
      recurringMonthlyCents: row.agreedRecurringMonthlyCents ?? 0,
      alreadyPaid: intent.status === "succeeded",
    });
  } catch (err) {
    log.error({ err, engagementId: row.id }, "free-scan SOW payment: PaymentIntent creation failed");
    res.status(500).json({ error: "payment_intent_failed" });
  }
});

const paymentConfirmedSchema = credentialSchema.and(
  z.object({ paymentIntentId: z.string().min(1).max(200) }),
);

router.post("/public/free-scan/sow/payment-confirmed", sowLimiter, noStore, async (req: Request, res: Response) => {
  const parsed = paymentConfirmedSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "paymentIntentId is required" });
    return;
  }

  const actor = await resolveActor(parsed.data, res, req);
  if (!actor) return;

  const row = await loadOrCreateEngagement(actor);

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

    if (intent.metadata?.["engagementId"] !== String(row.id)) {
      log.warn(
        { engagementId: row.id, paymentIntentId: intent.id, metaEngagementId: intent.metadata?.["engagementId"] },
        "free-scan SOW payment: REFUSED — PaymentIntent belongs to a different engagement",
      );
      res.status(403).json({ error: "intent_engagement_mismatch" });
      return;
    }

    if (intent.metadata?.["flow"] !== FREE_SCAN_SOW_FLOW_TAG) {
      log.warn(
        { engagementId: row.id, paymentIntentId: intent.id, metaFlow: intent.metadata?.["flow"] },
        "free-scan SOW payment: REFUSED — PaymentIntent was not created by this flow",
      );
      res.status(403).json({ error: "intent_flow_mismatch" });
      return;
    }

    if (intent.status !== "succeeded") {
      res.status(409).json({ error: "payment_not_succeeded", status: intent.status });
      return;
    }

    const now = new Date();
    const [updated] = await db
      .update(freeScanEngagementsTable)
      .set({
        status: "paid",
        paidAt: row.paidAt ?? now,
        stripePaymentIntentId: intent.id,
        // The charged figure is always the intent's own, never re-derived.
        chargedCents: intent.amount,
        updatedAt: now,
      })
      .where(eq(freeScanEngagementsTable.id, row.id))
      .returning();

    await createAuditLog({
      actorUserId: null,
      actorName: "public:free-scan",
      actorRole: "client",
      actionType: "free_scan_sow_paid",
      entityType: "free_scan_engagement",
      entityId: String(row.id),
      tenantId: row.customerId,
      metadata: {
        sowReference: row.sowReference,
        paymentPlan: row.paymentPlan,
        paymentIntentId: intent.id,
        amountCents: intent.amount,
      },
    });

    log.info(
      { customerId: row.customerId, engagementId: row.id, paymentIntentId: intent.id, amountCents: intent.amount },
      "free-scan SOW payment: confirmed",
    );

    res.json(await sowForEngagement(updated ?? row));
  } catch (err) {
    log.error({ err, engagementId: row.id }, "free-scan SOW payment: confirm failed");
    res.status(500).json({ error: "payment_confirm_failed" });
  }
});

export default router;
