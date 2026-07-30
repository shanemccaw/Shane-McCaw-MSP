import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  servicesTable,
  usersTable,
  workflowTemplateStepsTable,
  checkoutSessionsTable,
  resultsTemplatesTable,
  type ServiceAssociatedDocument,
} from "@workspace/db";
import { and, asc, eq, inArray, gte, isNull, desc, sql } from "drizzle-orm";
import { z } from "zod";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { checkoutVerificationCodesTable } from "@workspace/db";
import { resolveCatalogPricing, isServiceFree } from "../lib/catalog-pricing";
import { ensureAssessmentFunnelLead } from "../lib/crm-pipeline";
import { ensureClientSetupToken } from "../lib/client-setup-token";
import { ensureClientVerificationCode, sendVerificationCodeEmail, VERIFICATION_CODE_MAX_ATTEMPTS } from "../lib/checkout-verification-code";

const router: IRouter = Router();

// Strips associatedDocuments down to only the customer-visible entries, and to
// only the fields a public response needs (title + category) — docType is an
// internal generator key and customerVisible is redundant once filtered.
// customerVisible === false entries ground the SOW's accuracy but are never
// meant for customers; they must never reach a public route's response.
function toPublicAssociatedDocuments(
  docs: ServiceAssociatedDocument[] | null,
): { title: string; category: "report" | "consulting" }[] {
  if (!docs) return [];
  return docs
    .filter((d) => d.customerVisible === true)
    .map((d) => ({ title: d.title, category: d.category }));
}

