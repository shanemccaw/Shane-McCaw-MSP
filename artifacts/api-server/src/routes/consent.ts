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
 *     Burns the single-use token, stamps tenants.consent.graph, redirects to a
 *     result page. Also handles checkout-session state (UUID) — marks the
 *     session consented.
 *
 *   GET  /api/consent/declined
 *     Shown when the admin clicked "No" at the Microsoft screen — never a blank page.
 *
 *   GET  /api/admin/consent
 *     List all tenant consent records (admin only).
 *
 *   PATCH /api/admin/consent/:tenantId/revoke
 *     Force-revoke a tenant's consent (admin only).
 *
 * ── Storage (Tenant/User Refactor Phase 6, #99) ────────────────────────────────
 * All three grants recorded here — Graph read (`graph`), the separate write App
 * Registration (`writeBack`), and SharePoint Online (`sharepoint`) — used to
 * live in three tables keyed by tenant GUID (tenant_consent /
 * tenant_write_consent / tenant_sharepoint_consent). Those are dropped; the
 * three now occupy three keys of the single `tenants.consent` jsonb column.
 *
 * Two consequences that shape every route below:
 *
 *   1. A grant can only be recorded ON a tenants row. tenants has NOT NULL
 *      msp_id / customer_name / tenant_id, so a consent record can no longer
 *      spring into existence keyed by a bare GUID. Every callback therefore
 *      resolves its target row before stamping anything — by customerId where
 *      one is known (and then only if the GUID Microsoft returned agrees with
 *      it), or via portal.ts's single resolveOrCreateDirectTenant door on the
 *      self-service path, which is the only path allowed to create one. See
 *      resolveCallbackTenant below for why those two are not interchangeable.
 *
 *   2. Every write goes through graph.ts's mergeConsentKey() — never a plain
 *      `.set({ consent })`, which would overwrite the whole column and destroy
 *      the other two grants. The three grants stayed independent for a reason
 *      (three different App Registrations / resources, consented separately);
 *      that guarantee now lives in exactly one helper.
 *
 * "customerId" throughout this file is `tenants.id` — the same integer id-space
 * the old msp_customers.id occupied, which every migrated consumer
 * (graphWriteForTenant, admin-active-directory, portal scan-status) already
 * resolves with `eq(tenantsTable.id, customerId)`.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { randomBytes, createHmac, timingSafeEqual } from "crypto";
import { db, tenantsTable, consentInviteTokensTable, checkoutSessionsTable, servicesTable, mspsTable, type TenantConsentRecord } from "@workspace/db";
import { eq, and, isNull, gte, desc, sql } from "drizzle-orm";
import { emitWorkflowEvent } from "../lib/workflow-executor.ts";
import { requireAdmin, requireRole } from "../middlewares/requireAuth.ts";
import { buildAdminConsentUrl, mergeConsentKey, mtAppCredentialsPresent, REQUIRED_MT_SCOPES } from "../lib/graph.ts";
import { REQUIRED_SHAREPOINT_APP_PERMISSIONS } from "../lib/sharepoint-admin.ts";
import { createAuditLog } from "../lib/audit.ts";
import { logger } from "../lib/logger.ts";
const log = logger.child({ channel: "auth" });

const router: IRouter = Router();

// UUID v4 pattern — checkout session IDs are UUIDs, invite tokens are 64-char hex.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Which key of tenants.consent a flow writes. */
type ConsentKey = "graph" | "writeBack" | "sharepoint";

/**
 * Stamp one grant onto one tenants row, merging into the rest of the column.
 *
 * Returns false when NO tenants row matched — the caller must treat that as a
 * real failure and say so, never as a silent success. Under the old schema an
 * upsert would simply have created a consent row for any GUID; there is no such
 * fallback now, and a grant that lands nowhere is exactly the kind of silent
 * hole this refactor must not introduce.
 */
async function stampConsent(
  where: ReturnType<typeof eq>,
  key: ConsentKey,
  patch: Partial<TenantConsentRecord>,
): Promise<boolean> {
  const [row] = await db
    .update(tenantsTable)
    .set({ consent: mergeConsentKey(key, patch), updatedAt: new Date() })
    .where(where)
    .returning({ id: tenantsTable.id });
  return row != null;
}

/**
 * Resolves which tenants row a consent callback is allowed to write to, for
 * every path that already knows WHICH customer it is about: the write-back and
 * SharePoint callbacks (customerId HMAC-signed into the state and cross-checked
 * against the single-use token row), and the read callback's invite path (the
 * customerId stamped on the invite token).
 *
 * In all three, `customerId` is the authoritative identity and the `tenant`
 * GUID Microsoft appends to the redirect is unsigned — treated purely as a
 * consistency check: it must match the customer's own tenants.tenant_id. Any
 * disagreement means the admin who approved is in a different Microsoft tenant
 * than the link was minted for, and NEITHER row gets the grant.
 *
 * Not usable by the read callback's self-service path, whose whole job is to
 * accept a GUID that may legitimately have no customer object yet.
 */
async function resolveCallbackTenant(
  customerId: number,
  tenantFromMicrosoft: string | undefined,
): Promise<
  | { ok: true; id: number; tenantId: string }
  | { ok: false; reason: "not_found" | "tenant_mismatch"; expectedTenantId?: string }
> {
  const [row] = await db
    .select({ id: tenantsTable.id, tenantId: tenantsTable.tenantId })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, customerId))
    .limit(1);

  if (!row) return { ok: false, reason: "not_found" };

  const returned = tenantFromMicrosoft?.trim();
  if (returned && returned.toLowerCase() !== row.tenantId.trim().toLowerCase()) {
    return { ok: false, reason: "tenant_mismatch", expectedTenantId: row.tenantId };
  }

  return { ok: true, id: row.id, tenantId: row.tenantId };
}

