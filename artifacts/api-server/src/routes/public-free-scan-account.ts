/**
 * public-free-scan-account.ts — Git #4329 (Feature #1352, Free Scan).
 *
 * The design's `acctScreen` block (Design/marketing/marketing_handoff/Marketing
 * Checkout.dc.html) for a paid Free Scan Prospect, and the sign-in behind it.
 *
 * Account creation — the flow credential (live `sessionId` or emailed
 * `returnToken`, via `resolveActor`), and only for a PAID engagement:
 *
 *   POST /api/public/free-scan/account/status           where the three substeps stand
 *   POST /api/public/free-scan/account/send-code        step 1: email a six-digit code
 *   POST /api/public/free-scan/account/verify-code      step 1: judge it
 *   POST /api/public/free-scan/account/set-password     step 2
 *   POST /api/public/free-scan/account/mfa/totp/setup   step 3: authenticator app key
 *   POST /api/public/free-scan/account/mfa/totp/verify  step 3: confirm → signed in
 *   POST /api/public/free-scan/account/mfa/sms/setup    step 3: text a code to a phone
 *   POST /api/public/free-scan/account/mfa/sms/verify   step 3: confirm → signed in
 *
 * Sign-in and the signed-in engagement (session cookie):
 *
 *   POST /api/public/free-scan/account/login            email + password → challenge
 *   POST /api/public/free-scan/account/login/verify     challenge + code → signed in
 *   GET  /api/public/free-scan/account/me               the engagement this account opens
 *   POST /api/public/free-scan/account/results          that engagement's scan results
 *   POST /api/public/free-scan/account/logout
 *
 * ── Scope, per Shane's correction on #4329 ────────────────────────────────────
 * This is NOT a Portal login. It never writes `users.password_hash`,
 * `mfa_enrollments` or `client_services`, so `/auth/login` has nothing to accept
 * and `hasRealEntitlement()` (routes/auth.ts, #656) stays closed. What the
 * session opens is one `free_scan_engagements` row — its results (the same
 * locked projection the other doors serve) and its SOW — plus the Remediate
 * step behind that engagement, through `resolveActor`'s `accountSession` door.
 * See lib/free-scan-account.ts for the credential and token model.
 */

import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { db, tenantsTable, type FreeScanEngagement } from "@workspace/db";
import { eq } from "drizzle-orm";
import { credentialSchema, resolveActor } from "./public-free-scan-sow.ts";
import { loadOrCreateEngagement, selectionFromRow } from "../lib/free-scan-engagement.ts";
import {
  accountStage,
  beginSmsEnrollment,
  beginTotpEnrollment,
  checkEmailCode,
  clearAccountSessionCookie,
  completeSmsEnrollment,
  completeTotpEnrollment,
  EMAIL_CODE_TTL_MS,
  FreeScanAccountError,
  issueEmailCode,
  loadAccountForEngagement,
  normalisePhone,
  passwordSignIn,
  resolveAccountSession,
  revokeAccountSessions,
  secondFactorSignIn,
  setAccountPassword,
  setAccountSessionCookie,
} from "../lib/free-scan-account.ts";
import { maskEmail } from "../lib/purchase-account-flow.ts";
import { buildFreeScanLockedResults } from "../lib/free-scan-locked-results.ts";
import { getEmailTemplateOrFallback, sendEmailOrThrow } from "../lib/mailer.ts";
import { createAuditLog } from "../lib/audit.ts";
import { logger } from "../lib/logger.ts";

const log = logger.child({ channel: "auth" });

const router: IRouter = Router();

const isDev = process.env.NODE_ENV !== "production";
// Same stricter-than-isDev gate #1380 uses: the real code is only ever surfaced
// on a developer's own machine, never in staging or production.
const isLocalDevCodeExposure = process.env.NODE_ENV === "development";

const sendCodeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: isDev ? 100 : 6,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many codes requested. Please wait a few minutes and try again." },
});

const stepLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: isDev ? 500 : 40,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many attempts. Please wait a few minutes and try again." },
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: isDev ? 200 : 15,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many sign-in attempts. Please wait a few minutes and try again." },
});

const readLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: isDev ? 1000 : 240,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many requests. Please wait a few minutes and try again." },
});

function noStore(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
}

const AUDIT_ACTOR = { actorUserId: null, actorName: "public:free-scan-account", actorRole: "client" } as const;

