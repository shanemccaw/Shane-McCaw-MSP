/**
 * public-free-scan-account-recovery.ts — Git #4483 (Feature #1352, Free Scan).
 *
 * Recovery for the scoped Free Scan engagement account (#4329). The credential
 * and security model live in lib/free-scan-account-recovery.ts; this file is the
 * HTTP surface behind the "Forgot your password?" and "Lost your authenticator?"
 * paths on /scan/account.
 *
 *   POST /api/public/free-scan/account/recover/send-code       email a recovery code (always 202)
 *   POST /api/public/free-scan/account/recover/verify-code     code -> recovery token
 *   POST /api/public/free-scan/account/recover/reset-password  token + new password (does not sign in)
 *   POST /api/public/free-scan/account/recover/mfa-reset       token + current password -> request for operator approval
 *   POST /api/public/free-scan/account/recover/mfa/totp/setup  approved: token + password -> new authenticator key
 *   POST /api/public/free-scan/account/recover/mfa/sms/setup   approved: token + password + phone -> text a code
 *   POST /api/public/free-scan/account/recover/mfa/verify      approved: token + code -> factor replaced, signed in
 *
 * The operator half (approve / deny after an identity check) is
 * routes/admin-free-scan-account-recovery.ts.
 *
 * Nothing here reads or writes `users`, and `/auth/forgot-password` is untouched.
 */

import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import type { FreeScanAccount, FreeScanEngagement } from "@workspace/db";
import {
  beginRecoverySms,
  beginRecoveryTotp,
  checkRecoveryCode,
  completeRecoveryEnrolment,
  issueRecoveryCode,
  MFA_RESET_APPROVAL_TTL_MS,
  mfaResetState,
  RECOVERY_CODE_TTL_MS,
  requestMfaReset,
  resetPasswordWithRecovery,
  resolveRecoveryToken,
  type RecoveryContext,
} from "../lib/free-scan-account-recovery.ts";
import { clearAccountSessionCookie, normalisePhone, setAccountSessionCookie } from "../lib/free-scan-account.ts";
import { getEmailTemplateOrFallback, sendEmailOrThrow } from "../lib/mailer.ts";
import { createAuditLog } from "../lib/audit.ts";
import { createNotificationForAllAdmins } from "../lib/notification-center.ts";
import { logger } from "../lib/logger.ts";

const log = logger.child({ channel: "auth" });

const router: IRouter = Router();

const isDev = process.env.NODE_ENV !== "production";
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
  limit: isDev ? 500 : 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many attempts. Please wait a few minutes and try again." },
});

function noStore(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
}

const AUDIT_ACTOR = { actorUserId: null, actorName: "public:free-scan-account-recovery", actorRole: "client" } as const;

const codeField = z.string().trim().regex(/^\d{6}$/);
const tokenField = z.string().min(1).max(2000);
const passwordField = z.string().min(1).max(200);