/**
 * Projects one key of tenants.consent into the flat row shape the old
 * per-type consent tables exposed, so the admin-facing payloads below keep
 * their existing field names (customer-detail.tsx reads writeConsent
 * .consentStatus/.consentedAt/.revokedAt verbatim).
 *
 * `undefined` in, `null` out: an absent key means this tenant has never been
 * through that flow. That is a real, reportable "never granted" state and must
 * never be inferred from a sibling key — the three grants are independent.
 */
function consentRow(record: TenantConsentRecord | undefined) {
  if (!record) return null;
  return {
    consentStatus: record.status,
    consentedAt: record.consentedAt ?? null,
    revokedAt: record.revokedAt ?? null,
    grants: record.grants ?? [],
  };
}

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
// whose own `graph` consent has gone revoked/declined. Reuses the exact same
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
    .select({ tenantId: tenantsTable.tenantId })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, customerId))
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

    // Record the decline on the tenant's existing row only. Deliberately does
    // NOT create one: a tenants row is a real customer object (NOT NULL msp_id
    // + customer_name, appears in every customer list), and an admin who
    // declined at the Microsoft screen has no relationship to record. The old
    // schema could park an orphan consent row against a bare GUID; that is not
    // a state worth resurrecting. An unmatched decline is logged, not silent.
    if (tenant) {
      const stamped = await stampConsent(eq(tenantsTable.tenantId, tenant), "graph", {
        status: "declined",
      });
      if (!stamped) {
        log.info({ tenant }, "Consent callback: decline from a tenant with no tenants row — nothing to record (no customer object exists for it)");
      }
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

    // tenants.tenant_id is NOT NULL UNIQUE, so this is now an exact lookup —
    // there can be at most one customer object per Microsoft tenant, which is
    // precisely the invariant this guard used to have to enforce by hand.
    const [conflictingCustomer] = await db
      .select({ id: tenantsTable.id, mspId: tenantsTable.mspId })
      .from(tenantsTable)
      .where(eq(tenantsTable.tenantId, tenant))
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
  let inviteRecord: { customerId: number | null; clientUserId: number | null; invitedEmail: string | null; invitedName: string | null } | null = null;
  if (state && !isCheckoutSession) {
    const now = new Date();
    const [row] = await db
      .select({
        customerId: consentInviteTokensTable.customerId,
        clientUserId: consentInviteTokensTable.clientUserId,
        // Admin "add client" invites (#103) carry the identity of a client
        // with no account yet — provisioned below once consent is granted.
        invitedEmail: consentInviteTokensTable.invitedEmail,
        invitedName: consentInviteTokensTable.invitedName,
      })
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

  // ── Mark the checkout session consented ─────────────────────────────────────
  // Moved AHEAD of the consent stamp by Phase 6 (#99). The stamp now needs a
  // tenants row to write onto, and creating that row wants the buyer's real
  // name — which only this update returns. Nothing here depends on the consent
  // stamp, and the cross-MSP boundary guard above (the actual safety gate)
  // has already run and returned on conflict.
  let successRedirect = `${hostBase}/portal/consent/success?tenant=${encodeURIComponent(tenant)}`;
  // Hoisted so the consent.granted emission block below can read slug + email without a second DB round-trip.
  let updatedSession: { id: string; email: string; fullName: string; productSlug: string } | undefined;

  if (isCheckoutSession && state) {
    const sessionNow = new Date();
    [updatedSession] = await db
      .update(checkoutSessionsTable)
      .set({
        status: "consented",
        tenantId: tenant,
        updatedAt: sessionNow,
      })
      .where(
        and(
          eq(checkoutSessionsTable.id, state),
          gte(checkoutSessionsTable.expiresAt, sessionNow),
        ),
      )
      .returning({
        id: checkoutSessionsTable.id,
        email: checkoutSessionsTable.email,
        fullName: checkoutSessionsTable.fullName,
        productSlug: checkoutSessionsTable.productSlug,
      });

    if (updatedSession) {
      successRedirect += `&session=${encodeURIComponent(state)}`;
      log.info({ sessionId: state, tenant }, "Checkout session marked consented via consent callback");
    } else {
      log.warn({ sessionId: state, tenant }, "Consent callback: checkout session not found or expired — redirect proceeds without session");
    }
  }

  // ── Resolve the tenants row, then stamp the `graph` grant on it ─────────────
  // Consent lives ON the tenant now, so the row has to exist first. Which row,
  // and whether one may be CREATED, depends on the path — these two cases are
  // not interchangeable and must not be collapsed:
  //
  //   (a) The invite token already names a customer (inviteRecord.customerId, a
  //       tenants.id). That customer is the authoritative identity and it
  //       already belongs to an MSP. Resolve by id and require the GUID
  //       Microsoft returned to match that customer's own tenant_id. Creating
  //       here instead would be a real defect: resolveOrCreateDirectTenant
  //       attaches new rows to the isDirectBusiness MSP, so an MSP-channel
  //       customer consenting from an unexpected tenant would silently spawn a
  //       second customer object under the WRONG MSP while the status flip
  //       below still pointed at the original — split-brain across a tenant
  //       boundary. Mismatch fails closed instead.
  //
  //   (b) No customer named (self-service checkout, or an invite minted for a
  //       client with no account yet). This GUID legitimately may have no
  //       customer object, and creating one under the direct-business MSP is
  //       exactly right — it is the same door provisionProspectAccount uses
  //       below, called here so the grant is recorded even on paths that never
  //       reach provisioning (a token or session with no email), each of which
  //       is still a real Microsoft consent every later Graph call depends on.
  //
  // Dynamic import (not a static one) keeps the large portal.ts route module
  // out of consent.ts's module graph and avoids circular-load ordering issues;
  // provisionProspectAccount, used further down, comes from the same import.
  const { resolveOrCreateDirectTenant, provisionProspectAccount } = await import("./portal.js");

  let consentTenant: { id: number } | null;
  if (inviteRecord?.customerId != null) {
    const bound = await resolveCallbackTenant(inviteRecord.customerId, tenant);
    if (!bound.ok) {
      log.warn(
        { tenant, customerId: inviteRecord.customerId, expectedTenantId: bound.expectedTenantId, reason: bound.reason },
        bound.reason === "tenant_mismatch"
          ? "Consent callback: REFUSED — the Microsoft tenant that consented is not the invited customer's tenant; no grant recorded and no second customer object created"
          : "Consent callback: invited customer row no longer exists — no grant recorded",
      );
      res.status(400).send("This consent link was issued for a different Microsoft organisation. Please ask your provider for a new link.");
      return;
    }
    consentTenant = { id: bound.id };
  } else {
    consentTenant = await resolveOrCreateDirectTenant(
      tenant,
      updatedSession?.fullName?.trim() || inviteRecord?.invitedName?.trim() || "Direct Customer",
    );
  }

  if (!consentTenant) {
    // resolveOrCreateDirectTenant returns null only when no MSP is flagged
    // isDirectBusiness — a platform misconfiguration, not a customer problem.
    // The admin genuinely approved at Microsoft and there is nowhere to record
    // it; that must be loud, and the buyer must not be told everything is fine.
    log.error(
      { tenant, isCheckoutSession },
      "Consent callback: admin consent GRANTED but no tenants row could be created (no isDirectBusiness MSP configured) — grant NOT recorded",
    );
    res.status(500).send("Consent was approved, but this platform could not record it. Please contact support — do not retry the link.");
    return;
  }

  // Single write, through mergeConsentKey — the writeBack/sharepoint keys in
  // the same column are untouched. adminEmail is only known on the checkout
  // path; omitting it leaves any previously-captured value intact rather than
  // blanking it (workflow-executor reads consent.graph.adminEmail).
  const consentPatch: Partial<TenantConsentRecord> = {
    status: "granted",
    consentedAt: new Date().toISOString(),
    revokedAt: null,
    grants: [...REQUIRED_MT_SCOPES],
  };
  if (updatedSession?.email) consentPatch.adminEmail = updatedSession.email;

  await stampConsent(eq(tenantsTable.id, consentTenant.id), "graph", consentPatch);

  log.info({ tenant, customerId: consentTenant.id, inviteCustomerId: inviteRecord?.customerId, isCheckoutSession }, "Tenant admin consent granted");

  // MSP-channel customers start "onboarding" and flip to "active" exactly on
  // consent granted (business rule, confirmed). Only applies to the invite-token
  // path (inviteRecord set) — direct website checkout customers are already
  // "active" from creation (see resolveOrCreateDirectTenant in portal.ts) and
  // never go through this branch since isCheckoutSession customers have no
  // inviteRecord. Guarded to only flip customers currently "onboarding" so an
  // admin's deliberate "inactive"/"archived" status is never silently overwritten.
  if (inviteRecord?.customerId != null) {
    await db
      .update(tenantsTable)
      .set({ status: "active", updatedAt: new Date() })
      .where(
        and(
          eq(tenantsTable.id, inviteRecord.customerId),
          eq(tenantsTable.status, "onboarding"),
        ),
      )
      .catch((err: unknown) => {
        log.warn({ err, customerId: inviteRecord?.customerId }, "Consent callback: failed to flip customer status to active (non-fatal)");
      });
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

      // Create the real Prospect account NOW (the users row, carrying its
      // tenant/MSP scope inline — msp_customers/msp_users were absorbed into
      // tenants/users by #92). Converts the funnel-entry lead new → converted.
      // Idempotent — the downstream free-checkout / paid-webhook paths find it
      // already linked, and the tenants row resolved above is the one it reuses.
      if (sessionEmail) {
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
              "consent callback: Prospect user was created WITHOUT a tenant link (users.tenant_id) — customer provisioning failed; payment webhook will retry and alert",
            );
          }
        }
      } else {
        // A checkout-session consent with no resolvable email means NO account
        // and NO users→tenants link is created here, and the paid webhook used
        // to assume this step had already run. Never skip this silently.
        log.error(
          { tenant, sessionId: state, hadUpdatedSession: !!updatedSession },
          "consent callback: checkout session resolved with NO email — Prospect provisioning SKIPPED; bridge now depends entirely on the payment webhook (which verifies and alerts)",
        );
      }
    }
    // invite-link path: clientId set from inviteRecord above; packageKey unavailable (no product context) → baseline fallback

    // Admin "add client" invite path (#103): the token carries the email the
    // admin specified and no clientUserId (no account existed when it was
    // minted). Provision the real account NOW, exactly like the
    // checkout-session path above — provisionProspectAccount is the single
    // account-creation door, and it needs the real tenant GUID we just got.
    if (!isCheckoutSession && inviteRecord && clientId == null && inviteRecord.invitedEmail) {
      const prospect = await provisionProspectAccount({
        email: inviteRecord.invitedEmail,
        fullName: inviteRecord.invitedName,
        tenantId: tenant,
        role: "CustomerUser",
      });
      if (prospect) {
        clientId = prospect.userId;
        prospectCustomerId = prospect.customerId;
        log.info(
          { tenant, userId: prospect.userId, customerId: prospect.customerId },
          "consent callback: provisioned admin-invited client account at consent time",
        );
      }
    }

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
        // Pass the tenants.id so the run is associated with the customer
        // directly. Invite-link path (Assessment/MSP-channel) carries it on the
        // token; checkout-session path has the Prospect's customerId created at
        // consent time above. `consentTenant.id` is the final fallback and is
        // never null now — it is the row this callback just stamped consent on
        // for this exact GUID. That closes the orphaned-run case the previous
        // `?? undefined` left open (runDiagnostics falling back to a tenantId
        // lookup and recording customerId=null), which left the Assessment
        // wizard — scoped to the customerId JWT claim — unable to stream its
        // own scan.
        customerId: inviteRecord?.customerId ?? prospectCustomerId ?? consentTenant.id,
        packageKey: resolvedPackageKey ?? undefined,
        triggeredByUserId: undefined,
        // This is the initial post-consent scan for a purchased order —
        // the genuine Assessment-flow trigger. Real discriminator for
        // document generation; see diagnostics-runner.ts's DiagnosticsRunOpts.
        isAssessmentTriggered: true,
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

