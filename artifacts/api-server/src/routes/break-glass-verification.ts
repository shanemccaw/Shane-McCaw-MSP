/**
 * break-glass-verification.ts
 *
 * Customer-tenant-proven delivery of a break-glass secret produced by a paused
 * workflow run (see the "break_glass_verification_gate" node in workflow-executor).
 *
 * Flow:
 *   1. A portal user invites 1–5 recipients (POST /portal/break-glass/:id/invite).
 *   2. Each recipient opens their single-use link (GET /public/break-glass/verify/:token),
 *      which redirects into a Microsoft OAuth sign-in scoped to THAT customer's tenant.
 *   3. The callback (GET /public/break-glass/verify/callback) checks whether the
 *      signed-in user holds an ACTIVE eligible directory role. The first to prove it
 *      wins; the secret is revealed once and every other pending link is superseded.
 *   4. On the winner's explicit acknowledgment (POST /public/break-glass/:id/acknowledge)
 *      the plaintext is purged and the paused workflow run is resumed via the SAME
 *      resumeWorkflowRun path the pending-approvals /decide endpoint uses.
 *   5. An admin can force-reset the credential when every link is dead-ended
 *      (POST /portal/break-glass/:id/admin-override).
 *
 * The decrypted secret is NEVER written to req.log, the run-log/output-sample tables,
 * or the run payload — only { revealed, deliveredToEmail, timestamp } is logged.
 */

import { Router, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { randomBytes, createHmac, timingSafeEqual } from "crypto";
import { z } from "zod";
import {
  db,
  breakGlassPendingSecretsTable,
  breakGlassVerificationAttemptsTable,
  breakGlassOverrideAuditTable,
  mspCustomersTable,
  mspsTable,
  wfRunsTable,
} from "@workspace/db";
import { and, eq, ne, gte, desc } from "drizzle-orm";
import { requireAuth, assertCustomerAccess, type AuthUser } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";
import { decryptSecret, encryptSecret } from "../lib/secret-crypto";
import { graphWriteForTenant, sendMailViaGraph, graphCredentialsPresent } from "../lib/graph";
import { sendEmailForMspOrThrow } from "../lib/mailer";

const router = Router();

// ── Tunables (named constants, not magic numbers) ─────────────────────────────
/** How long a verification link stays valid, measured from its createdAt. */
const BREAK_GLASS_LINK_TTL_MS = 24 * 60 * 60 * 1000; // 24h
/** Failed (role_absent) verifications allowed before a link is burned. */
const BREAK_GLASS_MAX_ATTEMPTS = 5;
/** Rolling window for the repeated-override alert. */
const BREAK_GLASS_OVERRIDE_ALERT_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h
/** Number of overrides in the window that triggers the alert (2nd override fires it). */
const BREAK_GLASS_OVERRIDE_ALERT_THRESHOLD = 2;
/**
 * Entra role template ids that satisfy the gate. Global Administrator by default;
 * extend here to accept other eligible roles (single source of truth — not inlined).
 */
const ELIGIBLE_ROLE_TEMPLATE_IDS = [
  "62e90394-69f5-4237-9190-012177145e10", // Global Administrator
];

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

function siteUrl(): string {
  return (process.env.SITE_URL ?? "").replace(/\/$/, "");
}
function callbackRedirectUri(): string {
  return `${siteUrl()}/api/public/break-glass/verify/callback`;
}

// ── State signing (ties the OAuth callback back to the attempt) ───────────────
function stateSecret(): string {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET not configured");
  return s;
}
function signState(token: string): string {
  const mac = createHmac("sha256", stateSecret()).update(token).digest("hex");
  return `${token}.${mac}`;
}
function verifyState(state: string): string | null {
  const dot = state.lastIndexOf(".");
  if (dot <= 0) return null;
  const token = state.slice(0, dot);
  const mac = state.slice(dot + 1);
  const expected = createHmac("sha256", stateSecret()).update(token).digest("hex");
  const a = Buffer.from(mac, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return token;
}

const publicLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again later." },
});

// ── MSP white-label branding + mandatory credibility footer ───────────────────
interface PageBranding {
  name: string;
  logoUrl: string | null;
  primaryColor: string | null;
}

/**
 * Non-removable per platform standing rule — every customer-facing page renders
 * this, unconditionally, regardless of which MSP is involved. MSP white-label
 * branding augments the page; it never overrides or hides this line.
 */
const CREDIBILITY_FOOTER_TEXT = "Modernization delivered by a 30-Year Microsoft Veteran & M365 Architect for NASA";