// ── Shared resolution for the creation steps ──────────────────────────────────

interface CreationContext {
  engagement: FreeScanEngagement;
  billingEmail: string | null;
}

/** Resolve the Prospect by their flow credential and require a paid engagement. */
async function resolvePaidEngagement(req: Request, res: Response, body: unknown): Promise<CreationContext | null> {
  const parsed = credentialSchema.safeParse(body);
  if (!parsed.success) {
    res.status(400).json({ error: "credential_required" });
    return null;
  }
  const actor = await resolveActor(parsed.data, res, req);
  if (!actor) return null;
  const engagement = await loadOrCreateEngagement(actor);
  if (engagement.status !== "paid") {
    res.status(409).json({ error: "payment_required" });
    return null;
  }
  return { engagement, billingEmail: actor.email?.trim().toLowerCase() || null };
}

const codeField = z.string().trim().regex(/^\d{6}$/);

// ── POST /account/status ──────────────────────────────────────────────────────

router.post("/public/free-scan/account/status", readLimiter, noStore, async (req: Request, res: Response) => {
  const parsed = credentialSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "credential_required" });
    return;
  }
  const actor = await resolveActor(parsed.data, res, req);
  if (!actor) return;

  try {
    const engagement = await loadOrCreateEngagement(actor);
    if (engagement.status !== "paid") {
      res.json({ stage: "not_paid", email: null, codePending: false, mfaMethod: null, phoneLast4: null, signedIn: false });
      return;
    }
    const account = await loadAccountForEngagement(engagement.id);
    const session = await resolveAccountSession(req);
    const email = account?.email ?? actor.email;
    res.json({
      stage: accountStage(account),
      // Masked: the flow credential is a bearer link, and this reply is enough
      // for the Prospect to recognise their address without handing it out.
      email: email ? maskEmail(email) : null,
      // An unexpired code is already in the inbox, so the screen does not send
      // another one on every refresh.
      codePending: !!account?.emailCodeHash && !!account.emailCodeExpiresAt && account.emailCodeExpiresAt.getTime() > Date.now(),
      mfaMethod: account?.mfaMethod ?? null,
      phoneLast4: account?.phone ? account.phone.slice(-4) : null,
      signedIn: !!session && session.engagement.id === engagement.id,
    });
  } catch (err) {
    log.error({ err, customerId: actor.customerId }, "free-scan account: status failed");
    res.status(500).json({ error: "account_status_failed" });
  }
});

// ── Step 1: emailed code ──────────────────────────────────────────────────────
// Exchange Online / Microsoft Graph via mailer.ts — the only mail transport. A
// send failure is a visible error: the Prospect is waiting on this mail.

router.post("/public/free-scan/account/send-code", sendCodeLimiter, noStore, async (req: Request, res: Response) => {
  const ctx = await resolvePaidEngagement(req, res, req.body);
  if (!ctx) return;
  if (!ctx.billingEmail) {
    log.error({ engagementId: ctx.engagement.id }, "free-scan account: paid engagement has no billing email — cannot issue a code");
    res.status(409).json({ error: "email_missing" });
    return;
  }

  let code: string;
  let expiresAt: Date;
  try {
    ({ code, expiresAt } = await issueEmailCode(ctx.engagement, ctx.billingEmail));
  } catch (err) {
    if (err instanceof FreeScanAccountError) {
      res.status(409).json({ error: err.code });
      return;
    }
    log.error({ err, engagementId: ctx.engagement.id }, "free-scan account: could not store the code");
    res.status(500).json({ error: "code_issue_failed" });
    return;
  }

  const minutes = Math.round(EMAIL_CODE_TTL_MS / 60000);
  const defaultBody = `
    <p>Hi there,</p>
    <p>Here is the code to confirm your email address and set up the account for your engagement with Shane McCaw Consulting (${ctx.engagement.sowReference}):</p>
    <p style="margin:24px 0;text-align:center;">
      <span style="display:inline-block;font-family:Menlo,Consolas,monospace;font-size:32px;font-weight:700;letter-spacing:10px;color:#0A2540;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:8px;padding:16px 24px;">${code}</span>
    </p>
    <p>Enter it on the page you already have open. The code expires in <strong>${minutes} minutes</strong>.</p>
    <p style="margin-top:24px;color:#64748b;font-size:13px;">If you didn't just sign and pay for a statement of work with Shane McCaw Consulting, you can ignore this email — no account has been created.</p>
    <p style="margin-top:24px;">— Shane McCaw Consulting</p>
  `;

  try {
    const { subject, bodyHtml } = await getEmailTemplateOrFallback(
      "free-scan-account-verification-code",
      { code, sowReference: ctx.engagement.sowReference, minutes: String(minutes) },
      "Your verification code",
      defaultBody,
    );
    await sendEmailOrThrow(ctx.billingEmail, subject, bodyHtml, { templateName: "free-scan-account-verification-code" });
  } catch (err) {
    log.error({ err, engagementId: ctx.engagement.id }, "free-scan account: code email could not be delivered");
    res.status(502).json({ error: "email_send_failed" });
    return;
  }

  await createAuditLog({
    ...AUDIT_ACTOR,
    actionType: "free_scan_account_code_sent",
    entityType: "free_scan_engagement",
    entityId: String(ctx.engagement.id),
    tenantId: ctx.engagement.customerId,
    // The code is never logged or audited — only that one was issued.
    metadata: { sowReference: ctx.engagement.sowReference, expiresAt },
  });

  const body: Record<string, unknown> = { ok: true, email: maskEmail(ctx.billingEmail), expiresAt: expiresAt.toISOString() };
  if (isLocalDevCodeExposure) {
    log.warn(
      { engagementId: ctx.engagement.id, devVerificationCode: code },
      "[DEV] free-scan account code exposed — NODE_ENV=development only, never active in staging/production",
    );
    body["devVerificationCode"] = code;
  }
  res.json(body);
});