/** Prospect-entered text (signer name, role) lands in operator mail — escape it. */
function esc(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function accountPageLink(): string {
  const base = (process.env.SITE_URL ?? "").replace(/\/$/, "");
  return base ? `<a href="${base}/scan/account">${base}/scan/account</a>` : "your engagement page";
}

/** A notice to the account's own address. Best-effort: the action already happened. */
async function sendNotice(to: string, slug: string, subject: string, bodyHtml: string, vars: Record<string, string>): Promise<void> {
  try {
    const rendered = await getEmailTemplateOrFallback(slug, vars, subject, bodyHtml);
    await sendEmailOrThrow(to, rendered.subject, rendered.bodyHtml, { templateName: slug });
  } catch (err) {
    log.error({ err, slug }, "free-scan account recovery: notice email could not be delivered");
  }
}

async function audit(actionType: string, account: FreeScanAccount, engagement: FreeScanEngagement | null, metadata: Record<string, unknown>): Promise<void> {
  await createAuditLog({
    ...AUDIT_ACTOR,
    actionType,
    entityType: "free_scan_account",
    entityId: String(account.id),
    tenantId: engagement?.customerId ?? null,
    metadata: { engagementId: account.engagementId, ...(engagement ? { sowReference: engagement.sowReference } : {}), ...metadata },
  });
}

/** Resolve the body's recovery token, answering 401 when it is not live. */
async function recoveryFromBody(req: Request, res: Response): Promise<RecoveryContext | null> {
  const token = tokenField.safeParse((req.body as { recoveryToken?: unknown } | undefined)?.recoveryToken);
  const ctx = token.success ? await resolveRecoveryToken(token.data) : null;
  if (!ctx) {
    res.status(401).json({ error: "recovery_expired" });
    return null;
  }
  return ctx;
}

// ── POST /recover/send-code ───────────────────────────────────────────────────
// Answers 202 before looking anything up, so neither the body nor the response
// time says whether an account exists at the address (same shape as the Free
// Scan return-link request, routes/public-free-scan-return.ts).

const sendCodeSchema = z.object({ email: z.string().trim().toLowerCase().email().max(320) });

router.post("/public/free-scan/account/recover/send-code", sendCodeLimiter, noStore, (req: Request, res: Response) => {
  const parsed = sendCodeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "email_invalid" });
    return;
  }
  const email = parsed.data.email;
  res.status(202).json({ ok: true, expiresInMinutes: Math.round(RECOVERY_CODE_TTL_MS / 60000) });

  void (async () => {
    try {
      const issued = await issueRecoveryCode(email);
      if (issued.status === "no_account") return;
      if (issued.status === "throttled") {
        await audit("free_scan_account_recovery_code_throttled", issued.account, null, { ip: req.ip ?? null });
        return;
      }

      const minutes = String(Math.round(RECOVERY_CODE_TTL_MS / 60000));
      const { subject, bodyHtml } = await getEmailTemplateOrFallback(
        "free-scan-account-recovery-code",
        { code: issued.code, minutes },
        "Your account recovery code",
        `
    <p>Hi there,</p>
    <p>Someone asked to recover the account for your engagement with Shane McCaw Consulting. Here is the code:</p>
    <p style="margin:24px 0;text-align:center;">
      <span style="display:inline-block;font-family:Menlo,Consolas,monospace;font-size:32px;font-weight:700;letter-spacing:10px;color:#0A2540;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:8px;padding:16px 24px;">${issued.code}</span>
    </p>
    <p>Enter it on the page you already have open. The code expires in <strong>${minutes} minutes</strong>.</p>
    <p style="margin-top:24px;color:#64748b;font-size:13px;">If you didn't ask for this, you can ignore this email. Your password and second factor have not changed.</p>
    <p style="margin-top:24px;">— Shane McCaw Consulting</p>
  `,
      );
      await sendEmailOrThrow(issued.account.email, subject, bodyHtml, { templateName: "free-scan-account-recovery-code" });
      await audit("free_scan_account_recovery_code_sent", issued.account, null, { expiresAt: issued.expiresAt, ip: req.ip ?? null });
      if (isLocalDevCodeExposure) {
        log.warn(
          { accountId: issued.account.id, devVerificationCode: issued.code },
          "[DEV] free-scan account recovery code — NODE_ENV=development only, never active in staging/production",
        );
      }
    } catch (err) {
      log.error({ err }, "free-scan account recovery: code request failed");
    }
  })();
});

// ── POST /recover/verify-code ─────────────────────────────────────────────────

const verifyCodeSchema = z.object({ email: z.string().trim().toLowerCase().email().max(320), code: codeField });