// ── Minimal self-contained public page (baseline; msp-portal Prompt 6 may supersede) ──
// `branding` is null only for pages rendered before an MSP/customer context could
// be resolved (e.g. a token that doesn't exist yet) — the credibility footer still
// renders unconditionally in that case.
function renderPage(title: string, bodyHtml: string, branding: PageBranding | null): string {
  const accent = branding?.primaryColor || "#111827";
  const headerHtml = branding
    ? `<div class="brand-header">` +
      (branding.logoUrl ? `<img src="${escapeHtml(branding.logoUrl)}" alt="${escapeHtml(branding.name)}" class="brand-logo">` : "") +
      `<span class="brand-name">${escapeHtml(branding.name)}</span></div>`
    : "";
  return `<!doctype html><html><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<meta name="robots" content="noindex,nofollow"><title>${escapeHtml(title)}</title>` +
    `<style>body{font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:34rem;margin:0 auto;padding:0 1rem 2rem;color:#1a1a1a}` +
    `.brand-header{display:flex;align-items:center;gap:.75rem;padding:1.5rem 0 0}` +
    `.brand-logo{height:32px;max-width:160px;object-fit:contain}` +
    `.brand-name{font-weight:600;font-size:1rem;color:#1a1a1a}` +
    `.card{border:1px solid #e5e7eb;border-radius:12px;padding:1.5rem;margin-top:1.5rem}h1{font-size:1.25rem}` +
    `code{background:#f3f4f6;padding:.15rem .35rem;border-radius:6px}` +
    `.secret{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:1.1rem;background:#111827;color:#f9fafb;padding:1rem;border-radius:8px;word-break:break-all}` +
    `button{background:${accent};color:#fff;border:0;border-radius:8px;padding:.6rem 1rem;font-size:1rem;cursor:pointer}` +
    `.credibility-footer{margin-top:2rem;padding-top:1rem;border-top:1px solid #e5e7eb;text-align:center;font-size:.75rem;color:#6b7280}</style></head>` +
    `<body>${headerHtml}<div class="card">${bodyHtml}</div>` +
    `<div class="credibility-footer">${escapeHtml(CREDIBILITY_FOOTER_TEXT)}</div>` +
    `</body></html>`;
}
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

// ── Shared context resolver: pendingSecretId → customer / MSP / tenant / branding ──
// Single query — extends the standard customerId → mspCustomersTable.mspId →
// mspsTable lookup pattern (same shape used elsewhere for MSP branding, e.g.
// msp-onboarding.ts) with one more join so callers get white-label branding for
// free alongside tenant/domain context, without a second round-trip.
interface PendingContext {
  secret: typeof breakGlassPendingSecretsTable.$inferSelect;
  mspId: number;
  tenantId: string | null;
  domain: string | null;
  branding: PageBranding;
}
async function resolvePendingContext(pendingSecretId: number): Promise<PendingContext | null> {
  const [row] = await db
    .select({
      secret: breakGlassPendingSecretsTable,
      mspId: mspCustomersTable.mspId,
      tenantId: mspCustomersTable.tenantId,
      domain: mspCustomersTable.domain,
      mspName: mspsTable.name,
      mspLogoUrl: mspsTable.logoUrl,
      mspPrimaryColor: mspsTable.primaryColor,
    })
    .from(breakGlassPendingSecretsTable)
    .innerJoin(mspCustomersTable, eq(breakGlassPendingSecretsTable.customerId, mspCustomersTable.id))
    .innerJoin(mspsTable, eq(mspsTable.id, mspCustomersTable.mspId))
    .where(eq(breakGlassPendingSecretsTable.id, pendingSecretId))
    .limit(1);
  if (!row) return null;
  return {
    secret: row.secret, mspId: row.mspId, tenantId: row.tenantId, domain: row.domain,
    branding: { name: row.mspName, logoUrl: row.mspLogoUrl, primaryColor: row.mspPrimaryColor },
  };
}

/**
 * Shared invite issuance — used by both the invite endpoint and admin-override.
 * Generates a single-use token per email (onboarding-link pattern), inserts a
 * verification-attempt row, and emails the recipient via the MSP's customer-facing
 * mail path. Returns the number of invites successfully sent.
 */
async function sendBreakGlassInvites(
  pendingSecretId: number,
  emails: string[],
  initiatedByUserId: number,
  mspId: number,
): Promise<number> {
  let sent = 0;
  for (const rawEmail of emails) {
    const email = rawEmail.toLowerCase().trim();
    const linkToken = randomBytes(32).toString("hex");
    await db.insert(breakGlassVerificationAttemptsTable).values({
      pendingSecretId,
      initiatedByPortalUserId: initiatedByUserId,
      invitedEmail: email,
      linkToken,
      linkStatus: "pending",
      failedAttemptCount: 0,
    });
    // Points at the msp-portal landing page (Prompt 6), NOT the backend redirect
    // endpoint directly — the recipient sees context copy + a "Sign in with
    // Microsoft" button before the OAuth redirect fires, rather than landing on
    // Microsoft's login screen with zero context.
    const link = `${siteUrl()}/portal/break-glass/verify/${linkToken}`;
    const html =
      `<p>You have been asked to verify control of your organization's Microsoft 365 tenant in order to receive a break-glass administrator credential.</p>` +
      `<p>This link is single-use and expires in ${Math.round(BREAK_GLASS_LINK_TTL_MS / 3_600_000)} hours. You will be asked to sign in with your Microsoft account; you must hold an active Global Administrator role.</p>` +
      `<p><a href="${escapeHtml(link)}">Verify and retrieve the credential</a></p>`;
    try {
      await sendEmailForMspOrThrow(mspId, email, "Action required: verify your tenant to retrieve a break-glass credential", html);
      sent++;
    } catch (err) {
      logger.warn({ err, pendingSecretId, email }, "break-glass: invite email failed (non-fatal for this recipient)");
    }
  }
  return sent;
}

