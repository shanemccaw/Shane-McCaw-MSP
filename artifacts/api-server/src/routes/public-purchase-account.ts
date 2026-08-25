/**
 * public-purchase-account.ts — generalized inline account creation for ANY paid
 * Buy.tsx purchase session (Git #1310, Phase 1 of Epic #1309).
 *
 * The $5,000 Copilot Assessment funnel already ships this exact flow
 * (public-assessment-account.ts, #437/#438/#636): prove the buyer controls the
 * mailbox the order was placed under with an emailed six-digit code, attach a
 * password to their account, and hand them into the portal auto-logged-in. The
 * flow's security model was never assessment-specific — only its route file
 * was. This file is the generalized surface, keyed on the same server-side
 * purchase session (`checkout_sessions`) every Buy.tsx product (monitoring /
 * retainer / packs) checks out through:
 *
 *   POST /api/public/purchase/send-verification-code   issue + email the code
 *   POST /api/public/purchase/verify-code              judge the code
 *   POST /api/public/purchase/set-password             complete the account
 *   GET  /api/public/purchase/account-status           where the flow stands
 *   POST /api/public/purchase/mfa/totp/setup           begin TOTP enrollment
 *   POST /api/public/purchase/mfa/totp/verify-setup    complete TOTP enrollment
 *   POST /api/public/purchase/mfa/passkey/registration-options
 *   POST /api/public/purchase/mfa/passkey/verify-registration
 *
 * All are unauthenticated and keyed on the checkout-session UUID — the same
 * bearer the payment routes already trust — and every one of them re-enforces
 * the `paid` + unexpired ordering gate server-side. The core operations live in
 * lib/purchase-account-flow.ts (see its header for the full security-property
 * inventory and for why public-assessment-account.ts is deliberately NOT
 * rewritten onto it in this phase — the live assessment checkout stays
 * byte-for-byte untouched).
 *
 * ── Why MFA enrollment appears HERE, keyed on the purchase session ────────────
 * The portal's own MFA enrollment endpoints (mfa.ts) require a session, and a
 * session only exists after the portal boot exchanges the signup token — but
 * Shane's Buy.tsx product flow (#1309) runs MFA BEFORE the portal handoff, on
 * the marketing site, which is a different app with its own cookie scope (the
 * same reality Git #636 documents for auto-login). So enrollment here is gated
 * exactly as hard as set-password is, plus two more locks:
 *
 *   1. the session's mailbox must be PROVEN (verified code, address unchanged)
 *      and the password must already be set through this flow — enrollment is
 *      the tail of account creation, never a standalone door; and
 *   2. the account must have ZERO active MFA methods. An existing account's
 *      MFA is never enrollable or replaceable through a checkout session — the
 *      same doctrine that stops set-password overwriting an existing password.
 *      An already-enrolled buyer signs into the portal and manages MFA there.
 *
 * The crypto and storage are the platform's one real MFA implementation,
 * imported from mfa.ts (otplib TOTP + encryptTotp at rest; @simplewebauthn +
 * webauthn_credentials), per that file's own "extend, do not fork" rule — no
 * second implementation, only a different front door with a purchase-session
 * gate instead of a session gate.
 *
 * Passkey caveat, stated honestly: WebAuthn pins the relying-party ID and
 * origin. TOTP works from any origin, but if the marketing site is served from
 * a different registrable domain than the portal/API (getRpId), the browser
 * itself will refuse passkey creation there no matter what this server accepts.
 * PURCHASE_PASSKEY_EXTRA_ORIGINS (comma-separated) admits additional exact
 * origins under the SAME registrable domain; a truly cross-domain marketing
 * site must defer passkey enrollment to the portal (the existing authenticated
 * endpoints) after the Phase-4 handoff. Phase 8 makes that call per
 * environment; both doors exist.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { randomBytes } from "crypto";
import {
  db,
  usersTable,
  signupExchangeTokensTable,
  mfaEnrollmentsTable,
  webauthnCredentialsTable,
  webauthnChallengesTable,
} from "@workspace/db";
import { and, eq, gt } from "drizzle-orm";
import { z } from "zod";
import { generateSecret, generateURI, verifySync } from "otplib";
import type { AuthenticatorTransport } from "@simplewebauthn/server";
import { createAuditLog } from "../lib/audit.ts";
import { getEmailTemplateOrFallback, sendEmailOrThrow } from "../lib/mailer.ts";
import { getMspPortalLandingUrl } from "../lib/portal-url.ts";
import { logger } from "../lib/logger.ts";
import {
  resolvePaidPurchaseSession,
  issueVerificationCode,
  checkVerificationCode,
  getVerifiedEmail,
  attachPasswordToAccount,
  maskEmail,
  type PaidPurchaseSession,
} from "../lib/purchase-account-flow.ts";
import { getActiveMfaMethods, getRpId, getRpOrigin, encryptTotp } from "./mfa.ts";

const log = logger.child({ channel: "auth" });

const router: IRouter = Router();

const isDev = process.env.NODE_ENV !== "production";

// Same limiter budgets as the assessment flow's — separate instances, so one
// funnel's abuse cannot exhaust the other's budget. Sending mail costs money
// and lands in someone's inbox — the resend button is the abusable surface
// here, so it is limited harder than the check.
const sendCodeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: isDev ? 100 : 6,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many verification emails requested. Please wait a few minutes and try again." },
});

const verifyCodeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: isDev ? 200 : 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many attempts. Please wait a few minutes and try again." },
});

const setPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: isDev ? 100 : 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many attempts. Please wait a few minutes and try again." },
});

// Mirrors mfa.ts's mfaLimiter budget for the enrollment surface.
const mfaEnrollLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: isDev ? 200 : 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many MFA attempts. Please try again later." },
});

const statusLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: isDev ? 600 : 60,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many requests. Please wait a few minutes and try again." },
});

/** resolvePaidPurchaseSession, with the rejection written straight to the response. */
async function requirePaidSession(rawSessionId: unknown, res: Response): Promise<PaidPurchaseSession | null> {
  const resolved = await resolvePaidPurchaseSession(rawSessionId);
  if (!resolved.ok) {
    res.status(resolved.status).json({ error: resolved.error });
    return null;
  }
  return resolved.session;
}