// One row per tenant that has been through the Graph consent flow. Projected
// explicitly rather than `select()`-ing the tenants row: a bare select would
// ship the whole consent jsonb, including the writeBack/sharepoint grants and
// their captured admin emails, to a list view that only asks about Graph.
// Tenants that have never been through this flow are filtered out in JS (no
// jsonb-path SQL predicate — every other consent reader in the codebase
// selects the column and inspects it), preserving "one row per consent record".

router.get("/admin/consent", requireAdmin, async (_req: Request, res: Response) => {
  const rows = await db
    .select({
      tenantId: tenantsTable.tenantId,
      customerId: tenantsTable.id,
      customerName: tenantsTable.customerName,
      consent: tenantsTable.consent,
      updatedAt: tenantsTable.updatedAt,
    })
    .from(tenantsTable)
    .orderBy(desc(tenantsTable.updatedAt));

  res.json(
    rows
      .filter((r) => r.consent?.graph != null)
      .map((r) => ({
        tenantId: r.tenantId,
        customerId: r.customerId,
        customerName: r.customerName,
        adminEmail: r.consent?.graph?.adminEmail ?? null,
        updatedAt: r.updatedAt,
        ...consentRow(r.consent?.graph),
      })),
  );
});

// ── PATCH /api/admin/consent/:tenantId/revoke ──────────────────────────────────