/**
 * Repeated-override alert. Fires ONLY from admin-override, immediately after the
 * audit write. Reuses the platform-mailbox Graph mail primitive (an internal signal
 * to the platform admin) — NOT the customer-facing sender and NOT the alert-rule
 * engine. Non-fatal: a send failure must never undo the override.
 */
async function maybeFireOverrideAlert(customerId: number, tenantDomain: string | null): Promise<void> {
  try {
    const windowStart = new Date(Date.now() - BREAK_GLASS_OVERRIDE_ALERT_WINDOW_MS);
    const rows = await db
      .select({
        adminUserId: breakGlassOverrideAuditTable.adminUserId,
        reason: breakGlassOverrideAuditTable.reason,
        createdAt: breakGlassOverrideAuditTable.createdAt,
      })
      .from(breakGlassOverrideAuditTable)
      .where(and(
        eq(breakGlassOverrideAuditTable.customerId, customerId),
        gte(breakGlassOverrideAuditTable.createdAt, windowStart),
      ))
      .orderBy(breakGlassOverrideAuditTable.createdAt);

    if (rows.length < BREAK_GLASS_OVERRIDE_ALERT_THRESHOLD) return;

    const mailUserId = process.env.GRAPH_MAIL_USER_ID;
    if (!mailUserId || !graphCredentialsPresent()) {
      logger.warn({ customerId, count: rows.length }, "break-glass: override threshold crossed but platform mailbox not configured — alert skipped");
      return;
    }

    const listHtml = rows
      .map((r) => `<li>admin #${r.adminUserId} — ${escapeHtml(r.reason)} <em>(${r.createdAt.toISOString()})</em></li>`)
      .join("");
    const windowHours = Math.round(BREAK_GLASS_OVERRIDE_ALERT_WINDOW_MS / 3_600_000);
    const html =
      `<p><strong>${rows.length}</strong> break-glass admin-overrides for customer <code>#${customerId}</code>` +
      `${tenantDomain ? ` (${escapeHtml(tenantDomain)})` : ""} in the last ${windowHours}h.</p>` +
      `<p>Repeated resets can mean flaky email delivery to the customer's admins — or that something is wrong with this tenant's break-glass setup. Each reset:</p>` +
      `<ul>${listHtml}</ul>`;

    await sendMailViaGraph({
      fromUserId: mailUserId,
      to: mailUserId,
      subject: `[break-glass] ${rows.length} overrides for customer #${customerId} in ${windowHours}h`,
      htmlBody: html,
    });
    logger.info({ customerId, count: rows.length }, "break-glass: repeated-override alert sent");
  } catch (err) {
    logger.warn({ err, customerId }, "break-glass: repeated-override alert failed (non-fatal)");
  }
}

function generateStrongPassword(): string {
  // 4 char classes guaranteed + entropy from random bytes.
  const rand = randomBytes(24).toString("base64").replace(/[^a-zA-Z0-9]/g, "");
  return `Bg9!${rand}`.slice(0, 28);
}

const effectiveRoleOf = (user: AuthUser) => (user.role === "admin" ? "PlatformAdmin" : user.mspRole);

// ── Delegated Graph helpers (auth-code flow — net-new; standard OAuth) ─────────
async function exchangeCodeForToken(tenantId: string, code: string): Promise<string | null> {
  const clientId = process.env.MT_APP_CLIENT_ID;
  const clientSecret = process.env.MT_APP_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("MT_APP_CLIENT_ID / MT_APP_CLIENT_SECRET not configured");
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: callbackRedirectUri(),
    scope: "https://graph.microsoft.com/User.Read",
  });
  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  if (!res.ok) {
    logger.warn({ tenantId, status: res.status }, "break-glass: auth-code exchange failed");
    return null;
  }
  const data = (await res.json()) as { access_token?: string };
  return data.access_token ?? null;
}