// ── POST /api/public/purchase/send-verification-code ──────────────────────────
//
// Issues a fresh six-digit code and mails it. Transport is Exchange Online /
// Microsoft Graph via mailer.ts's sendEmailOrThrow — the ONLY mail transport
// this platform uses. Throwing (not the fire-and-forget sendEmail) is
// deliberate: the buyer is sitting on a screen waiting for this mail, so a send
// failure has to become a visible error rather than a silent wait for something
// that will never arrive.

const sendCodeSchema = z.object({ sessionId: z.string() });

router.post("/public/purchase/send-verification-code", sendCodeLimiter, async (req: Request, res: Response) => {
  const parsed = sendCodeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "sessionId is required" });
    return;
  }

  const session = await requirePaidSession(parsed.data.sessionId, res);
  if (!session) return;

  if (!session.email.trim()) {
    log.error({ sessionId: session.id }, "purchase verification: paid session carries no email — cannot issue a code");
    res.status(409).json({ error: "email_missing" });
    return;
  }

  let code: string;
  let expiresAt: Date;
  let email: string;
  try {
    ({ code, expiresAt, email } = await issueVerificationCode(session));
  } catch (err) {
    log.error({ err, sessionId: session.id }, "purchase verification: could not store the verification code");
    res.status(500).json({ error: "code_issue_failed" });
    return;
  }

  const firstName = session.fullName?.trim().split(/\s+/)[0] ?? "";
  const defaultBody = `
    <p>Hi ${firstName || "there"},</p>
    <p>Here is the code to confirm your email address and finish setting up your Shane McCaw Consulting account:</p>
    <p style="margin:24px 0;text-align:center;">
      <span style="display:inline-block;font-family:Menlo,Consolas,monospace;font-size:32px;font-weight:700;letter-spacing:10px;color:#0A2540;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:8px;padding:16px 24px;">${code}</span>
    </p>
    <p>Enter it on the page you already have open. The code expires in <strong>15 minutes</strong>.</p>
    <p style="margin-top:24px;color:#64748b;font-size:13px;">If you didn't just make a purchase from Shane McCaw Consulting, you can ignore this email — no account changes have been made.</p>
    <p style="margin-top:24px;">— Shane McCaw Consulting</p>
  `;

  try {
    const { subject, bodyHtml } = await getEmailTemplateOrFallback(
      "purchase-flow-verification-code",
      { code, firstName, company: session.company ?? "", productSlug: session.productSlug },
      "Your verification code",
      defaultBody,
    );
    await sendEmailOrThrow(email, subject, bodyHtml, { templateName: "purchase-flow-verification-code" });
  } catch (err) {
    log.error({ err, sessionId: session.id }, "purchase verification: code email could not be delivered");
    res.status(502).json({ error: "email_send_failed" });
    return;
  }

  await createAuditLog({
    actorUserId: null,
    actorName: "public:purchase-flow",
    actorRole: "client",
    actionType: "purchase_flow_verification_code_sent",
    entityType: "checkout_session",
    entityId: session.id,
    // The code itself is never logged or audited — only that one was issued.
    metadata: { expiresAt, productSlug: session.productSlug },
  });

  log.info({ sessionId: session.id, productSlug: session.productSlug }, "purchase verification: six-digit code issued and emailed");
  res.json({ ok: true, expiresAt: expiresAt.toISOString(), email: maskEmail(email) });
});

