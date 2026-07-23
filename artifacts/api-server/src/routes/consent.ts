/**
 * Admin Consent Routes
 *
 * Handles the multi-tenant Microsoft admin-consent OAuth flow:
 *
 *   POST /api/consent/invite-link
 *     Admin (or MSPAdmin) generates a single-use invite link for a customer.
 *     Returns a signed URL they can send to the customer's Global Admin.
 *
 *   GET  /api/consent/callback
 *     Microsoft redirects here after the customer's admin approves (or declines).
 *     Burns the single-use token, upserts tenant_consent, redirects to a result page.
 *     Also handles checkout-session state (UUID) — marks the session consented.
 *
 *   GET  /api/consent/declined
 *     Shown when the admin clicked "No" at the Microsoft screen — never a blank page.
 *
 *   GET  /api/admin/consent
 *     List all tenant consent records (admin only).
 *
 *   PATCH /api/admin/consent/:tenantId/revoke
 *     Force-revoke a tenant's consent (admin only).
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { randomBytes, createHmac, timingSafeEqual } from "crypto";
import { db, tenantConsentTable, tenantWriteConsentTable, consentInviteTokensTable, checkoutSessionsTable, servicesTable, mspCustomersTable, mspsTable } from "@workspace/db";
import { eq, and, isNull, gte, desc, sql } from "drizzle-orm";
import { emitWorkflowEvent } from "../lib/workflow-executor.ts";
import { requireAdmin, requireRole } from "../middlewares/requireAuth.ts";
import { buildAdminConsentUrl, mtAppCredentialsPresent, REQUIRED_MT_SCOPES } from "../lib/graph.ts";
import { createAuditLog } from "../lib/audit.ts";
import { logger } from "../lib/logger.ts";
const log = logger.child({ channel: "auth" });

const router: IRouter = Router();

// UUID v4 pattern — checkout session IDs are UUIDs, invite tokens are 64-char hex.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Returns the protocol+host base (e.g. "https://example.replit.app") from request headers. */
function getHostBase(req: Request): string {
  const proto = req.headers["x-forwarded-proto"] ?? req.protocol;
  const host = req.headers["x-forwarded-host"] ?? req.headers.host;
  return `${proto}://${host}`;
}

/**
 * The redirect_uri sent to Microsoft as part of the OAuth consent request.
 * THIS VALUE MUST BE REGISTERED in the Azure App Registration → Authentication → Redirect URIs.
 * Exact format: https://<your-domain>/api/consent/callback
 */
function getCallbackUrl(req: Request): string {
  return `${getHostBase(req)}/api/consent/callback`;
}

// ── POST /api/consent/invite-link ──────────────────────────────────────────────

router.post("/consent/invite-link", requireAdmin, async (req: Request, res: Response) => {
  if (!mtAppCredentialsPresent()) {
    res.status(503).json({
      error: "Multi-tenant app credentials not configured (MT_APP_CLIENT_ID / MT_APP_CLIENT_SECRET)",
    });
    return;
  }

  const { tenantId, customerId, clientUserId, ttlHours = 72 } = req.body as {
    tenantId?: string;
    customerId?: number;
    clientUserId?: number;
    ttlHours?: number;
  };

  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + Math.min(Number(ttlHours) || 72, 168) * 60 * 60 * 1000);

  await db.insert(consentInviteTokensTable).values({
    token,
    tenantId: tenantId?.trim() || null,
    customerId: customerId ?? null,
    clientUserId: clientUserId ?? null,
    expiresAt,
  });

  const callbackUrl = getCallbackUrl(req);
  const tenantHint = tenantId?.trim() || "common";
  const consentUrl = buildAdminConsentUrl(tenantHint, token, callbackUrl, process.env.MT_APP_CLIENT_ID ?? "");

  await createAuditLog({
    actorUserId: req.user!.id,
    actorName: req.user!.email ?? "admin",
    actorRole: "admin",
    actionType: "consent_invite_created",
    entityType: "consent_invite",
    metadata: { tenantHint, customerId, clientUserId, expiresAt },
  });

  res.json({
    consentUrl,
    token,
    expiresAt,
    scopes: REQUIRED_MT_SCOPES,
  });
});

