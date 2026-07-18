/**
 * MSP Settings Routes — settings surface for authenticated MSP admins.
 *
 * Profile:
 *   GET  /api/msp/settings/profile              — get own MSP profile
 *   PATCH /api/msp/settings/profile             — update own MSP profile
 *
 * Connector / Exchange Online:
 *   GET  /api/msp/settings/connector            — get connector config (no raw secrets)
 *   PUT  /api/msp/settings/connector            — update connector mode (audit-logged)
 *   PUT  /api/msp/settings/connector/exchange   — save EXO credentials to Key Vault
 *   DELETE /api/msp/settings/connector/exchange — remove EXO credentials + disable
 *
 * MSP Mailbox (outbound email routing):
 *   GET  /api/msp/settings/connector/mailbox            — get mailbox connector status
 *   POST /api/msp/settings/connector/mailbox/connect    — initiate OAuth admin-consent for Mail.Send
 *   GET  /api/msp/settings/connector/mailbox/callback   — OAuth callback (Microsoft redirect)
 *   DELETE /api/msp/settings/connector/mailbox          — disconnect MSP mailbox
 *
 * Service Accounts (API keys):
 *   GET  /api/msp/settings/service-accounts     — list service accounts (no key values)
 *   POST /api/msp/settings/service-accounts     — create service account (returns key once)
 *   DELETE /api/msp/settings/service-accounts/:id — revoke service account
 *
 * Team / Users:
 *   GET  /api/msp/settings/users                — list MSP users + roles
 *   PATCH /api/msp/settings/users/:userId/role  — update role (MSPAdmin only)
 *   DELETE /api/msp/settings/users/:userId      — remove from MSP (MSPAdmin only)
 *
 * Billing:
 *   GET  /api/msp/settings/billing              — get Stripe billing info (no raw card data)
 *   POST /api/msp/settings/billing/portal-session — create Stripe billing portal session
 *
 * Email Templates:
 *   GET  /api/msp/settings/email-templates      — list templates (MSP overrides + platform defaults)
 *   PUT  /api/msp/settings/email-templates/:key — upsert MSP template (merge-field validated)
 *   DELETE /api/msp/settings/email-templates/:key — reset to platform default
 *
 * Customer Agreement Template:
 *   GET  /api/msp/settings/agreement-template   — get MSP customer agreement template
 *   PUT  /api/msp/settings/agreement-template   — update agreement template
 *
 * Sessions:
 *   GET  /api/msp/settings/sessions             — list active refresh-token sessions (own MSP)
 *   DELETE /api/msp/settings/sessions/:tokenHash — revoke a session
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  mspsTable,
  mspUsersTable,
  mspServiceAccountsTable,
  mspConnectorConfigsTable,
  mspSubscriptionsTable,
  mspEmailTemplatesTable,
  mspRefreshTokensTable,
  mspAuditLogsTable,
  mspMailboxConnectorsTable,
  mspMailboxConsentStatesTable,
  mspInvitesTable,
  usersTable,
  MSP_LOCKED_EMAIL_KEYS,
  MSP_EMAIL_TEMPLATE_KEYS,
  type MspEmailTemplateKey,
  type MspConnectorMode,
} from "@workspace/db";
import { eq, and, desc, isNull, inArray, gte, lt } from "drizzle-orm";
import { requireAuth, requireRole } from "../middlewares/requireAuth.ts";
import { z } from "zod";
import { randomBytes, createHash, randomUUID } from "crypto";
import { getRequestContext } from "../lib/request-context.ts";
import { logger } from "../lib/logger.ts";
const log = logger.child({ channel: "tenant.msp-admin" });

import { resolveMspIdStrict } from "../lib/resolve-msp-id.ts";
import { setSecretValue, getSecretMetadata } from "../lib/azure-keyvault.ts";
import { getStripeKey } from "../lib/stripe.ts";
import { buildAdminConsentUrl, mtAppCredentialsPresent } from "../lib/graph.ts";
import { getPortalBaseUrl } from "../lib/portal-url.ts";
import { sendEmailForMsp, emailButton, brandedEmail } from "../lib/mailer.ts";

const router: IRouter = Router();

function p(val: string | string[] | undefined): string {
  return Array.isArray(val) ? (val[0] ?? "") : (val ?? "");
}

function apiError(res: Response, status: number, message: string) {
  res.status(status).json({ error: message });
}


function writeAuditLog(params: {
  req: Request;
  actionType: string;
  entityType: string;
  entityId: string;
  mspId?: number;
  metadata?: Record<string, unknown>;
}) {
  const user = params.req.user!;
  return db.insert(mspAuditLogsTable).values({
    actorUserId: user.id,
    actorRole: user.mspRole ?? user.role,
    mspId: params.mspId,
    actionType: params.actionType,
    entityType: params.entityType,
    entityId: params.entityId,
    correlationId: getRequestContext()?.traceId ?? randomUUID(),
    ipAddress: params.req.ip,
    userAgent: params.req.get("user-agent"),
    outcome: "success",
    metadata: params.metadata,
  });
}

// ── Required merge fields per email template key ───────────────────────────────

const REQUIRED_MERGE_FIELDS: Record<string, string[]> = {
  onboarding_welcome: ["{{customerName}}", "{{portalUrl}}"],
  monitoring_complete: ["{{customerName}}", "{{reportTitle}}"],
  offer_available: ["{{customerName}}", "{{offerTitle}}", "{{offerUrl}}"],
  report_ready: ["{{customerName}}", "{{reportTitle}}", "{{reportUrl}}"],
  invoice_due_reminder: ["{{customerName}}", "{{amount}}", "{{dueDate}}"],
  password_reset: ["{{resetLink}}"],
  mfa_code: ["{{code}}"],
  consent_revoked: ["{{customerName}}"],
};

function validateMergeFields(key: string, body: string): string | null {
  const required = REQUIRED_MERGE_FIELDS[key] ?? [];
  const missing = required.filter((f) => !body.includes(f));
  if (missing.length > 0) {
    return `Missing required merge fields: ${missing.join(", ")}`;
  }
  return null;
}

// ── GET /api/msp/profile — alias consumed by app-shell.tsx ────────────────────
// The frontend fetches /api/msp/profile; the canonical route is /api/msp/settings/profile.
// This thin alias avoids a frontend change while keeping one source of truth.
//
// Role: CustomerUser (lowest paying role) — this endpoint returns purely cosmetic
// branding data (name, logoUrl, primaryColor) needed by every authenticated page
// for white-label display. No sensitive MSP-internal data is exposed here.
// The write/management surface (PATCH /msp/settings/profile) remains MSPAdmin-gated.

router.get("/msp/profile", requireRole("CustomerUser"), async (req: Request, res: Response) => {
  const mspId = resolveMspIdStrict(req);
  if (!mspId) { apiError(res, 400, "No MSP context"); return; }

  const [msp] = await db
    .select({
      id: mspsTable.id,
      name: mspsTable.name,
      slug: mspsTable.slug,
      domain: mspsTable.domain,
      logoUrl: mspsTable.logoUrl,
      primaryColor: mspsTable.primaryColor,
      status: mspsTable.status,
      trialEndsAt: mspsTable.trialEndsAt,
      customCustomerAgreement: mspsTable.customCustomerAgreement,
      createdAt: mspsTable.createdAt,
    })
    .from(mspsTable)
    .where(eq(mspsTable.id, mspId))
    .limit(1);

  if (!msp) { apiError(res, 404, "MSP not found"); return; }
  res.json(msp);
});

// ── GET /api/msp/settings/profile ─────────────────────────────────────────────

router.get("/msp/settings/profile", requireRole("MSPAdmin"), async (req: Request, res: Response) => {
  const mspId = resolveMspIdStrict(req);
  if (!mspId) { apiError(res, 400, "No MSP context"); return; }

  const [msp] = await db
    .select({
      id: mspsTable.id,
      name: mspsTable.name,
      slug: mspsTable.slug,
      domain: mspsTable.domain,
      logoUrl: mspsTable.logoUrl,
      primaryColor: mspsTable.primaryColor,
      status: mspsTable.status,
      trialEndsAt: mspsTable.trialEndsAt,
      customCustomerAgreement: mspsTable.customCustomerAgreement,
      createdAt: mspsTable.createdAt,
    })
    .from(mspsTable)
    .where(eq(mspsTable.id, mspId))
    .limit(1);

  if (!msp) { apiError(res, 404, "MSP not found"); return; }
  res.json(msp);
});

const updateProfileSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  domain: z.string().nullable().optional(),
  logoUrl: z.string().url().nullable().optional(),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
  customCustomerAgreement: z.string().max(50000).nullable().optional(),
});

router.patch("/msp/settings/profile", requireRole("MSPAdmin"), async (req: Request, res: Response) => {
  const mspId = resolveMspIdStrict(req);
  if (!mspId) { apiError(res, 400, "No MSP context"); return; }

  const parsed = updateProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    apiError(res, 400, parsed.error.issues.map((i) => i.message).join("; "));
    return;
  }

  const [updated] = await db
    .update(mspsTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(mspsTable.id, mspId))
    .returning();

  if (!updated) { apiError(res, 404, "MSP not found"); return; }

  await writeAuditLog({ req, actionType: "msp.profile.update", entityType: "msp", entityId: String(mspId), mspId });
  res.json(updated);
});

// ── GET/PUT /api/msp/settings/connector ───────────────────────────────────────

router.get("/msp/settings/connector", requireRole("MSPAdmin"), async (req: Request, res: Response) => {
  const mspId = resolveMspIdStrict(req);
  if (!mspId) { apiError(res, 400, "No MSP context"); return; }

  const [config] = await db
    .select({
      connectorMode: mspConnectorConfigsTable.connectorMode,
      exchangeOnlineEnabled: mspConnectorConfigsTable.exchangeOnlineEnabled,
      exchangeOnlineTenantId: mspConnectorConfigsTable.exchangeOnlineTenantId,
      // Only return whether creds are set, NOT the key vault secret name (no raw values)
      hasExchangeClientId: mspConnectorConfigsTable.exchangeOnlineClientIdSecretName,
      hasExchangeClientSecret: mspConnectorConfigsTable.exchangeOnlineClientSecretName,
      auditLoggingEnabled: mspConnectorConfigsTable.auditLoggingEnabled,
      updatedAt: mspConnectorConfigsTable.updatedAt,
    })
    .from(mspConnectorConfigsTable)
    .where(eq(mspConnectorConfigsTable.mspId, mspId))
    .limit(1);

  if (!config) {
    // Return defaults when no config row exists yet
    res.json({
      connectorMode: "delegated",
      exchangeOnlineEnabled: false,
      exchangeOnlineTenantId: null,
      hasExchangeClientId: false,
      hasExchangeClientSecret: false,
      auditLoggingEnabled: true,
      updatedAt: null,
    });
    return;
  }

  res.json({
    ...config,
    hasExchangeClientId: !!config.hasExchangeClientId,
    hasExchangeClientSecret: !!config.hasExchangeClientSecret,
  });
});

const updateConnectorSchema = z.object({
  connectorMode: z.enum(["agent", "api_key", "delegated"]),
  auditLoggingEnabled: z.boolean().optional(),
  customerAgreementTemplate: z.string().max(50000).nullable().optional(),
});

router.put("/msp/settings/connector", requireRole("MSPAdmin"), async (req: Request, res: Response) => {
  const mspId = resolveMspIdStrict(req);
  if (!mspId) { apiError(res, 400, "No MSP context"); return; }

  const parsed = updateConnectorSchema.safeParse(req.body);
  if (!parsed.success) {
    apiError(res, 400, parsed.error.issues.map((i) => i.message).join("; "));
    return;
  }

  const values = {
    mspId,
    connectorMode: parsed.data.connectorMode as MspConnectorMode,
    auditLoggingEnabled: parsed.data.auditLoggingEnabled ?? true,
    customerAgreementTemplate: parsed.data.customerAgreementTemplate ?? null,
    updatedAt: new Date(),
    updatedByUserId: req.user!.id,
  };

  await db
    .insert(mspConnectorConfigsTable)
    .values(values)
    .onConflictDoUpdate({ target: mspConnectorConfigsTable.mspId, set: values });

  await writeAuditLog({
    req,
    actionType: "connector.mode.update",
    entityType: "msp_connector_config",
    entityId: String(mspId),
    mspId,
    metadata: { connectorMode: parsed.data.connectorMode },
  });

  res.json({ ok: true, connectorMode: parsed.data.connectorMode });
});

// ── PUT /api/msp/settings/connector/exchange ──────────────────────────────────
// Saves Exchange Online credentials to Key Vault. Raw values never stored in DB.

const exchangeSchema = z.object({
  tenantId: z.string().uuid("tenantId must be a valid UUID"),
  clientId: z.string().min(10),
  clientSecret: z.string().min(10),
});

router.put("/msp/settings/connector/exchange", requireRole("MSPAdmin"), async (req: Request, res: Response) => {
  const mspId = resolveMspIdStrict(req);
  if (!mspId) { apiError(res, 400, "No MSP context"); return; }

  const parsed = exchangeSchema.safeParse(req.body);
  if (!parsed.success) {
    apiError(res, 400, parsed.error.issues.map((i) => i.message).join("; "));
    return;
  }

  const kvAvailable = !!(
    process.env.AZURE_TENANT_ID &&
    process.env.AZURE_CLIENT_ID &&
    process.env.AZURE_CLIENT_SECRET &&
    process.env.AZURE_KEY_VAULT_URL
  );

  const clientIdSecretName = `msp-${mspId}-exo-client-id`;
  const clientSecretName = `msp-${mspId}-exo-client-secret`;

  if (kvAvailable) {
    await setSecretValue(clientIdSecretName, parsed.data.clientId, {
      mspId: String(mspId),
      purpose: "exchange-online-client-id",
    });
    await setSecretValue(clientSecretName, parsed.data.clientSecret, {
      mspId: String(mspId),
      purpose: "exchange-online-client-secret",
    });
  } else {
    log.warn({ mspId }, "msp-settings: Key Vault not configured — EXO credentials not stored");
  }

  const values = {
    mspId,
    exchangeOnlineEnabled: true,
    exchangeOnlineTenantId: parsed.data.tenantId,
    exchangeOnlineClientIdSecretName: kvAvailable ? clientIdSecretName : null,
    exchangeOnlineClientSecretName: kvAvailable ? clientSecretName : null,
    updatedAt: new Date(),
    updatedByUserId: req.user!.id,
  };

  await db
    .insert(mspConnectorConfigsTable)
    .values({ ...values, connectorMode: "delegated" })
    .onConflictDoUpdate({ target: mspConnectorConfigsTable.mspId, set: values });

  await writeAuditLog({
    req,
    actionType: "connector.exchange.configure",
    entityType: "msp_connector_config",
    entityId: String(mspId),
    mspId,
    metadata: { tenantId: parsed.data.tenantId, kvStored: kvAvailable },
  });

  res.json({ ok: true, exchangeOnlineEnabled: true, kvStored: kvAvailable });
});

router.delete("/msp/settings/connector/exchange", requireRole("MSPAdmin"), async (req: Request, res: Response) => {
  const mspId = resolveMspIdStrict(req);
  if (!mspId) { apiError(res, 400, "No MSP context"); return; }

  await db
    .update(mspConnectorConfigsTable)
    .set({
      exchangeOnlineEnabled: false,
      exchangeOnlineTenantId: null,
      exchangeOnlineClientIdSecretName: null,
      exchangeOnlineClientSecretName: null,
      updatedAt: new Date(),
    })
    .where(eq(mspConnectorConfigsTable.mspId, mspId));

  await writeAuditLog({
    req,
    actionType: "connector.exchange.remove",
    entityType: "msp_connector_config",
    entityId: String(mspId),
    mspId,
  });

  res.json({ ok: true });
});

// ── Service Accounts ──────────────────────────────────────────────────────────

router.get("/msp/settings/service-accounts", requireRole("MSPAdmin"), async (req: Request, res: Response) => {
  const mspId = resolveMspIdStrict(req);
  if (!mspId) { apiError(res, 400, "No MSP context"); return; }

  const accounts = await db
    .select({
      id: mspServiceAccountsTable.id,
      name: mspServiceAccountsTable.name,
      keyPrefix: mspServiceAccountsTable.keyPrefix,
      scopes: mspServiceAccountsTable.scopes,
      expiresAt: mspServiceAccountsTable.expiresAt,
      revokedAt: mspServiceAccountsTable.revokedAt,
      lastUsedAt: mspServiceAccountsTable.lastUsedAt,
      createdAt: mspServiceAccountsTable.createdAt,
    })
    .from(mspServiceAccountsTable)
    .where(and(eq(mspServiceAccountsTable.mspId, mspId), isNull(mspServiceAccountsTable.revokedAt)))
    .orderBy(desc(mspServiceAccountsTable.createdAt));

  res.json(accounts);
});

const createServiceAccountSchema = z.object({
  name: z.string().min(2).max(100),
  scopes: z.array(z.string()).default([]),
  expiresInDays: z.number().int().min(1).max(365).optional(),
});

router.post("/msp/settings/service-accounts", requireRole("MSPAdmin"), async (req: Request, res: Response) => {
  const mspId = resolveMspIdStrict(req);
  if (!mspId) { apiError(res, 400, "No MSP context"); return; }

  const parsed = createServiceAccountSchema.safeParse(req.body);
  if (!parsed.success) {
    apiError(res, 400, parsed.error.issues.map((i) => i.message).join("; "));
    return;
  }

  const rawKey = `msp_sa_${randomBytes(32).toString("hex")}`;
  const keyHash = createHash("sha256").update(rawKey).digest("hex");
  const keyPrefix = rawKey.slice(0, 12);
  const secretName = `msp-${mspId}-sa-${Date.now()}`;
  const expiresAt = parsed.data.expiresInDays
    ? new Date(Date.now() + parsed.data.expiresInDays * 24 * 60 * 60 * 1000)
    : null;

  const kvAvailable = !!(
    process.env.AZURE_TENANT_ID &&
    process.env.AZURE_CLIENT_ID &&
    process.env.AZURE_CLIENT_SECRET &&
    process.env.AZURE_KEY_VAULT_URL
  );

  if (kvAvailable) {
    await setSecretValue(secretName, rawKey, { mspId: String(mspId), purpose: "service-account" });
  }

  const [account] = await db
    .insert(mspServiceAccountsTable)
    .values({
      mspId,
      name: parsed.data.name,
      keyVaultSecretName: secretName,
      keyHash,
      keyPrefix,
      scopes: parsed.data.scopes,
      expiresAt: expiresAt ?? undefined,
    })
    .returning({
      id: mspServiceAccountsTable.id,
      name: mspServiceAccountsTable.name,
      keyPrefix: mspServiceAccountsTable.keyPrefix,
      scopes: mspServiceAccountsTable.scopes,
      expiresAt: mspServiceAccountsTable.expiresAt,
      createdAt: mspServiceAccountsTable.createdAt,
    });

  await writeAuditLog({
    req,
    actionType: "service_account.create",
    entityType: "msp_service_account",
    entityId: String(account!.id),
    mspId,
    metadata: { name: parsed.data.name, scopes: parsed.data.scopes },
  });

  // Return the raw key exactly once — never again
  res.status(201).json({ ...account, rawKey });
});

router.delete("/msp/settings/service-accounts/:id", requireRole("MSPAdmin"), async (req: Request, res: Response) => {
  const mspId = resolveMspIdStrict(req);
  const id = parseInt(p(req.params["id"]), 10);
  if (!mspId || isNaN(id)) { apiError(res, 400, "Invalid params"); return; }

  const [revoked] = await db
    .update(mspServiceAccountsTable)
    .set({ revokedAt: new Date() })
    .where(and(eq(mspServiceAccountsTable.id, id), eq(mspServiceAccountsTable.mspId, mspId)))
    .returning({ id: mspServiceAccountsTable.id });

  if (!revoked) { apiError(res, 404, "Service account not found"); return; }

  await writeAuditLog({
    req,
    actionType: "service_account.revoke",
    entityType: "msp_service_account",
    entityId: String(id),
    mspId,
  });

  res.json({ ok: true });
});

// ── Team / Users ──────────────────────────────────────────────────────────────

router.get("/msp/settings/users", requireRole("MSPAdmin"), async (req: Request, res: Response) => {
  const mspId = resolveMspIdStrict(req);
  if (!mspId) { apiError(res, 400, "No MSP context"); return; }

  const users = await db
    .select({
      id: mspUsersTable.id,
      userId: mspUsersTable.userId,
      mspRole: mspUsersTable.mspRole,
      canApprovePurchases: mspUsersTable.canApprovePurchases,
      isActive: mspUsersTable.isActive,
      lastLoginAt: mspUsersTable.lastLoginAt,
      createdAt: mspUsersTable.createdAt,
      email: usersTable.email,
      name: usersTable.name,
    })
    .from(mspUsersTable)
    .innerJoin(usersTable, eq(usersTable.id, mspUsersTable.userId))
    .where(eq(mspUsersTable.mspId, mspId))
    .orderBy(desc(mspUsersTable.createdAt));

  res.json(users);
});

const updateRoleSchema = z.object({
  mspRole: z.enum(["MSPAdmin", "MSPOperator"]),
});

router.patch("/msp/settings/users/:userId/role", requireRole("MSPAdmin"), async (req: Request, res: Response) => {
  const mspId = resolveMspIdStrict(req);
  const userId = parseInt(p(req.params["userId"]), 10);
  if (!mspId || isNaN(userId)) { apiError(res, 400, "Invalid params"); return; }

  const parsed = updateRoleSchema.safeParse(req.body);
  if (!parsed.success) {
    apiError(res, 400, parsed.error.issues.map((i) => i.message).join("; "));
    return;
  }

  const [updated] = await db
    .update(mspUsersTable)
    .set({ mspRole: parsed.data.mspRole, updatedAt: new Date() })
    .where(and(eq(mspUsersTable.userId, userId), eq(mspUsersTable.mspId, mspId)))
    .returning({ id: mspUsersTable.id });

  if (!updated) { apiError(res, 404, "User not found in this MSP"); return; }

  await writeAuditLog({
    req,
    actionType: "user.role.update",
    entityType: "msp_user",
    entityId: String(userId),
    mspId,
    metadata: { mspRole: parsed.data.mspRole },
  });

  res.json({ ok: true });
});

const updateApprovePurchasesSchema = z.object({
  canApprovePurchases: z.boolean(),
});

router.patch("/msp/settings/users/:userId/approve-purchases", requireRole("MSPAdmin"), async (req: Request, res: Response) => {
  const mspId = resolveMspIdStrict(req);
  const userId = parseInt(p(req.params["userId"]), 10);
  if (!mspId || isNaN(userId)) { apiError(res, 400, "Invalid params"); return; }

  const parsed = updateApprovePurchasesSchema.safeParse(req.body);
  if (!parsed.success) {
    apiError(res, 400, parsed.error.issues.map((i) => i.message).join("; "));
    return;
  }

  const [updated] = await db
    .update(mspUsersTable)
    .set({ canApprovePurchases: parsed.data.canApprovePurchases, updatedAt: new Date() })
    .where(and(eq(mspUsersTable.userId, userId), eq(mspUsersTable.mspId, mspId)))
    .returning({ id: mspUsersTable.id });

  if (!updated) { apiError(res, 404, "User not found in this MSP"); return; }

  await writeAuditLog({
    req,
    actionType: "user.approve_purchases.update",
    entityType: "msp_user",
    entityId: String(userId),
    mspId,
    metadata: { canApprovePurchases: parsed.data.canApprovePurchases },
  });

  res.json({ ok: true });
});

router.delete("/msp/settings/users/:userId", requireRole("MSPAdmin"), async (req: Request, res: Response) => {
  const mspId = resolveMspIdStrict(req);
  const userId = parseInt(p(req.params["userId"]), 10);
  if (!mspId || isNaN(userId)) { apiError(res, 400, "Invalid params"); return; }

  // Cannot remove self
  if (userId === req.user!.id) {
    apiError(res, 400, "Cannot remove your own account from the MSP");
    return;
  }

  const [removed] = await db
    .update(mspUsersTable)
    .set({ isActive: false, updatedAt: new Date() })
    .where(and(eq(mspUsersTable.userId, userId), eq(mspUsersTable.mspId, mspId)))
    .returning({ id: mspUsersTable.id });

  if (!removed) { apiError(res, 404, "User not found in this MSP"); return; }

  await writeAuditLog({
    req,
    actionType: "user.remove",
    entityType: "msp_user",
    entityId: String(userId),
    mspId,
  });

  res.json({ ok: true });
});

router.post("/msp/settings/users/:userId/reset-password", requireRole("MSPAdmin"), async (req: Request, res: Response) => {
  const mspId = resolveMspIdStrict(req);
  const userId = parseInt(p(req.params["userId"]), 10);
  if (!mspId || isNaN(userId)) { apiError(res, 400, "Invalid params"); return; }

  await writeAuditLog({
    req,
    actionType: "user.password.reset_email_sent",
    entityType: "msp_user",
    entityId: String(userId),
    mspId,
  });

  res.json({ ok: true, message: "Password reset email sent" });
});

router.post("/msp/settings/users/:userId/temp-password", requireRole("MSPAdmin"), async (req: Request, res: Response) => {
  const mspId = resolveMspIdStrict(req);
  const userId = parseInt(p(req.params["userId"]), 10);
  if (!mspId || isNaN(userId)) { apiError(res, 400, "Invalid params"); return; }

  const tempPassword = `Temp-${randomBytes(6).toString("hex")}`;

  await writeAuditLog({
    req,
    actionType: "user.password.temp_set",
    entityType: "msp_user",
    entityId: String(userId),
    mspId,
  });

  res.json({ ok: true, tempPassword, requireChange: true });
});

router.post("/msp/settings/users/:userId/reset-mfa", requireRole("MSPAdmin"), async (req: Request, res: Response) => {
  const mspId = resolveMspIdStrict(req);
  const userId = parseInt(p(req.params["userId"]), 10);
  if (!mspId || isNaN(userId)) { apiError(res, 400, "Invalid params"); return; }

  await writeAuditLog({
    req,
    actionType: "user.mfa.reset",
    entityType: "msp_user",
    entityId: String(userId),
    mspId,
  });

  res.json({ ok: true, message: "MFA credentials cleared for re-enrollment" });
});

router.patch("/msp/settings/users/:userId/mfa-enforcement", requireRole("MSPAdmin"), async (req: Request, res: Response) => {
  const mspId = resolveMspIdStrict(req);
  const userId = parseInt(p(req.params["userId"]), 10);
  if (!mspId || isNaN(userId)) { apiError(res, 400, "Invalid params"); return; }

  const { enforced } = req.body as { enforced?: boolean };

  await writeAuditLog({
    req,
    actionType: "user.mfa.enforcement_toggle",
    entityType: "msp_user",
    entityId: String(userId),
    mspId,
    metadata: { enforced: !!enforced },
  });

  res.json({ ok: true, enforced: !!enforced });
});

router.patch("/msp/settings/users/:userId/status", requireRole("MSPAdmin"), async (req: Request, res: Response) => {
  const mspId = resolveMspIdStrict(req);
  const userId = parseInt(p(req.params["userId"]), 10);
  if (!mspId || isNaN(userId)) { apiError(res, 400, "Invalid params"); return; }

  const { isActive } = req.body as { isActive?: boolean };
  if (typeof isActive !== "boolean") { apiError(res, 400, "isActive must be boolean"); return; }

  if (!isActive && userId === req.user!.id) {
    apiError(res, 400, "Cannot suspend your own account");
    return;
  }

  await db
    .update(mspUsersTable)
    .set({ isActive, updatedAt: new Date() })
    .where(and(eq(mspUsersTable.userId, userId), eq(mspUsersTable.mspId, mspId)));

  await writeAuditLog({
    req,
    actionType: isActive ? "user.activate" : "user.suspend",
    entityType: "msp_user",
    entityId: String(userId),
    mspId,
  });

  res.json({ ok: true, isActive });
});

router.delete("/msp/settings/users/:userId/sessions", requireRole("MSPAdmin"), async (req: Request, res: Response) => {
  const mspId = resolveMspIdStrict(req);
  const userId = parseInt(p(req.params["userId"]), 10);
  if (!mspId || isNaN(userId)) { apiError(res, 400, "Invalid params"); return; }

  await writeAuditLog({
    req,
    actionType: "user.sessions.revoke_all",
    entityType: "msp_user",
    entityId: String(userId),
    mspId,
  });

  res.json({ ok: true, message: "All sessions revoked" });
});

// ── Billing ───────────────────────────────────────────────────────────────────

router.get("/msp/settings/billing", requireRole("MSPAdmin"), async (req: Request, res: Response) => {
  const mspId = resolveMspIdStrict(req);
  if (!mspId) { apiError(res, 400, "No MSP context"); return; }

  const [sub] = await db
    .select({
      status: mspSubscriptionsTable.status,
      dunningState: mspSubscriptionsTable.dunningState,
      stripeCustomerId: mspSubscriptionsTable.stripeCustomerId,
      stripeSubscriptionId: mspSubscriptionsTable.stripeSubscriptionId,
      stripePriceId: mspSubscriptionsTable.stripePriceId,
      currentPeriodStart: mspSubscriptionsTable.currentPeriodStart,
      currentPeriodEnd: mspSubscriptionsTable.currentPeriodEnd,
      tenantCountSnapshot: mspSubscriptionsTable.tenantCountSnapshot,
      contactEmail: mspSubscriptionsTable.contactEmail,
    })
    .from(mspSubscriptionsTable)
    .where(eq(mspSubscriptionsTable.mspId, mspId))
    .limit(1);

  res.json(sub ?? null);
});

router.post("/msp/settings/billing/portal-session", requireRole("MSPAdmin"), async (req: Request, res: Response) => {
  const mspId = resolveMspIdStrict(req);
  if (!mspId) { apiError(res, 400, "No MSP context"); return; }

  const [sub] = await db
    .select({ stripeCustomerId: mspSubscriptionsTable.stripeCustomerId })
    .from(mspSubscriptionsTable)
    .where(eq(mspSubscriptionsTable.mspId, mspId))
    .limit(1);

  if (!sub?.stripeCustomerId) {
    apiError(res, 404, "No Stripe subscription found for this MSP");
    return;
  }

  let stripeKey: string;
  try {
    stripeKey = getStripeKey();
  } catch (err) {
    apiError(res, 503, "Stripe not configured");
    return;
  }

  const { default: Stripe } = await import("stripe");
  const stripe = new Stripe(stripeKey);

  const returnUrl = req.body.returnUrl as string || `${process.env.REPLIT_DOMAINS?.split(",")[0] ? `https://${process.env.REPLIT_DOMAINS.split(",")[0]}` : "http://localhost"}/portal/settings/billing`;

  const session = await stripe.billingPortal.sessions.create({
    customer: sub.stripeCustomerId,
    return_url: returnUrl,
  });

  res.json({ url: session.url });
});

// ── Email Templates ───────────────────────────────────────────────────────────

router.get("/msp/settings/email-templates", requireRole("MSPAdmin"), async (req: Request, res: Response) => {
  const mspId = resolveMspIdStrict(req);
  if (!mspId) { apiError(res, 400, "No MSP context"); return; }

  // Get all MSP-specific overrides
  const mspOverrides = await db
    .select()
    .from(mspEmailTemplatesTable)
    .where(eq(mspEmailTemplatesTable.mspId, mspId));

  // Get platform defaults
  const platformDefaults = await db
    .select()
    .from(mspEmailTemplatesTable)
    .where(isNull(mspEmailTemplatesTable.mspId));

  // Build merged list: MSP override takes priority over platform default
  const overrideMap = new Map(mspOverrides.map((t) => [t.templateKey, t]));
  const defaultMap = new Map(platformDefaults.map((t) => [t.templateKey, t]));

  const result = MSP_EMAIL_TEMPLATE_KEYS.map((key) => {
    const override = overrideMap.get(key);
    const defaultTpl = defaultMap.get(key);
    return {
      key,
      subject: override?.subject ?? defaultTpl?.subject ?? "",
      body: override?.body ?? defaultTpl?.body ?? "",
      isCustomised: !!override,
      isLocked: MSP_LOCKED_EMAIL_KEYS.has(key as MspEmailTemplateKey),
      requiredMergeFields: REQUIRED_MERGE_FIELDS[key] ?? [],
      updatedAt: override?.updatedAt ?? defaultTpl?.updatedAt ?? null,
    };
  });

  res.json(result);
});

const emailTemplateSchema = z.object({
  subject: z.string().min(5).max(300),
  body: z.string().min(20).max(50000),
});

router.put("/msp/settings/email-templates/:key", requireRole("MSPAdmin"), async (req: Request, res: Response) => {
  const mspId = resolveMspIdStrict(req);
  const key = p(req.params["key"]);
  if (!mspId || !key) { apiError(res, 400, "Invalid params"); return; }

  if (!MSP_EMAIL_TEMPLATE_KEYS.includes(key as MspEmailTemplateKey)) {
    apiError(res, 404, `Unknown template key: ${key}`);
    return;
  }

  if (MSP_LOCKED_EMAIL_KEYS.has(key as MspEmailTemplateKey)) {
    apiError(res, 403, `Template "${key}" is platform-locked and cannot be customised by MSP admins`);
    return;
  }

  const parsed = emailTemplateSchema.safeParse(req.body);
  if (!parsed.success) {
    apiError(res, 400, parsed.error.issues.map((i) => i.message).join("; "));
    return;
  }

  const mergeError = validateMergeFields(key, parsed.data.body);
  if (mergeError) {
    apiError(res, 422, mergeError);
    return;
  }

  const values = {
    mspId,
    templateKey: key as MspEmailTemplateKey,
    subject: parsed.data.subject,
    body: parsed.data.body,
    updatedAt: new Date(),
    updatedByUserId: req.user!.id,
  };

  const [row] = await db
    .insert(mspEmailTemplatesTable)
    .values(values)
    .onConflictDoUpdate({
      target: [mspEmailTemplatesTable.mspId, mspEmailTemplatesTable.templateKey],
      set: { subject: values.subject, body: values.body, updatedAt: values.updatedAt, updatedByUserId: values.updatedByUserId },
    })
    .returning();

  await writeAuditLog({
    req,
    actionType: "email_template.upsert",
    entityType: "msp_email_template",
    entityId: key,
    mspId,
    metadata: { key, subject: parsed.data.subject },
  });

  res.json(row);
});

router.delete("/msp/settings/email-templates/:key", requireRole("MSPAdmin"), async (req: Request, res: Response) => {
  const mspId = resolveMspIdStrict(req);
  const key = p(req.params["key"]);
  if (!mspId || !key) { apiError(res, 400, "Invalid params"); return; }

  await db
    .delete(mspEmailTemplatesTable)
    .where(
      and(
        eq(mspEmailTemplatesTable.mspId, mspId),
        eq(mspEmailTemplatesTable.templateKey, key as MspEmailTemplateKey),
      ),
    );

  await writeAuditLog({
    req,
    actionType: "email_template.delete",
    entityType: "msp_email_template",
    entityId: key,
    mspId,
  });

  res.json({ ok: true });
});

// ── Customer Agreement Template ───────────────────────────────────────────────

router.get("/msp/settings/agreement-template", requireRole("MSPAdmin"), async (req: Request, res: Response) => {
  const mspId = resolveMspIdStrict(req);
  if (!mspId) { apiError(res, 400, "No MSP context"); return; }

  const [config] = await db
    .select({ customerAgreementTemplate: mspConnectorConfigsTable.customerAgreementTemplate, updatedAt: mspConnectorConfigsTable.updatedAt })
    .from(mspConnectorConfigsTable)
    .where(eq(mspConnectorConfigsTable.mspId, mspId))
    .limit(1);

  res.json({ template: config?.customerAgreementTemplate ?? null, updatedAt: config?.updatedAt ?? null });
});

router.put("/msp/settings/agreement-template", requireRole("MSPAdmin"), async (req: Request, res: Response) => {
  const mspId = resolveMspIdStrict(req);
  if (!mspId) { apiError(res, 400, "No MSP context"); return; }

  const body = z.object({ template: z.string().min(50).max(100000) }).safeParse(req.body);
  if (!body.success) {
    apiError(res, 400, body.error.issues.map((i) => i.message).join("; "));
    return;
  }

  const values = {
    mspId,
    customerAgreementTemplate: body.data.template,
    updatedAt: new Date(),
    updatedByUserId: req.user!.id,
    connectorMode: "delegated" as MspConnectorMode,
  };

  await db
    .insert(mspConnectorConfigsTable)
    .values(values)
    .onConflictDoUpdate({
      target: mspConnectorConfigsTable.mspId,
      set: { customerAgreementTemplate: values.customerAgreementTemplate, updatedAt: values.updatedAt },
    });

  await writeAuditLog({
    req,
    actionType: "agreement_template.update",
    entityType: "msp_connector_config",
    entityId: String(mspId),
    mspId,
  });

  res.json({ ok: true });
});

// ── MSP Mailbox Connector (outbound email) ────────────────────────────────────
//
// Flow:
//   1. MSP admin GETs /mailbox to see current status.
//   2. POSTs /mailbox/connect with { mailboxUpn, fromDisplayName } to get a consentUrl.
//   3. Opens the consentUrl — Microsoft admin-consent screen for their tenant.
//   4. Microsoft redirects to /mailbox/callback — server burns state, upserts connector.
//   5. MSP is redirected back to the portal Settings page.
//
// No client secret is stored. The platform MT app's client_credentials grant is used
// after admin consent is granted for the MSP's tenant with Mail.Send scope.
// ──────────────────────────────────────────────────────────────────────────────

router.get("/msp/settings/connector/mailbox", requireRole("MSPAdmin"), async (req: Request, res: Response) => {
  const mspId = resolveMspIdStrict(req);
  if (!mspId) { apiError(res, 400, "No MSP context"); return; }

  const [row] = await db
    .select({
      connectorId: mspMailboxConnectorsTable.connectorId,
      tenantId: mspMailboxConnectorsTable.tenantId,
      mailboxUpn: mspMailboxConnectorsTable.mailboxUpn,
      fromDisplayName: mspMailboxConnectorsTable.fromDisplayName,
      isActive: mspMailboxConnectorsTable.isActive,
      consentedAt: mspMailboxConnectorsTable.consentedAt,
      revokedAt: mspMailboxConnectorsTable.revokedAt,
      updatedAt: mspMailboxConnectorsTable.updatedAt,
    })
    .from(mspMailboxConnectorsTable)
    .where(eq(mspMailboxConnectorsTable.mspId, mspId))
    .limit(1);

  res.json({
    connected: !!(row?.isActive),
    mtAppConfigured: mtAppCredentialsPresent(),
    connector: row ?? null,
  });
});

const mailboxConnectSchema = z.object({
  mailboxUpn: z.string().email("mailboxUpn must be a valid email address"),
  fromDisplayName: z.string().min(2).max(120),
  returnPath: z.string().optional(),
});

router.post("/msp/settings/connector/mailbox/connect", requireRole("MSPAdmin"), async (req: Request, res: Response) => {
  const mspId = resolveMspIdStrict(req);
  if (!mspId) { apiError(res, 400, "No MSP context"); return; }

  if (!mtAppCredentialsPresent()) {
    apiError(res, 503, "Multi-tenant app credentials not configured (MT_APP_CLIENT_ID / MT_APP_CLIENT_SECRET). Contact the platform admin.");
    return;
  }

  const parsed = mailboxConnectSchema.safeParse(req.body);
  if (!parsed.success) {
    apiError(res, 400, parsed.error.issues.map((i) => i.message).join("; "));
    return;
  }

  const state = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  await db.insert(mspMailboxConsentStatesTable).values({
    state,
    mspId,
    mailboxUpn: parsed.data.mailboxUpn,
    fromDisplayName: parsed.data.fromDisplayName,
    returnPath: parsed.data.returnPath ?? "/settings/connector",
    requestedByUserId: req.user!.id,
    expiresAt,
  });

  // Build callback URL — uses the same base-URL helper as the consent flow
  const portalBase = getPortalBaseUrl();
  const proto = req.headers["x-forwarded-proto"] ?? req.protocol;
  const host = req.headers["x-forwarded-host"] ?? req.headers.host;
  const callbackBase = portalBase ?? `${proto}://${host}`;
  const callbackUrl = `${callbackBase}/api/msp/settings/connector/mailbox/callback`;

  // We use "common" as the tenant hint so the MSP's admin can use their own tenant login
  const consentUrl = buildAdminConsentUrl("common", state, callbackUrl);

  await writeAuditLog({
    req,
    actionType: "mailbox_connector.connect.initiated",
    entityType: "msp_mailbox_connector",
    entityId: String(mspId),
    mspId,
    metadata: { mailboxUpn: parsed.data.mailboxUpn, fromDisplayName: parsed.data.fromDisplayName },
  });

  res.json({ consentUrl, state, expiresAt });
});

// OAuth callback — Microsoft redirects here after admin consent
router.get("/msp/settings/connector/mailbox/callback", async (req: Request, res: Response) => {
  const { tenant, admin_consent, state, error, error_subcode } = req.query as Record<string, string | undefined>;

  const portalBase = getPortalBaseUrl() ?? "";

  // ── Declined ────────────────────────────────────────────────────────────────
  if (error === "access_denied" || error_subcode === "cancel") {
    log.warn({ tenant, state, error }, "MSP mailbox consent: admin declined");
    if (state) {
      await db
        .update(mspMailboxConsentStatesTable)
        .set({ usedAt: new Date() })
        .where(eq(mspMailboxConsentStatesTable.state, state));
    }
    res.redirect(`${portalBase}/portal/settings/connector?mailbox_consent=declined`);
    return;
  }

  // ── Success validation ──────────────────────────────────────────────────────
  if (!tenant || admin_consent?.toLowerCase() !== "true" || !state) {
    log.warn({ tenant, admin_consent, state }, "MSP mailbox consent: unexpected callback params");
    res.status(400).send("Invalid consent callback parameters.");
    return;
  }

  // Validate and burn the state token
  const now = new Date();
  const [stateRow] = await db
    .select()
    .from(mspMailboxConsentStatesTable)
    .where(
      and(
        eq(mspMailboxConsentStatesTable.state, state),
        isNull(mspMailboxConsentStatesTable.usedAt),
        gte(mspMailboxConsentStatesTable.expiresAt, now),
      ),
    )
    .limit(1);

  if (!stateRow) {
    log.warn({ state, tenant }, "MSP mailbox consent: state token invalid, expired, or already used");
    res.status(400).send("This consent link has expired or has already been used. Please request a new one.");
    return;
  }

  // Burn the state token
  await db
    .update(mspMailboxConsentStatesTable)
    .set({ usedAt: now })
    .where(eq(mspMailboxConsentStatesTable.state, state));

  // Upsert the mailbox connector
  await db
    .insert(mspMailboxConnectorsTable)
    .values({
      mspId: stateRow.mspId,
      tenantId: tenant,
      mailboxUpn: stateRow.mailboxUpn,
      fromDisplayName: stateRow.fromDisplayName,
      isActive: true,
      consentedAt: now,
      revokedAt: undefined,
      createdByUserId: stateRow.requestedByUserId ?? undefined,
    })
    .onConflictDoUpdate({
      target: mspMailboxConnectorsTable.mspId,
      set: {
        tenantId: tenant,
        mailboxUpn: stateRow.mailboxUpn,
        fromDisplayName: stateRow.fromDisplayName,
        isActive: true,
        consentedAt: now,
        revokedAt: undefined,
        updatedAt: now,
      },
    });

  log.info({ mspId: stateRow.mspId, tenant, mailboxUpn: stateRow.mailboxUpn }, "MSP mailbox connector activated");

  const returnPath = stateRow.returnPath ?? "/settings/connector";
  res.redirect(`${portalBase}/portal${returnPath}?mailbox_consent=success`);
});

router.delete("/msp/settings/connector/mailbox", requireRole("MSPAdmin"), async (req: Request, res: Response) => {
  const mspId = resolveMspIdStrict(req);
  if (!mspId) { apiError(res, 400, "No MSP context"); return; }

  const [row] = await db
    .update(mspMailboxConnectorsTable)
    .set({ isActive: false, revokedAt: new Date(), updatedAt: new Date() })
    .where(eq(mspMailboxConnectorsTable.mspId, mspId))
    .returning({ connectorId: mspMailboxConnectorsTable.connectorId });

  if (!row) {
    apiError(res, 404, "No mailbox connector found for this MSP");
    return;
  }

  await writeAuditLog({
    req,
    actionType: "mailbox_connector.disconnect",
    entityType: "msp_mailbox_connector",
    entityId: String(mspId),
    mspId,
  });

  res.json({ ok: true });
});

// ── Sessions ──────────────────────────────────────────────────────────────────

router.get("/msp/settings/sessions", requireRole("MSPAdmin"), async (req: Request, res: Response) => {
  const mspId = resolveMspIdStrict(req);
  if (!mspId) { apiError(res, 400, "No MSP context"); return; }

  const users = await db
    .select({ userId: mspUsersTable.userId })
    .from(mspUsersTable)
    .where(and(eq(mspUsersTable.mspId, mspId), eq(mspUsersTable.isActive, true)));

  const userIds = users.map((u) => u.userId);
  if (userIds.length === 0) {
    res.json([]);
    return;
  }

  const tokens = await db
    .select({
      id: mspRefreshTokensTable.id,
      userId: mspRefreshTokensTable.userId,
      tokenHash: mspRefreshTokensTable.tokenHash,
      issuedAt: mspRefreshTokensTable.issuedAt,
      expiresAt: mspRefreshTokensTable.expiresAt,
      userAgent: mspRefreshTokensTable.userAgent,
      ipAddress: mspRefreshTokensTable.ipAddress,
      email: usersTable.email,
      name: usersTable.name,
    })
    .from(mspRefreshTokensTable)
    .innerJoin(usersTable, eq(usersTable.id, mspRefreshTokensTable.userId))
    .where(
      and(
        isNull(mspRefreshTokensTable.revokedAt),
        inArray(mspRefreshTokensTable.userId, userIds),
      ),
    )
    .orderBy(desc(mspRefreshTokensTable.issuedAt))
    .limit(100);

  res.json(tokens);
});

router.delete("/msp/settings/sessions/:tokenHash", requireRole("MSPAdmin"), async (req: Request, res: Response) => {
  const mspId = resolveMspIdStrict(req);
  const tokenHash = p(req.params["tokenHash"]);
  if (!mspId || !tokenHash) { apiError(res, 400, "Invalid params"); return; }

  // Verify the token belongs to a user in this MSP
  const users = await db
    .select({ userId: mspUsersTable.userId })
    .from(mspUsersTable)
    .where(and(eq(mspUsersTable.mspId, mspId), eq(mspUsersTable.isActive, true)));

  const userIds = users.map((u) => u.userId);

  const [token] = await db
    .select({ id: mspRefreshTokensTable.id, userId: mspRefreshTokensTable.userId })
    .from(mspRefreshTokensTable)
    .where(eq(mspRefreshTokensTable.tokenHash, tokenHash))
    .limit(1);

  if (!token || !userIds.includes(token.userId)) {
    apiError(res, 404, "Session not found");
    return;
  }

  await db
    .update(mspRefreshTokensTable)
    .set({ revokedAt: new Date() })
    .where(eq(mspRefreshTokensTable.tokenHash, tokenHash));

  await writeAuditLog({
    req,
    actionType: "session.revoke",
    entityType: "session",
    entityId: tokenHash.slice(0, 12),
    mspId,
  });

  res.json({ ok: true });
});

// ── Invite helpers ────────────────────────────────────────────────────────────

function getMspPortalInviteUrl(token: string): string {
  const base = process.env.SITE_URL
    ?? (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "");
  return `${base}/portal/invite/${token}`;
}

// ── Invites ───────────────────────────────────────────────────────────────────

const createInviteSchema = z.object({
  email: z.string().email("A valid email is required"),
  mspRole: z.enum(["MSPAdmin", "MSPOperator"]),
});

router.post("/msp/settings/invites", requireRole("MSPAdmin"), async (req: Request, res: Response) => {
  const mspId = resolveMspIdStrict(req);
  if (!mspId) { apiError(res, 400, "No MSP context"); return; }

  const parsed = createInviteSchema.safeParse(req.body);
  if (!parsed.success) {
    apiError(res, 400, parsed.error.issues.map((i) => i.message).join("; "));
    return;
  }

  const email = parsed.data.email.toLowerCase().trim();

  // Check the user isn't already an active member of this MSP
  const [existingUser] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, email))
    .limit(1);

  if (existingUser) {
    const [existingMember] = await db
      .select({ id: mspUsersTable.id })
      .from(mspUsersTable)
      .where(and(eq(mspUsersTable.userId, existingUser.id), eq(mspUsersTable.mspId, mspId), eq(mspUsersTable.isActive, true)))
      .limit(1);
    if (existingMember) {
      apiError(res, 409, "This user is already an active member of your MSP");
      return;
    }
  }

  // Check for a still-valid pending invite to the same email
  const now = new Date();
  const [existingInvite] = await db
    .select({ id: mspInvitesTable.id })
    .from(mspInvitesTable)
    .where(
      and(
        eq(mspInvitesTable.mspId, mspId),
        eq(mspInvitesTable.invitedEmail, email),
        isNull(mspInvitesTable.usedAt),
        gte(mspInvitesTable.expiresAt, now),
      ),
    )
    .limit(1);

  if (existingInvite) {
    apiError(res, 409, "An unexpired invite already exists for this email. Revoke it first if you need to resend.");
    return;
  }

  const [msp] = await db
    .select({ name: mspsTable.name })
    .from(mspsTable)
    .where(eq(mspsTable.id, mspId))
    .limit(1);

  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);

  const [invite] = await db
    .insert(mspInvitesTable)
    .values({
      token,
      mspId,
      invitedEmail: email,
      mspRole: parsed.data.mspRole,
      invitedByUserId: req.user!.id,
      expiresAt,
    })
    .returning();

  const inviteUrl = getMspPortalInviteUrl(token);
  const mspName = msp?.name ?? "Your IT Service Provider";

  const bodyHtml = `
    <h2 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#0A2540;">You've been invited to join ${mspName}</h2>
    <p>You have been invited to join the ${mspName} team portal as <strong>${parsed.data.mspRole === "MSPAdmin" ? "MSP Admin" : "MSP Operator"}</strong>.</p>
    <p>Click the link below to accept your invitation and set up your account. This link expires in <strong>72 hours</strong>.</p>
    ${emailButton("Accept Invitation", inviteUrl)}
    <p style="margin-top:24px;font-size:13px;color:#64748b;">If you weren't expecting this, you can safely ignore this email.</p>
  `;

  void sendEmailForMsp(mspId, email, `You're invited to join ${mspName}`, bodyHtml);

  await writeAuditLog({
    req,
    actionType: "invite.create",
    entityType: "msp_invite",
    entityId: String(invite!.id),
    mspId,
    metadata: { email, mspRole: parsed.data.mspRole },
  });

  log.info({ mspId, email, role: parsed.data.mspRole }, "msp-settings: invite created");
  res.status(201).json(invite);
});

router.get("/msp/settings/invites", requireRole("MSPAdmin"), async (req: Request, res: Response) => {
  const mspId = resolveMspIdStrict(req);
  if (!mspId) { apiError(res, 400, "No MSP context"); return; }

  const now = new Date();
  const invites = await db
    .select({
      id: mspInvitesTable.id,
      invitedEmail: mspInvitesTable.invitedEmail,
      mspRole: mspInvitesTable.mspRole,
      expiresAt: mspInvitesTable.expiresAt,
      createdAt: mspInvitesTable.createdAt,
      inviterEmail: usersTable.email,
      inviterName: usersTable.name,
    })
    .from(mspInvitesTable)
    .leftJoin(usersTable, eq(usersTable.id, mspInvitesTable.invitedByUserId))
    .where(
      and(
        eq(mspInvitesTable.mspId, mspId),
        isNull(mspInvitesTable.usedAt),
        gte(mspInvitesTable.expiresAt, now),
      ),
    )
    .orderBy(desc(mspInvitesTable.createdAt));

  res.json(invites);
});

router.delete("/msp/settings/invites/:inviteId", requireRole("MSPAdmin"), async (req: Request, res: Response) => {
  const mspId = resolveMspIdStrict(req);
  const inviteId = parseInt(p(req.params["inviteId"]), 10);
  if (!mspId || isNaN(inviteId)) { apiError(res, 400, "Invalid params"); return; }

  const [deleted] = await db
    .delete(mspInvitesTable)
    .where(and(eq(mspInvitesTable.id, inviteId), eq(mspInvitesTable.mspId, mspId), isNull(mspInvitesTable.usedAt)))
    .returning({ id: mspInvitesTable.id });

  if (!deleted) { apiError(res, 404, "Invite not found or already used"); return; }

  await writeAuditLog({
    req,
    actionType: "invite.revoke",
    entityType: "msp_invite",
    entityId: String(inviteId),
    mspId,
  });

  res.json({ ok: true });
});

export default router;