router.patch("/admin/consent/:tenantId/revoke", requireAdmin, async (req: Request, res: Response) => {
  const tenantId = req.params["tenantId"] as string;

  // Flips the `graph` key only — a force-revoke of the read grant says nothing
  // about the write app or SharePoint, which are separate App Registrations /
  // resources with their own revoke paths. mergeConsentKey keeps them intact.
  const revoked = await stampConsent(eq(tenantsTable.tenantId, tenantId), "graph", {
    status: "revoked",
    revokedAt: new Date().toISOString(),
  });

  if (!revoked) {
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
// the `writeBack` key of tenants.consent — fully independent of the read-only
// flow above (which stays untouched, in its own `graph` key, and is never
// inferred from this one). PlatformAdmin-triggered only: an admin generates the consent
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
    .select({ tenantId: tenantsTable.tenantId })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, customerId))
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

// ── POST /api/portal/consent/debug-write-reconsent-link ────────────────────────
// ⚠️ TEMPORARY DEBUG CODE — DELETE BEFORE PRODUCTION ⚠️
// Allows a testbed customer to self-serve the write-consent flow from the
// msp-portal shell. Uses the exact same write-consent logic as the admin route.
router.post("/portal/consent/debug-write-reconsent-link", requireRole("Assessment"), async (req: Request, res: Response) => {
  if (!process.env.MT_APP_WRITE_CLIENT_ID) {
    res.status(503).json({ error: "Write app credentials not configured (MT_APP_WRITE_CLIENT_ID)" });
    return;
  }

  const customerId = (req.user as { customerId?: number } | undefined)?.customerId;
  if (typeof customerId !== "number" || Number.isNaN(customerId)) {
    res.status(403).json({ error: "No customer identity on token" });
    return;
  }

  const [customer] = await db
    .select({ tenantId: tenantsTable.tenantId, isTestbed: tenantsTable.isTestbed })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, customerId))
    .limit(1);

  if (!customer) {
    res.status(404).json({ error: "Customer not found" });
    return;
  }
  
  if (!customer.isTestbed) {
    res.status(403).json({ error: "Debug route is restricted to testbed customers" });
    return;
  }

  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);

  await db.insert(consentInviteTokensTable).values({
    token,
    tenantId: customer.tenantId?.trim() || null,
    customerId,
    clientUserId: req.user!.id,
    expiresAt,
  });

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
    actorName: req.user!.email ?? "customer",
    actorRole: "client",
    actionType: "write_consent_invite_created",
    entityType: "tenant_write_consent",
    metadata: { tenantHint, customerId, expiresAt, debug: true },
  });

  res.json({ consentUrl, expiresAt });
});