router.post("/public/free-scan/account/verify-code", stepLimiter, noStore, async (req: Request, res: Response) => {
  const code = codeField.safeParse((req.body as { code?: unknown } | undefined)?.code);
  if (!code.success) {
    res.status(400).json({ error: "code_invalid" });
    return;
  }
  const ctx = await resolvePaidEngagement(req, res, req.body);
  if (!ctx) return;

  const account = await loadAccountForEngagement(ctx.engagement.id);
  if (!account) {
    res.status(409).json({ error: "code_not_issued" });
    return;
  }
  if (accountStage(account) === "complete") {
    res.status(409).json({ error: "account_exists" });
    return;
  }
  // A code proves the address it was sent to — which must still be the billing address.
  if (!ctx.billingEmail || account.email !== ctx.billingEmail) {
    res.status(409).json({ error: "email_mismatch" });
    return;
  }

  const result = await checkEmailCode(account, code.data);
  if (result === "ok") {
    res.json({ ok: true, stage: "password" });
    return;
  }
  const status = result === "invalid" ? 400 : result === "expired" ? 410 : result === "too_many_attempts" ? 429 : 409;
  res.status(status).json({ error: result === "invalid" ? "code_invalid" : result === "expired" ? "code_expired" : result === "no_code" ? "code_not_issued" : result });
});

// ── Step 2: password ──────────────────────────────────────────────────────────

router.post("/public/free-scan/account/set-password", stepLimiter, noStore, async (req: Request, res: Response) => {
  const password = z.string().min(1).max(200).safeParse((req.body as { password?: unknown } | undefined)?.password);
  if (!password.success) {
    res.status(400).json({ error: "weak_password" });
    return;
  }
  const ctx = await resolvePaidEngagement(req, res, req.body);
  if (!ctx) return;

  const account = await loadAccountForEngagement(ctx.engagement.id);
  if (!account) {
    res.status(409).json({ error: "email_unverified" });
    return;
  }
  const result = await setAccountPassword(account, ctx.billingEmail ?? "", password.data);
  if (result === "ok") {
    res.json({ ok: true, stage: "mfa" });
    return;
  }
  res.status(result === "weak_password" ? 400 : 409).json({ error: result });
});

// ── Step 3: second factor ─────────────────────────────────────────────────────

async function mfaStageAccount(req: Request, res: Response) {
  const ctx = await resolvePaidEngagement(req, res, req.body);
  if (!ctx) return null;
  const account = await loadAccountForEngagement(ctx.engagement.id);
  const stage = accountStage(account);
  if (!account || stage !== "mfa") {
    res.status(409).json({ error: stage === "complete" ? "account_exists" : "password_required" });
    return null;
  }
  return { ctx, account };
}