// ── POST /api/public/purchase/verify-code ─────────────────────────────────────

const verifyCodeSchema = z.object({
  sessionId: z.string(),
  code: z.string().trim().regex(/^\d{6}$/, "Enter the six-digit code from your email"),
});

router.post("/public/purchase/verify-code", verifyCodeLimiter, async (req: Request, res: Response) => {
  const parsed = verifyCodeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid request" });
    return;
  }

  const session = await requirePaidSession(parsed.data.sessionId, res);
  if (!session) return;

  const result = await checkVerificationCode(session.id, parsed.data.code);

  switch (result.outcome) {
    case "no_code_issued":
      res.status(400).json({ error: "no_code_issued" });
      return;
    case "already_verified":
      res.json({ ok: true, alreadyVerified: true });
      return;
    case "code_expired":
      res.status(400).json({ error: "code_expired" });
      return;
    case "too_many_attempts":
      log.warn({ sessionId: session.id }, "purchase verification: attempt budget exhausted for this code");
      res.status(429).json({ error: "too_many_attempts" });
      return;
    case "code_incorrect":
      res.status(400).json({ error: "code_incorrect", attemptsRemaining: result.attemptsRemaining });
      return;
    case "verified":
      break;
  }

  await createAuditLog({
    actorUserId: null,
    actorName: "public:purchase-flow",
    actorRole: "client",
    actionType: "purchase_flow_email_verified",
    entityType: "checkout_session",
    entityId: session.id,
    metadata: { attempts: result.attempts },
  });

  log.info({ sessionId: session.id }, "purchase verification: email address proven");
  res.json({ ok: true });
});

// ── POST /api/public/purchase/set-password ────────────────────────────────────
//
// Attaches a bcrypt hash to the buyer's account, provisioning the account first
// when no earlier step created one (the Retainer flow's consent step is
// skippable, so consent-time provisioning is not guaranteed to have run — see
// lib/purchase-account-flow.ts). Requires a verified code for this session AND
// that the verified address is still the session's own address.