// ── POST /api/portal/consent/reconsent-link ────────────────────────────────────
//
// Customer-scoped equivalent of invite-link above, for a logged-in customer
// whose own tenant_consent has gone revoked/declined. Reuses the exact same
// invite-token + buildAdminConsentUrl mechanism — no second consent mechanism.
// tenantId/customerId are resolved server-side from the JWT, never trusted
// from the request body.
router.post("/portal/consent/reconsent-link", requireRole("Assessment"), async (req: Request, res: Response) => {
  if (!mtAppCredentialsPresent()) {
    res.status(503).json({
      error: "Multi-tenant app credentials not configured (MT_APP_CLIENT_ID / MT_APP_CLIENT_SECRET)",
    });
    return;
  }

  const customerId = (req.user as { customerId?: number } | undefined)?.customerId;
  if (typeof customerId !== "number" || Number.isNaN(customerId)) {
    res.status(403).json({ error: "No customer identity on token" });
    return;
  }

  const [customerRow] = await db
    .select({ tenantId: mspCustomersTable.tenantId })
    .from(mspCustomersTable)
    .where(eq(mspCustomersTable.id, customerId))
    .limit(1);

  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);

  await db.insert(consentInviteTokensTable).values({
    token,
    tenantId: customerRow?.tenantId?.trim() || null,
    customerId,
    clientUserId: req.user!.id,
    expiresAt,
  });

  const callbackUrl = getCallbackUrl(req);
  const tenantHint = customerRow?.tenantId?.trim() || "common";
  const consentUrl = buildAdminConsentUrl(tenantHint, token, callbackUrl, process.env.MT_APP_CLIENT_ID ?? "");

  await createAuditLog({
    actorUserId: req.user!.id,
    actorName: req.user!.email ?? "customer",
    actorRole: "client",
    actionType: "consent_invite_created",
    entityType: "consent_invite",
    metadata: { tenantHint, customerId, reconsent: true, expiresAt },
  });

  res.json({
    consentUrl,
    expiresAt,
    scopes: REQUIRED_MT_SCOPES,
  });
});

// ── GET /api/consent/callback ──────────────────────────────────────────────────