// ── GET /api/admin/write-consent/callback ──────────────────────────────────────
// Microsoft redirects here after the customer's admin approves or declines the
// WRITE app. One FIXED URL for every customer (registered once in Azure);
// the customerId is recovered from the HMAC-signed state and cross-checked
// against the single-use token row. Mirrors the read callback above: burn the
// token, stamp tenants.consent.writeBack, land on a result page. Unauthenticated
// by necessity (Microsoft's redirect carries no session) — trust comes from the
// HMAC-bound, DB-backed single-use state.
//
// Phase 6 (#99) scope resolution — read this before touching the writes below.
// The grant is written to the tenants row identified by `customerId`, which is
// HMAC-signed and cross-checked against the token row. The `tenant` GUID in the
// query string is Microsoft's, unsigned, and is used ONLY as a check: if it
// disagrees with that customer's own tenants.tenant_id, the admin who approved
// belongs to a different Microsoft tenant than the link was minted for, and the
// grant is REFUSED rather than stamped on either row. Writing by GUID instead
// would let an unsigned query parameter pick which tenant receives write
// permissions; writing by customerId without the check would record a grant the
// consenting tenant never actually gave. Fails closed on both.

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

  // Resolve the ONE tenants row this callback may write to, before any branch
  // below writes anything. Fails closed on both a missing customer and a
  // tenant-GUID disagreement.
  const target = await resolveCallbackTenant(customerId, tenant);
  if (!target.ok) {
    log.warn(
      { customerId, tenant, expectedTenantId: target.expectedTenantId, reason: target.reason },
      target.reason === "tenant_mismatch"
        ? "Write-consent callback: REFUSED — the Microsoft tenant that consented is not this customer's tenant; no grant recorded on either row"
        : "Write-consent callback: customer row no longer exists — no grant recorded",
    );
    res.status(400).send("This consent link does not match the Microsoft organisation that approved it. Please request a new link.");
    return;
  }

  // Declined at the Microsoft screen
  if (error === "access_denied" || error_subcode === "cancel") {
    log.warn({ customerId, tenant, error, error_subcode }, "Write-consent callback: admin declined");
    await stampConsent(eq(tenantsTable.id, target.id), "writeBack", { status: "declined" });
    res.redirect(`${hostBase}/portal/consent/declined${tenant ? `?tenant=${encodeURIComponent(tenant)}` : ""}`);
    return;
  }

  if (!tenant || admin_consent?.toLowerCase() !== "true") {
    log.warn({ customerId, tenant, admin_consent }, "Write-consent callback: unexpected parameters");
    res.status(400).send("Invalid consent callback parameters.");
    return;
  }

  // Stamp the `writeBack` key as granted. `grants` is deliberately NOT written —
  // the write app's manifest is the source of truth for what was granted; no
  // permission list is fabricated here. (Contrast the read and SharePoint flows,
  // which each have a declared REQUIRED_* constant to snapshot.) Omitting it
  // from the patch also leaves any existing value untouched rather than
  // blanking it, which is what mergeConsentKey's field-level merge is for.
  await stampConsent(eq(tenantsTable.id, target.id), "writeBack", {
    status: "granted",
    consentedAt: now.toISOString(),
    revokedAt: null,
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
// Status read for the admin UI — the customer's current `writeBack` grant, or
// null when it has never been through this flow. One row read now that consent
// lives on the tenant. Payload shape is frozen: customer-detail.tsx reads
// writeConsent.consentStatus / .consentedAt / .revokedAt verbatim.

router.get("/admin/customers/:customerId/write-consent", requireAdmin, async (req: Request, res: Response) => {
  const customerId = parseInt(req.params["customerId"] as string, 10);
  if (isNaN(customerId)) {
    res.status(400).json({ error: "Invalid customerId" });
    return;
  }

  const [customer] = await db
    .select({ tenantId: tenantsTable.tenantId, consent: tenantsTable.consent })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, customerId))
    .limit(1);

  if (!customer) {
    res.status(404).json({ error: "Customer not found" });
    return;
  }

  res.json({ tenantId: customer.tenantId, writeConsent: consentRow(customer.consent?.writeBack) });
});