router.post("/public/free-scan/account/recover/verify-code", stepLimiter, noStore, async (req: Request, res: Response) => {
  const parsed = verifyCodeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "code_invalid" });
    return;
  }
  try {
    const result = await checkRecoveryCode(parsed.data.email, parsed.data.code);
    if (!result.ok) {
      if (result.account && result.reason === "too_many_attempts") {
        await audit("free_scan_account_recovery_code_exhausted", result.account, null, { ip: req.ip ?? null });
      }
      // One answer for a wrong code, an expired one, a spent budget and an
      // address with no account.
      res.status(400).json({ error: "code_invalid" });
      return;
    }
    const { account, engagement, token } = result;
    await audit("free_scan_account_recovery_verified", account, engagement, { ip: req.ip ?? null });
    const state = mfaResetState(account);
    res.json({
      ok: true,
      recoveryToken: token,
      mfaMethod: account.mfaMethod,
      phoneLast4: account.mfaMethod === "sms" && account.phone ? account.phone.slice(-4) : null,
      mfaReset: {
        state,
        approvalExpiresAt: state === "approved" && account.mfaResetApprovalExpiresAt ? account.mfaResetApprovalExpiresAt.toISOString() : null,
      },
    });
  } catch (err) {
    log.error({ err }, "free-scan account recovery: code check failed");
    res.status(500).json({ error: "recovery_failed" });
  }
});

// ── POST /recover/reset-password ──────────────────────────────────────────────

router.post("/public/free-scan/account/recover/reset-password", stepLimiter, noStore, async (req: Request, res: Response) => {
  const password = passwordField.safeParse((req.body as { password?: unknown } | undefined)?.password);
  if (!password.success) {
    res.status(400).json({ error: "weak_password" });
    return;
  }
  const ctx = await recoveryFromBody(req, res);
  if (!ctx) return;

  try {
    const result = await resetPasswordWithRecovery(ctx, password.data);
    if (!result.ok) {
      res.status(result.reason === "weak_password" ? 400 : 401).json({ error: result.reason === "weak_password" ? "weak_password" : "recovery_expired" });
      return;
    }
    // Whatever this browser held is dead server-side already; drop the cookie too.
    clearAccountSessionCookie(res);
    const cancelled = result.cancelledMfaReset === "pending" || result.cancelledMfaReset === "approved";
    await audit("free_scan_account_password_reset", result.account, ctx.engagement, {
      cancelledMfaReset: cancelled ? result.cancelledMfaReset : null,
      ip: req.ip ?? null,
    });
    log.info({ accountId: result.account.id, cancelledMfaReset: cancelled }, "free-scan account recovery: password reset, sessions revoked");

    await sendNotice(
      result.account.email,
      "free-scan-account-password-changed",
      "Your password was changed",
      `
    <p>Hi there,</p>
    <p>The password for the account on your engagement with Shane McCaw Consulting (${ctx.engagement.sowReference}) was just changed using a code sent to this address. Every signed-in session was signed out.</p>
    ${cancelled ? "<p>A request to replace your second factor was open on this account, and it has been cancelled. If you still need it, ask again from the sign-in page.</p>" : ""}
    <p>Signing in still needs your second factor.</p>
    <p style="margin-top:24px;color:#64748b;font-size:13px;">If you didn't do this, someone can read this mailbox. Secure it, then reset the password again from ${accountPageLink()}.</p>
    <p style="margin-top:24px;">— Shane McCaw Consulting</p>
  `,
      { sowReference: ctx.engagement.sowReference },
    );

    res.json({ ok: true, recoveryToken: result.token });
  } catch (err) {
    log.error({ err, accountId: ctx.account.id }, "free-scan account recovery: password reset failed");
    res.status(500).json({ error: "recovery_failed" });
  }
});

// ── POST /recover/mfa-reset ───────────────────────────────────────────────────