router.get("/services", async (req: Request, res: Response) => {
  try {
    const { type, category } = req.query as { type?: string; category?: string };
    const conditions = [eq(servicesTable.visibility, "public")];
    if (type) {
      conditions.push(eq(servicesTable.serviceType, type));
    }
    if (category) {
      conditions.push(eq(servicesTable.category, category));
    }
    // Explicit column list (mirrors /catalog/assessments below) rather than a
    // bare .select() — a bare select pulls every column declared on
    // servicesTable, including admin-only columns added via a manual/ SQL
    // migration that may not have been run against this DB yet. This public
    // storefront route shouldn't 500 the entire catalogue when one of those
    // columns is pending a manual migration. associatedDocuments IS safe to
    // include here (its migration has landed) but every entry is filtered to
    // customerVisible below before the response is sent — the rest are
    // internal-only (they exist to ground the SOW's accuracy) and must never
    // reach this public route's response.
    const services = await db
      .select({
        id: servicesTable.id,
        slug: servicesTable.slug,
        name: servicesTable.name,
        description: servicesTable.description,
        category: servicesTable.category,
        deliverables: servicesTable.deliverables,
        price: servicesTable.price,
        basePrice: servicesTable.basePrice,
        maxPrice: servicesTable.maxPrice,
        priceCents: servicesTable.priceCents,
        internalCostCents: servicesTable.internalCostCents,
        turnaround: servicesTable.turnaround,
        durationDays: servicesTable.durationDays,
        billingType: servicesTable.billingType,
        serviceType: servicesTable.serviceType,
        tagline: servicesTable.tagline,
        targetAudience: servicesTable.targetAudience,
        inclusions: servicesTable.inclusions,
        features: servicesTable.features,
        badge: servicesTable.badge,
        highlighted: servicesTable.highlighted,
        hoursPerMonth: servicesTable.hoursPerMonth,
        iconName: servicesTable.iconName,
        pageHref: servicesTable.pageHref,
        pageSlug: servicesTable.pageSlug,
        sortOrder: servicesTable.sortOrder,
        tier: servicesTable.tier,
        workflowTemplateId: servicesTable.workflowTemplateId,
        overviewPdfKey: servicesTable.overviewPdfKey,
        bestFor: servicesTable.bestFor,
        triggers: servicesTable.triggers,
        fulfillmentTypeKey: servicesTable.fulfillmentTypeKey,
        isFreeOffering: servicesTable.isFreeOffering,
        typeAttributes: servicesTable.typeAttributes,
        associatedDocuments: servicesTable.associatedDocuments,
      })
      .from(servicesTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(asc(servicesTable.sortOrder), asc(servicesTable.createdAt));

    // Collect unique workflow template IDs that have linked services
    const templateIds = services
      .map((s) => s.workflowTemplateId)
      .filter((id): id is number => id != null);

    // workflowTasks: top-level steps (phases) per template, ordered by step order
    const workflowTasksByTemplateId = new Map<
      number,
      Array<{ title: string; description: string | null; order: number }>
    >();

    if (templateIds.length > 0) {
      const steps = await db
        .select({
          workflowTemplateId: workflowTemplateStepsTable.workflowTemplateId,
          title: workflowTemplateStepsTable.title,
          description: workflowTemplateStepsTable.description,
          order: workflowTemplateStepsTable.order,
        })
        .from(workflowTemplateStepsTable)
        .where(inArray(workflowTemplateStepsTable.workflowTemplateId, templateIds))
        .orderBy(asc(workflowTemplateStepsTable.order));

      for (const step of steps) {
        const list = workflowTasksByTemplateId.get(step.workflowTemplateId) ?? [];
        list.push({ title: step.title, description: step.description, order: step.order });
        workflowTasksByTemplateId.set(step.workflowTemplateId, list);
      }
    }

    res.json(
      services.map((s) => {
        const wfSteps = s.workflowTemplateId
          ? (workflowTasksByTemplateId.get(s.workflowTemplateId) ?? [])
          : [];
        return {
          ...s,
          hasPdf: s.overviewPdfKey != null,
          workflowTasks: wfSteps,
          workflowSummary: wfSteps.map(({ title, description }) => ({ title, description })),
          associatedDocuments: toPublicAssociatedDocuments(s.associatedDocuments),
          ...resolveCatalogPricing({
            priceCents: s.priceCents ?? 0,
            internalCostCents: s.internalCostCents,
          }),
        };
      })
    );
  } catch {
    res.status(500).json({ error: "Failed to fetch services" });
  }
});

// ── UUID detector (checkout session IDs are v4 UUIDs) ─────────────────────────
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── POST /api/public/checkout-session ─────────────────────────────────────────
// Creates a server-side checkout session; returns only the sessionId.
// The client stores only the UUID so PII survives origin-crossing redirects.

const createSessionSchema = z.object({
  productSlug: z.string().min(1, "productSlug is required"),
  fullName: z.string().min(1, "fullName is required"),
  email: z.string().email("email must be a valid email address"),
  // Company/industry (#142): the buyer's ORGANIZATION — becomes the tenant's
  // identity (tenants.customerName/industry), not the individual filling out
  // the form. See resolveOrCreateDirectTenant in portal.ts.
  company: z.string().min(1, "company is required"),
  industry: z.string().min(1, "industry is required"),
  seats: z.number().int().min(1).default(1),
  // GA4's client_id (#116). Optional: no client-side GA4 instrumentation
  // exists yet in this monorepo (#115), so no real caller sends this today.
  ga4ClientId: z.string().trim().max(200).optional(),
});

router.post("/public/checkout-session", async (req: Request, res: Response) => {
  const parsed = createSessionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid request" });
    return;
  }

  const { productSlug, fullName, email, company, industry, seats, ga4ClientId } = parsed.data;
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  const [row] = await db
    .insert(checkoutSessionsTable)
    .values({ productSlug, fullName, email, company, industry, seats, expiresAt })
    .returning({ id: checkoutSessionsTable.id });

  // Top-of-funnel lead capture: the visitor has entered a real name + email. Record
  // it as a real Lead now, before they proceed to (or bounce from) M365 consent —
  // a bounced lead is still trackable, remarketable data. Converts to a Prospect
  // account at consent time (see provisionProspectAccount / convertLeadForClient).
  // Fire-and-forget, non-fatal — must never block session creation.
  void ensureAssessmentFunnelLead(email, fullName, company, ga4ClientId);

  res.json({ sessionId: row.id });
});

// ── GET /api/public/checkout-session/:id ──────────────────────────────────────
// Returns only non-PII fields: productSlug and status.
// The client caches name/email in localStorage alongside the sessionId so
// they survive cross-origin redirects without the server ever exposing PII on
// this public endpoint.
// Returns 404 if not found or expired.