// ── SharePoint consent (Office 365 SharePoint Online resource) ─────────────────
//
// THIRD, independent consent flow — for Sites.FullControl.All, an Application
// permission on the "Office 365 SharePoint Online" API
// (appId 00000003-0000-0ff1-ce00-000000000000), NOT Microsoft Graph.
//
// Why this is not just "add scopes to the Graph flow": a tenant's granted
// `graph` consent key is a snapshot of REQUIRED_MT_SCOPES (Graph .default) and
// says nothing about the SharePoint resource. Every tenant that consented before
// Sites.FullControl.All was added to the app registration has a perfectly valid
// Graph consent and NO SharePoint grant, so re-consent detection needs its own
// per-tenant record (the `sharepoint` key) to diff against — reusing the Graph
// key would report those tenants as SharePoint-consented when they aren't. This
// is exactly the independence mergeConsentKey exists to protect now that all
// three share one jsonb column.
//
// The permission lives on the SAME multi-tenant app as Graph (MT_APP_CLIENT_ID),
// so this reuses that client id rather than a separate registration — unlike the
// write flow above, which has its own app. State handling follows the write-flow
// precedent exactly: never bare, HMAC-signed over customerId + a single-use
// consent_invite_tokens row, with an "sp." prefix so a state minted for this flow
// cannot be replayed against the read or write callbacks (and vice versa).