async function graphGetDelegated<T>(token: string, path: string): Promise<T | null> {
  const res = await fetch(`${GRAPH_BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  return (await res.json()) as T;
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /portal/break-glass/:pendingSecretId/invite
// ─────────────────────────────────────────────────────────────────────────────
router.post("/portal/break-glass/:pendingSecretId/invite", requireAuth, async (req: Request, res: Response) => {
  const pendingSecretId = parseInt(req.params.pendingSecretId as string, 10);
  if (isNaN(pendingSecretId)) return res.status(404).json({ error: "Not found" });

  const body = z.object({ emails: z.array(z.string().email()).min(1).max(5) }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "emails must be 1–5 valid addresses" });

  try {
    const ctx = await resolvePendingContext(pendingSecretId);
    // Return 404 for both "not found" and "not yours" — never confirm the id exists.
    if (!ctx) return res.status(404).json({ error: "Not found" });
    if (!(await assertCustomerAccess(req.user!, ctx.secret.customerId))) {
      return res.status(404).json({ error: "Not found" });
    }
    if (ctx.secret.status !== "pending_delivery") {
      return res.status(409).json({ error: "This secret is no longer awaiting delivery" });
    }

    const sent = await sendBreakGlassInvites(pendingSecretId, body.data.emails, req.user!.id, ctx.mspId);
    return res.json({ ok: true, invited: body.data.emails.length, sent });
  } catch (err) {
    req.log.error({ err, pendingSecretId }, "break-glass: invite failed");
    return res.status(500).json({ error: "Failed to send invites" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /portal/break-glass/by-run/:runId — pending-action status for the Portal's
// pack-execution surface. Scoped by runId (not customerId): the caller is a view
// that's already looking at one specific run, so there's no "which run" ambiguity
// to resolve. Never returns linkToken or the encrypted secret — this is a status
// read for the initiator, not a delivery surface.
// ─────────────────────────────────────────────────────────────────────────────
router.get("/portal/break-glass/by-run/:runId", requireAuth, async (req: Request, res: Response) => {
  const runId = parseInt(req.params.runId as string, 10);
  if (isNaN(runId)) return res.status(404).json({ error: "Not found" });

  try {
    const [run] = await db.select().from(wfRunsTable).where(eq(wfRunsTable.id, runId)).limit(1);
    if (!run) return res.status(404).json({ error: "Not found" });

    // The gate node preserves payload.customerId (only the secret field itself and
    // any secretTemplate-referenced keys are stripped — see the redactedPayload
    // snapshot written by break_glass_verification_gate in workflow-executor.ts).
    const customerIdRaw = (run.payload as Record<string, unknown> | null)?.customerId;
    const customerId = customerIdRaw != null ? parseInt(String(customerIdRaw), 10) : NaN;
    // Return 404 for both "not found" and "not yours" — never confirm the run exists.
    if (isNaN(customerId) || !(await assertCustomerAccess(req.user!, customerId))) {
      return res.status(404).json({ error: "Not found" });
    }

    const [secret] = await db
      .select()
      .from(breakGlassPendingSecretsTable)
      .where(eq(breakGlassPendingSecretsTable.runId, runId))
      .orderBy(desc(breakGlassPendingSecretsTable.createdAt))
      .limit(1);

    // Only "pending" when the run is actually paused at a (non-terminal) break-glass
    // gate right now — a break_glass_pending_secrets row with status "pending_delivery"
    // is sufficient evidence of that; no need to inspect the workflow definition's
    // node types directly.
    if (run.status !== "awaiting_approval" || !secret || secret.status !== "pending_delivery") {
      return res.json({ pending: false });
    }

    const attempts = await db
      .select({
        id: breakGlassVerificationAttemptsTable.id,
        invitedEmail: breakGlassVerificationAttemptsTable.invitedEmail,
        linkStatus: breakGlassVerificationAttemptsTable.linkStatus,
        verificationOutcome: breakGlassVerificationAttemptsTable.verificationOutcome,
        attemptedAt: breakGlassVerificationAttemptsTable.attemptedAt,
      })
      .from(breakGlassVerificationAttemptsTable)
      .where(eq(breakGlassVerificationAttemptsTable.pendingSecretId, secret.id))
      .orderBy(desc(breakGlassVerificationAttemptsTable.createdAt));

    return res.json({
      pending: true,
      pendingSecretId: secret.id,
      status: secret.status,
      attempts,
    });
  } catch (err) {
    req.log.error({ err, runId }, "break-glass: by-run status lookup failed");
    return res.status(500).json({ error: "Failed to load status" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /public/break-glass/verify/:token  — redirect into tenant-scoped OAuth
// ─────────────────────────────────────────────────────────────────────────────
router.get("/public/break-glass/verify/:token", publicLimiter, async (req: Request, res: Response) => {
  const token = req.params.token as string;
  // Declared outside try so the catch-all error page can still use it if it was
  // resolved before the exception was thrown; null renders an unbranded page
  // (the credibility footer still renders unconditionally either way).
  let branding: PageBranding | null = null;
  try {
    const [attempt] = await db
      .select()
      .from(breakGlassVerificationAttemptsTable)
      .where(eq(breakGlassVerificationAttemptsTable.linkToken, token))
      .limit(1);

    // Resolve ctx (and its branding) as soon as we know the pendingSecretId, so
    // every page below — including the invalid/expired ones — can be branded.
    // A single fetch, reused for the rest of this handler (was fetched twice before).
    const ctx = attempt ? await resolvePendingContext(attempt.pendingSecretId) : null;
    branding = ctx?.branding ?? null;

    if (!attempt || attempt.linkStatus !== "pending") {
      return res.status(410).send(renderPage("Link unavailable",
        `<h1>This verification link is no longer valid</h1><p>It may have already been used, superseded, or expired. Please ask your provider to send a new link.</p>`, branding));
    }
    if (attempt.createdAt.getTime() + BREAK_GLASS_LINK_TTL_MS < Date.now()) {
      await db.update(breakGlassVerificationAttemptsTable)
        .set({ linkStatus: "expired", verificationOutcome: "expired" })
        .where(eq(breakGlassVerificationAttemptsTable.id, attempt.id));
      return res.status(410).send(renderPage("Link expired",
        `<h1>This verification link has expired</h1><p>Please ask your provider to send a new link.</p>`, branding));
    }

    if (!ctx || !ctx.tenantId) {
      return res.status(409).send(renderPage("Not available",
        `<h1>Verification is not available</h1><p>This customer's tenant is not configured for verification. Please contact your provider.</p>`, branding));
    }

    const clientId = process.env.MT_APP_CLIENT_ID;
    if (!clientId) return res.status(500).send(renderPage("Not configured", `<h1>Verification is temporarily unavailable</h1>`, branding));

    const authorize = new URL(`https://login.microsoftonline.com/${encodeURIComponent(ctx.tenantId)}/oauth2/v2.0/authorize`);
    authorize.searchParams.set("client_id", clientId);
    authorize.searchParams.set("response_type", "code");
    authorize.searchParams.set("redirect_uri", callbackRedirectUri());
    authorize.searchParams.set("response_mode", "query");
    authorize.searchParams.set("scope", "https://graph.microsoft.com/User.Read");
    authorize.searchParams.set("state", signState(token));
    return res.redirect(authorize.toString());
  } catch (err) {
    logger.error({ err }, "break-glass: verify redirect failed");
    return res.status(500).send(renderPage("Error", `<h1>Something went wrong</h1><p>Please try again later.</p>`, branding));
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /public/break-glass/verify/callback  — exchange code once, check role
// ─────────────────────────────────────────────────────────────────────────────
router.get("/public/break-glass/verify/callback", publicLimiter, async (req: Request, res: Response) => {
  // See the comment on the same pattern in /verify/:token — resolved as soon as
  // possible below and reused for every renderPage call in this handler.
  let branding: PageBranding | null = null;
  try {
    const state = String(req.query.state ?? "");
    const code = String(req.query.code ?? "");
    const token = verifyState(state);
    if (!token || !code) {
      return res.status(400).send(renderPage("Invalid request", `<h1>Invalid or expired request</h1>`, branding));
    }

    const [attempt] = await db
      .select()
      .from(breakGlassVerificationAttemptsTable)
      .where(eq(breakGlassVerificationAttemptsTable.linkToken, token))
      .limit(1);

    const ctx = attempt ? await resolvePendingContext(attempt.pendingSecretId) : null;
    branding = ctx?.branding ?? null;

    if (!attempt || attempt.linkStatus !== "pending") {
      return res.status(410).send(renderPage("Link unavailable", `<h1>This verification link is no longer valid</h1>`, branding));
    }

    if (!ctx || !ctx.tenantId) {
      return res.status(409).send(renderPage("Not available", `<h1>Verification is not available</h1>`, branding));
    }

    // Exchange the auth code ONCE. Persist no token / refresh token.
    const accessToken = await exchangeCodeForToken(ctx.tenantId, code);
    if (!accessToken) {
      return res.status(400).send(renderPage("Sign-in failed", `<h1>We could not verify your sign-in</h1><p>Please reopen your link and try again.</p>`, branding));
    }

    const me = await graphGetDelegated<{ id: string; userPrincipalName: string }>(accessToken, "/me?$select=id,userPrincipalName");
    const memberships = await graphGetDelegated<{ value: Array<{ "@odata.type"?: string; roleTemplateId?: string }> }>(
      accessToken, "/me/transitiveMemberOf?$select=roleTemplateId",
    );
    const upn = me?.userPrincipalName ?? null;

    const hasActiveEligibleRole = (memberships?.value ?? []).some(
      (m) => (m["@odata.type"] ?? "").toLowerCase().includes("directoryrole")
        && m.roleTemplateId != null
        && ELIGIBLE_ROLE_TEMPLATE_IDS.includes(m.roleTemplateId),
    );

    if (hasActiveEligibleRole) {
      // WINNER — atomically CLAIM this attempt (only if still pending) and
      // supersede every other pending attempt for the same secret, in one tx.
      // The conditional claim (WHERE linkStatus='pending') means two simultaneous
      // callbacks cannot both win: the second sees 0 rows updated and bows out.
      const claimed = await db.transaction(async (tx) => {
        const won = await tx.update(breakGlassVerificationAttemptsTable)
          .set({ linkStatus: "consumed", verificationOutcome: "success", entraUserPrincipalName: upn, attemptedAt: new Date() })
          .where(and(
            eq(breakGlassVerificationAttemptsTable.id, attempt.id),
            eq(breakGlassVerificationAttemptsTable.linkStatus, "pending"),
          ))
          .returning({ id: breakGlassVerificationAttemptsTable.id });
        if (won.length === 0) return false;
        await tx.update(breakGlassVerificationAttemptsTable)
          .set({ linkStatus: "superseded", verificationOutcome: "superseded" })
          .where(and(
            eq(breakGlassVerificationAttemptsTable.pendingSecretId, attempt.pendingSecretId),
            eq(breakGlassVerificationAttemptsTable.linkStatus, "pending"),
            ne(breakGlassVerificationAttemptsTable.id, attempt.id),
          ));
        return true;
      });

      if (!claimed) {
        return res.status(409).send(renderPage("Already verified",
          `<h1>This credential has already been verified</h1><p>Another authorized administrator completed verification first.</p>`, branding));
      }

      // Re-read the pending secret; only reveal while still awaiting delivery.
      const [secret] = await db.select().from(breakGlassPendingSecretsTable)
        .where(eq(breakGlassPendingSecretsTable.id, attempt.pendingSecretId)).limit(1);
      if (!secret || secret.status !== "pending_delivery") {
        return res.status(409).send(renderPage("Already delivered", `<h1>This credential has already been delivered</h1>`, branding));
      }

      const plaintext = decryptSecret(secret.encryptedValue);
      // Reveal-once page (server-rendered so the plaintext never enters client
      // routing/history). Requires an explicit acknowledgment click to proceed.
      const ackBody =
        `<h1>Break-glass credential</h1>` +
        `<p>Signed in as <code>${escapeHtml(upn ?? "unknown")}</code>. This is shown once.</p>` +
        `<div class="secret">${escapeHtml(plaintext)}</div>` +
        `<p>Store this in your organization's password vault and/or a physical, offline location. Do not save it to OneDrive, SharePoint, Teams, or email — these are automatically indexed by Copilot and are not appropriate for emergency-access credentials.</p>` +
        `<p>Acknowledging permanently purges the stored copy.</p>` +
        `<form method="POST" action="${siteUrl()}/api/public/break-glass/${secret.id}/acknowledge">` +
        `<input type="hidden" name="linkToken" value="${escapeHtml(token)}">` +
        `<button type="submit">I have saved it — acknowledge & finish</button></form>`;
      return res.status(200).send(renderPage("Break-glass credential", ackBody, branding));
    }

    // Not active — is the user PIM-eligible for an eligible role? Best-effort:
    // this needs RoleManagement.Read.Directory and may not be granted; on any
    // failure we fall through to role_absent rather than mis-reporting.
    let pimEligible = false;
    if (me?.id) {
      const elig = await graphGetDelegated<{ value: Array<{ roleDefinitionId?: string }> }>(
        accessToken, `/roleManagement/directory/roleEligibilityScheduleInstances?$filter=principalId eq '${me.id}'`,
      );
      pimEligible = (elig?.value ?? []).some((e) => e.roleDefinitionId != null && ELIGIBLE_ROLE_TEMPLATE_IDS.includes(e.roleDefinitionId));
    }

    if (pimEligible) {
      // Do NOT consume/expire — the user can activate their role and reuse the link.
      await db.update(breakGlassVerificationAttemptsTable)
        .set({ verificationOutcome: "role_not_active_pim_eligible", entraUserPrincipalName: upn, attemptedAt: new Date() })
        .where(eq(breakGlassVerificationAttemptsTable.id, attempt.id));
      return res.status(200).send(renderPage("Activate your role",
        `<h1>Your eligible role isn't active yet</h1><p>You are eligible for an administrator role but it is not currently active. Activate it in Microsoft Entra (PIM), then reopen this same link to finish.</p>`, branding));
    }

    // Neither active nor eligible — record a failed attempt; burn the link only
    // after the configured max is reached.
    const nextCount = (attempt.failedAttemptCount ?? 0) + 1;
    const burned = nextCount >= BREAK_GLASS_MAX_ATTEMPTS;
    await db.update(breakGlassVerificationAttemptsTable)
      .set({
        verificationOutcome: "role_absent",
        entraUserPrincipalName: upn,
        attemptedAt: new Date(),
        failedAttemptCount: nextCount,
        ...(burned ? { linkStatus: "expired" as const } : {}),
      })
      .where(eq(breakGlassVerificationAttemptsTable.id, attempt.id));

    return res.status(403).send(renderPage("Not authorized",
      `<h1>You don't hold an eligible administrator role</h1>` +
      (burned
        ? `<p>This link has now been disabled after too many attempts. Please ask your provider to send a new one.</p>`
        : `<p>Sign in with an account that holds an active Global Administrator role, then reopen this link.</p>`), branding));
  } catch (err) {
    logger.error({ err }, "break-glass: callback failed");
    return res.status(500).send(renderPage("Error", `<h1>Something went wrong</h1><p>Please try again later.</p>`, branding));
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /public/break-glass/:pendingSecretId/acknowledge  — purge + resume run
// ─────────────────────────────────────────────────────────────────────────────
router.post("/public/break-glass/:pendingSecretId/acknowledge", publicLimiter, async (req: Request, res: Response) => {
  const pendingSecretId = parseInt(req.params.pendingSecretId as string, 10);
  const linkToken = String((req.body as Record<string, unknown>)?.linkToken ?? "");

  // pendingSecretId is enough to resolve branding on its own (no linkToken needed
  // for this lookup) — resolve it before the validity check so even the
  // "Invalid request" page (missing linkToken) can be branded when possible.
  const ctxForBranding = !isNaN(pendingSecretId) ? await resolvePendingContext(pendingSecretId) : null;
  const branding = ctxForBranding?.branding ?? null;

  if (isNaN(pendingSecretId) || !linkToken) {
    return res.status(400).send(renderPage("Invalid request", `<h1>Invalid request</h1>`, branding));
  }

  try {
    // The winning attempt is the ack credential — only the winner's browser holds
    // this consumed+success linkToken for this pending secret.
    const [attempt] = await db.select().from(breakGlassVerificationAttemptsTable)
      .where(and(
        eq(breakGlassVerificationAttemptsTable.linkToken, linkToken),
        eq(breakGlassVerificationAttemptsTable.pendingSecretId, pendingSecretId),
        eq(breakGlassVerificationAttemptsTable.linkStatus, "consumed"),
        eq(breakGlassVerificationAttemptsTable.verificationOutcome, "success"),
      ))
      .limit(1);
    if (!attempt) return res.status(410).send(renderPage("Unavailable", `<h1>This action is no longer available</h1>`, branding));

    const [secret] = await db.select().from(breakGlassPendingSecretsTable)
      .where(eq(breakGlassPendingSecretsTable.id, pendingSecretId)).limit(1);
    if (!secret || secret.status !== "pending_delivery") {
      return res.status(409).send(renderPage("Already delivered", `<h1>This credential has already been delivered</h1>`, branding));
    }

    // Purge: actually remove the ciphertext (column is NOT NULL → empty string),
    // mark delivered, and record who received it.
    await db.update(breakGlassPendingSecretsTable)
      .set({ status: "delivered_purged", encryptedValue: "", deliveredAt: new Date(), deliveredToEmail: attempt.invitedEmail })
      .where(eq(breakGlassPendingSecretsTable.id, pendingSecretId));

    // Resume the paused run via the SAME path pending-approvals/:id/decide uses.
    if (secret.gateNodeId) {
      const [run] = await db.select().from(wfRunsTable).where(eq(wfRunsTable.id, secret.runId)).limit(1);
      const resumePayload = (run?.payload as Record<string, unknown>) ?? {};
      const gateNodeId = secret.gateNodeId;
      setImmediate(() => {
        void (async () => {
          try {
            const { resumeWorkflowRun } = await import("../lib/workflow-executor");
            await resumeWorkflowRun(secret.runId, gateNodeId, resumePayload, "Break-glass credential delivered and acknowledged");
          } catch (err) {
            logger.warn({ err, runId: secret.runId }, "break-glass: resume failed (non-fatal)");
          }
        })();
      });
    } else {
      logger.warn({ pendingSecretId, runId: secret.runId }, "break-glass: pending secret has no gateNodeId — cannot resume run");
    }

    // Log ONLY non-sensitive delivery metadata — never the value.
    logger.info({ revealed: true, deliveredToEmail: attempt.invitedEmail, timestamp: new Date().toISOString() }, "break-glass: secret delivered");

    return res.status(200).send(renderPage("Done", `<h1>Delivery complete</h1><p>The credential has been delivered and the stored copy purged. The paused automation has resumed and is continuing on its own — you can close this window.</p>`, branding));
  } catch (err) {
    logger.error({ err, pendingSecretId }, "break-glass: acknowledge failed");
    return res.status(500).send(renderPage("Error", `<h1>Something went wrong</h1>`, branding));
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /portal/break-glass/:pendingSecretId/admin-override  — force reset + reissue
// ─────────────────────────────────────────────────────────────────────────────
router.post("/portal/break-glass/:pendingSecretId/admin-override", requireAuth, async (req: Request, res: Response) => {
  const pendingSecretId = parseInt(req.params.pendingSecretId as string, 10);
  if (isNaN(pendingSecretId)) return res.status(404).json({ error: "Not found" });

  const body = z.object({
    reason: z.string().trim().min(1),
    emails: z.array(z.string().email()).min(1).max(5).optional(),
  }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "reason is required; emails (if given) must be 1–5 valid addresses" });

  try {
    const ctx = await resolvePendingContext(pendingSecretId);
    if (!ctx) return res.status(404).json({ error: "Not found" });

    // More powerful than invite → PlatformAdmin / MSPAdmin / MSPOperator only.
    const role = effectiveRoleOf(req.user!);
    const roleAllowed = role === "PlatformAdmin" || role === "MSPAdmin" || role === "MSPOperator";
    if (!roleAllowed || !(await assertCustomerAccess(req.user!, ctx.secret.customerId))) {
      return res.status(404).json({ error: "Not found" });
    }

    if (ctx.secret.status !== "pending_delivery") {
      return res.status(409).json({ error: "This secret is not awaiting delivery" });
    }
    if (!ctx.tenantId) {
      return res.status(409).json({ error: "Customer tenant is not configured" });
    }

    // Every attempt for this pending secret must be terminal (expired/superseded).
    const attempts = await db.select({ linkStatus: breakGlassVerificationAttemptsTable.linkStatus, invitedEmail: breakGlassVerificationAttemptsTable.invitedEmail })
      .from(breakGlassVerificationAttemptsTable)
      .where(eq(breakGlassVerificationAttemptsTable.pendingSecretId, pendingSecretId));
    const anyLive = attempts.some((a) => a.linkStatus !== "expired" && a.linkStatus !== "superseded");
    if (anyLive) {
      return res.status(409).json({ error: "There are still live verification links for this secret" });
    }

    // The break-glass account identity travels on the (non-secret) run payload
    // under the canonical `breakGlassAccountId` key, which the gate node stamps
    // from its configurable accountIdField at pause time.
    const [run] = await db.select().from(wfRunsTable).where(eq(wfRunsTable.id, ctx.secret.runId)).limit(1);
    const runPayload = (run?.payload as Record<string, unknown>) ?? {};
    const accountId = runPayload.breakGlassAccountId as string | undefined;
    if (!accountId) {
      return res.status(409).json({ error: "Run payload does not carry the break-glass account identity (breakGlassAccountId)" });
    }

    // 1. Reset the credential on the tenant (same write helper as creation).
    const newPassword = generateStrongPassword();
    const write = await graphWriteForTenant(
      ctx.tenantId,
      `/users/${encodeURIComponent(accountId)}`,
      "PATCH",
      { passwordProfile: { password: newPassword, forceChangePasswordNextSignIn: false } },
    );
    if (!write.success) {
      req.log.error({ pendingSecretId, status: write.status, errorType: write.errorType }, "break-glass: admin-override tenant reset failed");
      return res.status(502).json({ error: "Failed to reset the tenant credential", detail: write.errorType });
    }

    // 2–4. Supersede old, insert new pending secret, write audit — in one tx.
    const oldPendingSecretId = pendingSecretId;
    let newPendingSecretId = 0;
    await db.transaction(async (tx) => {
      await tx.update(breakGlassPendingSecretsTable)
        .set({ status: "superseded_by_reset" })
        .where(eq(breakGlassPendingSecretsTable.id, oldPendingSecretId));

      const [created] = await tx.insert(breakGlassPendingSecretsTable).values({
        runId: ctx.secret.runId,
        customerId: ctx.secret.customerId,
        encryptedValue: encryptSecret(newPassword),
        gateNodeId: ctx.secret.gateNodeId,
        status: "pending_delivery",
      }).returning({ id: breakGlassPendingSecretsTable.id });
      newPendingSecretId = created.id;

      await tx.insert(breakGlassOverrideAuditTable).values({
        customerId: ctx.secret.customerId,
        adminUserId: req.user!.id,
        reason: body.data.reason,
        oldPendingSecretId,
        newPendingSecretId,
      });
    });

    // 5. Repeated-override alert (only ever fires from here).
    await maybeFireOverrideAlert(ctx.secret.customerId, ctx.domain);

    // 6. Re-issue links — admin-supplied recipients when given, else the prior set.
    const priorEmails = Array.from(new Set(attempts.map((a) => a.invitedEmail)));
    const emails = body.data.emails && body.data.emails.length > 0 ? body.data.emails : priorEmails;
    const sent = emails.length > 0 ? await sendBreakGlassInvites(newPendingSecretId, emails, req.user!.id, ctx.mspId) : 0;

    // 7. Do NOT resume — the run stays paused until the new secret is acknowledged.
    return res.json({ ok: true, newPendingSecretId, reissued: emails.length, sent });
  } catch (err) {
    req.log.error({ err, pendingSecretId }, "break-glass: admin-override failed");
    return res.status(500).json({ error: "Failed to process override" });
  }
});

export default router;