router.get("/consent/callback", async (req: Request, res: Response) => {
  const { tenant, admin_consent, state, error, error_subcode } = req.query as Record<string, string | undefined>;

  const hostBase = getHostBase(req);

  // Microsoft declined callback — surface a clear message
  if (error === "access_denied" || error_subcode === "cancel") {
    log.warn({ tenant, state, error, error_subcode }, "Consent callback: admin declined");

    if (state && !UUID_RE.test(state)) {
      // Burn the invite token on decline too
      await db
        .update(consentInviteTokensTable)
        .set({ usedAt: new Date() })
        .where(eq(consentInviteTokensTable.token, state));
    }

    if (tenant) {
      await db
        .insert(tenantConsentTable)
        .values({
          tenantId: tenant,
          consentStatus: "declined",
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: tenantConsentTable.tenantId,
          set: { consentStatus: "declined", updatedAt: new Date() },
        });
    }

    res.redirect(`${hostBase}/portal/consent/declined${tenant ? `?tenant=${encodeURIComponent(tenant)}` : ""}`);
    return;
  }

  // Success callback must include tenant + admin_consent=True
  if (!tenant || admin_consent?.toLowerCase() !== "true") {
    log.warn({ tenant, admin_consent, state }, "Consent callback: unexpected parameters");
    res.status(400).send("Invalid consent callback parameters.");
    return;
  }

  // Determine whether `state` is a checkout session UUID or an MSP invite token.
  const isCheckoutSession = !!state && UUID_RE.test(state);

  // ── Cross-MSP tenant boundary guard (direct self-service checkout path only) ──
  // A checkout session always belongs to the isDirectBusiness MSP (checkout_sessions
  // has no mspId column). If the Microsoft tenant that just consented is ALREADY
  // registered as a customer under a DIFFERENT MSP, letting this purchase proceed
  // would silently cross-link the buyer to that other MSP's customer record —
  // leaking its engine history, findings, and SOWs across the tenant boundary
  // (confirmed live: user 92 under mspId 89 saw customer 1's data under mspId 1).
  // Reject BEFORE marking the session consented and before payment ever happens.
  // Do not cross-link, do not create a duplicate customer. The equivalent check in
  // ensureClientMspUser (portal.ts) is a post-payment backstop for this same case.
  if (isCheckoutSession && state) {
    const [directMsp] = await db
      .select({ id: mspsTable.id })
      .from(mspsTable)
      .where(eq(mspsTable.isDirectBusiness, true))
      .limit(1);

    const [conflictingCustomer] = await db
      .select({ id: mspCustomersTable.id, mspId: mspCustomersTable.mspId })
      .from(mspCustomersTable)
      .where(eq(mspCustomersTable.tenantId, tenant))
      .limit(1);

    if (directMsp && conflictingCustomer && conflictingCustomer.mspId !== directMsp.id) {
      log.warn(
        {
          tenantId: tenant,
          sessionId: state,
          conflictingCustomerId: conflictingCustomer.id,
          existingMspId: conflictingCustomer.mspId,
          directMspId: directMsp.id,
        },
        "Consent callback: REJECTED cross-MSP tenant conflict — this Microsoft tenant is already connected to a customer under a different MSP; not marking the checkout session consented",
      );
      res.redirect(
        `${hostBase}/portal/consent/tenant-conflict?tenant=${encodeURIComponent(tenant)}`,
      );
      return;
    }
  }

  // Validate and burn the invite token (only for non-UUID state values)
  let inviteRecord: { customerId: number | null; clientUserId: number | null } | null = null;
  if (state && !isCheckoutSession) {
    const now = new Date();
    const [row] = await db
      .select({ customerId: consentInviteTokensTable.customerId, clientUserId: consentInviteTokensTable.clientUserId })
      .from(consentInviteTokensTable)
      .where(
        and(
          eq(consentInviteTokensTable.token, state),
          isNull(consentInviteTokensTable.usedAt),
          gte(consentInviteTokensTable.expiresAt, now),
        ),
      )
      .limit(1);

    if (!row) {
      log.warn({ state, tenant }, "Consent callback: invite token invalid, expired, or already used");
      res.status(400).send("This consent link has expired or has already been used. Please request a new link.");
      return;
    }

    inviteRecord = row;

    await db
      .update(consentInviteTokensTable)
      .set({ usedAt: now, tenantId: tenant })
      .where(eq(consentInviteTokensTable.token, state));
  }

  // Upsert tenant_consent record
  await db
    .insert(tenantConsentTable)
    .values({
      tenantId: tenant,
      customerId: inviteRecord?.customerId ?? null,
      clientUserId: inviteRecord?.clientUserId ?? null,
      consentStatus: "granted",
      consentedAt: new Date(),
      scopesGranted: [...REQUIRED_MT_SCOPES],
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: tenantConsentTable.tenantId,
      set: {
        consentStatus: "granted",
        consentedAt: new Date(),
        revokedAt: null,
        scopesGranted: [...REQUIRED_MT_SCOPES],
        updatedAt: new Date(),
        ...(inviteRecord?.customerId != null ? { customerId: inviteRecord.customerId } : {}),
        ...(inviteRecord?.clientUserId != null ? { clientUserId: inviteRecord.clientUserId } : {}),
      },
    });

  log.info({ tenant, customerId: inviteRecord?.customerId, isCheckoutSession }, "Tenant admin consent granted");

  // MSP-channel customers start "onboarding" and flip to "active" exactly on
  // consent granted (business rule, confirmed). Only applies to the invite-token
  // path (inviteRecord set) — direct website checkout customers are already
  // "active" from creation (see ensureDirectCustomerRecord in portal.ts) and
  // never go through this branch since isCheckoutSession customers have no
  // inviteRecord. Guarded to only flip customers currently "onboarding" so an
  // admin's deliberate "inactive"/"archived" status is never silently overwritten.
  if (inviteRecord?.customerId != null) {
    await db
      .update(mspCustomersTable)
      .set({ status: "active", updatedAt: new Date() })
      .where(
        and(
          eq(mspCustomersTable.id, inviteRecord.customerId),
          eq(mspCustomersTable.status, "onboarding"),
        ),
      )
      .catch((err: unknown) => {
        log.warn({ err, customerId: inviteRecord?.customerId }, "Consent callback: failed to flip customer status to active (non-fatal)");
      });
  }

  // If the state was a checkout session UUID, mark it consented and thread it
  // into the redirect so ConsentSuccessPage can show the "Continue to payment" CTA.
  let successRedirect = `${hostBase}/portal/consent/success?tenant=${encodeURIComponent(tenant)}`;
  // Hoisted so the consent.granted emission block below can read slug + email without a second DB round-trip.
  let updatedSession: { id: string; email: string; fullName: string; productSlug: string } | undefined;

  if (isCheckoutSession && state) {
    const now = new Date();
    [updatedSession] = await db
      .update(checkoutSessionsTable)
      .set({
        status: "consented",
        tenantId: tenant,
        updatedAt: now,
      })
      .where(
        and(
          eq(checkoutSessionsTable.id, state),
          gte(checkoutSessionsTable.expiresAt, now),
        ),
      )
      .returning({
        id: checkoutSessionsTable.id,
        email: checkoutSessionsTable.email,
        fullName: checkoutSessionsTable.fullName,
        productSlug: checkoutSessionsTable.productSlug,
      });

    if (updatedSession) {
      // Copy the session admin email onto the tenant_consent row so it's available for provisioning
      await db
        .update(tenantConsentTable)
        .set({ adminEmail: updatedSession.email, updatedAt: new Date() })
        .where(eq(tenantConsentTable.tenantId, tenant))
        .catch(() => {
          // adminEmail column may not exist in all environments — non-fatal
        });

      successRedirect += `&session=${encodeURIComponent(state)}`;
      log.info({ sessionId: state, tenant }, "Checkout session marked consented via consent callback");
    } else {
      log.warn({ sessionId: state, tenant }, "Consent callback: checkout session not found or expired — redirect proceeds without session");
    }
  }

  // ── Provision the Prospect account + emit consent.granted workflow event ─────
  // Core structural fix: for the direct-business self-service funnel (checkout-
  // session path), the real account is created HERE, at consent time — not
  // deferred to password setup or the later free/paid provisioning. That makes the
  // account exist and be admin-recoverable (/auth/forgot-password) the instant
  // consent is granted, gives consent.granted a real clientId to carry (so the
  // "Run Assessment" scan workflow actually fires for genuinely free orders), and
  // associates the fresh diagnostics run with the customer directly.
  //
  // Runs for both paths (invite-link and checkout-session). Skips emission with a
  // warning rather than crashing the redirect flow if context is unresolvable.
  let resolvedPackageKey = "core:security-baseline";
  let prospectCustomerId: number | null = null;
  try {
    // clientId: from invite token (invite-link path) or the Prospect we create below (checkout-session path)
    let clientId: number | null = inviteRecord?.clientUserId ?? null;
    // packageKey from the ordered product; falls back to the canonical baseline
    // scan when the product declares none (assessment products typically don't) —
    // so the consent.granted event ALWAYS carries a real, resolvable package key
    // rather than being silently skipped (the historical free-order bug).
    let packageKey: string | null = null;

    if (isCheckoutSession && state) {
      // Re-fetch the session if the update didn't match (expired/not found) — we still want
      // packageKey + email even if updatedSession is null.
      let productSlug: string | null = null;
      let sessionEmail: string | null = null;
      let sessionFullName: string | null = null;

      if (updatedSession) {
        productSlug = updatedSession.productSlug;
        sessionEmail = updatedSession.email;
        sessionFullName = updatedSession.fullName;
      } else {
        // Session not updated (expired or not found) — try a direct read
        const [existing] = await db
          .select({
            productSlug: checkoutSessionsTable.productSlug,
            email: checkoutSessionsTable.email,
            fullName: checkoutSessionsTable.fullName,
          })
          .from(checkoutSessionsTable)
          .where(eq(checkoutSessionsTable.id, state))
          .limit(1);
        productSlug = existing?.productSlug ?? null;
        sessionEmail = existing?.email ?? null;
        sessionFullName = existing?.fullName ?? null;
      }

      // Resolve packageKey + serviceType via services.type_attributes->>'packageKey'.
      // serviceType picks the Prospect's role: assessment products get the low-
      // privilege "Assessment" role (promoted to CustomerUser on payment); anything
      // else gets "CustomerUser" directly (a passwordless account can't log in until
      // setup, so this grants no premature access).
      let serviceType: string | null = null;
      if (productSlug) {
        const [svcRow] = await db
          .select({
            pk: sql<string>`type_attributes->>'packageKey'`,
            serviceType: servicesTable.serviceType,
          })
          .from(servicesTable)
          .where(eq(servicesTable.slug, productSlug))
          .limit(1);
        packageKey = svcRow?.pk ?? null;
        serviceType = svcRow?.serviceType ?? null;
      }

      // Create the real Prospect account NOW (users + msp_customers + msp_users),
      // converting the funnel-entry lead new → converted. Idempotent — the
      // downstream free-checkout / paid-webhook paths find it already linked.
      // Dynamic import mirrors the runDiagnostics import below — avoids pulling the
      // large portal.ts route module into consent.ts's static module graph (and any
      // circular-load ordering issues).
      if (sessionEmail) {
        const { provisionProspectAccount } = await import("./portal.js");
        const prospect = await provisionProspectAccount({
          email: sessionEmail,
          fullName: sessionFullName,
          tenantId: tenant,
          role: serviceType === "assessment" ? "Assessment" : "CustomerUser",
        });
        if (prospect) {
          clientId = prospect.userId;
          prospectCustomerId = prospect.customerId;
          log.info(
            { tenant, userId: prospect.userId, customerId: prospect.customerId, serviceType },
            "consent callback: provisioned Prospect account at consent time",
          );
          if (prospect.customerId == null) {
            // The users row exists but ensureDirectCustomerRecord/ensureClientMspUser
            // failed inside provisionProspectAccount (its own catch logs the cause).
            // Surface it loudly here too — this is exactly the state that produced
            // a paid, non-functional account ("Seven Hundred", users.id=21). The
            // Stripe webhook re-attempts the bridge and verifies+alerts on failure
            // (verifyCustomerBridge), so this is not the last line of defense, but
            // it must never pass silently.
            log.error(
              { tenant, sessionId: state, userId: prospect.userId },
              "consent callback: Prospect user was created WITHOUT an msp_customers bridge — customer provisioning failed; payment webhook will retry and alert",
            );
          }
        }
      } else {
        // A checkout-session consent with no resolvable email means NO account and
        // NO msp_customers/msp_users bridge is created here, and the paid webhook
        // used to assume this step had already run. Never skip this silently.
        log.error(
          { tenant, sessionId: state, hadUpdatedSession: !!updatedSession },
          "consent callback: checkout session resolved with NO email — Prospect provisioning SKIPPED; bridge now depends entirely on the payment webhook (which verifies and alerts)",
        );
      }
    }
    // invite-link path: clientId set from inviteRecord above; packageKey unavailable (no product context) → baseline fallback

    resolvedPackageKey = packageKey ?? "core:security-baseline";

    // The "Run Assessment" workflow resolves the client by clientId, so only emit
    // when we have one (checkout-session path always does now; invite-link path
    // only when the token carried a clientUserId).
    if (clientId == null) {
      log.warn(
        { tenant, isCheckoutSession, hasInviteRecord: inviteRecord != null },
        "consent.granted: no clientId resolved — skipping event emission",
      );
    } else {
      void emitWorkflowEvent("consent.granted", {
        tenantId: tenant,
        packageKey: resolvedPackageKey,
        clientId,
      });
      log.info({ tenant, packageKey: resolvedPackageKey, clientId }, "consent.granted: event emitted");
    }
  } catch (err) {
    // error (not warn): a failure here means the consent-time account/bridge
    // provisioning silently didn't happen — the exact precursor to a paid,
    // non-functional account. The redirect still proceeds (never strand the
    // buyer at Microsoft), but this must be loud and greppable.
    log.error({ err, tenant, sessionId: state }, "consent.granted: provisioning/emission FAILED — redirect proceeds, payment webhook must create the bridge");
  }

  // Fire-and-forget diagnostics run — must not delay the consent redirect.
  // Uses dynamic import to avoid circular-dependency issues at module load time.
  //
  // packageKey: when the ordered product declares a monitoring package
  // (services.type_attributes->>'packageKey'), run that. Otherwise fall through
  // to runDiagnostics' own canonical default ("core:security-baseline") by
  // passing undefined — do NOT pass a literal "default", which is not a real
  // monitoring_packages.key and makes executeMonitoringPackage return
  // runStatus:"no_checks" (an empty scan). This is the path that guarantees an
  // Assessment order — whose product type carries no packageKey unless an admin
  // sets one — still fires a real fresh deep scan. Every assessment order
  // triggers a fresh scan; there is no skip-if-recent guard anywhere in this
  // path, so prior scan data is never reused (idempotency is keyed per-run via
  // a unique triggerId, so it only dedupes retries of the SAME run).
  void (async () => {
    try {
      const { runDiagnostics } = await import("../lib/diagnostics-runner.js");
      await runDiagnostics({
        tenantId: tenant,
        // Pass the msp_customers id so the run is associated with the customer
        // directly. Invite-link path (Assessment/MSP-channel) carries it on the
        // token; checkout-session path now has the Prospect's customerId created
        // at consent time above. Without it, runDiagnostics resolves the customer
        // by tenantId, which orphans the run (customerId=null) when
        // msp_customers.tenant_id was not yet stamped — leaving the Assessment
        // wizard (scoped to the customerId JWT claim) unable to stream its own
        // scan until the purchase-time backfill runs, which a pure-assessment
        // customer may never reach.
        customerId: inviteRecord?.customerId ?? prospectCustomerId ?? undefined,
        packageKey: resolvedPackageKey ?? undefined,
        triggeredByUserId: undefined,
      });
      log.info(
        { tenant, packageKey: resolvedPackageKey ?? "core:security-baseline" },
        "consent.granted: diagnostics run started",
      );
    } catch (diagErr) {
      log.warn({ err: diagErr, tenant }, "consent.granted: diagnostics run failed (non-fatal)");
    }
  })();

  res.redirect(successRedirect);
});