const setPasswordSchema = z.object({
  sessionId: z.string(),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

router.post("/public/purchase/set-password", setPasswordLimiter, async (req: Request, res: Response) => {
  const parsed = setPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid request" });
    return;
  }

  const session = await requirePaidSession(parsed.data.sessionId, res);
  if (!session) return;

  const result = await attachPasswordToAccount(session, parsed.data.password, { provisionIfMissing: true });

  switch (result.outcome) {
    case "email_not_verified":
      res.status(409).json({ error: "email_not_verified" });
      return;
    case "account_missing":
      // provisionIfMissing means this only happens when provisioning itself
      // failed — a real defect to shout about, not something to paper over.
      log.error(
        { sessionId: session.id },
        "purchase set-password: account provisioning failed for a paid, email-verified buyer",
      );
      res.status(409).json({ error: "account_missing" });
      return;
    case "already_set":
      // A returning buyer. Their existing credential is not replaceable through
      // a checkout session — /auth/forgot-password is the door for that.
      log.info({ sessionId: session.id, userId: result.userId }, "purchase set-password: account already has a password — sign-in required");
      res.status(409).json({ error: "already_set", portalUrl: getMspPortalLandingUrl() });
      return;
    case "ok":
      break;
  }

  await createAuditLog({
    actorUserId: result.userId,
    actorName: "public:purchase-flow",
    actorRole: "client",
    actionType: "purchase_flow_password_set",
    entityType: "user",
    entityId: String(result.userId),
    metadata: { checkoutSessionId: session.id, accountProvisionedInline: result.provisioned },
  });

  // Same single-use, short-lived auto-login handoff the assessment flow mints
  // (Git #636): the portal's own boot effect trades it for a real session the
  // instant that tab lands. Phase 4 of #1309 builds the /buy handoff on this.
  const signupToken = randomBytes(32).toString("hex");
  await db.insert(signupExchangeTokensTable).values({
    token: signupToken,
    userId: result.userId,
    expiresAt: new Date(Date.now() + 2 * 60 * 1000),
  });

  log.info(
    { sessionId: session.id, userId: result.userId, provisioned: result.provisioned },
    "purchase set-password: account completed inline",
  );
  res.json({
    ok: true,
    email: session.email.trim().toLowerCase(),
    accountProvisioned: result.provisioned,
    portalUrl: `${getMspPortalLandingUrl()}?signupToken=${encodeURIComponent(signupToken)}`,
  });
});

// ── GET /api/public/purchase/account-status ───────────────────────────────────
//
// Where this session's account creation honestly stands, so a resumed or
// refreshed Buy.tsx tab can land on the right stage instead of guessing —
// the same resumability doctrine the session table itself exists for.

router.get("/public/purchase/account-status", statusLimiter, async (req: Request, res: Response) => {
  const session = await requirePaidSession(req.query.sessionId, res);
  if (!session) return;

  const verifiedEmail = await getVerifiedEmail(session);

  let passwordSet = false;
  let mfaEnrolled = false;
  if (verifiedEmail) {
    const [user] = await db
      .select({ id: usersTable.id, passwordHash: usersTable.passwordHash })
      .from(usersTable)
      .where(eq(usersTable.email, verifiedEmail))
      .limit(1);
    if (user) {
      passwordSet = Boolean(user.passwordHash);
      mfaEnrolled = passwordSet ? (await getActiveMfaMethods(user.id)).length > 0 : false;
    }
  }

  res.json({
    productSlug: session.productSlug,
    email: maskEmail(session.email.trim().toLowerCase()),
    emailVerified: Boolean(verifiedEmail),
    passwordSet,
    mfaEnrolled,
  });
});

// ── MFA enrollment, purchase-session-keyed ────────────────────────────────────

interface MfaEligibleAccount {
  session: PaidPurchaseSession;
  userId: number;
  email: string;
}

/**
 * The full gate chain every MFA enrollment call must pass — see the file
 * header. Paid session, proven mailbox still matching the session, account
 * present with its password already set through this flow, and ZERO active MFA
 * methods on the account.
 */
async function resolveMfaEligibleAccount(rawSessionId: unknown, res: Response): Promise<MfaEligibleAccount | null> {
  const session = await requirePaidSession(rawSessionId, res);
  if (!session) return null;

  const email = await getVerifiedEmail(session);
  if (!email) {
    res.status(409).json({ error: "email_not_verified" });
    return null;
  }

  const [user] = await db
    .select({ id: usersTable.id, passwordHash: usersTable.passwordHash })
    .from(usersTable)
    .where(eq(usersTable.email, email))
    .limit(1);

  if (!user) {
    res.status(409).json({ error: "account_missing" });
    return null;
  }
  if (!user.passwordHash) {
    // Enrollment is the tail of account creation, never a standalone door.
    res.status(409).json({ error: "password_not_set" });
    return null;
  }

  const methods = await getActiveMfaMethods(user.id);
  if (methods.length > 0) {
    // An existing account's MFA is never enrollable or replaceable through a
    // checkout session — the portal's authenticated MFA management is the door.
    log.warn(
      { sessionId: session.id, userId: user.id },
      "purchase MFA: REFUSED — account already has active MFA; portal sign-in is the door for changes",
    );
    res.status(409).json({ error: "mfa_already_enrolled" });
    return null;
  }

  return { session, userId: user.id, email };
}

const mfaSessionSchema = z.object({ sessionId: z.string() });

// ── POST /api/public/purchase/mfa/totp/setup ──────────────────────────────────

router.post("/public/purchase/mfa/totp/setup", mfaEnrollLimiter, async (req: Request, res: Response) => {
  const parsed = mfaSessionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "sessionId is required" });
    return;
  }

  const eligible = await resolveMfaEligibleAccount(parsed.data.sessionId, res);
  if (!eligible) return;

  const secret = generateSecret();
  const otpauth = generateURI({ issuer: "Shane McCaw Consulting", label: eligible.email, secret });

  const { default: QRCode } = await import("qrcode");
  const qrDataUrl = await QRCode.toDataURL(otpauth);

  // Same contract as mfa.ts's setup: nothing stored yet — the secret only
  // becomes an enrollment once verify-setup proves the authenticator has it.
  res.json({ secret, otpauth, qrDataUrl });
});