function signSharePointConsentState(customerId: number, token: string): string {
  const mac = createHmac("sha256", writeConsentStateSecret()).update(`sharepoint-consent:${customerId}:${token}`).digest("hex");
  return `sp.${customerId}.${token}.${mac}`;
}
function verifySharePointConsentState(state: string): { customerId: number; token: string } | null {
  const parts = state.split(".");
  if (parts.length !== 4 || parts[0] !== "sp" || !parts[1] || !parts[2] || !parts[3]) return null;
  const customerId = parseInt(parts[1], 10);
  const token = parts[2];
  const mac = parts[3];
  if (isNaN(customerId) || String(customerId) !== parts[1]) return null;
  const expected = createHmac("sha256", writeConsentStateSecret()).update(`sharepoint-consent:${customerId}:${token}`).digest("hex");
  const a = Buffer.from(mac, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return { customerId, token };
}

// ── GET /api/admin/customers/:customerId/sharepoint-consent/start ──────────────

router.get("/admin/customers/:customerId/sharepoint-consent/start", requireAdmin, async (req: Request, res: Response) => {
  const customerId = parseInt(req.params["customerId"] as string, 10);
  if (isNaN(customerId)) {
    res.status(400).json({ error: "Invalid customerId" });
    return;
  }

  if (!process.env.MT_APP_CLIENT_ID) {
    res.status(503).json({ error: "Multi-tenant app credentials not configured (MT_APP_CLIENT_ID)" });
    return;
  }

  const [customer] = await db
    .select({ tenantId: tenantsTable.tenantId })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, customerId))
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

  // Fixed callback URL — register exactly this one URL in the MT app's Azure
  // Redirect URIs (alongside /api/consent/callback); customerId rides in the
  // signed state, not the path, so one URL serves every customer.
  const callbackUrl = `${getHostBase(req)}/api/admin/sharepoint-consent/callback`;
  const tenantHint = customer.tenantId?.trim() || "common";
  const consentUrl = buildAdminConsentUrl(
    tenantHint,
    signSharePointConsentState(customerId, token),
    callbackUrl,
    process.env.MT_APP_CLIENT_ID,
  );

  await createAuditLog({
    actorUserId: req.user!.id,
    actorName: req.user!.email ?? "admin",
    actorRole: "admin",
    actionType: "sharepoint_consent_invite_created",
    entityType: "tenant_sharepoint_consent",
    metadata: { tenantHint, customerId, expiresAt, permissions: [...REQUIRED_SHAREPOINT_APP_PERMISSIONS] },
  });

  res.json({ consentUrl, expiresAt, permissions: REQUIRED_SHAREPOINT_APP_PERMISSIONS });
});

// ── POST /api/portal/consent/sharepoint-link ───────────────────────────────────
// Customer-scoped equivalent of the start route above, for a logged-in customer
// whose own SharePoint consent is missing or stale. Mirrors the existing
// /portal/consent/reconsent-link (read flow) so the portal pill has one real
// button to call for the SharePoint case. customerId comes from the JWT only.

router.post("/portal/consent/sharepoint-link", requireRole("Assessment"), async (req: Request, res: Response) => {
  if (!process.env.MT_APP_CLIENT_ID) {
    res.status(503).json({ error: "Multi-tenant app credentials not configured (MT_APP_CLIENT_ID)" });
    return;
  }

  const customerId = (req.user as { customerId?: number } | undefined)?.customerId;
  if (typeof customerId !== "number" || Number.isNaN(customerId)) {
    res.status(403).json({ error: "No customer identity on token" });
    return;
  }

  const [customerRow] = await db
    .select({ tenantId: tenantsTable.tenantId })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, customerId))
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

  const callbackUrl = `${getHostBase(req)}/api/admin/sharepoint-consent/callback`;
  const tenantHint = customerRow?.tenantId?.trim() || "common";
  const consentUrl = buildAdminConsentUrl(
    tenantHint,
    signSharePointConsentState(customerId, token),
    callbackUrl,
    process.env.MT_APP_CLIENT_ID,
  );

  await createAuditLog({
    actorUserId: req.user!.id,
    actorName: req.user!.email ?? "customer",
    actorRole: "client",
    actionType: "sharepoint_consent_invite_created",
    entityType: "tenant_sharepoint_consent",
    metadata: { tenantHint, customerId, reconsent: true, expiresAt },
  });

  res.json({ consentUrl, expiresAt, permissions: REQUIRED_SHAREPOINT_APP_PERMISSIONS });
});

// ── GET /api/admin/sharepoint-consent/callback ─────────────────────────────────
// Microsoft redirects here after the tenant admin approves or declines the
// SharePoint permission. One FIXED URL for every customer. Unauthenticated by
// necessity (Microsoft's redirect carries no session) — trust comes from the
// HMAC-bound, DB-backed single-use state, exactly as in the write callback.