// ── GET /api/consent/declined ──────────────────────────────────────────────────
// Fallback plain-text endpoint — the frontend consent/declined page handles
// the actual rendering; this is a safety net if the frontend is unreachable.

router.get("/consent/declined", (_req: Request, res: Response) => {
  res.status(200).send(`
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Consent Declined</title>
<style>body{font-family:sans-serif;max-width:600px;margin:80px auto;padding:0 20px;color:#1a1a2e}
h1{color:#dc3545}p{line-height:1.6}</style></head>
<body>
<h1>Consent Not Granted</h1>
<p>You chose not to grant the requested permissions. Your organisation will not be connected
to the platform until an admin approves the consent request.</p>
<p>If this was a mistake, please contact your MSP to receive a fresh consent link.</p>
</body>
</html>`);
});

// ── GET /api/admin/consent ─────────────────────────────────────────────────────

router.get("/admin/consent", requireAdmin, async (_req: Request, res: Response) => {
  const rows = await db
    .select()
    .from(tenantConsentTable)
    .orderBy(desc(tenantConsentTable.updatedAt));
  res.json(rows);
});

// ── PATCH /api/admin/consent/:tenantId/revoke ──────────────────────────────────

router.patch("/admin/consent/:tenantId/revoke", requireAdmin, async (req: Request, res: Response) => {
  const tenantId = req.params["tenantId"] as string;

  const [updated] = await db
    .update(tenantConsentTable)
    .set({ consentStatus: "revoked", revokedAt: new Date(), updatedAt: new Date() })
    .where(eq(tenantConsentTable.tenantId, tenantId))
    .returning({ tenantId: tenantConsentTable.tenantId });

  if (!updated) {
    res.status(404).json({ error: "Tenant consent record not found" });
    return;
  }

  await createAuditLog({
    actorUserId: req.user!.id,
    actorName: req.user!.email ?? "admin",
    actorRole: "admin",
    actionType: "tenant_consent_revoked",
    entityType: "tenant_consent",
    entityId: tenantId,
    metadata: { tenantId },
  });

  res.json({ ok: true, tenantId });
});