router.post("/public/free-scan/account/recover/mfa-reset", stepLimiter, noStore, async (req: Request, res: Response) => {
  const password = passwordField.safeParse((req.body as { password?: unknown } | undefined)?.password);
  if (!password.success) {
    res.status(401).json({ error: "invalid_password" });
    return;
  }
  const ctx = await recoveryFromBody(req, res);
  if (!ctx) return;

  try {
    const result = await requestMfaReset(ctx, password.data);
    if (!result.ok) {
      const status = result.reason === "account_locked" ? 423 : 401;
      res.status(status).json({ error: result.reason === "token_invalid" ? "recovery_expired" : result.reason });
      return;
    }

    if (result.state === "requested") {
      const { account } = result;
      const passwordRecentlyReset = !!account.passwordSetAt && Date.now() - account.passwordSetAt.getTime() < 24 * 60 * 60 * 1000;
      await audit("free_scan_account_mfa_reset_requested", account, ctx.engagement, {
        mfaMethod: account.mfaMethod,
        passwordRecentlyReset,
        ip: req.ip ?? null,
      });

      await createNotificationForAllAdmins({
        title: "Free Scan account: second-factor reset requested",
        body: `${account.email} (${ctx.engagement.sowReference}) says they lost their ${account.mfaMethod === "sms" ? "phone" : "authenticator"}. Check their identity outside this request before approving.${passwordRecentlyReset ? " Their password was reset in the last 24 hours." : ""}`,
        category: "security",
        severity: "warning",
        notifType: "general",
        linkPath: "/adminv2/free-scan-recovery",
      }).catch((err: unknown) => log.error({ err }, "free-scan account recovery: operator notification failed"));

      const operatorEmail = process.env.ADMIN_EMAIL ?? process.env.CRM_ADMIN_EMAIL;
      if (operatorEmail) {
        await sendNotice(
          operatorEmail,
          "free-scan-account-mfa-reset-operator",
          `Second-factor reset requested — ${ctx.engagement.sowReference}`,
          `
    <p>A Free Scan engagement account has asked to replace its second factor.</p>
    <ul>
      <li>Account: ${esc(account.email)}</li>
      <li>Engagement: ${esc(ctx.engagement.sowReference)}${ctx.engagement.signerName ? `, signed by ${esc(ctx.engagement.signerName)}${ctx.engagement.signerRole ? ` (${esc(ctx.engagement.signerRole)})` : ""}` : ""}</li>
      <li>Current factor: ${account.mfaMethod === "sms" ? `text message to the number ending ${account.phone?.slice(-4) ?? ""}` : "authenticator app"}</li>
      <li>Password last set: ${account.passwordSetAt ? account.passwordSetAt.toISOString() : "unknown"}${passwordRecentlyReset ? " — reset in the last 24 hours" : ""}</li>
    </ul>
    <p>They proved the mailbox and the current password. Neither of those is enough: confirm the person's identity through a channel that is not this email address before approving. Approve or deny in AdminV2 under Free Scan account recovery.</p>
  `,
          { sowReference: ctx.engagement.sowReference },
        );
      } else {
        log.warn({ accountId: account.id }, "free-scan account recovery: no ADMIN_EMAIL configured — operator relies on the in-app notification");
      }

      await sendNotice(
        account.email,
        "free-scan-account-mfa-reset-requested",
        "We received your request to replace your second factor",
        `
    <p>Hi there,</p>
    <p>We received a request to replace the second factor on the account for your engagement with Shane McCaw Consulting (${esc(ctx.engagement.sowReference)}).</p>
    <p>Before a new one can be set up, we check your identity with you directly. Once that's done we'll email you, and you'll have ${Math.round(MFA_RESET_APPROVAL_TTL_MS / 3600000)} hours to set it up from ${accountPageLink()}.</p>
    <p style="margin-top:24px;color:#64748b;font-size:13px;">If you didn't ask for this, reply to this email straight away.</p>
    <p style="margin-top:24px;">— Shane McCaw Consulting</p>
  `,
        { sowReference: ctx.engagement.sowReference },
      );
    }

    res.json({ ok: true, state: result.state === "already_approved" ? "approved" : "pending" });
  } catch (err) {
    log.error({ err, accountId: ctx.account.id }, "free-scan account recovery: second-factor reset request failed");
    res.status(500).json({ error: "recovery_failed" });
  }
});

// ── Re-enrolment (after an operator approval) ────────────────────────────────

function gateError(res: Response, reason: "not_approved" | "invalid_password" | "account_locked"): void {
  res.status(reason === "not_approved" ? 409 : reason === "account_locked" ? 423 : 401).json({ error: reason });
}