router.get("/admin/sharepoint-consent/callback", async (req: Request, res: Response) => {
  const { tenant, admin_consent, state, error, error_subcode } = req.query as Record<string, string | undefined>;
  const hostBase = getHostBase(req);

  const verified = state ? verifySharePointConsentState(state) : null;
  if (!verified) {
    log.warn({ state }, "SharePoint-consent callback: state missing or failed HMAC verification");
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
    log.warn({ customerId, tokenCustomerId: tokenRow?.customerId }, "SharePoint-consent callback: token invalid, expired, used, or bound to a different customer");
    res.status(400).send("This consent link has expired or has already been used. Please request a new link.");
    return;
  }

  await db
    .update(consentInviteTokensTable)
    .set({ usedAt: now, ...(tenant ? { tenantId: tenant } : {}) })
    .where(eq(consentInviteTokensTable.token, token));

  // Same fail-closed scope resolution as the write callback above — see the
  // note there. customerId is the signed identity; the GUID Microsoft returned
  // must agree with it or nothing is written.
  const target = await resolveCallbackTenant(customerId, tenant);
  if (!target.ok) {
    log.warn(
      { customerId, tenant, expectedTenantId: target.expectedTenantId, reason: target.reason },
      target.reason === "tenant_mismatch"
        ? "SharePoint-consent callback: REFUSED — the Microsoft tenant that consented is not this customer's tenant; no grant recorded on either row"
        : "SharePoint-consent callback: customer row no longer exists — no grant recorded",
    );
    res.status(400).send("This consent link does not match the Microsoft organisation that approved it. Please request a new link.");
    return;
  }

  // Declined at the Microsoft screen
  if (error === "access_denied" || error_subcode === "cancel") {
    log.warn({ customerId, tenant, error, error_subcode }, "SharePoint-consent callback: admin declined");
    await stampConsent(eq(tenantsTable.id, target.id), "sharepoint", { status: "declined" });
    res.redirect(`${hostBase}/portal/consent/declined${tenant ? `?tenant=${encodeURIComponent(tenant)}` : ""}`);
    return;
  }

  if (!tenant || admin_consent?.toLowerCase() !== "true") {
    log.warn({ customerId, tenant, admin_consent }, "SharePoint-consent callback: unexpected parameters");
    res.status(400).send("Invalid consent callback parameters.");
    return;
  }

  // Stamp the permission snapshot into `grants`, the same field the Graph
  // callback stamps REQUIRED_MT_SCOPES into (one field, two resources — the key
  // it sits under is what says which). What the app registration asked for at
  // this moment IS what the admin approved on this screen (admin_consent=true is
  // tenant-wide for every Application permission the app currently declares on
  // that resource). Storing the snapshot — rather than a bare boolean — is what
  // makes drift detectable later when REQUIRED_SHAREPOINT_APP_PERMISSIONS grows.
  await stampConsent(eq(tenantsTable.id, target.id), "sharepoint", {
    status: "granted",
    consentedAt: now.toISOString(),
    revokedAt: null,
    grants: [...REQUIRED_SHAREPOINT_APP_PERMISSIONS],
  });

  await createAuditLog({
    actorUserId: null,
    actorName: "microsoft:sharepoint-consent-callback",
    actorRole: "admin",
    actionType: "tenant_sharepoint_consent_granted",
    entityType: "tenant_sharepoint_consent",
    entityId: tenant,
    metadata: { tenantId: tenant, customerId, permissions: [...REQUIRED_SHAREPOINT_APP_PERMISSIONS] },
  });

  log.info({ tenant, customerId }, "Tenant SHAREPOINT admin consent granted");
  res.redirect(`${hostBase}/portal/consent/success?tenant=${encodeURIComponent(tenant)}&sharepoint=1`);
});

// ── GET /api/admin/customers/:customerId/sharepoint-consent ────────────────────
// Status read for the admin UI — the customer's current `sharepoint` grant,
// plus the same staleness verdict the portal pill uses.

router.get("/admin/customers/:customerId/sharepoint-consent", requireAdmin, async (req: Request, res: Response) => {
  const customerId = parseInt(req.params["customerId"] as string, 10);
  if (isNaN(customerId)) {
    res.status(400).json({ error: "Invalid customerId" });
    return;
  }

  const [customer] = await db
    .select({ tenantId: tenantsTable.tenantId, consent: tenantsTable.consent })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, customerId))
    .limit(1);

  if (!customer) {
    res.status(404).json({ error: "Customer not found" });
    return;
  }

  const record = customer.consent?.sharepoint;
  // Only a "granted" tenant can be permission-stale — revoked/declined/absent
  // are already surfaced by the status itself and take priority.
  const permissionsStale =
    record?.status === "granted" &&
    REQUIRED_SHAREPOINT_APP_PERMISSIONS.some((p) => !(record.grants ?? []).includes(p));

  res.json({
    tenantId: customer.tenantId,
    // `permissionsGranted` is kept as an alias of the stored `grants` snapshot
    // so the field name this route has always returned stays stable.
    sharePointConsent: record
      ? { ...consentRow(record), permissionsGranted: record.grants ?? [] }
      : null,
    permissionsStale,
    requiredPermissions: REQUIRED_SHAREPOINT_APP_PERMISSIONS,
  });
});

export default router;
