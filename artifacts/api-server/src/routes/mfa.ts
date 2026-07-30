import { Router, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { createHash, randomBytes, createCipheriv, createDecipheriv } from "crypto";
import { db, usersTable, mfaEnrollmentsTable, mfaChallengesTable, mfaBypassCodesTable, webauthnCredentialsTable, webauthnChallengesTable, mspRefreshTokensTable } from "@workspace/db";
import { eq, and, gt, isNull } from "drizzle-orm";
import { requireAuth, requireAdmin, type AuthUser } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";
import { createAuditLog } from "../lib/audit";
import { sendEmailFromTemplate } from "../lib/mailer.ts";
import { getMspPortalBaseUrl } from "../lib/portal-url.ts";
const log = logger.child({ channel: "auth" });
const auditLog = logger.child({ channel: "audit" });
import { createSession, type LoginMethod } from "../lib/session-tracking";
import { generateSecret, generateURI, verifySync } from "otplib";
import type { AuthenticatorTransport } from "@simplewebauthn/server";

const router = Router();

const mfaLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many MFA attempts. Please try again later." },
});

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET not configured");
  return secret;
}

function buildUserPayload(user: typeof usersTable.$inferSelect) {
  return {
    id: user.id,
    email: user.email,
    name: user.name ?? undefined,
    company: user.company ?? undefined,
    phone: user.phone ?? undefined,
    address: user.address ?? undefined,
    addressCity: user.addressCity ?? undefined,
    addressState: user.addressState ?? undefined,
    addressZip: user.addressZip ?? undefined,
    role: user.role,
  };
}

function getRpId(): string {
  const domains = process.env.REPLIT_DOMAINS;
  if (domains) {
    const firstDomain = domains.split(",")[0].trim();
    return firstDomain;
  }
  const devDomain = process.env.REPLIT_DEV_DOMAIN;
  if (devDomain) return devDomain;
  return "localhost";
}

function getRpOrigin(): string {
  const domains = process.env.REPLIT_DOMAINS;
  if (domains) {
    const firstDomain = domains.split(",")[0].trim();
    return `https://${firstDomain}`;
  }
  const devDomain = process.env.REPLIT_DEV_DOMAIN;
  if (devDomain) return `https://${devDomain}`;
  return "http://localhost";
}

// ── TOTP encryption helpers (AES-256-GCM) ─────────────────────────────────────
// Key is derived from TOTP_ENCRYPTION_KEY env var (32-byte hex) or falls back
// to a SHA-256 of JWT_SECRET so existing deployments need zero new secrets.

function getTotpEncryptionKey(): Buffer {
  const raw = process.env.TOTP_ENCRYPTION_KEY;
  if (raw) return Buffer.from(raw, "hex").subarray(0, 32);
  return createHash("sha256").update(getJwtSecret()).digest();
}