// ── Write-back consent (WRITE App Registration — MT_APP_WRITE_CLIENT_ID) ───────
//
// Separate consent flow for the dedicated write App Registration, recorded in
// tenant_write_consent — fully independent of the read-only flow above (which
// stays untouched). PlatformAdmin-triggered only: an admin generates the consent
// URL for a specific customer, sends/opens it, and Microsoft redirects to the
// single FIXED callback below (/api/admin/write-consent/callback) — one URL to
// register in the write app's Azure Redirect URIs, regardless of customer count.
// The customerId travels inside the signed state instead of the callback path.
//
// State is never bare (state-less consent URLs are banned platform-wide): a
// single-use expiring row in consent_invite_tokens backs every URL, and the
// state carries an HMAC over BOTH the customerId and the token
// ("wc.<customerId>.<token>.<mac>") — binding it to the WRITE flow and to one
// specific customer. A write-flow state pasted into the read callback fails
// closed (its token lookup on the full prefixed string finds no row) and vice
// versa; a tampered customerId fails the HMAC; and the callback additionally
// cross-checks the state's customerId against the token row's stored customerId,
// so the DB row stays the authoritative binding.

function writeConsentStateSecret(): string {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET not configured");
  return s;
}
function signWriteConsentState(customerId: number, token: string): string {
  const mac = createHmac("sha256", writeConsentStateSecret()).update(`write-consent:${customerId}:${token}`).digest("hex");
  return `wc.${customerId}.${token}.${mac}`;
}
function verifyWriteConsentState(state: string): { customerId: number; token: string } | null {
  const parts = state.split(".");
  if (parts.length !== 4 || parts[0] !== "wc" || !parts[1] || !parts[2] || !parts[3]) return null;
  const customerId = parseInt(parts[1], 10);
  const token = parts[2];
  const mac = parts[3];
  if (isNaN(customerId) || String(customerId) !== parts[1]) return null;
  const expected = createHmac("sha256", writeConsentStateSecret()).update(`write-consent:${customerId}:${token}`).digest("hex");
  const a = Buffer.from(mac, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return { customerId, token };
}

// ── GET /api/admin/customers/:customerId/write-consent/start ───────────────────

router.get("/admin/customers/:customerId/write-consent/start", requireAdmin, async (req: Request, res: Response) => {
  const customerId = parseInt(req.params["customerId"] as string, 10);
  if (isNaN(customerId)) {
    res.status(400).json({ error: "Invalid customerId" });
    return;
  }

  if (!process.env.MT_APP_WRITE_CLIENT_ID) {
    res.status(503).json({ error: "Write app credentials not configured (MT_APP_WRITE_CLIENT_ID)" });
    return;
  }

  const [customer] = await db
    .select({ tenantId: mspCustomersTable.tenantId })
    .from(mspCustomersTable)
    .where(eq(mspCustomersTable.id, customerId))
    .limit(1);

  if (!customer) {
    res.status(404).json({ error: "Customer not found" });
    return;
  }

  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);

  await db.insert(consentInviteTokensTable).values({
    token,
    tenantId: customer.tenantId?.trim() || null,
    customerId,
    clientUserId: null,
    expiresAt,
  });

  // Fixed callback URL — register exactly this one URL in the write app's
  // Azure Redirect URIs; customerId rides in the signed state, not the path.
  const callbackUrl = `${getHostBase(req)}/api/admin/write-consent/callback`;
  const tenantHint = customer.tenantId?.trim() || "common";
  const consentUrl = buildAdminConsentUrl(
    tenantHint,
    signWriteConsentState(customerId, token),
    callbackUrl,
    process.env.MT_APP_WRITE_CLIENT_ID,
  );

  await createAuditLog({
    actorUserId: req.user!.id,
    actorName: req.user!.email ?? "admin",
    actorRole: "admin",
    actionType: "write_consent_invite_created",
    entityType: "tenant_write_consent",
    metadata: { tenantHint, customerId, expiresAt },
  });

  res.json({ consentUrl, expiresAt });
});

