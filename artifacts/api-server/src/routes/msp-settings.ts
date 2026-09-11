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
  tenantsTable,
  mspStaffCustomerScopesTable,
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
  passwordResetTokensTable,
  mfaEnrollmentsTable,
  mfaChallengesTable,
  webauthnCredentialsTable,
  webauthnChallengesTable,
  MSP_LOCKED_EMAIL_KEYS,
  MSP_EMAIL_TEMPLATE_KEYS,
  type MspEmailTemplateKey,
  type MspConnectorMode,
  type MspRole,
} from "@workspace/db";
import { eq, and, desc, isNull, inArray, gte, lt, count } from "drizzle-orm";
import { requireAuth, requireCapability, effectiveMspRole } from "../middlewares/requireAuth.ts";
import { roleClearsLadderFloor } from "../middlewares/rbac-ladder.ts";
import { setGrantRole, usersHoldingGrantRole } from "../middlewares/rbac-capability.ts";
import { CAPABILITY_COLUMN_ROLE_KEYS, LEGACY_ROLE } from "@workspace/db/rbac/legacy-ladder";
import { z } from "zod";
import { randomBytes, createHash, randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import { getRequestContext } from "../lib/request-context.ts";
import { logger } from "../lib/logger.ts";
const log = logger.child({ channel: "tenant.msp-admin" });

import { resolveMspIdStrict } from "../lib/resolve-msp-id.ts";
import { setSecretValue, getSecretMetadata } from "../lib/azure-keyvault.ts";
import { getStripeKey } from "../lib/stripe.ts";
import { buildAdminConsentUrl, mtAppCredentialsPresent } from "../lib/graph.ts";
import { getMspPortalBaseUrl } from "../lib/portal-url.ts";
import { sendEmailForMsp, emailButton, brandedEmail, sendEmailFromTemplate, passwordResetEmail } from "../lib/mailer.ts";
import { revokeAllOtherSessions } from "../lib/session-tracking.ts";

const router: IRouter = Router();

function p(val: string | string[] | undefined): string {
  return Array.isArray(val) ? (val[0] ?? "") : (val ?? "");
}

function apiError(res: Response, status: number, message: string) {
  res.status(status).json({ error: message });
}

// Target-role ceiling check for the credential/security-action routes below
// (Git #3032). requireCapability("ladder.msp-admin") only enforces a FLOOR on the caller —
// it says nothing about the target — and every one of these routes' target
// lookup was `mspId`-ownership only, which let any real MSPAdmin reset the
// password / clear the MFA / suspend a PlatformAdmin at the same MSP (full
// privilege escalation, no interaction with the target needed). Mirrors the
// existing pattern that already keeps PlatformAdmin unassignable through this
// surface (`updateRoleSchema`/`createInviteSchema` above only ever enumerate
// `[`MSPAdmin`, `MSPOperator`]`), generalized to a real role-index ceiling so
// a peer or higher-privileged target is rejected regardless of which two
// tiers are involved, not just the PlatformAdmin case.
//
// #2458 — this was `roleIndex(target) >= roleIndex(caller)`, the last request-path
// reader of the ROLE_ORDER index comparison outside requireRole itself. It now asks
// the same evaluator requireRole asks, because the two questions are the same
// question: "does the target clear the caller's own rung?" is exactly the ladder
// capability of the caller's rung, evaluated with the TARGET as the principal.
// `ladder.msp-admin`'s allow set is {MSPAdmin, PlatformAdmin}, so an MSPAdmin caller
// rejects an MSPAdmin or PlatformAdmin target and permits an MSPOperator — identical
// to the index comparison, and it now moves with the data instead of against it.
//
// Both fail-closed edges of the old arithmetic are preserved on purpose, since this
// function returning `true` is what REJECTS:
//   - caller holds no recognised rung → old `idx(target) >= -1` was always true, so
//     the action was always rejected. Kept explicitly below.
//   - target holds no recognised rung → old `-1 >= idx(caller)` was false, so the
//     action was permitted; the evaluator returns `unset` (default deny) for a
//     principal holding no role, which is the same answer.
async function targetOutranksOrEqualsCaller(req: Request, targetRole: MspRole | null | undefined): Promise<boolean> {
  const callerRole = effectiveMspRole(req.user!);
  // No rung to compare against — reject, exactly as roleIndex()'s -1 floor did.
  if (!callerRole) return true;

  const outcome = await roleClearsLadderFloor(targetRole ?? null, callerRole);
  // Unreadable model — reject. This guard exists to stop a privilege escalation
  // (Git #3032); "could not check" must never resolve to "go ahead".
  if (outcome.kind === "unavailable") return true;
  return outcome.kind === "allow";
}

async function rejectIfTargetOutranksCaller(req: Request, res: Response, targetRole: MspRole | null | undefined): Promise<boolean> {
  if (await targetOutranksOrEqualsCaller(req, targetRole)) {
    apiError(res, 403, "Cannot perform this action on a user with equal or higher privileges");
    return true;
  }
  return false;
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
// Role: Assessment (lowest real role) — this endpoint returns purely cosmetic
// branding data (name, logoUrl, primaryColor) needed by every authenticated page
// for white-label display. No sensitive MSP-internal data is exposed here.
// The write/management surface (PATCH /msp/settings/profile) remains MSPAdmin-gated.

router.get("/msp/profile", requireCapability("ladder.free"), async (req: Request, res: Response) => {
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

router.get("/msp/settings/profile", requireCapability("ladder.msp-admin"), async (req: Request, res: Response) => {
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

router.patch("/msp/settings/profile", requireCapability("ladder.msp-admin"), async (req: Request, res: Response) => {
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

router.get("/msp/settings/connector", requireCapability("ladder.msp-admin"), async (req: Request, res: Response) => {
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

router.put("/msp/settings/connector", requireCapability("ladder.msp-admin"), async (req: Request, res: Response) => {
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

router.put("/msp/settings/connector/exchange", requireCapability("ladder.msp-admin"), async (req: Request, res: Response) => {
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

router.delete("/msp/settings/connector/exchange", requireCapability("ladder.msp-admin"), async (req: Request, res: Response) => {
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

router.get("/msp/settings/service-accounts", requireCapability("ladder.msp-admin"), async (req: Request, res: Response) => {
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

router.post("/msp/settings/service-accounts", requireCapability("ladder.msp-admin"), async (req: Request, res: Response) => {
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

router.delete("/msp/settings/service-accounts/:id", requireCapability("ladder.msp-admin"), async (req: Request, res: Response) => {
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

router.get("/msp/settings/users", requireCapability("ladder.msp-admin"), async (req: Request, res: Response) => {
  const mspId = resolveMspIdStrict(req);
  if (!mspId) { apiError(res, 400, "No MSP context"); return; }

  const users = await db
    .select({
      // id and userId were two DIFFERENT ids pre-refactor (msp_users.id and
      // users.id). msp_users is gone, so both are the same users.id now. Both
      // keys are kept in the payload rather than collapsed to one: the
      // user-management page reads them interchangeably (u.userId ?? u.id, and
      // u.userId === id || u.id === id), which was only ever correct by
      // accident while the two id-spaces happened to overlap.
      id: usersTable.id,
      userId: usersTable.id,
      mspRole: usersTable.mspRole,
      isActive: usersTable.isActive,
      lastLoginAt: usersTable.lastLoginAt,
      createdAt: usersTable.createdAt,
      email: usersTable.email,
      name: usersTable.name,
    })
    .from(usersTable)
    .where(eq(usersTable.mspId, mspId))
    .orderBy(desc(usersTable.createdAt));

  // Real per-staff customer-scope counts (replaces the old mock
  // assignedCustomersCount). 0 rows = UNRESTRICTED (full MSP access) — the UI
  // renders that as "All customers", any positive number as the scoped subset.
  const scopeCounts = await db
    .select({ staffUserId: mspStaffCustomerScopesTable.staffUserId, n: count() })
    .from(mspStaffCustomerScopesTable)
    .where(eq(mspStaffCustomerScopesTable.mspId, mspId))
    .groupBy(mspStaffCustomerScopesTable.staffUserId);
  const scopeCountByUser = new Map(scopeCounts.map((r) => [r.staffUserId, Number(r.n)]));

  // #2460 — `canApprovePurchases` was a column on this row. It is now a membership
  // of the platform `cap.purchases.approve` role, so the toggle's state is a
  // separate read. The wire field name is deliberately unchanged: the MSP settings
  // UI reads `canApprovePurchases` and PATCHes the same name back, and renaming a
  // response field is a client change this migration has no business forcing.
  //
  // This is the GRANT, not the capability. An MSPAdmin can approve purchases without
  // holding this role; showing their toggle as ON would tell an admin they had
  // granted something they never granted. `msp-v1.ts`'s decide route asks the
  // capability question, which is the one that actually gates the action.
  const granted = await usersHoldingGrantRole(
    "msp",
    CAPABILITY_COLUMN_ROLE_KEYS.approvePurchases,
    users.map((u) => u.userId),
  );
  if (granted === null) {
    // Unseeded/unreadable model. Rendering every toggle as OFF would look like a
    // mass revoke, so this is reported rather than guessed at.
    apiError(res, 503, "Role data is temporarily unavailable");
    return;
  }

  res.json(
    users.map((u) => ({
      ...u,
      canApprovePurchases: granted.has(u.userId),
      // assignedCustomersCount === 0 means unrestricted, NOT "no access".
      assignedCustomersCount: scopeCountByUser.get(u.userId) ?? 0,
    })),
  );
});

// ── Per-staff customer-access scoping (msp_staff_customer_scopes) ──────────────
// GET returns the caller-MSP's customer list plus the target staff member's
// currently-assigned customer ids. An empty assigned list means UNRESTRICTED
// (full MSP access) — the additive, opt-in default. Scoping applies only to
// MSPAdmin/MSPOperator staff (enforced by assertCustomerAccess &
// resolveStaffScopedCustomerIds on every customer-scoped route).

router.get("/msp/settings/users/:userId/customer-scopes", requireCapability("ladder.msp-admin"), async (req: Request, res: Response) => {
  const mspId = resolveMspIdStrict(req);
  const userId = parseInt(p(req.params["userId"]), 10);
  if (!mspId || isNaN(userId)) { apiError(res, 400, "Invalid params"); return; }

  const [target] = await db
    .select({ mspRole: usersTable.mspRole })
    .from(usersTable)
    .where(and(eq(usersTable.id, userId), eq(usersTable.mspId, mspId)))
    .limit(1);
  if (!target) { apiError(res, 404, "User not found in this MSP"); return; }

  const [allCustomers, assigned] = await Promise.all([
    db
      .select({ id: tenantsTable.id, name: tenantsTable.customerName, status: tenantsTable.status })
      .from(tenantsTable)
      .where(eq(tenantsTable.mspId, mspId))
      .orderBy(tenantsTable.customerName),
    db
      .select({ customerId: mspStaffCustomerScopesTable.customerId })
      .from(mspStaffCustomerScopesTable)
      .where(and(
        eq(mspStaffCustomerScopesTable.staffUserId, userId),
        eq(mspStaffCustomerScopesTable.mspId, mspId),
      )),
  ]);

  res.json({
    mspRole: target.mspRole,
    // Scoping is meaningful only for these staff roles; the UI hides the picker otherwise.
    scopable: target.mspRole === LEGACY_ROLE.mspAdmin || target.mspRole === LEGACY_ROLE.mspOperator,
    allCustomers,
    assignedCustomerIds: assigned.map((a) => a.customerId),
  });
});

const updateScopesSchema = z.object({
  customerIds: z.array(z.number().int().positive()),
});

router.put("/msp/settings/users/:userId/customer-scopes", requireCapability("ladder.msp-admin"), async (req: Request, res: Response) => {
  const mspId = resolveMspIdStrict(req);
  const userId = parseInt(p(req.params["userId"]), 10);
  if (!mspId || isNaN(userId)) { apiError(res, 400, "Invalid params"); return; }

  const parsed = updateScopesSchema.safeParse(req.body);
  if (!parsed.success) {
    apiError(res, 400, parsed.error.issues.map((i) => i.message).join("; "));
    return;
  }
  // De-dupe the requested set.
  const requestedIds = [...new Set(parsed.data.customerIds)];

  // Target must be a staff member in the caller's own MSP.
  const [target] = await db
    .select({ mspRole: usersTable.mspRole })
    .from(usersTable)
    .where(and(eq(usersTable.id, userId), eq(usersTable.mspId, mspId)))
    .limit(1);
  if (!target) { apiError(res, 404, "User not found in this MSP"); return; }
  if (target.mspRole !== LEGACY_ROLE.mspAdmin && target.mspRole !== LEGACY_ROLE.mspOperator) {
    apiError(res, 400, "Customer scoping applies only to MSP staff (MSPAdmin/MSPOperator)");
    return;
  }

  // Every requested customer must belong to THIS MSP — never let a scope row
  // grant (or even reference) a customer outside the caller's own tenant.
  if (requestedIds.length > 0) {
    const owned = await db
      .select({ id: tenantsTable.id })
      .from(tenantsTable)
      .where(and(eq(tenantsTable.mspId, mspId), inArray(tenantsTable.id, requestedIds)));
    if (owned.length !== requestedIds.length) {
      apiError(res, 400, "One or more customers do not belong to this MSP");
      return;
    }
  }

  // Replace the whole set atomically: clear this staff member's rows in this
  // MSP, then insert the new set. An empty set = unrestricted (full access).
  await db.transaction(async (tx) => {
    await tx
      .delete(mspStaffCustomerScopesTable)
      .where(and(
        eq(mspStaffCustomerScopesTable.staffUserId, userId),
        eq(mspStaffCustomerScopesTable.mspId, mspId),
      ));
    if (requestedIds.length > 0) {
      await tx.insert(mspStaffCustomerScopesTable).values(
        requestedIds.map((customerId) => ({
          mspId,
          staffUserId: userId,
          customerId,
          createdByUserId: req.user!.id,
        })),
      );
    }
  });

  await writeAuditLog({
    req,
    actionType: "user.customer_scopes.update",
    entityType: "msp_user",
    entityId: String(userId),
    mspId,
    metadata: { customerIds: requestedIds, unrestricted: requestedIds.length === 0 },
  });

  res.json({ ok: true, assignedCustomerIds: requestedIds, unrestricted: requestedIds.length === 0 });
});

const updateRoleSchema = z.object({
  mspRole: z.enum([LEGACY_ROLE.mspAdmin, LEGACY_ROLE.mspOperator]),
});

router.patch("/msp/settings/users/:userId/role", requireCapability("ladder.msp-admin"), async (req: Request, res: Response) => {
  const mspId = resolveMspIdStrict(req);
  const userId = parseInt(p(req.params["userId"]), 10);
  if (!mspId || isNaN(userId)) { apiError(res, 400, "Invalid params"); return; }

  const parsed = updateRoleSchema.safeParse(req.body);
  if (!parsed.success) {
    apiError(res, 400, parsed.error.issues.map((i) => i.message).join("; "));
    return;
  }

  const [updated] = await db
    .update(usersTable)
    .set({ mspRole: parsed.data.mspRole, updatedAt: new Date() })
    .where(and(eq(usersTable.id, userId), eq(usersTable.mspId, mspId)))
    .returning({ id: usersTable.id });

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

router.patch("/msp/settings/users/:userId/approve-purchases", requireCapability("ladder.msp-admin"), async (req: Request, res: Response) => {
  const mspId = resolveMspIdStrict(req);
  const userId = parseInt(p(req.params["userId"]), 10);
  if (!mspId || isNaN(userId)) { apiError(res, 400, "Invalid params"); return; }

  const parsed = updateApprovePurchasesSchema.safeParse(req.body);
  if (!parsed.success) {
    apiError(res, 400, parsed.error.issues.map((i) => i.message).join("; "));
    return;
  }

  // #2460 — the target must still be a real member of the caller's MSP before
  // anything is granted. That check used to be the UPDATE's own WHERE clause; with
  // the column gone it has to be made explicitly, because the grant row lives in
  // `msp_user_roles` and knows nothing about which MSP a user belongs to.
  const [target] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(and(eq(usersTable.id, userId), eq(usersTable.mspId, mspId)))
    .limit(1);

  if (!target) { apiError(res, 404, "User not found in this MSP"); return; }

  // Was `UPDATE users SET can_approve_purchases = $1`. Now a membership of the
  // platform `cap.purchases.approve` role — the same grant #2457's seed carried the
  // column's live values into, so an existing grant is untouched and a new one lands
  // in the place the evaluator actually reads.
  const result = await setGrantRole(
    "msp",
    userId,
    CAPABILITY_COLUMN_ROLE_KEYS.approvePurchases,
    parsed.data.canApprovePurchases,
    req.user?.id ?? null,
  );
  if (!result.ok) { apiError(res, 503, "Role data is temporarily unavailable"); return; }

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

router.delete("/msp/settings/users/:userId", requireCapability("ladder.msp-admin"), async (req: Request, res: Response) => {
  const mspId = resolveMspIdStrict(req);
  const userId = parseInt(p(req.params["userId"]), 10);
  if (!mspId || isNaN(userId)) { apiError(res, 400, "Invalid params"); return; }

  // Cannot remove self
  if (userId === req.user!.id) {
    apiError(res, 400, "Cannot remove your own account from the MSP");
    return;
  }

  const [removed] = await db
    .update(usersTable)
    .set({ isActive: false, updatedAt: new Date() })
    .where(and(eq(usersTable.id, userId), eq(usersTable.mspId, mspId)))
    .returning({ id: usersTable.id });

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

// Real implementation of the same token/email flow as the self-service
// POST /auth/forgot-password (passwordResetTokensTable + "password-reset"
// template) — matches the customer-side portal.ts /portal/team/:userId/reset-password fix.
const MSP_RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour, matches /auth/forgot-password

router.post("/msp/settings/users/:userId/reset-password", requireCapability("ladder.msp-admin"), async (req: Request, res: Response) => {
  const mspId = resolveMspIdStrict(req);
  const userId = parseInt(p(req.params["userId"]), 10);
  if (!mspId || isNaN(userId)) { apiError(res, 400, "Invalid params"); return; }

  // Ownership check: the target user must belong to the caller's MSP.
  const [target] = await db
    .select({ id: usersTable.id, email: usersTable.email, name: usersTable.name, mspRole: usersTable.mspRole })
    .from(usersTable)
    .where(and(eq(usersTable.id, userId), eq(usersTable.mspId, mspId)))
    .limit(1);
  if (!target) { apiError(res, 404, "User not found in this MSP"); return; }
  if (await rejectIfTargetOutranksCaller(req, res, target.mspRole)) return;

  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + MSP_RESET_TOKEN_TTL_MS);
  await db.insert(passwordResetTokensTable).values({ userId, token, expiresAt });

  const resetUrl = `${getMspPortalBaseUrl()}/reset-password?token=${token}`;
  void sendEmailFromTemplate(
    "password-reset",
    target.email,
    { resetLink: resetUrl },
    "Reset your Shane McCaw Consulting portal password",
    passwordResetEmail({ resetUrl }),
  ).catch((e) => log.warn({ err: e, userId }, "msp-settings/reset-password: email failed (non-fatal)"));

  await writeAuditLog({
    req,
    actionType: "user.password.reset_email_sent",
    entityType: "msp_user",
    entityId: String(userId),
    mspId,
  });

  res.json({ ok: true, message: "Password reset email sent" });
});

router.post("/msp/settings/users/:userId/temp-password", requireCapability("ladder.msp-admin"), async (req: Request, res: Response) => {
  const mspId = resolveMspIdStrict(req);
  const userId = parseInt(p(req.params["userId"]), 10);
  if (!mspId || isNaN(userId)) { apiError(res, 400, "Invalid params"); return; }

  // Ownership check: the target user must belong to the caller's MSP.
  const [target] = await db
    .select({ id: usersTable.id, mspRole: usersTable.mspRole })
    .from(usersTable)
    .where(and(eq(usersTable.id, userId), eq(usersTable.mspId, mspId)))
    .limit(1);
  if (!target) { apiError(res, 404, "User not found in this MSP"); return; }
  if (await rejectIfTargetOutranksCaller(req, res, target.mspRole)) return;

  const tempPassword = `Temp-${randomBytes(6).toString("hex").toUpperCase()}!9`;
  const passwordHash = await bcrypt.hash(tempPassword, 12);
  await db.update(usersTable).set({ passwordHash }).where(eq(usersTable.id, userId));

  await writeAuditLog({
    req,
    actionType: "user.password.temp_set",
    entityType: "msp_user",
    entityId: String(userId),
    mspId,
  });

  res.json({ ok: true, tempPassword, requireChange: true });
});

router.post("/msp/settings/users/:userId/reset-mfa", requireCapability("ladder.msp-admin"), async (req: Request, res: Response) => {
  const mspId = resolveMspIdStrict(req);
  const userId = parseInt(p(req.params["userId"]), 10);
  if (!mspId || isNaN(userId)) { apiError(res, 400, "Invalid params"); return; }

  // Ownership check: the target user must belong to the caller's MSP.
  const [target] = await db
    .select({ id: usersTable.id, email: usersTable.email, name: usersTable.name, mspRole: usersTable.mspRole })
    .from(usersTable)
    .where(and(eq(usersTable.id, userId), eq(usersTable.mspId, mspId)))
    .limit(1);
  if (!target) { apiError(res, 404, "User not found in this MSP"); return; }
  if (await rejectIfTargetOutranksCaller(req, res, target.mspRole)) return;

  const enrollments = await db
    .select({ method: mfaEnrollmentsTable.method })
    .from(mfaEnrollmentsTable)
    .where(eq(mfaEnrollmentsTable.userId, userId));
  const passkeyRows = await db
    .select({ id: webauthnCredentialsTable.id })
    .from(webauthnCredentialsTable)
    .where(eq(webauthnCredentialsTable.userId, userId));

  const clearedMethods: string[] = enrollments.map((e) => e.method);
  if (passkeyRows.length > 0) clearedMethods.push("passkey");

  await db.delete(mfaEnrollmentsTable).where(eq(mfaEnrollmentsTable.userId, userId));
  await db.delete(mfaChallengesTable).where(eq(mfaChallengesTable.userId, userId));
  await db.delete(webauthnCredentialsTable).where(eq(webauthnCredentialsTable.userId, userId));
  await db.delete(webauthnChallengesTable).where(eq(webauthnChallengesTable.userId, userId));

  void sendEmailFromTemplate(
    "mfa-reset",
    target.email,
    {
      clientName: target.name ?? target.email,
      methodsList: clearedMethods.map((m) => (m === "totp" ? "Authenticator App (TOTP)" : m === "sms" ? "SMS" : m === "passkey" ? "Passkey / Security Key" : m)).join(", ") || "None",
      loginLink: getMspPortalBaseUrl(),
      securityLink: `${getMspPortalBaseUrl()}/security`,
    },
    "Your two-factor authentication has been reset",
    `<p>Hi ${target.name ?? target.email},</p><p>Your MFA has been reset by an MSP admin. Please sign in and set up a new authentication method.</p><p><a href="${getMspPortalBaseUrl()}">Sign in to your portal</a></p>`,
  ).catch((e) => log.warn({ err: e, userId }, "msp-settings/reset-mfa: email failed (non-fatal)"));

  await writeAuditLog({
    req,
    actionType: "user.mfa.reset",
    entityType: "msp_user",
    entityId: String(userId),
    mspId,
    metadata: { clearedMethods },
  });

  res.json({ ok: true, message: "MFA credentials cleared for re-enrollment" });
});

router.patch("/msp/settings/users/:userId/mfa-enforcement", requireCapability("ladder.msp-admin"), async (req: Request, res: Response) => {
  const mspId = resolveMspIdStrict(req);
  const userId = parseInt(p(req.params["userId"]), 10);
  if (!mspId || isNaN(userId)) { apiError(res, 400, "Invalid params"); return; }

  const { enforced } = req.body as { enforced?: boolean };

  // Ownership check: the target user must belong to the caller's MSP.
  const [target] = await db
    .select({ id: usersTable.id, mspRole: usersTable.mspRole })
    .from(usersTable)
    .where(and(eq(usersTable.id, userId), eq(usersTable.mspId, mspId)))
    .limit(1);
  if (!target) { apiError(res, 404, "User not found in this MSP"); return; }
  if (await rejectIfTargetOutranksCaller(req, res, target.mspRole)) return;

  await db
    .update(usersTable)
    .set({ mfaEnforced: !!enforced, updatedAt: new Date() })
    .where(and(eq(usersTable.id, userId), eq(usersTable.mspId, mspId)));

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

router.patch("/msp/settings/users/:userId/status", requireCapability("ladder.msp-admin"), async (req: Request, res: Response) => {
  const mspId = resolveMspIdStrict(req);
  const userId = parseInt(p(req.params["userId"]), 10);
  if (!mspId || isNaN(userId)) { apiError(res, 400, "Invalid params"); return; }

  const { isActive } = req.body as { isActive?: boolean };
  if (typeof isActive !== "boolean") { apiError(res, 400, "isActive must be boolean"); return; }

  if (!isActive && userId === req.user!.id) {
    apiError(res, 400, "Cannot suspend your own account");
    return;
  }

  // Ownership check: the target user must belong to the caller's MSP.
  const [target] = await db
    .select({ id: usersTable.id, mspRole: usersTable.mspRole })
    .from(usersTable)
    .where(and(eq(usersTable.id, userId), eq(usersTable.mspId, mspId)))
    .limit(1);
  if (!target) { apiError(res, 404, "User not found in this MSP"); return; }
  if (await rejectIfTargetOutranksCaller(req, res, target.mspRole)) return;

  await db
    .update(usersTable)
    .set({ isActive, updatedAt: new Date() })
    .where(and(eq(usersTable.id, userId), eq(usersTable.mspId, mspId)));

  await writeAuditLog({
    req,
    actionType: isActive ? "user.activate" : "user.suspend",
    entityType: "msp_user",
    entityId: String(userId),
    mspId,
  });

  res.json({ ok: true, isActive });
});

router.delete("/msp/settings/users/:userId/sessions", requireCapability("ladder.msp-admin"), async (req: Request, res: Response) => {
  const mspId = resolveMspIdStrict(req);
  const userId = parseInt(p(req.params["userId"]), 10);
  if (!mspId || isNaN(userId)) { apiError(res, 400, "Invalid params"); return; }

  // Ownership check: the target user must belong to the caller's MSP.
  const [target] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(and(eq(usersTable.id, userId), eq(usersTable.mspId, mspId)))
    .limit(1);
  if (!target) { apiError(res, 404, "User not found in this MSP"); return; }

  const revokedCount = await revokeAllOtherSessions(userId, null);

  await writeAuditLog({
    req,
    actionType: "user.sessions.revoke_all",
    entityType: "msp_user",
    entityId: String(userId),
    mspId,
    metadata: { revokedCount },
  });

  res.json({ ok: true, revokedCount });
});

// ── Billing ───────────────────────────────────────────────────────────────────

router.get("/msp/settings/billing", requireCapability("ladder.msp-admin"), async (req: Request, res: Response) => {
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

router.post("/msp/settings/billing/portal-session", requireCapability("ladder.msp-admin"), async (req: Request, res: Response) => {
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

router.get("/msp/settings/email-templates", requireCapability("ladder.msp-admin"), async (req: Request, res: Response) => {
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

router.put("/msp/settings/email-templates/:key", requireCapability("ladder.msp-admin"), async (req: Request, res: Response) => {
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

router.delete("/msp/settings/email-templates/:key", requireCapability("ladder.msp-admin"), async (req: Request, res: Response) => {
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

router.get("/msp/settings/agreement-template", requireCapability("ladder.msp-admin"), async (req: Request, res: Response) => {
  const mspId = resolveMspIdStrict(req);
  if (!mspId) { apiError(res, 400, "No MSP context"); return; }

  const [config] = await db
    .select({ customerAgreementTemplate: mspConnectorConfigsTable.customerAgreementTemplate, updatedAt: mspConnectorConfigsTable.updatedAt })
    .from(mspConnectorConfigsTable)
    .where(eq(mspConnectorConfigsTable.mspId, mspId))
    .limit(1);

  res.json({ template: config?.customerAgreementTemplate ?? null, updatedAt: config?.updatedAt ?? null });
});

router.put("/msp/settings/agreement-template", requireCapability("ladder.msp-admin"), async (req: Request, res: Response) => {
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

router.get("/msp/settings/connector/mailbox", requireCapability("ladder.msp-admin"), async (req: Request, res: Response) => {
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

  const [msp] = await db
    .select({
      automatedCustomerEmailsEnabled: mspsTable.automatedCustomerEmailsEnabled,
      writeBackEnabled: mspsTable.writeBackEnabled,
    })
    .from(mspsTable)
    .where(eq(mspsTable.id, mspId))
    .limit(1);

  res.json({
    connected: !!(row?.isActive),
    mtAppConfigured: mtAppCredentialsPresent(),
    connector: row ?? null,
    automatedCustomerEmailsEnabled: msp?.automatedCustomerEmailsEnabled ?? true,
    writeBackEnabled: msp?.writeBackEnabled ?? false,
  });
});

const mailboxConnectSchema = z.object({
  mailboxUpn: z.string().email("mailboxUpn must be a valid email address"),
  fromDisplayName: z.string().min(2).max(120),
  returnPath: z.string().optional(),
});

router.post("/msp/settings/connector/mailbox/connect", requireCapability("ladder.msp-admin"), async (req: Request, res: Response) => {
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
  const portalBase = getMspPortalBaseUrl();
  const proto = req.headers["x-forwarded-proto"] ?? req.protocol;
  const host = req.headers["x-forwarded-host"] ?? req.headers.host;
  const callbackBase = portalBase ?? `${proto}://${host}`;
  const callbackUrl = `${callbackBase}/api/msp/settings/connector/mailbox/callback`;

  // We use "common" as the tenant hint so the MSP's admin can use their own tenant login
  const consentUrl = buildAdminConsentUrl("common", state, callbackUrl, process.env.MT_APP_CLIENT_ID ?? "");

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

  const portalBase = getMspPortalBaseUrl();

  // ── Declined ────────────────────────────────────────────────────────────────
  if (error === "access_denied" || error_subcode === "cancel") {
    log.warn({ tenant, state, error }, "MSP mailbox consent: admin declined");
    if (state) {
      await db
        .update(mspMailboxConsentStatesTable)
        .set({ usedAt: new Date() })
        .where(eq(mspMailboxConsentStatesTable.state, state));
    }
    res.redirect(`${portalBase}/settings/connector?mailbox_consent=declined`);
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
  res.redirect(`${portalBase}${returnPath}?mailbox_consent=success`);
});

router.delete("/msp/settings/connector/mailbox", requireCapability("ladder.msp-admin"), async (req: Request, res: Response) => {
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

// ── PATCH /api/msp/settings/connector/mailbox/automated-emails ─────────────────
// Toggles automated customer-facing email (marketing/notification, not auth-critical
// transactional email). Functionally inert without an active mailbox connector — see
// canSendAutomatedCustomerEmail() in lib/mailer.ts, which every customer-facing send
// must check before sending.

const automatedEmailsSchema = z.object({ enabled: z.boolean() });

router.patch("/msp/settings/connector/mailbox/automated-emails", requireCapability("ladder.msp-admin"), async (req: Request, res: Response) => {
  const mspId = resolveMspIdStrict(req);
  if (!mspId) { apiError(res, 400, "No MSP context"); return; }

  const parsed = automatedEmailsSchema.safeParse(req.body);
  if (!parsed.success) {
    apiError(res, 400, parsed.error.issues.map((i) => i.message).join("; "));
    return;
  }

  const [updated] = await db
    .update(mspsTable)
    .set({ automatedCustomerEmailsEnabled: parsed.data.enabled, updatedAt: new Date() })
    .where(eq(mspsTable.id, mspId))
    .returning({ automatedCustomerEmailsEnabled: mspsTable.automatedCustomerEmailsEnabled });

  if (!updated) { apiError(res, 404, "MSP not found"); return; }

  await writeAuditLog({
    req,
    actionType: "msp.automated_customer_emails.update",
    entityType: "msp",
    entityId: String(mspId),
    mspId,
    metadata: { enabled: parsed.data.enabled },
  });

  res.json({ automatedCustomerEmailsEnabled: updated.automatedCustomerEmailsEnabled });
});

// ── PATCH /api/msp/settings/connector/mailbox/write-back ───────────────────────
// Toggles whether write-back (mutating) Graph operations are permitted for this
// MSP's tenants. This is the real, fail-closed Gate 1 of graphWriteForTenant()
// (artifacts/api-server/src/lib/graph.ts) — it resolves the MSP from the target
// customer row and throws WriteBackNotEnabledError when writeBackEnabled is
// false, before the separate tenant-write-consent gate even runs. It gates
// every tenant-scoped Microsoft Graph write call for every one of this MSP's
// tenants, not a cosmetic/schema-only flag.

const writeBackSchema = z.object({ enabled: z.boolean() });

router.patch("/msp/settings/connector/mailbox/write-back", requireCapability("ladder.msp-admin"), async (req: Request, res: Response) => {
  const mspId = resolveMspIdStrict(req);
  if (!mspId) { apiError(res, 400, "No MSP context"); return; }

  const parsed = writeBackSchema.safeParse(req.body);
  if (!parsed.success) {
    apiError(res, 400, parsed.error.issues.map((i) => i.message).join("; "));
    return;
  }

  const [updated] = await db
    .update(mspsTable)
    .set({ writeBackEnabled: parsed.data.enabled, updatedAt: new Date() })
    .where(eq(mspsTable.id, mspId))
    .returning({ writeBackEnabled: mspsTable.writeBackEnabled });

  if (!updated) { apiError(res, 404, "MSP not found"); return; }

  await writeAuditLog({
    req,
    actionType: "msp.write_back.update",
    entityType: "msp",
    entityId: String(mspId),
    mspId,
    metadata: { enabled: parsed.data.enabled },
  });

  res.json({ writeBackEnabled: updated.writeBackEnabled });
});

// ── Sessions ──────────────────────────────────────────────────────────────────

router.get("/msp/settings/sessions", requireCapability("ladder.msp-admin"), async (req: Request, res: Response) => {
  const mspId = resolveMspIdStrict(req);
  if (!mspId) { apiError(res, 400, "No MSP context"); return; }

  const users = await db
    .select({ userId: usersTable.id })
    .from(usersTable)
    .where(and(eq(usersTable.mspId, mspId), eq(usersTable.isActive, true)));

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

router.delete("/msp/settings/sessions/:tokenHash", requireCapability("ladder.msp-admin"), async (req: Request, res: Response) => {
  const mspId = resolveMspIdStrict(req);
  const tokenHash = p(req.params["tokenHash"]);
  if (!mspId || !tokenHash) { apiError(res, 400, "Invalid params"); return; }

  // Verify the token belongs to a user in this MSP
  const users = await db
    .select({ userId: usersTable.id })
    .from(usersTable)
    .where(and(eq(usersTable.mspId, mspId), eq(usersTable.isActive, true)));

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
  mspRole: z.enum([LEGACY_ROLE.mspAdmin, LEGACY_ROLE.mspOperator]),
});

router.post("/msp/settings/invites", requireCapability("ladder.msp-admin"), async (req: Request, res: Response) => {
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
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(and(eq(usersTable.id, existingUser.id), eq(usersTable.mspId, mspId), eq(usersTable.isActive, true)))
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
    <p>You have been invited to join the ${mspName} team portal as <strong>${parsed.data.mspRole === LEGACY_ROLE.mspAdmin ? "MSP Admin" : "MSP Operator"}</strong>.</p>
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

router.get("/msp/settings/invites", requireCapability("ladder.msp-admin"), async (req: Request, res: Response) => {
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

router.delete("/msp/settings/invites/:inviteId", requireCapability("ladder.msp-admin"), async (req: Request, res: Response) => {
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