function encryptTotp(plaintext: string): string {
  const key = getTotpEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${enc.toString("hex")}:${tag.toString("hex")}`;
}

function decryptTotp(ciphertext: string): string {
  const [ivHex, encHex, tagHex] = ciphertext.split(":");
  const key = getTotpEncryptionKey();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(encHex, "hex")), decipher.final()]).toString("utf8");
}

// ── MFA Token utilities ────────────────────────────────────────────────────────

export function signMfaToken(userId: number, methods: string[]): string {
  return jwt.sign({ mfa: true, userId, methods }, getJwtSecret(), { expiresIn: "10m" });
}

export function verifyMfaToken(token: string): { userId: number; methods: string[] } {
  const payload = jwt.verify(token, getJwtSecret()) as { mfa: boolean; userId: number; methods: string[] };
  if (!payload.mfa) throw new Error("Not an MFA token");
  return { userId: payload.userId, methods: payload.methods };
}

// ── MFA un-enrollment: the single shared implementation ───────────────────────
// Active Directory Phase 8 (Issue #68) needs an admin-initiated MFA reset. Per
// the initiative's "extend, do not fork" rule, the real per-method
// un-enrollment logic that the self-service DELETE routes below have always
// run is lifted here verbatim, and BOTH paths now call it:
//
//   • self-service  — DELETE /auth/mfa/{totp,sms,passkey}  (unchanged behaviour)
//   • admin-gated   — POST  /auth/mfa/admin/reset/:userId   (below), and
//                     POST  /admin/active-directory/user/:id/mfa-reset, which
//                     imports adminResetMfa() directly rather than duplicating it.
//
// There is deliberately no second implementation: adminResetMfa() is a thin
// wrapper that adds the notification e-mail and the audit trail on top of
// resetMfaForUser(), which is itself just unenrollMfaMethod() applied across
// the requested methods.

export const MFA_METHODS = ["totp", "sms", "passkey"] as const;
export type MfaMethod = (typeof MFA_METHODS)[number];

export function isMfaMethod(value: unknown): value is MfaMethod {
  return typeof value === "string" && (MFA_METHODS as readonly string[]).includes(value);
}

export const MFA_METHOD_LABELS: Record<string, string> = {
  totp: "Authenticator App (TOTP)",
  sms: "SMS",
  passkey: "Passkey / Security Key",
};

/**
 * Un-enroll ONE method for a user — byte-for-byte the deletes the matching
 * self-service DELETE route has always performed, so refactoring those routes
 * onto this helper is behaviour-preserving.
 */
export async function unenrollMfaMethod(userId: number, method: MfaMethod): Promise<void> {
  if (method === "passkey") {
    await db.delete(webauthnCredentialsTable).where(eq(webauthnCredentialsTable.userId, userId));
  }
  await db.delete(mfaEnrollmentsTable).where(
    and(eq(mfaEnrollmentsTable.userId, userId), eq(mfaEnrollmentsTable.method, method)),
  );
}

/** Which methods a user currently holds — enrollment rows plus real passkey credentials. */
async function listEnrolledMfaMethods(userId: number): Promise<string[]> {
  const enrollments = await db
    .select({ method: mfaEnrollmentsTable.method })
    .from(mfaEnrollmentsTable)
    .where(eq(mfaEnrollmentsTable.userId, userId));
  const passkeyRows = await db
    .select({ id: webauthnCredentialsTable.id })
    .from(webauthnCredentialsTable)
    .where(eq(webauthnCredentialsTable.userId, userId));

  const methods = enrollments.map((e) => e.method);
  if (passkeyRows.length > 0 && !methods.includes("passkey")) methods.push("passkey");
  return methods;
}

/**
 * Reset MFA for a user. Pass a single `method` to un-enroll just that one, or
 * omit it to clear every method ("any method", per Issue #68).
 *
 * A FULL reset additionally purges pending challenge rows and any *unused*
 * emergency bypass codes — a bypass code outliving the reset would otherwise
 * remain a live, un-revoked way past MFA. Already-used bypass codes are kept:
 * their usedAt/usedIp columns are the audit record of a real sign-in.
 */
export async function resetMfaForUser(
  userId: number,
  opts: { method?: MfaMethod } = {},
): Promise<{ clearedMethods: string[] }> {
  const enrolled = await listEnrolledMfaMethods(userId);

  if (opts.method) {
    const method = opts.method;
    await unenrollMfaMethod(userId, method);
    if (method === "passkey") {
      await db.delete(webauthnChallengesTable).where(eq(webauthnChallengesTable.userId, userId));
    } else {
      await db.delete(mfaChallengesTable).where(
        and(eq(mfaChallengesTable.userId, userId), eq(mfaChallengesTable.method, method)),
      );
    }
    return { clearedMethods: enrolled.includes(method) ? [method] : [] };
  }

  for (const method of MFA_METHODS) {
    await unenrollMfaMethod(userId, method);
  }
  await db.delete(mfaChallengesTable).where(eq(mfaChallengesTable.userId, userId));
  await db.delete(webauthnChallengesTable).where(eq(webauthnChallengesTable.userId, userId));
  await db.delete(mfaBypassCodesTable).where(
    and(eq(mfaBypassCodesTable.userId, userId), isNull(mfaBypassCodesTable.usedAt)),
  );

  return { clearedMethods: enrolled };
}

export interface AdminMfaResetActor {
  id: number;
  email: string;
  name?: string | null;
}

/**
 * Admin-initiated MFA reset: the data reset above, plus the notification e-mail
 * the target is owed and the audit trail Issue #68 requires (actor identity,
 * target account, timestamp). Returns null when the target user does not exist.
 */
export async function adminResetMfa(input: {
  userId: number;
  method?: MfaMethod;
  actor: AdminMfaResetActor;
  /** Surfaced in the audit metadata so a reset can be traced to the surface that fired it. */
  source: string;
}): Promise<{ clearedMethods: string[]; targetEmail: string; targetName: string | null } | null> {
  const [target] = await db
    .select({ id: usersTable.id, email: usersTable.email, name: usersTable.name })
    .from(usersTable)
    .where(eq(usersTable.id, input.userId))
    .limit(1);
  if (!target) return null;

  const { clearedMethods } = await resetMfaForUser(input.userId, { method: input.method });

  const methodsList = clearedMethods.map((m) => MFA_METHOD_LABELS[m] ?? m).join(", ") || "None";
  void sendEmailFromTemplate(
    "mfa-reset",
    target.email,
    {
      clientName: target.name ?? target.email,
      methodsList,
      loginLink: getMspPortalBaseUrl(),
      securityLink: `${getMspPortalBaseUrl()}/security`,
    },
    "Your two-factor authentication has been reset",
    `<p>Hi ${target.name ?? target.email},</p><p>Your multi-factor authentication has been reset by an administrator. Please sign in and set up a new authentication method.</p><p><a href="${getMspPortalBaseUrl()}">Sign in to your portal</a></p>`,
  ).catch((err) => log.warn({ err, userId: input.userId }, "admin mfa reset: notification email failed (non-fatal)"));

  void createAuditLog({
    actorUserId: input.actor.id,
    actorName: input.actor.name ?? input.actor.email,
    actorRole: "admin",
    actionType: "admin_mfa_reset",
    entityType: "user",
    entityId: target.id,
    entityLabel: target.name ?? target.email,
    metadata: { clearedMethods, method: input.method ?? "all", source: input.source },
  });

  auditLog.info(
    {
      actionType: "admin_mfa_reset",
      actorUserId: input.actor.id,
      actorEmail: input.actor.email,
      targetUserId: target.id,
      targetEmail: target.email,
      clearedMethods,
      method: input.method ?? "all",
      source: input.source,
      occurredAt: new Date().toISOString(),
    },
    "audit: PlatformAdmin reset MFA for an account",
  );

  log.info({ actorUserId: input.actor.id, targetUserId: target.id, clearedMethods }, "admin mfa reset applied");

  return { clearedMethods, targetEmail: target.email, targetName: target.name };
}

// ── POST /api/auth/mfa/admin/reset/:userId ────────────────────────────────────
// The admin-gated entry point Issue #68 calls for, living alongside mfa.ts's
// self-service routes and sharing their un-enrollment logic. Body may carry
// { method } to un-enroll a single method; omit it to clear all of them.
router.post("/auth/mfa/admin/reset/:userId", requireAdmin, async (req: Request, res: Response) => {
  const userId = parseInt(String(req.params.userId ?? ""), 10);
  if (!Number.isInteger(userId)) {
    res.status(400).json({ error: "Invalid userId" });
    return;
  }

  const rawMethod = (req.body as { method?: unknown } | undefined)?.method;
  if (rawMethod !== undefined && !isMfaMethod(rawMethod)) {
    res.status(400).json({ error: `method must be one of: ${MFA_METHODS.join(", ")}` });
    return;
  }

  try {
    const actor = req.user!;
    const result = await adminResetMfa({
      userId,
      method: rawMethod,
      actor: { id: actor.id, email: actor.email, name: actor.name },
      source: "auth.mfa.admin-reset",
    });
    if (!result) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.json({ ok: true, clearedMethods: result.clearedMethods });
  } catch (err) {
    log.error({ err, userId }, "admin mfa reset failed");
    res.status(500).json({ error: "Failed to reset MFA" });
  }
});

// ── GET /api/auth/mfa/enrollments ─────────────────────────────────────────────
// List all active MFA enrollments for the authenticated user.
router.get("/auth/mfa/enrollments", requireAuth, async (req: Request, res: Response) => {
  const user = req.user!;
  const enrollments = await db
    .select()
    .from(mfaEnrollmentsTable)
    .where(and(eq(mfaEnrollmentsTable.userId, user.id), eq(mfaEnrollmentsTable.enabled, true)));

  const passkeys = await db
    .select()
    .from(webauthnCredentialsTable)
    .where(eq(webauthnCredentialsTable.userId, user.id));

  res.json({
    totp: enrollments.some(e => e.method === "totp"),
    sms: enrollments.some(e => e.method === "sms"),
    smsPhone: enrollments.find(e => e.method === "sms")?.phone ?? null,
    passkey: passkeys.length > 0,
    passkeyCount: passkeys.length,
  });
});

// Guard: block SMS MFA for admin accounts (admins may use passkey or TOTP)
function rejectIfAdmin(req: Request, res: Response): boolean {
  if (req.user?.role === "admin") {
    res.status(403).json({ error: "Admins must use passkey or authenticator app authentication" });
    return true;
  }
  return false;
}

// ── TOTP Setup ────────────────────────────────────────────────────────────────

router.post("/auth/mfa/totp/setup", requireAuth, async (req: Request, res: Response) => {
  const user = req.user!;
  const secret = generateSecret();
  const otpauth = generateURI({ issuer: "Shane McCaw Consulting", label: user.email, secret });

  const { default: QRCode } = await import("qrcode");
  const qrDataUrl = await QRCode.toDataURL(otpauth);

  res.json({ secret, otpauth, qrDataUrl });
});

router.post("/auth/mfa/totp/verify-setup", requireAuth, mfaLimiter, async (req: Request, res: Response) => {
  const user = req.user!;
  const { secret, code } = req.body as { secret?: string; code?: string };

  if (!secret || !code) {
    res.status(400).json({ error: "secret and code are required" });
    return;
  }

  const result = verifySync({ token: code.replace(/\s/g, ""), secret, epochTolerance: 30 });
  if (!result.valid) {
    res.status(400).json({ error: "Invalid verification code. Please try again." });
    return;
  }

  await db.delete(mfaEnrollmentsTable).where(
    and(eq(mfaEnrollmentsTable.userId, user.id), eq(mfaEnrollmentsTable.method, "totp"))
  );

  await db.insert(mfaEnrollmentsTable).values({
    userId: user.id,
    method: "totp",
    enabled: true,
    encryptedSecret: encryptTotp(secret),
  });

  res.json({ ok: true });
});

router.post("/auth/mfa/totp/challenge", mfaLimiter, async (req: Request, res: Response) => {
  const { mfaToken, code } = req.body as { mfaToken?: string; code?: string };

  if (!mfaToken || !code) {
    res.status(400).json({ error: "mfaToken and code are required" });
    return;
  }

  let userId: number;
  try {
    ({ userId } = verifyMfaToken(mfaToken));
  } catch {
    res.status(401).json({ error: "Invalid or expired MFA session" });
    return;
  }

  const [enrollment] = await db
    .select()
    .from(mfaEnrollmentsTable)
    .where(and(eq(mfaEnrollmentsTable.userId, userId), eq(mfaEnrollmentsTable.method, "totp"), eq(mfaEnrollmentsTable.enabled, true)))
    .limit(1);

  if (!enrollment?.encryptedSecret) {
    res.status(400).json({ error: "TOTP not enrolled" });
    return;
  }

  const totpSecret = decryptTotp(enrollment.encryptedSecret);
  const result = verifySync({ token: code.replace(/\s/g, ""), secret: totpSecret, epochTolerance: 30 });
  if (!result.valid) {
    res.status(401).json({ error: "Invalid code. Please try again." });
    return;
  }

  return issueFullSession(userId, res, req, "totp");
});

router.delete("/auth/mfa/totp", requireAuth, async (req: Request, res: Response) => {
  const user = req.user!;
  await unenrollMfaMethod(user.id, "totp");
  res.json({ ok: true });
});

// ── SMS OTP Setup ─────────────────────────────────────────────────────────────

router.post("/auth/mfa/sms/setup", requireAuth, mfaLimiter, async (req: Request, res: Response) => {
  const user = req.user!;
  if (rejectIfAdmin(req, res)) return;
  const { phone } = req.body as { phone?: string };

  if (!phone) {
    res.status(400).json({ error: "phone is required" });
    return;
  }

  const phoneClean = phone.replace(/\s/g, "");

  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const codeHash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  await db.delete(mfaChallengesTable).where(
    and(eq(mfaChallengesTable.userId, user.id), eq(mfaChallengesTable.method, "sms"))
  );

  await db.insert(mfaChallengesTable).values({
    userId: user.id,
    method: "sms",
    codeHash,
    phone: phoneClean,
    expiresAt,
  });

  await sendSmsOtp(phoneClean, code);

  res.json({ ok: true, phoneLast4: phoneClean.slice(-4) });
});

router.post("/auth/mfa/sms/verify-setup", requireAuth, mfaLimiter, async (req: Request, res: Response) => {
  const user = req.user!;
  if (rejectIfAdmin(req, res)) return;
  const { phone, code } = req.body as { phone?: string; code?: string };

  if (!phone || !code) {
    res.status(400).json({ error: "phone and code are required" });
    return;
  }

  const phoneClean = phone.replace(/\s/g, "");

  // Verify code AND that the submitted phone matches the one the OTP was sent to
  const [challenge] = await db
    .select()
    .from(mfaChallengesTable)
    .where(
      and(
        eq(mfaChallengesTable.userId, user.id),
        eq(mfaChallengesTable.method, "sms"),
        gt(mfaChallengesTable.expiresAt, new Date()),
      )
    )
    .limit(1);

  if (!challenge?.codeHash || challenge.usedAt || challenge.phone !== phoneClean) {
    res.status(400).json({ error: "Invalid or expired code" });
    return;
  }

  const codeValid = await bcrypt.compare(code, challenge.codeHash);
  if (!codeValid) {
    res.status(400).json({ error: "Invalid or expired code" });
    return;
  }

  await db.update(mfaChallengesTable).set({ usedAt: new Date() }).where(eq(mfaChallengesTable.id, challenge.id));

  await db.delete(mfaEnrollmentsTable).where(
    and(eq(mfaEnrollmentsTable.userId, user.id), eq(mfaEnrollmentsTable.method, "sms"))
  );

  await db.insert(mfaEnrollmentsTable).values({
    userId: user.id,
    method: "sms",
    enabled: true,
    phone: phone.replace(/\s/g, ""),
  });

  res.json({ ok: true });
});

router.post("/auth/mfa/sms/challenge", mfaLimiter, async (req: Request, res: Response) => {
  const { mfaToken } = req.body as { mfaToken?: string };

  if (!mfaToken) {
    res.status(400).json({ error: "mfaToken is required" });
    return;
  }

  let userId: number;
  try {
    ({ userId } = verifyMfaToken(mfaToken));
  } catch {
    res.status(401).json({ error: "Invalid or expired MFA session" });
    return;
  }

  const [enrollment] = await db
    .select()
    .from(mfaEnrollmentsTable)
    .where(and(eq(mfaEnrollmentsTable.userId, userId), eq(mfaEnrollmentsTable.method, "sms"), eq(mfaEnrollmentsTable.enabled, true)))
    .limit(1);

  if (!enrollment?.phone) {
    res.status(400).json({ error: "SMS not enrolled" });
    return;
  }

  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const codeHash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  await db.delete(mfaChallengesTable).where(
    and(eq(mfaChallengesTable.userId, userId), eq(mfaChallengesTable.method, "sms"))
  );

  await db.insert(mfaChallengesTable).values({
    userId,
    method: "sms",
    codeHash,
    expiresAt,
  });

  await sendSmsOtp(enrollment.phone, code);

  res.json({ ok: true, phoneLast4: enrollment.phone.slice(-4) });
});

router.post("/auth/mfa/sms/verify", mfaLimiter, async (req: Request, res: Response) => {
  const { mfaToken, code } = req.body as { mfaToken?: string; code?: string };

  if (!mfaToken || !code) {
    res.status(400).json({ error: "mfaToken and code are required" });
    return;
  }

  let userId: number;
  try {
    ({ userId } = verifyMfaToken(mfaToken));
  } catch {
    res.status(401).json({ error: "Invalid or expired MFA session" });
    return;
  }

  const valid = await verifySmsCode(userId, code);
  if (!valid) {
    res.status(401).json({ error: "Invalid or expired code" });
    return;
  }

  return issueFullSession(userId, res, req, "sms");
});

router.delete("/auth/mfa/sms", requireAuth, async (req: Request, res: Response) => {
  const user = req.user!;
  await unenrollMfaMethod(user.id, "sms");
  res.json({ ok: true });
});

// ── Passkey / WebAuthn ────────────────────────────────────────────────────────

router.post("/auth/mfa/passkey/registration-options", requireAuth, async (req: Request, res: Response) => {
  const user = req.user!;

  const { generateRegistrationOptions } = await import("@simplewebauthn/server");

  const existingCredentials = await db
    .select()
    .from(webauthnCredentialsTable)
    .where(eq(webauthnCredentialsTable.userId, user.id));

  const options = await generateRegistrationOptions({
    rpName: "Shane McCaw Consulting",
    rpID: getRpId(),
    userName: user.email,
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
    and(eq(webauthnChallengesTable.userId, user.id), eq(webauthnChallengesTable.purpose, "registration"))
  );

  await db.insert(webauthnChallengesTable).values({
    userId: user.id,
    challenge: options.challenge,
    purpose: "registration",
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
  });

  res.json(options);
});

router.post("/auth/mfa/passkey/verify-registration", requireAuth, async (req: Request, res: Response) => {
  const user = req.user!;
  const body = req.body;

  const [challengeRow] = await db
    .select()
    .from(webauthnChallengesTable)
    .where(
      and(
        eq(webauthnChallengesTable.userId, user.id),
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
    const verification = await verifyRegistrationResponse({
      response: body,
      expectedChallenge: challengeRow.challenge,
      expectedOrigin: getRpOrigin(),
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
      userId: user.id,
      credentialId: credential.id,
      publicKey: publicKeyBase64,
      counter: credential.counter,
      deviceType: verification.registrationInfo.credentialDeviceType,
      backedUp: verification.registrationInfo.credentialBackedUp,
      transports: body.response?.transports ?? [],
    });

    await db.delete(webauthnChallengesTable).where(eq(webauthnChallengesTable.id, challengeRow.id));

    await db.delete(mfaEnrollmentsTable).where(
      and(eq(mfaEnrollmentsTable.userId, user.id), eq(mfaEnrollmentsTable.method, "passkey"))
    );
    await db.insert(mfaEnrollmentsTable).values({
      userId: user.id,
      method: "passkey",
      enabled: true,
    });

    res.json({ ok: true });
  } catch (err) {
    log.error({ err }, "Passkey registration error");
    res.status(400).json({ error: "Registration failed" });
  }
});

router.post("/auth/mfa/passkey/authentication-options", mfaLimiter, async (req: Request, res: Response) => {
  const { mfaToken } = req.body as { mfaToken?: string };

  if (!mfaToken) {
    res.status(400).json({ error: "mfaToken is required" });
    return;
  }

  let userId: number;
  try {
    ({ userId } = verifyMfaToken(mfaToken));
  } catch {
    res.status(401).json({ error: "Invalid or expired MFA session" });
    return;
  }

  const credentials = await db
    .select()
    .from(webauthnCredentialsTable)
    .where(eq(webauthnCredentialsTable.userId, userId));

  if (credentials.length === 0) {
    res.status(400).json({ error: "No passkeys enrolled" });
    return;
  }

  const { generateAuthenticationOptions } = await import("@simplewebauthn/server");

  const options = await generateAuthenticationOptions({
    rpID: getRpId(),
    userVerification: "preferred",
    allowCredentials: credentials.map(c => ({
      id: c.credentialId,
      transports: (c.transports as AuthenticatorTransport[] | undefined) ?? [],
    })),
  });

  await db.delete(webauthnChallengesTable).where(
    and(eq(webauthnChallengesTable.userId, userId), eq(webauthnChallengesTable.purpose, "authentication"))
  );

  await db.insert(webauthnChallengesTable).values({
    userId,
    challenge: options.challenge,
    purpose: "authentication",
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
  });

  res.json(options);
});

router.post("/auth/mfa/passkey/verify-authentication", mfaLimiter, async (req: Request, res: Response) => {
  const { mfaToken, ...body } = req.body as { mfaToken?: string; [key: string]: unknown };

  if (!mfaToken) {
    res.status(400).json({ error: "mfaToken is required" });
    return;
  }

  let userId: number;
  try {
    ({ userId } = verifyMfaToken(mfaToken));
  } catch {
    res.status(401).json({ error: "Invalid or expired MFA session" });
    return;
  }

  const [challengeRow] = await db
    .select()
    .from(webauthnChallengesTable)
    .where(
      and(
        eq(webauthnChallengesTable.userId, userId),
        eq(webauthnChallengesTable.purpose, "authentication"),
        gt(webauthnChallengesTable.expiresAt, new Date()),
      )
    )
    .limit(1);

  if (!challengeRow) {
    res.status(400).json({ error: "No pending authentication challenge" });
    return;
  }

  const credId = typeof body.id === "string" ? body.id : "";
  const [credential] = await db
    .select()
    .from(webauthnCredentialsTable)
    .where(
      and(
        eq(webauthnCredentialsTable.credentialId, credId),
        eq(webauthnCredentialsTable.userId, userId),
      )
    )
    .limit(1);

  if (!credential) {
    res.status(400).json({ error: "Credential not found" });
    return;
  }

  try {
    const { verifyAuthenticationResponse } = await import("@simplewebauthn/server");
    const verification = await verifyAuthenticationResponse({
      response: body as unknown as Parameters<typeof verifyAuthenticationResponse>[0]["response"],
      expectedChallenge: challengeRow.challenge,
      expectedOrigin: getRpOrigin(),
      expectedRPID: getRpId(),
      credential: {
        id: credential.credentialId,
        publicKey: Buffer.from(credential.publicKey, "base64url"),
        counter: credential.counter,
        transports: (credential.transports as AuthenticatorTransport[] | undefined) ?? [],
      },
    });

    if (!verification.verified) {
      res.status(401).json({ error: "Authentication failed" });
      return;
    }

    await db
      .update(webauthnCredentialsTable)
      .set({ counter: verification.authenticationInfo.newCounter })
      .where(eq(webauthnCredentialsTable.id, credential.id));

    await db.delete(webauthnChallengesTable).where(eq(webauthnChallengesTable.id, challengeRow.id));

    return issueFullSession(userId, res, req, "passkey");
  } catch (err) {
    log.error({ err }, "Passkey authentication error");
    res.status(400).json({ error: "Authentication failed" });
  }
});

router.delete("/auth/mfa/passkey", requireAuth, async (req: Request, res: Response) => {
  const user = req.user!;
  await unenrollMfaMethod(user.id, "passkey");
  res.json({ ok: true });
});

// ── GET /api/auth/mfa/passkey/registration-options (admin, no mfaToken needed) ─
router.post("/auth/mfa/passkey/admin-registration-options", requireAuth, async (req: Request, res: Response) => {
  const user = req.user!;
  if (user.role !== "admin") {
    res.status(403).json({ error: "Admin only" });
    return;
  }

  const { generateRegistrationOptions } = await import("@simplewebauthn/server");

  const existingCredentials = await db
    .select()
    .from(webauthnCredentialsTable)
    .where(eq(webauthnCredentialsTable.userId, user.id));

  const options = await generateRegistrationOptions({
    rpName: "Shane McCaw Consulting",
    rpID: getRpId(),
    userName: user.email,
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
    and(eq(webauthnChallengesTable.userId, user.id), eq(webauthnChallengesTable.purpose, "registration"))
  );

  await db.insert(webauthnChallengesTable).values({
    userId: user.id,
    challenge: options.challenge,
    purpose: "registration",
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
  });

  res.json(options);
});

// ── Admin Passkey login flow ───────────────────────────────────────────────────
// After password, check if admin has passkeys → return auth options or skip.
router.post("/auth/mfa/passkey/admin-authentication-options", mfaLimiter, async (req: Request, res: Response) => {
  const { mfaToken } = req.body as { mfaToken?: string };

  if (!mfaToken) {
    res.status(400).json({ error: "mfaToken is required" });
    return;
  }

  let userId: number;
  try {
    ({ userId } = verifyMfaToken(mfaToken));
  } catch {
    res.status(401).json({ error: "Invalid or expired MFA session" });
    return;
  }

  const credentials = await db
    .select()
    .from(webauthnCredentialsTable)
    .where(eq(webauthnCredentialsTable.userId, userId));

  if (credentials.length === 0) {
    res.status(400).json({ error: "No passkeys enrolled" });
    return;
  }

  const { generateAuthenticationOptions } = await import("@simplewebauthn/server");

  const options = await generateAuthenticationOptions({
    rpID: getRpId(),
    userVerification: "preferred",
    allowCredentials: credentials.map(c => ({
      id: c.credentialId,
      transports: (c.transports as AuthenticatorTransport[] | undefined) ?? [],
    })),
  });

  await db.delete(webauthnChallengesTable).where(
    and(eq(webauthnChallengesTable.userId, userId), eq(webauthnChallengesTable.purpose, "authentication"))
  );

  await db.insert(webauthnChallengesTable).values({
    userId,
    challenge: options.challenge,
    purpose: "authentication",
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
  });

  res.json(options);
});

// ── Unified verify endpoint ───────────────────────────────────────────────────
// POST /api/auth/mfa/verify — handles totp and sms in one endpoint
router.post("/auth/mfa/verify", mfaLimiter, async (req: Request, res: Response) => {
  const { mfaToken, method, code } = req.body as { mfaToken?: string; method?: string; code?: string };

  if (!mfaToken || !method || !code) {
    res.status(400).json({ error: "mfaToken, method, and code are required" });
    return;
  }

  let userId: number;
  try {
    ({ userId } = verifyMfaToken(mfaToken));
  } catch {
    res.status(401).json({ error: "Invalid or expired MFA session" });
    return;
  }

  // Admins must complete MFA via passkey, not TOTP or SMS
  if (method === "totp" || method === "sms") {
    const [user] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (user?.role === "admin") {
      res.status(403).json({ error: "Admins must use passkey authentication only" });
      return;
    }
  }

  if (method === "totp") {
    const [enrollment] = await db
      .select()
      .from(mfaEnrollmentsTable)
      .where(and(eq(mfaEnrollmentsTable.userId, userId), eq(mfaEnrollmentsTable.method, "totp"), eq(mfaEnrollmentsTable.enabled, true)))
      .limit(1);

    if (!enrollment?.encryptedSecret) {
      res.status(400).json({ error: "TOTP not enrolled" });
      return;
    }

    const totpSecret = decryptTotp(enrollment.encryptedSecret);
    const totpResult = verifySync({ token: code.replace(/\s/g, ""), secret: totpSecret, epochTolerance: 30 });
    const valid = totpResult.valid;
    if (!valid) {
      res.status(401).json({ error: "Invalid code. Please try again." });
      return;
    }
    return issueFullSession(userId, res, req, "totp");
  }

  if (method === "sms") {
    const valid = await verifySmsCode(userId, code);
    if (!valid) {
      res.status(401).json({ error: "Invalid or expired code" });
      return;
    }
    return issueFullSession(userId, res, req, "sms");
  }

  res.status(400).json({ error: `Unsupported method: ${method}` });
});

// ── Emergency MFA bypass ──────────────────────────────────────────────────────
// POST /api/auth/mfa/bypass — consume a real, single-use emergency bypass code
// (issued by an MSP admin via POST /portal/team/:userId/emergency-bypass) in
// place of a normal MFA challenge. Reaches this endpoint only AFTER the password
// step succeeded: the caller must present a valid mfaToken (signed by /auth/login
// once the password verified), so this is the "check before issuing tokens"
// pattern already proven for TOTP/SMS/passkey verification — never a way to skip
// the password. A valid, unexpired, unused code grants exactly ONE sign-in and is
// immediately invalidated (usedAt is set atomically, so a concurrent or repeat
// attempt with the same code fails). Normal MFA-enrolled logins are unaffected —
// this endpoint is only hit when the user explicitly chooses the bypass path.
router.post("/auth/mfa/bypass", mfaLimiter, async (req: Request, res: Response) => {
  const { mfaToken, code } = req.body as { mfaToken?: string; code?: string };

  if (!mfaToken || !code) {
    res.status(400).json({ error: "mfaToken and code are required" });
    return;
  }

  let userId: number;
  try {
    ({ userId } = verifyMfaToken(mfaToken));
  } catch {
    res.status(401).json({ error: "Invalid or expired MFA session" });
    return;
  }

  // Normalize to match how the code was stored (uppercased at generation).
  const normalized = code.trim().toUpperCase();

  const [bypass] = await db
    .select()
    .from(mfaBypassCodesTable)
    .where(
      and(
        eq(mfaBypassCodesTable.userId, userId),
        isNull(mfaBypassCodesTable.usedAt),
        gt(mfaBypassCodesTable.expiresAt, new Date()),
      ),
    )
    .limit(1);

  if (!bypass) {
    res.status(401).json({ error: "Invalid or expired bypass code" });
    return;
  }

  const valid = await bcrypt.compare(normalized, bypass.codeHash);
  if (!valid) {
    res.status(401).json({ error: "Invalid or expired bypass code" });
    return;
  }

  const ipAddress = (req.ip ?? req.socket?.remoteAddress) ?? null;
  const userAgent = (req.headers["user-agent"] as string | undefined) ?? null;

  // Single-use: flip usedAt to now ONLY if it is still null. The conditional
  // update makes consumption atomic, so two concurrent requests presenting the
  // same code can never both succeed — exactly one wins the transition.
  const consumed = await db
    .update(mfaBypassCodesTable)
    .set({ usedAt: new Date(), usedIp: ipAddress, usedUserAgent: userAgent })
    .where(and(eq(mfaBypassCodesTable.id, bypass.id), isNull(mfaBypassCodesTable.usedAt)))
    .returning({ id: mfaBypassCodesTable.id });

  if (consumed.length === 0) {
    res.status(401).json({ error: "Invalid or expired bypass code" });
    return;
  }

  // Audit the use as a security-sensitive event so an MSPAdmin can see when a
  // bypass code was consumed and from where.
  const [target] = await db
    .select({ email: usersTable.email, name: usersTable.name })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  void createAuditLog({
    actorUserId: userId,
    actorName: target?.name ?? target?.email ?? `user:${userId}`,
    actorRole: "client",
    actionType: "team_member_emergency_bypass_used",
    entityType: "user",
    entityId: userId,
    entityLabel: target?.name ?? target?.email ?? null,
    metadata: { ip: ipAddress, generatedBy: bypass.createdByUserId ?? null },
  });

  return issueFullSession(userId, res, req, "bypass");
});

// POST /api/auth/mfa/sms/send — send SMS code during login MFA flow
router.post("/auth/mfa/sms/send", mfaLimiter, async (req: Request, res: Response) => {
  const { mfaToken } = req.body as { mfaToken?: string };

  if (!mfaToken) {
    res.status(400).json({ error: "mfaToken is required" });
    return;
  }

  let userId: number;
  try {
    ({ userId } = verifyMfaToken(mfaToken));
  } catch {
    res.status(401).json({ error: "Invalid or expired MFA session" });
    return;
  }

  const [enrollment] = await db
    .select()
    .from(mfaEnrollmentsTable)
    .where(and(eq(mfaEnrollmentsTable.userId, userId), eq(mfaEnrollmentsTable.method, "sms"), eq(mfaEnrollmentsTable.enabled, true)))
    .limit(1);

  if (!enrollment?.phone) {
    res.status(400).json({ error: "SMS not enrolled" });
    return;
  }

  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const codeHash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  await db.delete(mfaChallengesTable).where(
    and(eq(mfaChallengesTable.userId, userId), eq(mfaChallengesTable.method, "sms"))
  );
  await db.insert(mfaChallengesTable).values({ userId, method: "sms", codeHash, expiresAt });

  await sendSmsOtp(enrollment.phone, code);

  res.json({ ok: true, phoneLast4: enrollment.phone.slice(-4) });
});

// ── Helpers ───────────────────────────────────────────────────────────────────

async function sendSmsOtp(phone: string, code: string): Promise<void> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;

  if (!accountSid || !authToken || !from) {
    log.warn({ code }, "Twilio not configured — OTP code not sent (dev mode)");
    return;
  }

  try {
    const { default: twilio } = await import("twilio");
    const client = twilio(accountSid, authToken);
    await client.messages.create({
      body: `Your Shane McCaw Consulting verification code is: ${code}. Valid for 10 minutes.`,
      from,
      to: phone,
    });
  } catch (err) {
    log.error({ err }, "Failed to send OTP via Twilio");
    throw new Error("Failed to send SMS. Please check your phone number.");
  }
}

async function verifySmsCode(userId: number, code: string): Promise<boolean> {
  const [challenge] = await db
    .select()
    .from(mfaChallengesTable)
    .where(
      and(
        eq(mfaChallengesTable.userId, userId),
        eq(mfaChallengesTable.method, "sms"),
        gt(mfaChallengesTable.expiresAt, new Date()),
      )
    )
    .limit(1);

  if (!challenge?.codeHash || challenge.usedAt) return false;

  const valid = await bcrypt.compare(code, challenge.codeHash);
  if (!valid) return false;

  await db
    .update(mfaChallengesTable)
    .set({ usedAt: new Date() })
    .where(eq(mfaChallengesTable.id, challenge.id));

  return true;
}

async function getMspClaimsForUser(userId: number): Promise<{
  mspRole: import("@workspace/db").MspRole | null;
  mspId: number | null;
  customerId: number | null;
}> {
  // Same shape auth.ts's getMspClaims() reads post-refactor: one users row,
  // no bridge. `customerId` stays the claim name while carrying users.tenantId
  // — the JWT wire format was deliberately frozen in Phase 1.
  const [mspUser] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  if (!mspUser) return { mspRole: null, mspId: null, customerId: null };
  return {
    mspRole: mspUser.mspRole as import("@workspace/db").MspRole,
    mspId: mspUser.mspId ?? null,
    customerId: mspUser.tenantId ?? null,
  };
}

async function issueFullSession(userId: number, res: Response, req: Request, loginMethod: LoginMethod): Promise<void> {
  const secret = getJwtSecret();
  const REFRESH_TOKEN_TTL_DAYS = 7;

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  // Include MSP role claims in the token so the MSP Portal auth works correctly
  const mspClaims = await getMspClaimsForUser(userId);
  const basePayload = buildUserPayload(user);
  const payload = {
    ...basePayload,
    mspRole: mspClaims.mspRole ?? undefined,
    mspId: mspClaims.mspId ?? undefined,
    customerId: mspClaims.customerId ?? undefined,
  };

  const accessToken = jwt.sign(payload, secret, { expiresIn: "15m" });

  // Issue a proper sliding refresh token stored in DB (matching the auth.ts pattern)
  const rawRefreshToken = randomBytes(48).toString("hex");
  const tokenHash = createHash("sha256").update(rawRefreshToken).digest("hex");
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
  const userAgent = (req.headers["user-agent"] as string | undefined) ?? null;
  const ipAddress = (req.ip ?? req.socket?.remoteAddress) ?? null;

  await db.insert(mspRefreshTokensTable).values({
    userId,
    tokenHash,
    expiresAt,
    userAgent,
    ipAddress,
  });

  void createSession({
    userId,
    sessionType: "standard",
    loginMethod,
    tokenHash,
    userAgent,
    ipAddress,
    expiresAt,
  });

  res.cookie("refreshToken", rawRefreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
    path: "/api/auth",
  });

  res.json({
    accessToken,
    refreshToken: rawRefreshToken,
    refreshExpiresAt: expiresAt.toISOString(),
    user: payload,
  });
}

export default router;