// ── POST /api/public/purchase/mfa/totp/verify-setup ───────────────────────────

const totpVerifySchema = z.object({
  sessionId: z.string(),
  secret: z.string().min(1),
  code: z.string().min(1),
});

router.post("/public/purchase/mfa/totp/verify-setup", mfaEnrollLimiter, async (req: Request, res: Response) => {
  const parsed = totpVerifySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "sessionId, secret and code are required" });
    return;
  }

  const eligible = await resolveMfaEligibleAccount(parsed.data.sessionId, res);
  if (!eligible) return;

  const result = verifySync({ token: parsed.data.code.replace(/\s/g, ""), secret: parsed.data.secret, epochTolerance: 30 });
  if (!result.valid) {
    res.status(400).json({ error: "Invalid verification code. Please try again." });
    return;
  }

  // The eligibility gate guarantees no active methods, so this delete is a
  // no-op belt-and-braces mirror of mfa.ts's own replace-on-verify shape.
  await db.delete(mfaEnrollmentsTable).where(
    and(eq(mfaEnrollmentsTable.userId, eligible.userId), eq(mfaEnrollmentsTable.method, "totp"))
  );

  await db.insert(mfaEnrollmentsTable).values({
    userId: eligible.userId,
    method: "totp",
    enabled: true,
    encryptedSecret: encryptTotp(parsed.data.secret),
  });

  await createAuditLog({
    actorUserId: eligible.userId,
    actorName: "public:purchase-flow",
    actorRole: "client",
    actionType: "purchase_flow_mfa_enrolled",
    entityType: "user",
    entityId: String(eligible.userId),
    metadata: { checkoutSessionId: eligible.session.id, method: "totp" },
  });

  log.info({ sessionId: eligible.session.id, userId: eligible.userId }, "purchase MFA: TOTP enrolled inline");
  res.json({ ok: true });
});

// ── POST /api/public/purchase/mfa/passkey/registration-options ────────────────

router.post("/public/purchase/mfa/passkey/registration-options", mfaEnrollLimiter, async (req: Request, res: Response) => {
  const parsed = mfaSessionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "sessionId is required" });
    return;
  }

  const eligible = await resolveMfaEligibleAccount(parsed.data.sessionId, res);
  if (!eligible) return;

  const { generateRegistrationOptions } = await import("@simplewebauthn/server");

  const existingCredentials = await db
    .select()
    .from(webauthnCredentialsTable)
    .where(eq(webauthnCredentialsTable.userId, eligible.userId));

  const options = await generateRegistrationOptions({
    rpName: "Shane McCaw Consulting",
    rpID: getRpId(),
    userName: eligible.email,
    attestationType: "none",
    excludeCredentials: existingCredentials.map(c => ({
      id: c.credentialId,
      transports: (c.transports as AuthenticatorTransport[] | undefined) ?? [],
    })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
  });

  await db.delete(webauthnChallengesTable).where(
    and(eq(webauthnChallengesTable.userId, eligible.userId), eq(webauthnChallengesTable.purpose, "registration"))
  );

  await db.insert(webauthnChallengesTable).values({
    userId: eligible.userId,
    challenge: options.challenge,
    purpose: "registration",
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
  });

  res.json(options);
});

// ── POST /api/public/purchase/mfa/passkey/verify-registration ─────────────────