async function finishSignedIn(req: Request, res: Response, engagement: FreeScanEngagement, account: Parameters<typeof setAccountSessionCookie>[1], method: string) {
  setAccountSessionCookie(res, account);
  await createAuditLog({
    ...AUDIT_ACTOR,
    actionType: "free_scan_account_created",
    entityType: "free_scan_engagement",
    entityId: String(engagement.id),
    tenantId: engagement.customerId,
    metadata: { sowReference: engagement.sowReference, mfaMethod: method, ip: req.ip ?? null },
  });
  log.info({ engagementId: engagement.id, accountId: account.id, mfaMethod: method }, "free-scan account: created and signed in");
  res.json({ ok: true, stage: "complete" });
}

router.post("/public/free-scan/account/mfa/totp/setup", stepLimiter, noStore, async (req: Request, res: Response) => {
  const found = await mfaStageAccount(req, res);
  if (!found) return;
  try {
    res.json(await beginTotpEnrollment(found.account));
  } catch (err) {
    log.error({ err, accountId: found.account.id }, "free-scan account: TOTP setup failed");
    res.status(500).json({ error: "mfa_setup_failed" });
  }
});

router.post("/public/free-scan/account/mfa/totp/verify", stepLimiter, noStore, async (req: Request, res: Response) => {
  const code = codeField.safeParse((req.body as { code?: unknown } | undefined)?.code);
  if (!code.success) {
    res.status(400).json({ error: "code_invalid" });
    return;
  }
  const found = await mfaStageAccount(req, res);
  if (!found) return;
  const enrolled = await completeTotpEnrollment(found.account, code.data);
  if (!enrolled) {
    res.status(400).json({ error: "code_invalid" });
    return;
  }
  await finishSignedIn(req, res, found.ctx.engagement, enrolled, "totp");
});

router.post("/public/free-scan/account/mfa/sms/setup", sendCodeLimiter, noStore, async (req: Request, res: Response) => {
  const rawPhone = z.string().max(40).safeParse((req.body as { phone?: unknown } | undefined)?.phone);
  const phone = rawPhone.success ? normalisePhone(rawPhone.data) : null;
  if (!phone) {
    res.status(400).json({ error: "phone_invalid" });
    return;
  }
  const found = await mfaStageAccount(req, res);
  if (!found) return;
  try {
    await beginSmsEnrollment(found.account, phone);
    res.json({ ok: true, phoneLast4: phone.slice(-4) });
  } catch (err) {
    log.error({ err, accountId: found.account.id }, "free-scan account: SMS enrollment code could not be sent");
    res.status(502).json({ error: "sms_send_failed" });
  }
});

router.post("/public/free-scan/account/mfa/sms/verify", stepLimiter, noStore, async (req: Request, res: Response) => {
  const code = codeField.safeParse((req.body as { code?: unknown } | undefined)?.code);
  if (!code.success) {
    res.status(400).json({ error: "code_invalid" });
    return;
  }
  const found = await mfaStageAccount(req, res);
  if (!found) return;
  const { result, account } = await completeSmsEnrollment(found.account, code.data);
  if (!account) {
    const status = result === "expired" ? 410 : result === "too_many_attempts" ? 429 : result === "no_code" ? 409 : 400;
    res.status(status).json({ error: result === "invalid" ? "code_invalid" : result === "expired" ? "code_expired" : result === "no_code" ? "code_not_issued" : result });
    return;
  }
  await finishSignedIn(req, res, found.ctx.engagement, account, "sms");
});

// ── Sign-in ───────────────────────────────────────────────────────────────────

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  password: z.string().min(1).max(200),
});

router.post("/public/free-scan/account/login", loginLimiter, noStore, async (req: Request, res: Response) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(401).json({ error: "invalid_credentials" });
    return;
  }
  try {
    const result = await passwordSignIn(parsed.data.email, parsed.data.password);
    if (!result.ok) {
      await createAuditLog({
        ...AUDIT_ACTOR,
        actionType: "free_scan_account_sign_in_failed",
        entityType: "free_scan_account",
        metadata: { reason: result.reason, ip: req.ip ?? null },
      });
      res.status(result.reason === "locked" ? 423 : 401).json({ error: result.reason === "locked" ? "account_locked" : "invalid_credentials" });
      return;
    }
    res.json({
      challenge: result.challenge,
      method: result.account.mfaMethod,
      phoneLast4: result.account.mfaMethod === "sms" && result.account.phone ? result.account.phone.slice(-4) : null,
    });
  } catch (err) {
    log.error({ err }, "free-scan account: sign-in failed");
    res.status(502).json({ error: "sign_in_failed" });
  }
});

