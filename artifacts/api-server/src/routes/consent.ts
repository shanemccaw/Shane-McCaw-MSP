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
 *     Burns the single-use token, stamps tenants.consent.graph, then ends by
 *     redirecting to a portal result page OR — when the consent came from the
 *     marketing site's popup flow — by returning a page that closes the popup
 *     (#474; see "How a consent callback ENDS" below). Also handles
 *     checkout-session state (UUID) — marks the session consented.
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
 *      it), or via lib/direct-tenant-provisioning.ts's single resolveOrCreateDirectTenant door on the
 *      self-service path, which is the only path allowed to create one. See
 *      resolveCallbackTenant below for why those two are not interchangeable.
 *
 *   2. Every write goes through graph.ts's mergeConsentKey() — never a plain
 *      `.set({ consent })`, which would overwrite the whole column and destroy
 *      the other two grants. The three grants stayed independent for a reason
 *      (separate resources and, for `writeBack`, a separate App Registration,
 *      each consented on its own screen); that guarantee now lives in exactly
 *      one helper.
 *
 *      #480 correction to an "architectural fact" stated in earlier issues:
 *      there are TWO App Registrations, not three. `graph` and `sharepoint` were
 *      always the same registration (MT_APP_CLIENT_ID) against two different
 *      resources — Microsoft Graph and Office 365 SharePoint Online — and as of
 *      2026-08-06 that registration declares both, so one admin-consent click
 *      covers them together. Only `writeBack` has a registration of its own
 *      (MT_APP_WRITE_CLIENT_ID). Since #637, the main `graph` callback below
 *      stamps `sharepoint` granted in the same request (same registration, same
 *      click) — `sharepoint` is a live KEY, written automatically on every new
 *      `graph` grant, and a live STEP only for the historical case: a tenant
 *      whose `graph` grant predates #637 shipping.
 *
 * "customerId" throughout this file is `tenants.id` — the same integer id-space
 * the old msp_customers.id occupied, which every migrated consumer
 * (graphWriteForTenant, admin-active-directory, portal scan-status) already
 * resolves with `eq(tenantsTable.id, customerId)`.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { randomBytes, createHmac, timingSafeEqual } from "crypto";
import { db, tenantsTable, consentInviteTokensTable, checkoutSessionsTable, servicesTable, mspsTable, type TenantConsentRecord, type TenantConsentMap } from "@workspace/db";
import { eq, and, isNull, gte, desc, sql } from "drizzle-orm";
import { z } from "zod";
import { emitWorkflowEvent } from "../lib/workflow-executor.ts";
import { requireAdmin, requireRole } from "../middlewares/requireAuth.ts";
import { buildAdminConsentUrl, mergeConsentKey, mtAppCredentialsPresent, getInitialDomainForTenant, REQUIRED_MT_SCOPES, REQUIRED_WRITE_APP_PERMISSIONS } from "../lib/graph.ts";
import { REQUIRED_SHAREPOINT_APP_PERMISSIONS } from "../lib/sharepoint-admin.ts";
import { startPowerPlatformEnrollmentDeviceCode, pollPowerPlatformEnrollmentDeviceCode } from "../lib/power-platform-admin.ts";
import { createAuditLog } from "../lib/audit.ts";
import { resolveOrCreateDirectTenant, provisionProspectAccount } from "../lib/direct-tenant-provisioning.ts";
import { getReadConsentRequirementForProduct, buildSessionReadConsentUrl } from "../lib/read-consent-flow.ts";
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

// The four DLP/Label monitor checks #425's on-demand scan fires — deliberately
// an explicit list, not a domain-prefix filter: the live `compliance:` domain
// also carries compliance:audit-log-retention and compliance:eeeu-site-sharing
// (confirmed via a live monitor_checks query), which this scan must not touch.
const DLP_LABEL_CHECK_KEYS = [
  "compliance:weak-dlp-policies",
  "compliance:dlp-incidents",
  "compliance:missing-labels",
  "compliance:label-errors",
];

/**
 * #425 — completes the "Read Consent -> Write Consent -> Add App Reg to
 * Group -> Run Scan" interface: once #249's provisioning chain reaches a real
 * "provisioned" outcome for a tenant, fire the four DLP/Label checks
 * on-demand rather than waiting for the next scheduled package run.
 *
 * `overallStatus === "provisioned"` is the ONLY status that triggers the
 * scan. "blocked" (write-back not yet granted) and "failed" are the two
 * outcomes the issue calls out explicitly, but "partially_provisioned" is
 * excluded too: it means step 3 — assigning the group to the Purview DLP
 * role group — did not complete, so the app-only DLP cmdlets these checks
 * depend on would still fail with the same "not recognized" error #246
 * documented. Running them on a partial provision would just reproduce that
 * failure early rather than produce a real result.
 *
 * Called from BOTH the `graph` and `writeBack` consent success paths (each
 * feeds it whatever outcome ITS OWN call to provisionDlpRoleGroupForTenant
 * returned) — since the chain only reaches "provisioned" once both consents
 * are actually in place, only the grant that completes it will ever see
 * "provisioned" here, so the scan naturally fires once, not twice, when both
 * consents land in the same session.
 */