const passkeyVerifySchema = z.object({
  sessionId: z.string(),
  // The WebAuthn attestation response, passed through to @simplewebauthn as-is.
  response: z.record(z.unknown()),
});

/**
 * The origins a purchase-flow passkey registration may legitimately come from:
 * the platform's own relying-party origin, any exact origins explicitly
 * admitted via PURCHASE_PASSKEY_EXTRA_ORIGINS (the marketing site, when it
 * shares the registrable domain), and — in dev only — the localhost origin the
 * request actually came from, since local front-ends each run on their own port.
 */
function buildExpectedOrigins(req: Request): string[] {
  const origins = new Set<string>([getRpOrigin()]);
  const extra = process.env.PURCHASE_PASSKEY_EXTRA_ORIGINS;
  if (extra) {
    for (const raw of extra.split(",")) {
      const trimmed = raw.trim();
      if (trimmed) origins.add(trimmed);
    }
  }
  const reqOrigin = req.headers.origin;
  if (isDev && typeof reqOrigin === "string" && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(reqOrigin)) {
    origins.add(reqOrigin);
  }
  return [...origins];
}

router.post("/public/purchase/mfa/passkey/verify-registration", mfaEnrollLimiter, async (req: Request, res: Response) => {
  const parsed = passkeyVerifySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "sessionId and response are required" });
    return;
  }

  const eligible = await resolveMfaEligibleAccount(parsed.data.sessionId, res);
  if (!eligible) return;

  const [challengeRow] = await db
    .select()
    .from(webauthnChallengesTable)
    .where(
      and(
        eq(webauthnChallengesTable.userId, eligible.userId),
        eq(webauthnChallengesTable.purpose, "registration"),
        gt(webauthnChallengesTable.expiresAt, new Date()),
      )
    )
    .limit(1);

  if (!challengeRow) {
    res.status(400).json({ error: "No pending registration challenge" });
    return;
  }

  try {
    const { verifyRegistrationResponse } = await import("@simplewebauthn/server");
    const body = parsed.data.response as unknown as Parameters<typeof verifyRegistrationResponse>[0]["response"];
    const verification = await verifyRegistrationResponse({
      response: body,
      expectedChallenge: challengeRow.challenge,
      expectedOrigin: buildExpectedOrigins(req),
      expectedRPID: getRpId(),
    });

    if (!verification.verified || !verification.registrationInfo) {
      res.status(400).json({ error: "Verification failed" });
      return;
    }

    const { credential } = verification.registrationInfo;

    // credential.id is already a Base64URL string from @simplewebauthn/server — store as-is
    const publicKeyBase64 = Buffer.from(credential.publicKey).toString("base64url");

    await db.insert(webauthnCredentialsTable).values({
      userId: eligible.userId,
      credentialId: credential.id,
      publicKey: publicKeyBase64,
      counter: credential.counter,
      deviceType: verification.registrationInfo.credentialDeviceType,
      backedUp: verification.registrationInfo.credentialBackedUp,
      transports: (body as { response?: { transports?: string[] } }).response?.transports ?? [],
    });

    await db.delete(webauthnChallengesTable).where(eq(webauthnChallengesTable.id, challengeRow.id));

    await db.delete(mfaEnrollmentsTable).where(
      and(eq(mfaEnrollmentsTable.userId, eligible.userId), eq(mfaEnrollmentsTable.method, "passkey"))
    );
    await db.insert(mfaEnrollmentsTable).values({
      userId: eligible.userId,
      method: "passkey",
      enabled: true,
    });

    await createAuditLog({
      actorUserId: eligible.userId,
      actorName: "public:purchase-flow",
      actorRole: "client",
      actionType: "purchase_flow_mfa_enrolled",
      entityType: "user",
      entityId: String(eligible.userId),
      metadata: { checkoutSessionId: eligible.session.id, method: "passkey" },
    });

    log.info({ sessionId: eligible.session.id, userId: eligible.userId }, "purchase MFA: passkey enrolled inline");
    res.json({ ok: true });
  } catch (err) {
    log.error({ err, sessionId: eligible.session.id }, "purchase MFA: passkey registration error");
    res.status(400).json({ error: "Registration failed" });
  }
});

export default router;