// ── GET /api/admin/write-consent/callback ──────────────────────────────────────
// Microsoft redirects here after the customer's admin approves or declines the
// WRITE app. One FIXED URL for every customer (registered once in Azure);
// the customerId is recovered from the HMAC-signed state and cross-checked
// against the single-use token row. Mirrors the read callback above: burn the
// token, upsert tenant_write_consent, land on a result page. Unauthenticated by
// necessity (Microsoft's redirect carries no session) — trust comes from the
// HMAC-bound, DB-backed single-use state.

router.get("/admin/write-consent/callback", async (req: Request, res: Response) => {
  const { tenant, admin_consent, state, error, error_subcode } = req.query as Record<string, string | undefined>;
  const hostBase = getHostBase(req);

  const verified = state ? verifyWriteConsentState(state) : null;
  if (!verified) {
    log.warn({ state }, "Write-consent callback: state missing or failed HMAC verification");
    res.status(400).send("Invalid consent callback state.");
    return;
  }
  const { customerId, token } = verified;

  // Validate + burn the single-use token; it must belong to THIS customer.
  const now = new Date();
  const [tokenRow] = await db
    .select({ customerId: consentInviteTokensTable.customerId })
    .from(consentInviteTokensTable)
    .where(
      and(
        eq(consentInviteTokensTable.token, token),
        isNull(consentInviteTokensTable.usedAt),
        gte(consentInviteTokensTable.expiresAt, now),
      ),
    )
    .limit(1);

  if (!tokenRow || tokenRow.customerId !== customerId) {
    log.warn({ customerId, tokenCustomerId: tokenRow?.customerId }, "Write-consent callback: token invalid, expired, used, or bound to a different customer");
    res.status(400).send("This consent link has expired or has already been used. Please request a new link.");
    return;
  }

  await db
    .update(consentInviteTokensTable)
    .set({ usedAt: now, ...(tenant ? { tenantId: tenant } : {}) })
    .where(eq(consentInviteTokensTable.token, token));

  // Declined at the Microsoft screen
  if (error === "access_denied" || error_subcode === "cancel") {
    log.warn({ customerId, tenant, error, error_subcode }, "Write-consent callback: admin declined");
    if (tenant) {
      await db
        .insert(tenantWriteConsentTable)
        .values({ tenantId: tenant, customerId, consentStatus: "declined", updatedAt: now })
        .onConflictDoUpdate({
          target: tenantWriteConsentTable.tenantId,
          set: { consentStatus: "declined", customerId, updatedAt: now },
        });
    }
    res.redirect(`${hostBase}/portal/consent/declined${tenant ? `?tenant=${encodeURIComponent(tenant)}` : ""}`);
    return;
  }

  if (!tenant || admin_consent?.toLowerCase() !== "true") {
    log.warn({ customerId, tenant, admin_consent }, "Write-consent callback: unexpected parameters");
    res.status(400).send("Invalid consent callback parameters.");
    return;
  }

  // Upsert tenant_write_consent as granted. scopesGranted is deliberately left
  // at its default — the write app's manifest is the source of truth for what
  // was granted; no scope list is fabricated here.
  await db
    .insert(tenantWriteConsentTable)
    .values({
      tenantId: tenant,
      customerId,
      consentStatus: "granted",
      consentedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: tenantWriteConsentTable.tenantId,
      set: {
        consentStatus: "granted",
        consentedAt: now,
        revokedAt: null,
        customerId,
        updatedAt: now,
      },
    });

  await createAuditLog({
    actorUserId: null,
    actorName: "microsoft:write-consent-callback",
    actorRole: "admin",
    actionType: "tenant_write_consent_granted",
    entityType: "tenant_write_consent",
    entityId: tenant,
    metadata: { tenantId: tenant, customerId },
  });

  log.info({ tenant, customerId }, "Tenant WRITE admin consent granted");
  res.redirect(`${hostBase}/portal/consent/success?tenant=${encodeURIComponent(tenant)}&write=1`);
});