const loginVerifySchema = z.object({ challenge: z.string().min(1).max(2000), code: codeField });

router.post("/public/free-scan/account/login/verify", loginLimiter, noStore, async (req: Request, res: Response) => {
  const parsed = loginVerifySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "code_invalid" });
    return;
  }
  const result = await secondFactorSignIn(parsed.data.challenge, parsed.data.code);
  if (!result.ok) {
    const status = result.reason === "challenge_invalid" ? 401 : result.reason === "code_expired" ? 410 : result.reason === "too_many_attempts" ? 429 : 400;
    res.status(status).json({ error: result.reason });
    return;
  }
  setAccountSessionCookie(res, result.account);
  await createAuditLog({
    ...AUDIT_ACTOR,
    actionType: "free_scan_account_signed_in",
    entityType: "free_scan_engagement",
    entityId: String(result.engagement.id),
    tenantId: result.engagement.customerId,
    metadata: { mfaMethod: result.account.mfaMethod, ip: req.ip ?? null },
  });
  res.json({ ok: true });
});

router.post("/public/free-scan/account/logout", readLimiter, noStore, async (req: Request, res: Response) => {
  const session = await resolveAccountSession(req);
  if (session) await revokeAccountSessions(session.account.id);
  clearAccountSessionCookie(res);
  res.json({ ok: true });
});

// ── The signed-in engagement ──────────────────────────────────────────────────

router.get("/public/free-scan/account/me", readLimiter, noStore, async (req: Request, res: Response) => {
  const session = await resolveAccountSession(req);
  if (!session) {
    res.status(401).json({ error: "account_signin_required" });
    return;
  }
  const { account, engagement } = session;
  try {
    const [tenant] = await db
      .select({ customerName: tenantsTable.customerName, domain: tenantsTable.domain, consent: tenantsTable.consent })
      .from(tenantsTable)
      .where(eq(tenantsTable.id, engagement.customerId))
      .limit(1);
    res.json({
      email: account.email,
      mfaMethod: account.mfaMethod,
      tenant: { name: tenant?.customerName ?? null, domain: tenant?.domain ?? null },
      engagement: {
        sowReference: engagement.sowReference,
        status: engagement.status,
        paymentPlan: engagement.paymentPlan,
        // The same normalised selection the SOW and Remediate step count from.
        phaseCount: selectionFromRow(engagement).phaseSlugs.length,
        signerName: engagement.signerName,
        signedAt: engagement.signedAt ? engagement.signedAt.toISOString() : null,
        paidAt: engagement.paidAt ? engagement.paidAt.toISOString() : null,
        chargedCents: engagement.chargedCents ?? 0,
        agreedServicesCents: engagement.agreedServicesCents ?? 0,
        agreedRecurringMonthlyCents: engagement.agreedRecurringMonthlyCents ?? 0,
      },
      writeConsent: {
        // The real grant, straight off tenants.consent.writeBack — never the engagement's mirror.
        status: tenant?.consent?.writeBack?.status ?? null,
        decision: engagement.writeConsentDecision,
      },
    });
  } catch (err) {
    log.error({ err, engagementId: engagement.id }, "free-scan account: engagement read failed");
    res.status(500).json({ error: "account_read_failed" });
  }
});

router.post("/public/free-scan/account/results", readLimiter, noStore, async (req: Request, res: Response) => {
  const session = await resolveAccountSession(req);
  if (!session) {
    res.status(401).json({ error: "account_signin_required" });
    return;
  }
  try {
    const [tenant] = await db
      .select({ domain: tenantsTable.domain })
      .from(tenantsTable)
      .where(eq(tenantsTable.id, session.engagement.customerId))
      .limit(1);
    // The same locked projection the live flow and the return link serve.
    const results = await buildFreeScanLockedResults(session.engagement.customerId);
    res.json({ ...results, domain: tenant?.domain ?? null });
  } catch (err) {
    log.error({ err, engagementId: session.engagement.id }, "free-scan account: results read failed");
    res.status(500).json({ error: "results_failed" });
  }
});

export default router;
