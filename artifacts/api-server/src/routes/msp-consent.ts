/**
 * msp-consent.ts
 *
 * MSP-scoped operator routes for tenant admin-consent visibility and
 * management (Git #2674, part of #2563 "Feature: Consent and Onboarding
 * (MSP Console)"). Real gap found by audit: every route in consent.ts —
 * `/consent/invite-link`, `/admin/consent`, `/admin/consent/:tenantId/revoke`,
 * `/admin/customers/:customerId/write-consent*`,
 * `/admin/customers/:customerId/sharepoint-consent*` — is `requireAdmin`
 * (PlatformAdmin) only. There was no MSPOperator/MSPAdmin-scoped equivalent
 * for an MSP to see or manage its OWN customers' consent state.
 *
 * Same storage as consent.ts: all three grants (`graph`, `writeBack`,
 * `sharepoint`) live in tenants.consent (jsonb), keyed by grant type. This
 * file never writes that column directly — every mutation goes through
 * consent.ts's own stampConsent()/mergeConsentKey() so there is exactly one
 * writer of that shape, same discipline consent.ts's own header documents.
 *
 * Routes (MSPOperator+, mspId from JWT claim; every :customerId route
 * ownership-checked via assertCustomerAccess before touching the row):
 *
 *   GET   /api/msp/consent
 *     List consent status (all three grant keys) for every tenant in the
 *     caller's own MSP book. Scoped equivalent of GET /api/admin/consent,
 *     extended to all three keys per #2563's stated scope ("write-consent/
 *     read-consent status"), not just `graph`.
 *
 *   GET   /api/msp/customers/:customerId/consent
 *     Single-customer detail across all three grant keys.
 *
 *   POST  /api/msp/customers/:customerId/consent/invite-link
 *     MSP operator generates a single-use read-consent (`graph`) invite link
 *     for one of their own customers — the MSP-scoped equivalent of
 *     POST /api/consent/invite-link.
 *
 *   PATCH /api/msp/customers/:customerId/consent/revoke
 *     Force-revoke one grant (`key` in body, default "graph") on the
 *     caller's own customer. Scoped equivalent of
 *     PATCH /api/admin/consent/:tenantId/revoke.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { randomBytes } from "crypto";
import { db, tenantsTable, consentInviteTokensTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireRole, assertCustomerAccess } from "../middlewares/requireAuth.ts";
import { resolveMspIdStrict } from "../lib/resolve-msp-id.ts";
import { buildAdminConsentUrl, mtAppCredentialsPresent, REQUIRED_MT_SCOPES } from "../lib/graph.ts";
import { createAuditLog } from "../lib/audit.ts";
import { getCallbackUrl, stampConsent, consentRow, CONSENT_REVOKE_KEYS, type ConsentKey } from "./consent.ts";
import { logger } from "../lib/logger.ts";

const log = logger.child({ channel: "tenant.msp-admin" });

const router: IRouter = Router();

// ── GET /api/msp/consent ────────────────────────────────────────────────────

router.get("/msp/consent", requireRole("MSPOperator"), async (req: Request, res: Response): Promise<void> => {
  const mspId = resolveMspIdStrict(req);
  if (!mspId) {
    res.status(403).json({ error: "No MSP scope on this token" });
    return;
  }

  const rows = await db
    .select({
      customerId: tenantsTable.id,
      tenantId: tenantsTable.tenantId,
      customerName: tenantsTable.customerName,
      consent: tenantsTable.consent,
      updatedAt: tenantsTable.updatedAt,
    })
    .from(tenantsTable)
    .where(eq(tenantsTable.mspId, mspId));

  res.json(
    rows
      .filter((r) => r.consent?.graph != null || r.consent?.writeBack != null || r.consent?.sharepoint != null)
      .map((r) => ({
        customerId: r.customerId,
        tenantId: r.tenantId,
        customerName: r.customerName,
        updatedAt: r.updatedAt,
        graph: consentRow(r.consent?.graph),
        writeBack: consentRow(r.consent?.writeBack),
        sharepoint: consentRow(r.consent?.sharepoint),
      })),
  );
});

// ── GET /api/msp/customers/:customerId/consent ──────────────────────────────

router.get(
  "/msp/customers/:customerId/consent",
  requireRole("MSPOperator"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = parseInt(req.params["customerId"] as string, 10);
    if (isNaN(customerId)) {
      res.status(400).json({ error: "Invalid customerId" });
      return;
    }

    if (!(await assertCustomerAccess(req.user!, customerId))) {
      res.status(404).json({ error: "Customer not found in your book" });
      return;
    }

    const [row] = await db
      .select({
        tenantId: tenantsTable.tenantId,
        customerName: tenantsTable.customerName,
        consent: tenantsTable.consent,
        updatedAt: tenantsTable.updatedAt,
      })
      .from(tenantsTable)
      .where(eq(tenantsTable.id, customerId))
      .limit(1);

    if (!row) {
      res.status(404).json({ error: "Customer not found" });
      return;
    }

    res.json({
      customerId,
      tenantId: row.tenantId,
      customerName: row.customerName,
      updatedAt: row.updatedAt,
      graph: consentRow(row.consent?.graph),
      writeBack: consentRow(row.consent?.writeBack),
      sharepoint: consentRow(row.consent?.sharepoint),
    });
  },
);

// ── POST /api/msp/customers/:customerId/consent/invite-link ────────────────
// MSP-scoped equivalent of POST /api/consent/invite-link — mints a read
// (`graph`) consent invite for one of the caller's own customers. Same
// single-use consent_invite_tokens + buildAdminConsentUrl mechanism as every
// other consent-invite path in this repo (admin invite-link,
// portal reconsent-link) — no second consent mechanism introduced here.

router.post(
  "/msp/customers/:customerId/consent/invite-link",
  requireRole("MSPOperator"),
  async (req: Request, res: Response): Promise<void> => {
    if (!mtAppCredentialsPresent()) {
      res.status(503).json({
        error: "Multi-tenant app credentials not configured (MT_APP_CLIENT_ID / MT_APP_CLIENT_SECRET)",
      });
      return;
    }

    const customerId = parseInt(req.params["customerId"] as string, 10);
    if (isNaN(customerId)) {
      res.status(400).json({ error: "Invalid customerId" });
      return;
    }

    if (!(await assertCustomerAccess(req.user!, customerId))) {
      res.status(404).json({ error: "Customer not found in your book" });
      return;
    }

    const { ttlHours = 72 } = req.body as { ttlHours?: number };

    const [customer] = await db
      .select({ tenantId: tenantsTable.tenantId })
      .from(tenantsTable)
      .where(eq(tenantsTable.id, customerId))
      .limit(1);

    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + Math.min(Math.max(Number(ttlHours) || 72, 1), 168) * 60 * 60 * 1000);

    await db.insert(consentInviteTokensTable).values({
      token,
      tenantId: customer?.tenantId?.trim() || null,
      customerId,
      expiresAt,
    });

    const callbackUrl = getCallbackUrl(req);
    const tenantHint = customer?.tenantId?.trim() || "common";
    const consentUrl = buildAdminConsentUrl(tenantHint, token, callbackUrl, process.env.MT_APP_CLIENT_ID ?? "");

    await createAuditLog({
      actorUserId: req.user!.id,
      actorName: req.user!.email ?? "msp-operator",
      actorRole: "client",
      actionType: "consent_invite_created",
      entityType: "consent_invite",
      entityId: customerId,
      metadata: { tenantHint, customerId, expiresAt },
    });

    log.info({ customerId, mspId: req.user!.mspId }, "msp-consent: invite link generated");

    res.json({
      consentUrl,
      token,
      expiresAt,
      scopes: REQUIRED_MT_SCOPES,
    });
  },
);

// ── PATCH /api/msp/customers/:customerId/consent/revoke ────────────────────

router.patch(
  "/msp/customers/:customerId/consent/revoke",
  requireRole("MSPOperator"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = parseInt(req.params["customerId"] as string, 10);
    if (isNaN(customerId)) {
      res.status(400).json({ error: "Invalid customerId" });
      return;
    }

    if (!(await assertCustomerAccess(req.user!, customerId))) {
      res.status(404).json({ error: "Customer not found in your book" });
      return;
    }

    const rawKey = (req.body as { key?: unknown } | undefined)?.key;
    const key: ConsentKey = rawKey === undefined ? "graph" : (rawKey as ConsentKey);
    if (!CONSENT_REVOKE_KEYS.includes(key)) {
      res.status(400).json({ error: `key must be one of: ${CONSENT_REVOKE_KEYS.join(", ")}` });
      return;
    }

    const revoked = await stampConsent(
      and(eq(tenantsTable.id, customerId), eq(tenantsTable.mspId, req.user!.mspId ?? -1))!,
      key,
      { status: "revoked", revokedAt: new Date().toISOString() },
    );

    if (!revoked) {
      res.status(404).json({ error: "Tenant consent record not found" });
      return;
    }

    await createAuditLog({
      actorUserId: req.user!.id,
      actorName: req.user!.email ?? "msp-operator",
      actorRole: "client",
      actionType: "tenant_consent_revoked",
      entityType: "tenant_consent",
      entityId: customerId,
      metadata: { customerId, key },
    });

    log.info({ customerId, mspId: req.user!.mspId, key }, "msp-consent: consent revoked");

    res.json({ ok: true, customerId, key });
  },
);

export default router;