router.post("/public/free-scan/account/recover/mfa/totp/setup", stepLimiter, noStore, async (req: Request, res: Response) => {
  const password = passwordField.safeParse((req.body as { password?: unknown } | undefined)?.password);
  if (!password.success) {
    res.status(401).json({ error: "invalid_password" });
    return;
  }
  const ctx = await recoveryFromBody(req, res);
  if (!ctx) return;
  try {
    const result = await beginRecoveryTotp(ctx, password.data);
    if (!result.ok) {
      gateError(res, result.reason);
      return;
    }
    res.json({ secret: result.secret, otpauthUri: result.otpauthUri });
  } catch (err) {
    log.error({ err, accountId: ctx.account.id }, "free-scan account recovery: TOTP setup failed");
    res.status(500).json({ error: "mfa_setup_failed" });
  }
});

router.post("/public/free-scan/account/recover/mfa/sms/setup", sendCodeLimiter, noStore, async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { password?: unknown; phone?: unknown };
  const password = passwordField.safeParse(body.password);
  if (!password.success) {
    res.status(401).json({ error: "invalid_password" });
    return;
  }
  const rawPhone = z.string().max(40).safeParse(body.phone);
  const phone = rawPhone.success ? normalisePhone(rawPhone.data) : null;
  if (!phone) {
    res.status(400).json({ error: "phone_invalid" });
    return;
  }
  const ctx = await recoveryFromBody(req, res);
  if (!ctx) return;
  try {
    const result = await beginRecoverySms(ctx, password.data, phone);
    if (!result.ok) {
      gateError(res, result.reason);
      return;
    }
    res.json({ ok: true, phoneLast4: phone.slice(-4) });
  } catch (err) {
    log.error({ err, accountId: ctx.account.id }, "free-scan account recovery: SMS code could not be sent");
    res.status(502).json({ error: "sms_send_failed" });
  }
});

router.post("/public/free-scan/account/recover/mfa/verify", stepLimiter, noStore, async (req: Request, res: Response) => {
  const code = codeField.safeParse((req.body as { code?: unknown } | undefined)?.code);
  if (!code.success) {
    res.status(400).json({ error: "code_invalid" });
    return;
  }
  const ctx = await recoveryFromBody(req, res);
  if (!ctx) return;
  try {
    const result = await completeRecoveryEnrolment(ctx, code.data);
    if (!result.ok) {
      const status =
        result.reason === "code_invalid" ? 400
        : result.reason === "code_expired" ? 410
        : result.reason === "too_many_attempts" ? 429
        : result.reason === "token_invalid" ? 401
        : 409;
      res.status(status).json({ error: result.reason === "token_invalid" ? "recovery_expired" : result.reason });
      return;
    }
    const { account } = result;
    setAccountSessionCookie(res, account);
    await audit("free_scan_account_mfa_replaced", account, ctx.engagement, {
      mfaMethod: account.mfaMethod,
      approvedBy: ctx.account.mfaResetDecidedBy,
      ip: req.ip ?? null,
    });
    log.info({ accountId: account.id, mfaMethod: account.mfaMethod }, "free-scan account recovery: second factor replaced, sessions revoked");

    await sendNotice(
      account.email,
      "free-scan-account-mfa-replaced",
      "Your second factor was replaced",
      `
    <p>Hi there,</p>
    <p>The second factor on the account for your engagement with Shane McCaw Consulting (${ctx.engagement.sowReference}) was replaced with ${account.mfaMethod === "sms" ? `text messages to the number ending ${account.phone?.slice(-4) ?? ""}` : "a new authenticator app"}. Every other signed-in session was signed out, and the old factor no longer works.</p>
    <p style="margin-top:24px;color:#64748b;font-size:13px;">If you didn't do this, reply to this email straight away.</p>
    <p style="margin-top:24px;">— Shane McCaw Consulting</p>
  `,
      { sowReference: ctx.engagement.sowReference },
    );

    res.json({ ok: true });
  } catch (err) {
    log.error({ err, accountId: ctx.account.id }, "free-scan account recovery: re-enrolment failed");
    res.status(500).json({ error: "recovery_failed" });
  }
});

export default router;
