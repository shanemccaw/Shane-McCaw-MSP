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
import { randomBytes } from "crypto";
import { db, tenantConsentTable, consentInviteTokensTable, checkoutSessionsTable, servicesTable, usersTable, mspCustomersTable } from "@workspace/db";
import { eq, and, isNull, gte, desc, sql } from "drizzle-orm";
import { emitWorkflowEvent } from "../lib/workflow-executor.ts";
import { requireAdmin } from "../middlewares/requireAuth.ts";
import { buildAdminConsentUrl, mtAppCredentialsPresent, REQUIRED_MT_SCOPES } from "../lib/graph.ts";
import { createAuditLog } from "../lib/audit.ts";
import { logger } from "../lib/logger.ts";

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
  const consentUrl = buildAdminConsentUrl(tenantHint, token, callbackUrl);

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

// ── GET /api/consent/callback ──────────────────────────────────────────────────

router.get("/consent/callback", async (req: Request, res: Response) => {
  const { tenant, admin_consent, state, error, error_subcode } = req.query as Record<string, string | undefined>;

  const hostBase = getHostBase(req);

  // Microsoft declined callback — surface a clear message
  if (error === "access_denied" || error_subcode === "cancel") {
    logger.warn({ tenant, state, error, error_subcode }, "Consent callback: admin declined");

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
    logger.warn({ tenant, admin_consent, state }, "Consent callback: unexpected parameters");
    res.status(400).send("Invalid consent callback parameters.");
    return;
  }

  // Determine whether `state` is a checkout session UUID or an MSP invite token.
  const isCheckoutSession = !!state && UUID_RE.test(state);

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
      logger.warn({ state, tenant }, "Consent callback: invite token invalid, expired, or already used");
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

  logger.info({ tenant, customerId: inviteRecord?.customerId, isCheckoutSession }, "Tenant admin consent granted");

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
        logger.warn({ err, customerId: inviteRecord?.customerId }, "Consent callback: failed to flip customer status to active (non-fatal)");
      });
  }

  // If the state was a checkout session UUID, mark it consented and thread it
  // into the redirect so ConsentSuccessPage can show the "Continue to payment" CTA.
  let successRedirect = `${hostBase}/portal/consent/success?tenant=${encodeURIComponent(tenant)}`;
  // Hoisted so the consent.granted emission block below can read slug + email without a second DB round-trip.
  let updatedSession: { id: string; email: string; productSlug: string } | undefined;

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
      logger.info({ sessionId: state, tenant }, "Checkout session marked consented via consent callback");
    } else {
      logger.warn({ sessionId: state, tenant }, "Consent callback: checkout session not found or expired — redirect proceeds without session");
    }
  }

  // ── Emit consent.granted workflow event ─────────────────────────────────────
  // Runs for both paths (invite-link and checkout-session). Skips emission with
  // a warning rather than crashing the redirect flow if context is unresolvable.
  let resolvedPackageKey: string | null = null;
  try {
    // clientId: from invite token (invite-link path) or email→users lookup (checkout-session path)
    let clientId: number | null = inviteRecord?.clientUserId ?? null;
    let packageKey: string | null = null;

    if (isCheckoutSession && state) {
      // Re-fetch the session if the update didn't match (expired/not found) — we still want
      // packageKey even if updatedSession is null.
      let productSlug: string | null = null;
      let sessionEmail: string | null = null;

      if (updatedSession) {
        productSlug = updatedSession.productSlug;
        sessionEmail = updatedSession.email;
      } else {
        // Session not updated (expired or not found) — try a direct read for the slug
        const [existing] = await db
          .select({ productSlug: checkoutSessionsTable.productSlug, email: checkoutSessionsTable.email })
          .from(checkoutSessionsTable)
          .where(eq(checkoutSessionsTable.id, state))
          .limit(1);
        productSlug = existing?.productSlug ?? null;
        sessionEmail = existing?.email ?? null;
      }

      // Resolve packageKey via services.type_attributes->>'packageKey'
      if (productSlug) {
        const [svcRow] = await db
          .select({ pk: sql<string>`type_attributes->>'packageKey'` })
          .from(servicesTable)
          .where(eq(servicesTable.slug, productSlug))
          .limit(1);
        packageKey = svcRow?.pk ?? null;
      }

      // Resolve clientId from email if a user account already exists (may not yet for pre-payment consent)
      if (clientId == null && sessionEmail) {
        const [userRow] = await db
          .select({ id: usersTable.id })
          .from(usersTable)
          .where(eq(usersTable.email, sessionEmail))
          .limit(1);
        clientId = userRow?.id ?? null;
      }
    }
    // invite-link path: clientId set from inviteRecord above; packageKey unavailable (no product context)

    resolvedPackageKey = packageKey;

    if (packageKey == null) {
      logger.warn(
        { tenant, isCheckoutSession, hasInviteRecord: inviteRecord != null },
        "consent.granted: packageKey unresolvable — skipping event emission",
      );
    } else {
      void emitWorkflowEvent("consent.granted", {
        tenantId: tenant,
        packageKey,
        ...(clientId != null ? { clientId } : {}),
      });
      logger.info({ tenant, packageKey, clientId }, "consent.granted: event emitted");
    }
  } catch (err) {
    logger.warn({ err, tenant }, "consent.granted: event emission error — non-fatal, redirect proceeds");
  }

  // Fire-and-forget diagnostics run — must not delay the consent redirect.
  // Uses dynamic import to avoid circular-dependency issues at module load time.
  void (async () => {
    try {
      const { runDiagnostics } = await import("../lib/diagnostics-runner.js");
      await runDiagnostics({
        tenantId: tenant,
        packageKey: resolvedPackageKey ?? "default",
        triggeredByUserId: undefined,
      });
      logger.info({ tenant }, "consent.granted: diagnostics run started");
    } catch (diagErr) {
      logger.warn({ err: diagErr, tenant }, "consent.granted: diagnostics run failed (non-fatal)");
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

export default router;
