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
import { db, tenantConsentTable, consentInviteTokensTable } from "@workspace/db";
import { eq, and, isNull, gte, desc } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth.ts";
import { buildAdminConsentUrl, mtAppCredentialsPresent, REQUIRED_MT_SCOPES } from "../lib/graph.ts";
import { createAuditLog } from "../lib/audit.ts";
import { logger } from "../lib/logger.ts";

const router: IRouter = Router();

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

    if (state) {
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

  // Validate and burn the invite token
  let inviteRecord: { customerId: number | null; clientUserId: number | null } | null = null;
  if (state) {
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

  logger.info({ tenant, customerId: inviteRecord?.customerId }, "Tenant admin consent granted");

  res.redirect(`${hostBase}/portal/consent/success?tenant=${encodeURIComponent(tenant)}`);
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