async function triggerDlpComplianceScanIfProvisioned(
  tenant: string,
  customerId: number,
  outcome: { overallStatus: string },
): Promise<void> {
  if (outcome.overallStatus !== "provisioned") {
    log.info(
      { tenant, customerId, overallStatus: outcome.overallStatus },
      "consent: DLP role-group provisioning not fully complete — skipping on-demand DLP/Label scan",
    );
    return;
  }
  try {
    const { triggerCheckRunsByKey } = await import("./admin-monitor-check-runs.ts");
    const result = await triggerCheckRunsByKey({ customerId, tenantId: tenant, checkKeys: DLP_LABEL_CHECK_KEYS });
    log.info(
      { tenant, customerId, started: result.started, skipped: result.skipped },
      "consent: on-demand DLP/Label scan triggered after DLP role-group provisioning",
    );
  } catch (err) {
    log.warn({ err, tenant, customerId }, "consent: on-demand DLP/Label scan trigger failed (non-fatal)");
  }
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

// ── How a consent callback ENDS (#474) ─────────────────────────────────────────
//
// The three OAuth callbacks in this file are reached from two structurally
// different UIs, and they must not end the same way:
//
//   "portal" — the MSP/admin and logged-in-customer flows. Microsoft was opened
//     by navigating the whole tab, so the callback's only way to return the user
//     anywhere is a redirect, and /portal/consent/success|declined is a page
//     their portal session can actually render. Unchanged.
//
//   "popup"  — the marketing-site assessment flow (#434). Microsoft was opened
//     in a `window.open` popup so the buyer's page never navigates away; that
//     page polls GET /api/public/flow/consent-status and advances itself. The
//     buyer is anonymous — they have no portal session at all — so redirecting
//     the popup to /portal/consent/success lands them on a page that was never
//     built for them and cannot work. It also leaves the popup sitting open on
//     top of the flow. The popup's correct ending is to close itself.
//
// No postMessage to the opener. It was considered and is genuinely not needed:
// the grant is stamped on the tenants row BEFORE any of these responses is
// written, and useFlowStatus already polls consent-status on a 3s tick while a
// grant is outstanding — so the flow learns about the grant from the server,
// which is also the only source that survives the popup being closed by hand,
// blocked, or opened as a tab instead. Adding a message channel would be a
// second, weaker path to the same fact.

/** Which UI opened the Microsoft screen, and therefore how this callback ends. */
type ConsentUiOrigin = "portal" | "popup";

/**
 * The whole response for a popup-origin callback: a self-contained page that
 * reports the outcome and closes itself.
 *
 * `window.close()` is permitted here because the window was opened by script
 * (`window.open`) — but it is best-effort: a browser that refuses, or a buyer
 * who opened the link in a normal tab after a popup block, is left looking at
 * the message instead of a blank page. Terminal problems pass autoClose:false
 * so they stay on screen to be read.
 *
 * Every value interpolated below is a literal from this module — no request
 * data reaches this markup, which is what keeps it injection-free.
 */
function consentPopupPage(opts: {
  title: string;
  heading: string;
  detail: string;
  tone: "ok" | "warn";
  autoClose: boolean;
}): string {
  const accent = opts.tone === "ok" ? "#34d399" : "#fbbf24";
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${opts.title}</title>
<style>
  html,body{height:100%}
  body{margin:0;display:flex;align-items:center;justify-content:center;
       font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
       background:#020617;color:#e2e8f0}
  main{max-width:26rem;padding:2rem;text-align:center}
  .dot{width:.6rem;height:.6rem;border-radius:50%;background:${accent};display:inline-block;margin-right:.5rem}
  h1{font-size:1.05rem;font-weight:600;margin:0 0 .6rem}
  p{font-size:.85rem;line-height:1.6;color:#94a3b8;margin:0}
</style></head>
<body><main>
  <h1><span class="dot"></span>${opts.heading}</h1>
  <p>${opts.detail}</p>
</main>
${opts.autoClose ? `<script>setTimeout(function(){try{window.close()}catch(e){}},600)</script>` : ""}
</body></html>`;
}

/**
 * Ends a consent callback the way its origin requires: the popup page for
 * "popup", the caller's existing portal redirect for "portal".
 *
 * Deliberately takes the portal URL as a callback rather than a string so each
 * call site keeps building its own redirect exactly as it always has — this
 * splits where the response is written, never what the portal path is.
 */
function endConsentCallback(
  res: Response,
  origin: ConsentUiOrigin,
  popup: Parameters<typeof consentPopupPage>[0],
  portalRedirect: () => string,
): void {
  if (origin === "popup") {
    // No explicit .type() — Express already sends a string body as
    // text/html, which is what the sibling /consent/declined page relies on.
    res.status(200).send(consentPopupPage(popup));
    return;
  }
  res.redirect(portalRedirect());
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

  // Determine whether `state` is a checkout session UUID or an MSP invite token.
  // Hoisted above the decline branch by #474: a declined popup has to close
  // itself just like an approved one does, so every exit below needs to know
  // which UI it is answering. Pure move — the expression is unchanged.
  const isCheckoutSession = !!state && UUID_RE.test(state);
  const uiOrigin: ConsentUiOrigin = isCheckoutSession ? "popup" : "portal";

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

    endConsentCallback(
      res,
      uiOrigin,
      {
        title: "Consent not granted",
        heading: "Permissions were not granted",
        detail:
          "You can close this window. The page you started from will offer the approval again — nothing has been connected.",
        tone: "warn",
        autoClose: true,
      },
      () => `${hostBase}/portal/consent/declined${tenant ? `?tenant=${encodeURIComponent(tenant)}` : ""}`,
    );
    return;
  }

  // Success callback must include tenant + admin_consent=True
  if (!tenant || admin_consent?.toLowerCase() !== "true") {
    log.warn({ tenant, admin_consent, state }, "Consent callback: unexpected parameters");
    res.status(400).send("Invalid consent callback parameters.");
    return;
  }

  // ── Cross-MSP tenant boundary guard (direct self-service checkout path only) ──
  // A checkout session always belongs to the isDirectBusiness MSP (checkout_sessions
  // has no mspId column). If the Microsoft tenant that just consented is ALREADY
  // registered as a customer under a DIFFERENT MSP, letting this purchase proceed
  // would silently cross-link the buyer to that other MSP's customer record —
  // leaking its engine history, findings, and SOWs across the tenant boundary
  // (confirmed live: user 92 under mspId 89 saw customer 1's data under mspId 1).
  // Reject BEFORE marking the session consented and before payment ever happens.
  // Do not cross-link, do not create a duplicate customer. The equivalent check in
  // ensureClientMspUser (lib/direct-tenant-provisioning.ts) is a post-payment backstop for this same case.
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
      // The only popup ending that deliberately does NOT close itself: this is
      // a terminal refusal the buyer has to actually read, and the flow behind
      // it will never advance (the session was not marked consented). Closing
      // the window silently would strand them on "waiting for approval" with no
      // explanation of why it never comes.
      endConsentCallback(
        res,
        uiOrigin,
        {
          title: "Organisation already connected",
          heading: "This Microsoft organisation is already connected",
          detail:
            "Your tenant is already registered with another provider on this platform, so this order cannot continue. Please contact support — you can close this window.",
          tone: "warn",
          autoClose: false,
        },
        () => `${hostBase}/portal/consent/tenant-conflict?tenant=${encodeURIComponent(tenant)}`,
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
  // Portal-origin only — a checkout-session (popup) consent never reaches this
  // URL now, it gets the self-closing page instead (#474).
  const successRedirect = `${hostBase}/portal/consent/success?tenant=${encodeURIComponent(tenant)}`;
  // Hoisted so the consent.granted emission block below can read slug + email without a second DB round-trip.
  let updatedSession: { id: string; email: string; fullName: string; company: string | null; industry: string | null; productSlug: string } | undefined;

  if (isCheckoutSession && state) {
    const sessionNow = new Date();
    [updatedSession] = await db
      .update(checkoutSessionsTable)
      .set({
        status: "consented",
        tenantId: tenant,
        // #1311: a session whose admin actually granted consent is by
        // definition not skipped — clears a Retainer buyer's earlier explicit
        // skip if they changed their mind and connected after all.
        consentSkippedAt: null,
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
        company: checkoutSessionsTable.company,
        industry: checkoutSessionsTable.industry,
        productSlug: checkoutSessionsTable.productSlug,
      });

    if (updatedSession) {
      log.info({ sessionId: state, tenant }, "Checkout session marked consented via consent callback");
    } else {
      log.warn({ sessionId: state, tenant }, "Consent callback: checkout session not found or expired — callback proceeds without session");
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
  // resolveOrCreateDirectTenant / provisionProspectAccount (used further down)
  // now live in lib/direct-tenant-provisioning.ts (#175, portal.ts route
  // decommission) — a small, router-free module, so a static top-level import
  // is safe (no more large-route-module / circular-load concern that used to
  // justify a dynamic import of portal.ts here).

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
      updatedSession?.company?.trim() || updatedSession?.fullName?.trim() || inviteRecord?.invitedName?.trim() || "Direct Customer",
      updatedSession?.industry,
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

  // Single write, through mergeConsentKey — the writeBack key in the same
  // column is untouched. adminEmail is only known on the checkout path;
  // omitting it leaves any previously-captured value intact rather than
  // blanking it (workflow-executor reads consent.graph.adminEmail).
  const grantedAt = new Date().toISOString();
  const consentPatch: Partial<TenantConsentRecord> = {
    status: "granted",
    consentedAt: grantedAt,
    revokedAt: null,
    grants: [...REQUIRED_MT_SCOPES],
  };
  if (updatedSession?.email) consentPatch.adminEmail = updatedSession.email;

  await stampConsent(eq(tenantsTable.id, consentTenant.id), "graph", consentPatch);

  // ── Also stamp `sharepoint` granted (Git #637) ──────────────────────────
  // Confirmed via Azure AD app-registration audit: Sites.FullControl.All lives
  // on this SAME MT_APP_CLIENT_ID registration as every Graph permission above
  // — there is only one app registration in play here (no per-tenant/per-MSP
  // override exists anywhere in this codebase) — so the admin_consent=True
  // Microsoft just returned already covers SharePoint too, in the same click.
  // Stamping it here (rather than requiring the separate
  // /admin/sharepoint-consent/callback round trip) is what makes
  // useReconsentKind's "sharepoint" pill (reconsent-pill.tsx) stop firing for
  // every tenant that consents from here on. The dedicated SharePoint
  // start/callback routes stay — see their own header comment — as the only
  // way a tenant whose `graph` grant predates this stamp (i.e. already
  // consented before this change shipped) can pick up the SharePoint grant.
  await stampConsent(eq(tenantsTable.id, consentTenant.id), "sharepoint", {
    status: "granted",
    consentedAt: grantedAt,
    revokedAt: null,
    grants: [...REQUIRED_SHAREPOINT_APP_PERMISSIONS],
  });

  log.info({ tenant, customerId: consentTenant.id, inviteCustomerId: inviteRecord?.customerId, isCheckoutSession }, "Tenant admin consent granted (graph + sharepoint, same app registration)");

  // ── Capture the tenant's real domain (#238) ─────────────────────────────
  // tenants.domain was never populated by this flow. Connect-IPPSSession-backed
  // checks (DLP/Labels, #212, and anything else built on that mechanism) reject
  // a raw tenant GUID as -Organization and need the real domain. Best-effort:
  // a lookup failure here must never fail the consent grant that already
  // landed above.
  try {
    const initialDomain = await getInitialDomainForTenant(tenant);
    if (initialDomain) {
      await db.update(tenantsTable).set({ domain: initialDomain, updatedAt: new Date() }).where(eq(tenantsTable.id, consentTenant.id));
    }
  } catch (err) {
    log.warn({ err, tenant, customerId: consentTenant.id }, "Consent callback: failed to capture tenant domain via Graph (non-fatal)");
  }

  // MSP-channel customers start "onboarding" and flip to "active" exactly on
  // consent granted (business rule, confirmed). Only applies to the invite-token
  // path (inviteRecord set) — direct website checkout customers are already
  // "active" from creation (see resolveOrCreateDirectTenant in lib/direct-tenant-provisioning.ts) and
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
      let sessionCompany: string | null = null;
      let sessionIndustry: string | null = null;

      if (updatedSession) {
        productSlug = updatedSession.productSlug;
        sessionEmail = updatedSession.email;
        sessionFullName = updatedSession.fullName;
        sessionCompany = updatedSession.company;
        sessionIndustry = updatedSession.industry;
      } else {
        // Session not updated (expired or not found) — try a direct read
        const [existing] = await db
          .select({
            productSlug: checkoutSessionsTable.productSlug,
            email: checkoutSessionsTable.email,
            fullName: checkoutSessionsTable.fullName,
            company: checkoutSessionsTable.company,
            industry: checkoutSessionsTable.industry,
          })
          .from(checkoutSessionsTable)
          .where(eq(checkoutSessionsTable.id, state))
          .limit(1);
        productSlug = existing?.productSlug ?? null;
        sessionEmail = existing?.email ?? null;
        sessionFullName = existing?.fullName ?? null;
        sessionCompany = existing?.company ?? null;
        sessionIndustry = existing?.industry ?? null;
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
      //
      // Free Scan shell account (Git #1355, Phase 3 of #1352): the marketing
      // /scan flow reaches this exact branch — its read consent runs through the
      // same #1311 session-keyed checkout session (#1361), against the
      // `license-waste-audit-free` *assessment* product — so a Free Scan grant
      // provisions a passwordless "Assessment" Prospect here with a real
      // customerId, which Phase 4's scan trigger and Phase 7's return link
      // attach to. This deliberately does NOT mint a /setup-password token or a
      // session: hasRealEntitlement() (auth.ts) refuses both password setup and
      // session issuance for an account with no client_services row, and a Free
      // Scan Prospect has none — so it cannot reach the portal until it actually
      // converts and a real entitlement is created (#656). Locked by
      // lib/free-scan-prospect.test.ts.
      if (sessionEmail) {
        const prospect = await provisionProspectAccount({
          email: sessionEmail,
          fullName: sessionFullName,
          company: sessionCompany,
          industry: sessionIndustry,
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

  // Fire-and-forget full-item detail collection (#339) — a SEPARATE void block,
  // started here rather than chained after the diagnostics run above, so the two
  // genuinely run in parallel rather than one waiting on the other.
  //
  // It runs its own `detail:full-item-collection` package with includeItems, so
  // by the time a remediation document (which promises to list ALL affected
  // items) or a War Room per-item dialog needs full detail, it has already been
  // collected instead of being fetched reactively at the point of need.
  //
  // It never touches the scoring scan: its own package (engines: []), its own
  // triggerId, its own table, no tenant_monitor_profiles row at all, and it
  // resolves rather than rejects on every failure path — see
  // item-detail-collector.ts's NON-INTERFERENCE notes.
  //
  // `packageKey` stays the detail package; `scopeToPackageKey` is the SCORING
  // package this consent-time scan is actually running, mirroring the
  // `resolvedPackageKey ?? "core:security-baseline"` default runDiagnostics
  // applies just above. Collection covers the intersection of the two, not the
  // whole catalog — see #543: an unscoped sweep re-ran every check curated out
  // of the scoring package, on every scan.
  void (async () => {
    try {
      const { runItemDetailCollection } = await import("../lib/item-detail-collector.js");
      const detail = await runItemDetailCollection({
        tenantId: tenant,
        customerId: inviteRecord?.customerId ?? prospectCustomerId ?? consentTenant.id,
        scopeToPackageKey: resolvedPackageKey ?? "core:security-baseline",
      });
      log.info(
        { tenant, runId: detail.runId, status: detail.status, checksWithItems: detail.checksWithItems, itemsPersisted: detail.itemsPersisted },
        "consent.granted: full-item detail collection finished",
      );
    } catch (detailErr) {
      log.warn({ err: detailErr, tenant }, "consent.granted: full-item detail collection failed (non-fatal)");
    }
  })();

  // Fire-and-forget DLP/Label Purview role-group provisioning (#249, #246
  // chunk C) — must not delay the consent redirect, and must never fail the
  // consent grant itself. Fires on every `graph` consent success (this chain
  // is idempotent and safe to re-run); it commonly reports "blocked" on a
  // brand-new tenant because `writeBack` is a separate, not-yet-granted
  // consent grant — see dlp-role-group-provisioning.ts's header for why that
  // is expected, not an error, and how the admin-panel re-trigger covers it.
  void (async () => {
    try {
      const { provisionDlpRoleGroupForTenant } = await import("../lib/dlp-role-group-provisioning.ts");
      const outcome = await provisionDlpRoleGroupForTenant(tenant, consentTenant.id, "consent.granted");
      log.info({ tenant, customerId: consentTenant.id, overallStatus: outcome.overallStatus }, "consent.granted: DLP role-group provisioning finished");
      // #425 — write-back consent is commonly still missing at this point (see
      // this block's own header above), so this usually no-ops here and fires
      // for real from the writeBack callback below instead.
      await triggerDlpComplianceScanIfProvisioned(tenant, consentTenant.id, outcome);
    } catch (err) {
      log.warn({ err, tenant }, "consent.granted: DLP role-group provisioning failed (non-fatal)");
    }
  })();

  endConsentCallback(
    res,
    uiOrigin,
    {
      title: "Access granted",
      heading: "Access granted",
      detail: "You can close this window — the page you started from is already continuing on its own.",
      tone: "ok",
      autoClose: true,
    },
    () => successRedirect,
  );
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
// Body: { key?: "graph" | "writeBack" | "sharepoint" }, defaulting to "graph"
// to preserve every existing caller's behavior unchanged. Phase 10 (Issue
// #91, amended-scope comment) unified what used to be described as separate
// Graph/SharePoint revoke mechanisms into ONE route with a consent-type
// selector — this is that selector. Still flips exactly one key via
// mergeConsentKey; the other two grants are always left untouched.
const CONSENT_REVOKE_KEYS: ConsentKey[] = ["graph", "writeBack", "sharepoint"];

router.patch("/admin/consent/:tenantId/revoke", requireAdmin, async (req: Request, res: Response) => {
  const tenantId = req.params["tenantId"] as string;

  const rawKey = (req.body as { key?: unknown } | undefined)?.key;
  const key: ConsentKey = rawKey === undefined ? "graph" : (rawKey as ConsentKey);
  if (!CONSENT_REVOKE_KEYS.includes(key)) {
    res.status(400).json({ error: `key must be one of: ${CONSENT_REVOKE_KEYS.join(", ")}` });
    return;
  }

  const revoked = await stampConsent(eq(tenantsTable.tenantId, tenantId), key, {
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
    metadata: { tenantId, key },
  });

  res.json({ ok: true, tenantId, key });
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
/**
 * The signed payload behind a write- or SharePoint-consent state (#474).
 *
 * The "portal" payload is byte-for-byte what it has always been, so every state
 * minted before this change still verifies and every in-flight consent link
 * keeps working. "popup" appends its own segment, which means the origin a
 * callback acts on is covered by the HMAC exactly like customerId and the token
 * are — it cannot be flipped by editing the redirect URL. (Even if it could, the
 * only thing it selects is which response body the browser gets; it grants
 * nothing and picks no tenant. Covering it is still the right default.)
 */
function consentStatePayload(prefix: string, customerId: number, token: string, origin: ConsentUiOrigin): string {
  return origin === "popup" ? `${prefix}:${customerId}:${token}:popup` : `${prefix}:${customerId}:${token}`;
}

/**
 * Shared parse for both `wc.` and `sp.` states. Accepts the original 4-segment
 * portal form and the 5-segment popup form (`<kind>.<id>.<token>.popup.<mac>`)
 * and NOTHING else — "popup" is the one literal allowed in that slot, so an
 * arbitrary segment cannot be smuggled through even before the MAC is checked.
 */
function verifyConsentState(
  state: string,
  kind: "wc" | "sp",
  payloadPrefix: string,
): { customerId: number; token: string; origin: ConsentUiOrigin } | null {
  const parts = state.split(".");
  if (parts.length !== 4 && parts.length !== 5) return null;
  if (parts[0] !== kind) return null;

  const origin: ConsentUiOrigin | null =
    parts.length === 4 ? "portal" : parts[3] === "popup" ? "popup" : null;
  if (!origin) return null;

  const idPart = parts[1];
  const token = parts[2];
  const mac = parts[parts.length - 1];
  if (!idPart || !token || !mac) return null;

  const customerId = parseInt(idPart, 10);
  if (isNaN(customerId) || String(customerId) !== idPart) return null;

  const expected = createHmac("sha256", writeConsentStateSecret())
    .update(consentStatePayload(payloadPrefix, customerId, token, origin))
    .digest("hex");
  const a = Buffer.from(mac, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return { customerId, token, origin };
}

function signWriteConsentState(customerId: number, token: string, origin: ConsentUiOrigin = "portal"): string {
  const mac = createHmac("sha256", writeConsentStateSecret())
    .update(consentStatePayload("write-consent", customerId, token, origin))
    .digest("hex");
  return origin === "popup" ? `wc.${customerId}.${token}.popup.${mac}` : `wc.${customerId}.${token}.${mac}`;
}
function verifyWriteConsentState(state: string): { customerId: number; token: string; origin: ConsentUiOrigin } | null {
  return verifyConsentState(state, "wc", "write-consent");
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
  const { customerId, token, origin: uiOrigin } = verified;

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
    endConsentCallback(
      res,
      uiOrigin,
      {
        title: "Write access not granted",
        heading: "Write access was not granted",
        detail:
          "You can close this window. The page you started from will offer it again, or let you choose a different option.",
        tone: "warn",
        autoClose: true,
      },
      () => `${hostBase}/portal/consent/declined${tenant ? `?tenant=${encodeURIComponent(tenant)}` : ""}`,
    );
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

  // Fire-and-forget DLP/Label Purview role-group provisioning (#249, #246
  // chunk C) — mirrors the exact same call in the `graph` consent path above
  // (consent.ts's other callback), just fired from this grant instead. Must
  // not delay this callback's own response, and must never fail the write
  // consent grant itself. #249's chain is idempotent and live-state-checked,
  // so firing it from both consent paths is safe by design; this is the
  // grant that usually completes it, since the chain's own write-back gate
  // (dlp-role-group-provisioning.ts's header) is keyed on exactly this
  // consent (#425).
  void (async () => {
    try {
      const { provisionDlpRoleGroupForTenant } = await import("../lib/dlp-role-group-provisioning.ts");
      const outcome = await provisionDlpRoleGroupForTenant(tenant, customerId, "consent.granted");
      log.info({ tenant, customerId, overallStatus: outcome.overallStatus }, "write-consent.granted: DLP role-group provisioning finished");
      await triggerDlpComplianceScanIfProvisioned(tenant, customerId, outcome);
    } catch (err) {
      log.warn({ err, tenant, customerId }, "write-consent.granted: DLP role-group provisioning failed (non-fatal)");
    }
  })();

  // Fire-and-forget Global Reader directory-role assignment (#1130) — grants
  // the READ app's service principal the tenant-wide Global Reader role using
  // this write-back consent's elevated permission (RoleManagement.ReadWrite.
  // Directory on the write app). Gated on exactly this `writeBack` grant, which
  // is why it fires here and not from the `graph` (read) consent path. Same
  // fire-and-forget contract as the DLP chain above: never delays this
  // callback's response, never fails the consent grant, idempotent on re-run.
  void (async () => {
    try {
      const { provisionGlobalReaderForTenant } = await import("../lib/global-reader-role-provisioning.ts");
      const outcome = await provisionGlobalReaderForTenant(tenant, customerId, "consent.granted");
      log.info({ tenant, customerId, overallStatus: outcome.overallStatus }, "write-consent.granted: Global Reader role provisioning finished");
    } catch (err) {
      log.warn({ err, tenant, customerId }, "write-consent.granted: Global Reader role provisioning failed (non-fatal)");
    }
  })();

  log.info({ tenant, customerId }, "Tenant WRITE admin consent granted");
  endConsentCallback(
    res,
    uiOrigin,
    {
      title: "Write access granted",
      heading: "Write access granted",
      detail: "You can close this window — the page you started from is already continuing on its own.",
      tone: "ok",
      autoClose: true,
    },
    () => `${hostBase}/portal/consent/success?tenant=${encodeURIComponent(tenant)}&write=1`,
  );
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
// ⚠ #480, 2026-08-06: this flow is NO LONGER PART OF ANY NEW PURCHASE. Shane's
// App Registration audit confirmed Sites.FullControl.All now sits on the single
// read-only registration alongside the Graph permissions, and Microsoft's v2
// /adminconsent grants everything a registration declares across every resource
// in one click — so the read consent already covers SharePoint and asking for it
// a second time was asking for something the tenant had just given. The Home
// flow's SharePoint step and its /public/flow/sharepoint-consent-url route are
// deleted; see the deletion note further down for the full keep/delete rationale.
//
// ⚠ #637, 2026-08-09: the main `graph` callback (GET /consent/callback above)
// now stamps `sharepoint` granted itself, in the same request, for the same
// reason #480 established — so the portal reconsent pill (reconsent-pill.tsx)
// no longer nags every newly-consenting tenant into a redundant second
// Microsoft screen for a resource their first click already covered.
//
// What survives here is the HISTORICAL path, kept on purpose:
//   - 72h consent links minted before this deploy still land on this callback.
//   - The admin start route and the portal reconsent link below still serve
//     tenants whose `sharepoint` grant predates #637 (their `graph` consent
//     happened before this file auto-stamped `sharepoint` alongside it), and
//     the status route is how anything reads one back.
// Nothing new should be built on it, and nothing here should be re-pointed at
// the marketing flow.
//
// Why the `sharepoint` key was ever separate, which is also why it cannot simply
// be folded into `graph` now: a tenant's granted `graph` consent key is a
// snapshot of REQUIRED_MT_SCOPES (Graph .default) and says nothing about the
// SharePoint resource. Every tenant that consented before Sites.FullControl.All
// was added to the app registration has a perfectly valid Graph consent and NO
// SharePoint grant, so re-consent detection needs its own per-tenant record to
// diff against — reusing the Graph key would report those tenants as
// SharePoint-consented when they aren't. That is exactly the independence
// mergeConsentKey exists to protect now that all three share one jsonb column,
// and it is unchanged by the registration merge: the merge changes what a NEW
// consent grants, not what an OLD tenant row records.
//
// The permission lives on the SAME multi-tenant app as Graph (MT_APP_CLIENT_ID),
// so this reuses that client id rather than a separate registration — unlike the
// write flow above, which has its own app. State handling follows the write-flow
// precedent exactly: never bare, HMAC-signed over customerId + a single-use
// consent_invite_tokens row, with an "sp." prefix so a state minted for this flow
// cannot be replayed against the read or write callbacks (and vice versa).

function signSharePointConsentState(customerId: number, token: string, origin: ConsentUiOrigin = "portal"): string {
  const mac = createHmac("sha256", writeConsentStateSecret())
    .update(consentStatePayload("sharepoint-consent", customerId, token, origin))
    .digest("hex");
  return origin === "popup" ? `sp.${customerId}.${token}.popup.${mac}` : `sp.${customerId}.${token}.${mac}`;
}
function verifySharePointConsentState(state: string): { customerId: number; token: string; origin: ConsentUiOrigin } | null {
  return verifyConsentState(state, "sp", "sharepoint-consent");
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
  const { customerId, token, origin: uiOrigin } = verified;

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
    endConsentCallback(
      res,
      uiOrigin,
      {
        title: "SharePoint access not granted",
        heading: "SharePoint access was not granted",
        detail:
          "You can close this window. The page you started from will offer the approval again — nothing has been connected.",
        tone: "warn",
        autoClose: true,
      },
      () => `${hostBase}/portal/consent/declined${tenant ? `?tenant=${encodeURIComponent(tenant)}` : ""}`,
    );
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
  endConsentCallback(
    res,
    uiOrigin,
    {
      title: "SharePoint access granted",
      heading: "SharePoint access granted",
      detail: "You can close this window — the page you started from is already continuing on its own.",
      tone: "ok",
      autoClose: true,
    },
    () => `${hostBase}/portal/consent/success?tenant=${encodeURIComponent(tenant)}&sharepoint=1`,
  );
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

// ═══════════════════════════════════════════════════════════════════════════════
// Public assessment-flow consent routes (#434, #432)
// ═══════════════════════════════════════════════════════════════════════════════
//
// The marketing site's Home-page assessment flow is unauthenticated: the buyer
// has no account and no JWT until the consent callback provisions a Prospect for
// them. Its identity for the whole flow is the checkout-session UUID — an
// unguessable, server-issued, 24h-expiring secret that already carries their
// name/email/company and, after the read-consent callback, their tenant GUID.
//
// These three routes (four until #480 deleted the SharePoint one — see below)
// are the public, session-keyed twins of the admin/portal routes above. They
// reuse the SAME HMAC state signers, the SAME single-use token table and the
// SAME fixed callbacks — no second consent mechanism, and nothing here can name
// a tenant the session did not already consent for.
//
// Authorisation model, stated explicitly because these are unauthenticated:
//   - The sessionId must resolve to an UNEXPIRED checkout_sessions row.
//   - Every route that mints a consent URL additionally requires that the
//     session has already completed READ consent (status "consented" + a
//     tenant_id stamped by the callback). So a stolen/guessed session cannot be
//     used to aim a write-consent link at an arbitrary tenant: the tenant is
//     whichever one that session's own Global Admin already approved, resolved
//     server-side, never supplied by the caller.
//   - The WRITE-consent mint is additionally product-type gated (#1312): only a
//     session whose ordered product is write-consent eligible — resolved from
//     the services row, never the caller — can mint one. See the gate's own
//     header below.
//   - No PII is returned by any of them.

/** The checkout session a public flow route is acting for, once validated. */
export type FlowSession = {
  id: string;
  status: string;
  tenantId: string | null;
  productSlug: string;
  consentSkippedAt: Date | null;
};

/**
 * Resolve `?sessionId=` (or a body sessionId) to a live checkout session.
 * Responds and returns null on every failure so callers can `if (!s) return;`.
 */
export async function resolveFlowSession(
  rawSessionId: unknown,
  res: Response,
): Promise<FlowSession | null> {
  const sessionId = typeof rawSessionId === "string" ? rawSessionId : "";
  if (!UUID_RE.test(sessionId)) {
    res.status(400).json({ error: "session_invalid" });
    return null;
  }
  const [row] = await db
    .select({
      id: checkoutSessionsTable.id,
      status: checkoutSessionsTable.status,
      tenantId: checkoutSessionsTable.tenantId,
      productSlug: checkoutSessionsTable.productSlug,
      consentSkippedAt: checkoutSessionsTable.consentSkippedAt,
    })
    .from(checkoutSessionsTable)
    .where(
      and(
        eq(checkoutSessionsTable.id, sessionId),
        gte(checkoutSessionsTable.expiresAt, new Date()),
      ),
    )
    .limit(1);

  if (!row) {
    res.status(404).json({ error: "session_expired" });
    return null;
  }
  return row;
}

/**
 * The tenants row a post-read-consent flow route may act on: the one the
 * session's own admin already granted READ consent for. Fails closed — a
 * session that has not completed read consent has no tenant to aim anything at.
 */
export async function resolveConsentedTenant(
  session: FlowSession,
  res: Response,
): Promise<{ id: number; tenantId: string } | null> {
  const tenantGuid = session.tenantId?.trim();
  if (!tenantGuid) {
    res.status(409).json({ error: "read_consent_required" });
    return null;
  }
  const [row] = await db
    .select({ id: tenantsTable.id, tenantId: tenantsTable.tenantId, consent: tenantsTable.consent })
    .from(tenantsTable)
    .where(eq(tenantsTable.tenantId, tenantGuid))
    .limit(1);

  if (!row) {
    log.warn({ sessionId: session.id, tenantGuid }, "public consent flow: session names a tenant with no tenants row");
    res.status(409).json({ error: "read_consent_required" });
    return null;
  }
  if (row.consent?.graph?.status !== "granted") {
    res.status(409).json({ error: "read_consent_required" });
    return null;
  }
  return { id: row.id, tenantId: row.tenantId };
}

// ── GET /api/public/flow/consent-status ────────────────────────────────────────
// The single polling endpoint the Home flow uses to auto-advance (#434). The
// buyer grants each consent in a popup on Microsoft's own domain; the page they
// started from never navigates away, so it polls this to learn when each grant
// has landed and moves itself to the next step.
//
// Returns statuses only — no scopes, no admin identity, no PII.

router.get("/public/flow/consent-status", async (req: Request, res: Response) => {
  const session = await resolveFlowSession(req.query.sessionId, res);
  if (!session) return;

  const tenantGuid = session.tenantId?.trim();
  let consent: TenantConsentMap = {};
  if (tenantGuid) {
    const [row] = await db
      .select({ consent: tenantsTable.consent })
      .from(tenantsTable)
      .where(eq(tenantsTable.tenantId, tenantGuid))
      .limit(1);
    consent = row?.consent ?? {};
  }

  res.json({
    sessionStatus: session.status,
    tenantConnected: !!tenantGuid,
    graph: consent.graph?.status ?? null,
    sharepoint: consent.sharepoint?.status ?? null,
    writeBack: consent.writeBack?.status ?? null,
    complianceGroup: consent.complianceGroup
      ? { path: consent.complianceGroup.path, confirmed: !!consent.complianceGroup.confirmedAt }
      : null,
    // #1972: whether this tenant's admin has completed the Power Platform
    // management-app device-code enrolment — see /public/flow/power-platform-
    // enrollment-status above for the fuller record (enrolledByUpn included).
    powerPlatformEnrolled: consent.powerPlatformEnrollment != null,
    // #1311: the buyer's explicit "skip the optional scan" decision (Retainer
    // purchases only — see /public/flow/read-consent-skip below). Additive;
    // pre-#1311 callers ignore it. Cleared server-side if consent later lands.
    readConsentSkipped: session.consentSkippedAt != null,
  });
});

// ── GET /api/public/flow/read-consent-url (Git #1311, Epic #1309 Phase 2) ──────
// The generalized READ-consent URL mint for a purchase session — the route
// Buy.tsx's flow calls for every product. Same mechanism as the assessment
// funnel's GET /api/public/consent-url (which stays unchanged for its existing
// callers): the OAuth `state` is the session UUID itself, landing on the same
// GET /api/consent/callback above. What this route adds is the product's
// consent REQUIREMENT, resolved server-side from the session's own services row
// (lib/read-consent-flow.ts) so the front-end renders required-vs-skippable
// from the catalog rather than hardcoding product knowledge:
//
//   requirement "required" — Monitoring tiers, Packs, assessments, and any
//     product the catalog cannot vouch for (fail closed). The purchase cannot
//     proceed without the grant.
//   requirement "optional" — Retainer only. The buyer may decline via
//     POST /public/flow/read-consent-skip below.

router.get("/public/flow/read-consent-url", async (req: Request, res: Response) => {
  if (!process.env.MT_APP_CLIENT_ID) {
    res.status(503).json({
      error: "Multi-tenant app credentials not configured (MT_APP_CLIENT_ID)",
    });
    return;
  }
  const session = await resolveFlowSession(req.query.sessionId, res);
  if (!session) return;

  const { requirement } = await getReadConsentRequirementForProduct(session.productSlug);
  const url = buildSessionReadConsentUrl(getHostBase(req), session.id, process.env.MT_APP_CLIENT_ID);

  res.json({
    url,
    requirement,
    skippable: requirement === "optional",
    // Mirrors what the invite-link routes return, so the flow can show the
    // buyer the read app's permission list before they approve it.
    scopes: REQUIRED_MT_SCOPES,
    readConsentSkipped: session.consentSkippedAt != null,
  });
});

// ── POST /api/public/flow/read-consent-skip (Git #1311) ────────────────────────
// The EXPLICIT skip branch behind Buy.tsx's "Skip — buy without a scan"
// (`connectOffered`/`scanSkipped`): records the buyer's decision on the session
// row (checkout_sessions.consent_skipped_at) so downstream fulfillment can
// branch on a real fact, not a client-side state that vanished with the tab.
// Fails closed twice, server-side, never trusting the caller:
//
//   - A product whose read consent is REQUIRED (Monitoring, Packs, anything
//     unknown) is refused with 409 consent_required — the front-end offering a
//     skip button it shouldn't have cannot manufacture a skippable purchase.
//   - A session whose tenant already granted consent is refused with 409
//     already_consented — a landed grant is never silently un-recorded; the
//     buyer's "Change" path is a fresh consent, not a retroactive skip.

const readConsentSkipSchema = z.object({ sessionId: z.string() });

router.post("/public/flow/read-consent-skip", async (req: Request, res: Response) => {
  const parsed = readConsentSkipSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid request" });
    return;
  }
  const session = await resolveFlowSession(parsed.data.sessionId, res);
  if (!session) return;

  if (session.tenantId?.trim() || session.status === "consented") {
    res.status(409).json({ error: "already_consented" });
    return;
  }

  const { requirement, serviceType } = await getReadConsentRequirementForProduct(session.productSlug);
  if (requirement !== "optional") {
    log.warn(
      { sessionId: session.id, productSlug: session.productSlug, serviceType, requirement },
      "public flow: read-consent skip REFUSED — this product's read consent is required, not skippable",
    );
    res.status(409).json({ error: "consent_required", requirement });
    return;
  }

  const now = new Date();
  await db
    .update(checkoutSessionsTable)
    .set({ consentSkippedAt: now, updatedAt: now })
    .where(eq(checkoutSessionsTable.id, session.id));

  await createAuditLog({
    actorUserId: null,
    actorName: "public:purchase-flow",
    actorRole: "client",
    actionType: "read_consent_skipped",
    entityType: "checkout_session",
    entityId: session.id,
    metadata: { sessionId: session.id, productSlug: session.productSlug, serviceType },
  });

  log.info(
    { sessionId: session.id, productSlug: session.productSlug, serviceType },
    "public flow: read consent explicitly skipped (optional for this product)",
  );

  res.json({ ok: true, requirement, readConsentSkipped: true });
});

// ── GET /api/public/flow/sharepoint-consent-url — DELETED (#480) ───────────────
//
// This route minted the Home flow's SECOND consent link ("step 2b" of #434), for
// a SharePoint Online approval the buyer had to give on a separate trip to the
// Microsoft consent screen. Shane's 2026-08-06 App Registration audit confirmed
// those permissions have been merged into the single read-only registration, so
// one admin-consent grant now covers Graph and SharePoint together and there is
// no second link to mint. AssessmentFlow.tsx was this route's ONLY caller
// (checked by grep across every artifact before deleting), and its SharePoint
// stage is gone, so the route is deleted rather than left as an unauthenticated
// public endpoint with no purpose.
//
// What is deliberately NOT deleted, and why — this is the #480 item-3 decision:
//
//   - `/api/admin/sharepoint-consent/callback`, signSharePointConsentState and
//     verifySharePointConsentState STAY — all of them, including the "popup"
//     origin branch this deleted route was the only minter of. Consent links
//     live 72h, so a popup-origin SharePoint link handed out before this deploy
//     is still in flight and must still verify and still self-close rather than
//     dying on an unrecognised state. The callback is also shared with the admin
//     and portal routes, which are not part of the marketing flow at all.
//   - `/api/admin/customers/:customerId/sharepoint-consent/start` and
//     `/api/portal/consent/sharepoint-link` STAY. They are wired into live UI
//     (admin-panel's customer pane, msp-portal's reconsent pill) that exists for
//     tenants whose SharePoint grant predates the merge.
//   - The `sharepoint` ConsentKey, the `sharepoint` field on
//     /public/flow/consent-status, and REQUIRED_SHAREPOINT_APP_PERMISSIONS STAY.
//     They are how an EXISTING tenant's historical, separately-granted SharePoint
//     consent is read back — by /admin/customers/:id/sharepoint-consent above, by
//     admin-active-directory (`sharePointConsent`) and by portal-assessment's
//     `sharePointPermissionsStale`.
//     Dropping the key would not migrate that data, it would just stop anything
//     being able to see it. Whether tenant rows in production still carry a
//     separate `sharepoint` grant is a DB question this environment cannot answer
//     (no DATABASE_URL), which is itself a reason to keep the readers: the cost of
//     keeping them is a few dead-for-new-consents lines, and the cost of guessing
//     wrong the other way is silently blinding every one of those surfaces.
//
// Net effect: nothing new ever writes a separate `sharepoint` grant through
// THIS route specifically; everything that could already read one still can.
// Since #637 the checkout-session (popup) path still gets `sharepoint`
// granted — it just happens as a side effect of GET /consent/callback's own
// `graph` stamp above, not through a second public route here.

// ── Write-consent product-type gate (Git #1312) ────────────────────────────────
//
// Which PURCHASED PRODUCTS may ever put the write app's (MT_APP_WRITE_CLIENT_ID)
// admin-consent screen in front of a buyer. Deny-by-default allowlist resolved
// from the session's own services row — never from anything the caller sends —
// so a front-end bug or a hand-crafted request cannot aim the write app at a
// product whose flow ends at read consent. Per #1309's product-specific flows:
//
//   - Quick-Start Packs      → ELIGIBLE. `services.category = 'config_pack'` is
//     the one reliable pack discriminator: 7 of the 12 sellable pack rows carry
//     a NULL service_type (confirmed against the live catalog), and
//     lib/remediation-catalog.ts keys the sellable-pack universe on exactly
//     this category. Packs are the flow that genuinely NEEDS write consent —
//     their fulfillment executes real Graph writes via
//     config-pack-orchestrator.ts.
//   - Assessment products    → ELIGIBLE. The #432 Compliance-decision
//     `delegate_write` path this route originally served (AssessmentFlow.tsx is
//     its only pre-#1312 caller) — kept working unchanged.
//   - Monitoring ('monitoring_tier') and Retainer ('retainer') → NEVER. Their
//     #1309 flows end at read consent (required for Monitoring, skippable for
//     Retainer); neither has any write-back fulfillment. They are excluded by
//     the deny-default, not by name — do not add them here.
//
// An unknown slug, or a session slug that names no services row at all (e.g.
// the portal SOW cart's constant "sow-cart", which deliberately resolves no
// service), fails CLOSED.
function isWriteConsentEligibleProduct(service: { category: string | null; serviceType: string | null }): boolean {
  return service.category === "config_pack" || service.serviceType === "assessment";
}

/**
 * Resolve the session's ordered product and enforce the write-consent
 * product-type gate. Responds 403 and returns false when the product may not
 * trigger a write-consent prompt, BEFORE any single-use token is minted — an
 * ineligible session never even creates a consent_invite_tokens row, so there
 * is no state the fixed write callback could ever accept for it.
 */
async function requireWriteConsentEligibleProduct(
  session: FlowSession,
  res: Response,
): Promise<boolean> {
  const slug = session.productSlug?.trim();
  const [svc] = slug
    ? await db
        .select({ category: servicesTable.category, serviceType: servicesTable.serviceType })
        .from(servicesTable)
        .where(eq(servicesTable.slug, slug))
        .limit(1)
    : [];

  if (!svc || !isWriteConsentEligibleProduct(svc)) {
    log.warn(
      {
        sessionId: session.id,
        productSlug: slug || null,
        category: svc?.category ?? null,
        serviceType: svc?.serviceType ?? null,
      },
      "public flow: write-consent URL REFUSED — product type is not write-consent eligible (Packs and assessments only; Monitoring/Retainer never)",
    );
    res.status(403).json({ error: "write_consent_not_available_for_product" });
    return false;
  }
  return true;
}

// ── GET /api/public/flow/write-consent-url ─────────────────────────────────────
// The generalized write-consent URL mint for a checkout session (#1312, Phase 3
// of #1309): originally path 2 of the #432 Compliance decision, now also the
// route Buy.tsx's Pack purchase flow calls for its "pay → read consent → write
// consent → dry-run → execute" chain. Needs the separate write-scoped App
// Registration (MT_APP_WRITE_CLIENT_ID). Same mechanism as
// /admin/customers/:id/write-consent/start — which, with the callback it
// shares, stays completely unchanged. Product-type gated (see above): only an
// eligible product's session can mint a URL here, checked server-side against
// the catalog row, never trusted from the caller.

router.get("/public/flow/write-consent-url", async (req: Request, res: Response) => {
  if (!process.env.MT_APP_WRITE_CLIENT_ID) {
    res.status(503).json({ error: "Write app credentials not configured (MT_APP_WRITE_CLIENT_ID)" });
    return;
  }
  const session = await resolveFlowSession(req.query.sessionId, res);
  if (!session) return;
  // Product gate FIRST — a Monitoring/Retainer buyer gets a definitive "not
  // available for this product", never a "grant read consent first" that
  // implies retrying could ever succeed.
  if (!(await requireWriteConsentEligibleProduct(session, res))) return;
  const tenant = await resolveConsentedTenant(session, res);
  if (!tenant) return;

  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);

  await db.insert(consentInviteTokensTable).values({
    token,
    tenantId: tenant.tenantId,
    customerId: tenant.id,
    clientUserId: null,
    expiresAt,
  });

  // "popup" — same reason as the SharePoint route above (#474).
  const consentUrl = buildAdminConsentUrl(
    tenant.tenantId,
    signWriteConsentState(tenant.id, token, "popup"),
    `${getHostBase(req)}/api/admin/write-consent/callback`,
    process.env.MT_APP_WRITE_CLIENT_ID,
  );

  await createAuditLog({
    actorUserId: null,
    actorName: "public:assessment-flow",
    actorRole: "client",
    actionType: "write_consent_invite_created",
    entityType: "tenant_write_consent",
    metadata: { tenantHint: tenant.tenantId, customerId: tenant.id, expiresAt, checkoutSessionId: session.id },
  });

  // `permissions` mirrors what /public/flow/sharepoint-consent-url has always
  // returned, so the flow can show the buyer the write app's permission list
  // before they approve it (#475). It is [] until REQUIRED_WRITE_APP_PERMISSIONS
  // is filled in from the app registration — see the constant's note in graph.ts.
  // The client renders nothing rather than a placeholder when it is empty.
  res.json({ consentUrl, expiresAt, permissions: REQUIRED_WRITE_APP_PERMISSIONS });
});

// ── POST /api/public/flow/compliance-decision ──────────────────────────────────
// Records the #432 three-path Compliance Center decision on the tenant. The
// `delegate_write` path's real grant is the independent `writeBack` consent
// record written by the write callback — this only records which path the
// customer chose, and for `self_add` whether they have told us it is done.

const complianceDecisionSchema = z.object({
  sessionId: z.string(),
  path: z.enum(["self_add", "delegate_write", "declined"]),
  /** Only meaningful for `self_add`: "I have added it, go ahead". */
  confirmed: z.boolean().optional(),
});

router.post("/public/flow/compliance-decision", async (req: Request, res: Response) => {
  const parsed = complianceDecisionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid request" });
    return;
  }
  const { path, confirmed } = parsed.data;

  const session = await resolveFlowSession(parsed.data.sessionId, res);
  if (!session) return;
  const tenant = await resolveConsentedTenant(session, res);
  if (!tenant) return;

  const now = new Date().toISOString();
  // Field-level merge, exactly like every other consent write in this file: a
  // later "confirmed" must not blank the original decidedAt, and none of the
  // three real consent grants may be touched.
  await db
    .update(tenantsTable)
    .set({
      consent: mergeConsentKey("complianceGroup", {
        path,
        decidedAt: now,
        ...(path === "self_add" ? { confirmedAt: confirmed ? now : null } : {}),
      }),
      updatedAt: new Date(),
    })
    .where(eq(tenantsTable.id, tenant.id));

  await createAuditLog({
    actorUserId: null,
    actorName: "public:assessment-flow",
    actorRole: "client",
    actionType: "compliance_group_decision_recorded",
    entityType: "tenant_compliance_group",
    entityId: tenant.tenantId,
    metadata: { customerId: tenant.id, path, confirmed: confirmed === true, checkoutSessionId: session.id },
  });

  log.info(
    { customerId: tenant.id, tenantId: tenant.tenantId, path, confirmed: confirmed === true },
    "public assessment flow: Compliance Center group decision recorded",
  );

  res.json({ ok: true, path, confirmed: confirmed === true });
});

// ── Power Platform management-app enrolment (Git #1972) ───────────────────────
// The onboarding-flow equivalent of what #1906 did by hand: get the customer's
// OWN tenant admin to interactively register our service principal
// (MT_APP_CLIENT_ID) as a Power Platform management application — the one-time,
// per-tenant action power-platform-admin.ts's PowerPlatformNotRegisteredError
// names, which no amount of Graph/SharePoint consent can substitute for. Uses
// OAuth2 device-code, not a redirect popup: there is no admin-consent screen
// for this action (it isn't a scope grant at all), so the admin instead visits
// a short Microsoft page and types a code — device-code is the flow that
// matches that shape, and mirrors what New-PowerAppManagementApp does under the
// hood. See power-platform-admin.ts's own header for why the device-code
// client is deliberately NOT MT_APP_CLIENT_ID.
//
// Gated behind resolveConsentedTenant exactly like the SharePoint/write/
// compliance-decision routes above: this step only makes sense for a tenant
// that has already completed Graph read consent (there is no tenant row to
// enrol otherwise), and it is offered from the SAME onboarding flow session.
//
// Three routes, matching the shape of every other /public/flow poll pair in
// this file:
//   POST .../power-platform-enrollment-start  — mint a device-code challenge
//   POST .../power-platform-enrollment-poll   — poll it once; on success this
//                                                ALSO performs the PUT and
//                                                persists the enrolment record
//   GET  .../power-platform-enrollment-status — current persisted state, for a
//                                                page reload / step re-entry

router.post("/public/flow/power-platform-enrollment-start", async (req: Request, res: Response) => {
  if (!process.env.MT_APP_CLIENT_ID) {
    res.status(503).json({ error: "Multi-tenant app credentials not configured (MT_APP_CLIENT_ID)" });
    return;
  }
  const parsed = z.object({ sessionId: z.string() }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid request" });
    return;
  }
  const session = await resolveFlowSession(parsed.data.sessionId, res);
  if (!session) return;
  const tenant = await resolveConsentedTenant(session, res);
  if (!tenant) return;

  try {
    const challenge = await startPowerPlatformEnrollmentDeviceCode(tenant.tenantId);
    log.info({ customerId: tenant.id, tenantId: tenant.tenantId }, "public flow: Power Platform enrolment device-code challenge started");
    res.json({
      deviceCode: challenge.deviceCode,
      userCode: challenge.userCode,
      verificationUri: challenge.verificationUri,
      expiresIn: challenge.expiresIn,
      interval: challenge.interval,
      message: challenge.message,
    });
  } catch (err) {
    log.error({ err, customerId: tenant.id, tenantId: tenant.tenantId }, "public flow: Power Platform device-code challenge failed to start");
    res.status(502).json({ error: err instanceof Error ? err.message : "Failed to start device-code challenge" });
  }
});

const powerPlatformEnrollmentPollSchema = z.object({ sessionId: z.string(), deviceCode: z.string() });

router.post("/public/flow/power-platform-enrollment-poll", async (req: Request, res: Response) => {
  if (!process.env.MT_APP_CLIENT_ID) {
    res.status(503).json({ error: "Multi-tenant app credentials not configured (MT_APP_CLIENT_ID)" });
    return;
  }
  const parsed = powerPlatformEnrollmentPollSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid request" });
    return;
  }
  const session = await resolveFlowSession(parsed.data.sessionId, res);
  if (!session) return;
  const tenant = await resolveConsentedTenant(session, res);
  if (!tenant) return;

  const result = await pollPowerPlatformEnrollmentDeviceCode(tenant.tenantId, parsed.data.deviceCode, process.env.MT_APP_CLIENT_ID);

  if (result.status === "pending") {
    res.json({ status: "pending" });
    return;
  }

  if (result.status === "error") {
    log.warn({ customerId: tenant.id, tenantId: tenant.tenantId, message: result.message }, "public flow: Power Platform enrolment poll returned an error");
    res.json({ status: "error", message: result.message });
    return;
  }

  // "enrolled" — the PUT already succeeded inside pollPowerPlatformEnrollmentDeviceCode;
  // this only persists the record. `powerPlatformEnrollment` is its own key, never
  // one of graph/writeBack/sharepoint — see TenantPowerPlatformEnrollmentRecord's doc.
  const enrolledAt = new Date().toISOString();
  await db
    .update(tenantsTable)
    .set({
      consent: mergeConsentKey("powerPlatformEnrollment", {
        enrolledAt,
        enrolledByUpn: result.enrolledByUpn,
        clientId: result.clientId,
      }),
      updatedAt: new Date(),
    })
    .where(eq(tenantsTable.id, tenant.id));

  await createAuditLog({
    actorUserId: null,
    actorName: "public:assessment-flow",
    actorRole: "client",
    actionType: "power_platform_management_app_enrolled",
    entityType: "tenant_power_platform_enrollment",
    entityId: tenant.tenantId,
    metadata: { customerId: tenant.id, enrolledByUpn: result.enrolledByUpn, clientId: result.clientId, checkoutSessionId: session.id },
  });

  log.info(
    { customerId: tenant.id, tenantId: tenant.tenantId, enrolledByUpn: result.enrolledByUpn },
    "public flow: Power Platform management app enrolled via device code",
  );

  res.json({ status: "enrolled", enrolledAt, enrolledByUpn: result.enrolledByUpn });
});

router.get("/public/flow/power-platform-enrollment-status", async (req: Request, res: Response) => {
  const session = await resolveFlowSession(req.query.sessionId, res);
  if (!session) return;
  const tenant = await resolveConsentedTenant(session, res);
  if (!tenant) return;

  const [row] = await db
    .select({ consent: tenantsTable.consent })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, tenant.id))
    .limit(1);

  const record = row?.consent?.powerPlatformEnrollment ?? null;
  res.json({
    enrolled: record != null,
    enrolledAt: record?.enrolledAt ?? null,
    enrolledByUpn: record?.enrolledByUpn ?? null,
  });
});

export default router;