router.get("/public/checkout-session/:id", async (req: Request, res: Response) => {
  const id = req.params["id"] as string;
  if (!UUID_RE.test(id)) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const now = new Date();
  const [row] = await db
    .select({
      productSlug: checkoutSessionsTable.productSlug,
      status: checkoutSessionsTable.status,
      seats: checkoutSessionsTable.seats,
      email: checkoutSessionsTable.email,
    })
    .from(checkoutSessionsTable)
    .where(and(eq(checkoutSessionsTable.id, id), gte(checkoutSessionsTable.expiresAt, now)))
    .limit(1);

  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  // hasPassword (#143): lets the checkout confirmed step show "log in" instead
  // of the code-verification UI for a returning buyer — the Stripe webhook only
  // emails a code to passwordless accounts, so without this signal the paid
  // return path would claim a code email that never comes. Boolean only, gated
  // by the unguessable session UUID; the email itself is still never exposed.
  const [acct] = await db
    .select({ passwordHash: usersTable.passwordHash })
    .from(usersTable)
    .where(eq(usersTable.email, row.email.toLowerCase().trim()))
    .limit(1);

  res.json({
    productSlug: row.productSlug,
    status: row.status,
    seats: row.seats,
    hasPassword: !!acct?.passwordHash,
  });
});

// ─── PUBLIC CHECKOUT: 6-digit code verification (#143) ────────────────────────
// Both endpoints are keyed by the public checkout-session UUID — the same
// unguessable identifier the checkout's confirmed step already holds in
// sessionStorage (see /public/checkout-session above). The UUID gates remote
// attackers: without it neither endpoint reveals whether an email/account
// exists, and codes can only be tried against the session's own buyer. Codes
// verify here, then flow into the UNCHANGED /auth/setup-password endpoint via a
// normal account-setup token minted by ensureClientSetupToken.

// Per-IP throttle on the public verify/resend endpoints (they take no auth and
// resolve an attacker-suppliable checkout-session UUID to an account). Bounds
// code brute-force and verification-email flooding beyond the per-code cap and
// resend cooldown. Mirrors auth.ts's loginLimiter shape.
const verificationCodeLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: process.env.NODE_ENV === "development" ? 200 : 12,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many attempts. Please wait a minute and try again." },
});

/** Resolves a live checkout session to the buyer account behind its email. */
async function resolveVerificationTarget(sessionId: string): Promise<
  | { ok: true; user: { id: number; email: string; name: string | null; passwordHash: string | null }; productSlug: string }
  | { ok: false }
> {
  if (!UUID_RE.test(sessionId)) return { ok: false };
  const [cs] = await db
    .select({ email: checkoutSessionsTable.email, productSlug: checkoutSessionsTable.productSlug })
    .from(checkoutSessionsTable)
    .where(and(eq(checkoutSessionsTable.id, sessionId), gte(checkoutSessionsTable.expiresAt, new Date())))
    .limit(1);
  if (!cs) return { ok: false };
  const [user] = await db
    .select({ id: usersTable.id, email: usersTable.email, name: usersTable.name, passwordHash: usersTable.passwordHash })
    .from(usersTable)
    .where(eq(usersTable.email, cs.email.toLowerCase().trim()))
    .limit(1);
  if (!user) return { ok: false };
  return { ok: true, user, productSlug: cs.productSlug };
}