// ── GET /api/admin/customers/:customerId/write-consent ─────────────────────────
// Status read for the admin UI — current tenant_write_consent state for the
// customer's tenant (or null when the tenant has no row / customer has no tenant).

router.get("/admin/customers/:customerId/write-consent", requireAdmin, async (req: Request, res: Response) => {
  const customerId = parseInt(req.params["customerId"] as string, 10);
  if (isNaN(customerId)) {
    res.status(400).json({ error: "Invalid customerId" });
    return;
  }

  const [customer] = await db
    .select({ tenantId: mspCustomersTable.tenantId })
    .from(mspCustomersTable)
    .where(eq(mspCustomersTable.id, customerId))
    .limit(1);

  if (!customer) {
    res.status(404).json({ error: "Customer not found" });
    return;
  }
  if (!customer.tenantId) {
    res.json({ tenantId: null, writeConsent: null });
    return;
  }

  const [row] = await db
    .select({
      consentStatus: tenantWriteConsentTable.consentStatus,
      consentedAt: tenantWriteConsentTable.consentedAt,
      revokedAt: tenantWriteConsentTable.revokedAt,
    })
    .from(tenantWriteConsentTable)
    .where(eq(tenantWriteConsentTable.tenantId, customer.tenantId))
    .limit(1);

  res.json({ tenantId: customer.tenantId, writeConsent: row ?? null });
});

export default router;