// POST /api/public/checkout/verify-code — the gate in front of /auth/setup-password.
// Correct code → consume the row, mint a normal account-setup token, return it.
// Wrong code → increment attemptCount; the 3rd strike locks the free flow
// (buyer restarts checkout) or auto-resends a fresh code for paid buyers, who
// must never be dead-ended after paying (behavior confirmed with Shane, #143).
router.post("/public/checkout/verify-code", verificationCodeLimiter, async (req: Request, res: Response) => {
  try {
    const { sessionId, code } = req.body as { sessionId?: string; code?: string };
    if (typeof sessionId !== "string" || typeof code !== "string" || !/^\d{6}$/.test(code)) {
      res.status(400).json({ ok: false, reason: "invalid_session" });
      return;
    }
    const target = await resolveVerificationTarget(sessionId);
    if (!target.ok) { res.status(400).json({ ok: false, reason: "invalid_session" }); return; }
    const { user } = target;
    if (user.passwordHash) { res.json({ ok: false, reason: "already_set" }); return; }

    // The whole check→compare→increment runs under the per-user advisory lock
    // (namespace 43084, same as the code mint) so the 3-attempt cap is EXACT: a
    // burst of parallel guesses serializes here instead of each reading the same
    // stale attemptCount and getting a bcrypt comparison against one code. The
    // account-setup token mint and the paid 3-strike resend are deferred until
    // AFTER this transaction commits — both take their own advisory locks
    // (43083 / 43084) on separate connections, so calling them inside would
    // deadlock against the lock this transaction still holds.
    type VerifyOutcome =
      | { kind: "match" }
      | { kind: "resend" }
      | { kind: "reason"; reason: string; attemptsRemaining?: number };
    const outcome: VerifyOutcome = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(43084, ${user.id})`);
      const [row] = await tx.select().from(checkoutVerificationCodesTable)
        .where(and(eq(checkoutVerificationCodesTable.userId, user.id), isNull(checkoutVerificationCodesTable.consumedAt)))
        .orderBy(desc(checkoutVerificationCodesTable.createdAt))
        .limit(1);
      if (!row) return { kind: "reason", reason: "expired" };
      if (row.purchaseType === "free" && row.attemptCount >= VERIFICATION_CODE_MAX_ATTEMPTS) {
        return { kind: "reason", reason: "locked" };
      }
      if (row.expiresAt < new Date()) return { kind: "reason", reason: "expired" };

      if (await bcrypt.compare(code, row.codeHash)) {
        await tx.update(checkoutVerificationCodesTable)
          .set({ consumedAt: new Date() })
          .where(eq(checkoutVerificationCodesTable.id, row.id));
        return { kind: "match" };
      }

      const attempts = row.attemptCount + 1;
      await tx.update(checkoutVerificationCodesTable)
        .set({ attemptCount: attempts })
        .where(eq(checkoutVerificationCodesTable.id, row.id));
      if (attempts >= VERIFICATION_CODE_MAX_ATTEMPTS) {
        // Paid buyers are never dead-ended: signal a fresh-code resend (done
        // after commit). Free buyers lock; the tombstone row survives and only
        // a captcha-gated checkout restart re-mints.
        return row.purchaseType === "paid"
          ? { kind: "resend" }
          : { kind: "reason", reason: "locked" };
      }
      return { kind: "reason", reason: "incorrect", attemptsRemaining: VERIFICATION_CODE_MAX_ATTEMPTS - attempts };
    });

    if (outcome.kind === "match") {
      const { token } = await ensureClientSetupToken(user.id);
      res.json({ ok: true, setupToken: token });
      return;
    }
    if (outcome.kind === "resend") {
      const minted = await ensureClientVerificationCode(user.id, "paid", { force: true });
      if (minted.sent) sendVerificationCodeEmail(user.email, user.name ?? user.email, minted.code, req.log);
      res.json({ ok: false, reason: "resent" });
      return;
    }
    res.json({
      ok: false,
      reason: outcome.reason,
      ...(outcome.attemptsRemaining != null ? { attemptsRemaining: outcome.attemptsRemaining } : {}),
    });
  } catch (err) {
    req.log.error({ err }, "public: checkout verify-code failed");
    res.status(500).json({ error: "Verification failed. Please try again." });
  }
});

// POST /api/public/checkout/resend-code — reissues a fresh code, carrying the
// existing row's purchaseType forward. Cooldown (60s, keyed on the latest ACTIVE
// row's createdAt inside ensureClientVerificationCode) prevents email spam; a
// free-flow lockout is terminal and only a captcha-gated checkout restart revives it.
//
// SECURITY: resend only ever REISSUES an already-minted code — it never mints
// the FIRST code for an account. The first code comes exclusively from a trusted
// provisioning path (provisionFreeOnboarding for free, the Stripe webhook for
// paid), which knows the true purchaseType. If resend minted the first code it
// would have to guess the type from the attacker-suppliable checkout-session
// productSlug: guessing 'paid' hands an attacker an unlockable code against any
// passwordless account (paid never locks) plus an email-flood primitive, and
// guessing 'free' would dead-end a real paying buyer who resends in the brief
// window before their webhook lands. So when no row exists yet we refuse to mint
// and tell the buyer their code is on the way — the trusted path emails it momentarily.
router.post("/public/checkout/resend-code", verificationCodeLimiter, async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.body as { sessionId?: string };
    if (typeof sessionId !== "string") { res.status(400).json({ ok: false, reason: "invalid_session" }); return; }
    const target = await resolveVerificationTarget(sessionId);
    if (!target.ok) { res.status(400).json({ ok: false, reason: "invalid_session" }); return; }
    const { user } = target;
    if (user.passwordHash) { res.json({ ok: false, reason: "already_set" }); return; }

    const [latest] = await db.select().from(checkoutVerificationCodesTable)
      .where(eq(checkoutVerificationCodesTable.userId, user.id))
      .orderBy(desc(checkoutVerificationCodesTable.createdAt))
      .limit(1);
    if (
      latest && !latest.consumedAt &&
      latest.purchaseType === "free" &&
      latest.attemptCount >= VERIFICATION_CODE_MAX_ATTEMPTS
    ) {
      res.json({ ok: false, reason: "locked" });
      return;
    }
    if (!latest) {
      // No trusted-minted code yet (paid buyer resending before the webhook
      // lands). Never mint here — see the SECURITY note above.
      res.json({ ok: false, reason: "not_ready" });
      return;
    }

    const minted = await ensureClientVerificationCode(user.id, latest.purchaseType);
    if (!minted.sent) {
      res.status(429).json({ ok: false, reason: "cooldown", retryAfterSeconds: minted.retryAfterSeconds });
      return;
    }
    sendVerificationCodeEmail(user.email, user.name ?? user.email, minted.code, req.log);
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "public: checkout resend-code failed");
    res.status(500).json({ error: "Could not resend the code. Please try again." });
  }
});

// ── GET /api/public/consent-url ───────────────────────────────────────────────
// Returns the Microsoft admin-consent URL.
// Optional ?sessionId=<uuid> — if present and the session resolves, the UUID is
// passed as the OAuth `state` parameter so the callback can reconnect the session.

router.get("/public/consent-url", async (req: Request, res: Response) => {
  const clientId = process.env.MT_APP_CLIENT_ID;
  if (!clientId) {
    res.json({ url: null });
    return;
  }

  const proto = req.headers["x-forwarded-proto"] ?? req.protocol;
  const host = req.headers["x-forwarded-host"] ?? req.headers.host;
  const redirectUri = `${proto}://${host}/api/consent/callback`;

  const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri });

  // Thread the checkout session ID through as OAuth `state` if provided and valid.
  //
  // HARD RULE: when a sessionId IS provided but cannot be resolved (bad UUID,
  // expired, or missing row), REFUSE to hand out a consent URL rather than
  // silently degrading to a state-less one. A consent completed via a state-less
  // URL reaches the callback with no `state`, which skips checkout-session
  // linking AND the consent-time Prospect provisioning entirely — the flow then
  // completes payment against an account with no msp_customers/msp_users bridge
  // (confirmed live: "Seven Hundred" paid-monitoring purchase, users.id=21).
  // The frontend treats { url: null, error } as "session expired — start over".
  const rawSessionId = req.query.sessionId as string | undefined;
  if (rawSessionId) {
    if (!UUID_RE.test(rawSessionId)) {
      req.log?.warn?.({ sessionId: rawSessionId }, "consent-url: sessionId is not a valid UUID — refusing to build a state-less consent URL");
      res.json({ url: null, error: "session_invalid" });
      return;
    }
    const now = new Date();
    const [sessionRow] = await db
      .select({ id: checkoutSessionsTable.id })
      .from(checkoutSessionsTable)
      .where(
        and(
          eq(checkoutSessionsTable.id, rawSessionId),
          gte(checkoutSessionsTable.expiresAt, now),
        ),
      )
      .limit(1);

    if (!sessionRow) {
      req.log?.warn?.({ sessionId: rawSessionId }, "consent-url: checkout session not found or expired — refusing to build a state-less consent URL");
      res.json({ url: null, error: "session_expired" });
      return;
    }
    params.set("state", rawSessionId);
  }

  const url = `https://login.microsoftonline.com/common/adminconsent?${params.toString()}`;
  res.json({ url });
});

// ── GET /api/catalog/assessments ──────────────────────────────────────────────
// Public endpoint — no auth required. Returns services where serviceType =
// 'assessment' AND isPublic = true, ordered by sortOrder ASC.
//
// resultsTemplateFamily: LEFT JOIN onto results_templates (#162, parent #161)
// so assessment-dashboard.tsx (msp-portal, #163) can route a product to the
// right results-template family without a second round-trip — this route was
// already the one fetch that page makes to resolve a serviceSlug to its
// catalogue row. Null for any product not yet mapped in the registry (or
// whose mapping is isActive: false), which callers must treat the same as
// "no family assigned" rather than an error.

router.get("/catalog/assessments", async (req: Request, res: Response) => {
  try {
    const rows = await db
      .select({
        id: servicesTable.id,
        slug: servicesTable.slug,
        name: servicesTable.name,
        tagline: servicesTable.tagline,
        description: servicesTable.description,
        badge: servicesTable.badge,
        highlighted: servicesTable.highlighted,
        price: servicesTable.price,
        basePrice: servicesTable.basePrice,
        maxPrice: servicesTable.maxPrice,
        sortOrder: servicesTable.sortOrder,
        features: servicesTable.features,
        deliverables: servicesTable.deliverables,
        inclusions: servicesTable.inclusions,
        turnaround: servicesTable.turnaround,
        targetAudience: servicesTable.targetAudience,
        durationDays: servicesTable.durationDays,
        category: servicesTable.category,
        fulfillmentTypeKey: servicesTable.fulfillmentTypeKey,
        isPublic: servicesTable.isPublic,
        isFreeOffering: servicesTable.isFreeOffering,
        priceCents: servicesTable.priceCents,
        internalCostCents: servicesTable.internalCostCents,
        associatedDocuments: servicesTable.associatedDocuments,
        resultsTemplateFamily: resultsTemplatesTable.family,
      })
      .from(servicesTable)
      .leftJoin(
        resultsTemplatesTable,
        and(
          eq(resultsTemplatesTable.serviceId, servicesTable.id),
          eq(resultsTemplatesTable.isActive, true),
        ),
      )
      .where(
        and(
          eq(servicesTable.serviceType, "assessment"),
          eq(servicesTable.isPublic, true),
        ),
      )
      .orderBy(asc(servicesTable.sortOrder));

    const assessmentOffers = rows.map((r) => {
      // Free-vs-paid MUST consider the canonical `priceCents`, not just the
      // legacy decimal price/basePrice columns. A paid assessment created via
      // the modern admin API has price/basePrice NULL with the real price only
      // in priceCents; deriving isFree from the legacy columns alone wrongly
      // marks it free, which routes the frontend to the Stripe-free checkout and
      // delivers a paid product for $0. isServiceFree() is the single source of
      // truth (shared with the server-side free-checkout guard).
      const isFree = isServiceFree(r);
      // Surface the real retail price for display when the legacy decimal
      // columns are null but priceCents is set, so the checkout page shows the
      // true price (e.g. "$250") for a modern-priced paid assessment rather than
      // "$0". Genuinely-free offers (priceCents 0/null) keep price = null.
      const price =
        r.price ??
        (r.priceCents != null && r.priceCents > 0
          ? (r.priceCents / 100).toFixed(2)
          : r.price);
      return {
        ...r,
        price,
        isFree,
        associatedDocuments: toPublicAssociatedDocuments(r.associatedDocuments),
        ...resolveCatalogPricing({
          priceCents: r.priceCents ?? 0,
          internalCostCents: r.internalCostCents,
        }),
      };
    });

    res.json(assessmentOffers);
  } catch {
    res.status(500).json({ error: "Failed to fetch assessments" });
  }
});

export default router;
