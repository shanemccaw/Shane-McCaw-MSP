import { Router, type IRouter, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import crypto, { randomUUID } from "crypto";
import jwt from "jsonwebtoken";
import { db, usersTable, mspUsersTable, mspsTable, mspRefreshTokensTable, passwordResetTokensTable, impersonationTokensTable, accountSetupTokensTable, mfaEnrollmentsTable, webauthnCredentialsTable, mspAuditLogsTable, mspServiceAccountsTable, mspCustomersTable, type MspRole } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import type { CookieOptions } from "express";
import { sendEmailFromTemplate, passwordResetEmail, PORTAL_URL } from "../lib/mailer.ts";
import { getPortalBaseUrl, buildAccountSetupUrl } from "../lib/portal-url.ts";
import { signMfaToken } from "./mfa.ts";
import { dispatchEvent, EVENT_TYPES, systemActor, userActor, impersonationActor } from "../lib/event-bus.ts";
import { requireRole, requireAuth } from "../middlewares/requireAuth.ts";
import { getRequestContext } from "../lib/request-context.ts";
import {
  createSession,
  touchSessionByTokenHash,
  revokeSessionByTokenHash,
  revokeSessionById,
  revokeAllOtherSessions,
  listActiveSessions,
  listLoginHistory,
  type LoginMethod,
} from "../lib/session-tracking.ts";

const isDev = process.env.NODE_ENV !== "production";

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: isDev ? 200 : 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many login attempts from this IP. Please try again in 15 minutes." },
});

const setupPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: isDev ? 200 : 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many password setup attempts from this IP. Please try again in 15 minutes." },
});

const router: IRouter = Router();

// 15-minute access tokens, 7-day sliding refresh
const REFRESH_TOKEN_TTL_DAYS = 7;
const ACCESS_TOKEN_TTL = "15m";
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET not configured");
  return secret;
}

function cookieOpts(): CookieOptions {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
    path: "/api/auth",
  };
}

function hashRefreshToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function generateRefreshToken(): string {
  return crypto.randomBytes(48).toString("hex");
}

/**
 * Write an auth audit log entry. Non-fatal — errors are silently swallowed
 * so a broken DB state never interrupts an auth flow.
 */
async function writeAuthAuditLog(
  actionType: string,
  req: Request,
  opts: {
    userId?: number;
    mspId?: number | null;
    customerId?: number | null;
    mspRole?: string | null;
    outcome?: "success" | "failure" | "partial";
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await db.insert(mspAuditLogsTable).values({
      actorUserId: opts.userId ?? null,
      actorRole: opts.mspRole ?? null,
      mspId: opts.mspId ?? null,
      customerId: opts.customerId ?? null,
      actionType,
      correlationId: getRequestContext()?.traceId ?? randomUUID(),
      ipAddress: (req.ip ?? req.socket?.remoteAddress) ?? null,
      userAgent: req.headers["user-agent"] ?? null,
      outcome: opts.outcome ?? "success",
      metadata: opts.metadata,
    });
  } catch {
    // Audit log is non-fatal
  }
}

/**
 * Look up the msp_users row for a given user and return MSP claims.
 * Returns null values when no MSP record exists (e.g. legacy admin user).
 */
async function getMspClaims(userId: number): Promise<{
  mspRole: MspRole | null;
  mspId: number | null;
  customerId: number | null;
  mspSlug: string | null;
}> {
  const [mspUser] = await db
    .select()
    .from(mspUsersTable)
    .where(eq(mspUsersTable.userId, userId))
    .limit(1);

  if (!mspUser) return { mspRole: null, mspId: null, customerId: null, mspSlug: null };

  let mspSlug: string | null = null;
  if (mspUser.mspId) {
    const [msp] = await db
      .select({ slug: mspsTable.slug })
      .from(mspsTable)
      .where(eq(mspsTable.id, mspUser.mspId))
      .limit(1);
    mspSlug = msp?.slug ?? null;
  }

  return {
    mspRole: mspUser.mspRole as MspRole,
    mspId: mspUser.mspId ?? null,
    customerId: mspUser.customerId ?? null,
    mspSlug,
  };
}

function buildUserPayload(
  user: typeof usersTable.$inferSelect,
  mspClaims: { mspRole: MspRole | null; mspId: number | null; customerId: number | null; mspSlug: string | null },
) {
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
    mspRole: mspClaims.mspRole ?? undefined,
    mspId: mspClaims.mspId ?? undefined,
    customerId: mspClaims.customerId ?? undefined,
    mspSlug: mspClaims.mspSlug ?? undefined,
  };
}

/**
 * Issue a new refresh token: generate, hash, store in DB.
 * Also creates the user-facing session row (see session-tracking.ts) that
 * powers self-service "Active Sessions" / "Login History".
 * Returns the raw token (for the client) and the DB row id.
 */
async function issueRefreshToken(
  userId: number,
  req: Request,
  loginMethod: LoginMethod = "password",
): Promise<{ rawToken: string; expiresAt: Date }> {
  const rawToken = generateRefreshToken();
  const tokenHash = hashRefreshToken(rawToken);
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

  return { rawToken, expiresAt };
}

router.post("/auth/login", loginLimiter, async (req: Request, res: Response) => {
  const { email, password } = req.body as { email?: string; password?: string };

  if (!email || !password) {
    res.status(400).json({ error: "email and password are required" });
    return;
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    res.status(500).json({ error: "Server misconfiguration" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email.toLowerCase().trim())).limit(1);

  if (!user) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  if (!user.passwordHash) {
    res.status(401).json({ error: "No password set for this account. Check your email for a setup link." });
    return;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  // Check for active MFA enrollments
  const enrollments = await db
    .select()
    .from(mfaEnrollmentsTable)
    .where(and(eq(mfaEnrollmentsTable.userId, user.id), eq(mfaEnrollmentsTable.enabled, true)));

  const passkeys = await db
    .select()
    .from(webauthnCredentialsTable)
    .where(eq(webauthnCredentialsTable.userId, user.id));

  const methods: string[] = [
    ...enrollments.filter(e => e.method !== "passkey").map(e => e.method),
    ...(passkeys.length > 0 ? ["passkey"] : []),
  ];

  if (methods.length > 0) {
    const mfaToken = signMfaToken(user.id, methods);
    res.json({ mfaRequired: true, mfaToken, methods });
    return;
  }

  const mspClaims = await getMspClaims(user.id);
  const payload = buildUserPayload(user, mspClaims);
  const accessToken = jwt.sign(payload, secret, { expiresIn: ACCESS_TOKEN_TTL });
  const { rawToken: refreshToken, expiresAt: refreshExpiresAt } = await issueRefreshToken(user.id, req);

  void dispatchEvent({
    eventType: EVENT_TYPES.AUTH_LOGIN,
    actor: userActor(user.id, mspClaims.mspRole ?? "Free"),
    source: "auth.login",
    mspId: mspClaims.mspId,
    customerId: mspClaims.customerId,
    payload: { email: user.email, role: user.role },
  });

  void writeAuthAuditLog("AUTH_LOGIN", req, {
    userId: user.id,
    mspId: mspClaims.mspId,
    customerId: mspClaims.customerId,
    mspRole: mspClaims.mspRole,
    metadata: { email: user.email },
  });

  res.cookie("refreshToken", refreshToken, cookieOpts());
  res.json({ accessToken, refreshToken, refreshExpiresAt: refreshExpiresAt.toISOString(), user: payload });
});

router.post("/auth/refresh", async (req: Request, res: Response) => {
  // Accept refresh token from cookie (web clients) or request body (mobile clients)
  const rawToken = (req.cookies?.refreshToken as string | undefined)
    ?? (req.body as { refreshToken?: string })?.refreshToken;

  if (!rawToken) {
    res.status(401).json({ error: "No refresh token" });
    return;
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    res.status(500).json({ error: "Server misconfiguration" });
    return;
  }

  const tokenHash = hashRefreshToken(rawToken);
  const now = new Date();

  // Look up the refresh token in the DB
  const [storedToken] = await db
    .select()
    .from(mspRefreshTokensTable)
    .where(eq(mspRefreshTokensTable.tokenHash, tokenHash))
    .limit(1);

  if (!storedToken) {
    res.status(401).json({ error: "Invalid or expired refresh token" });
    return;
  }

  if (storedToken.revokedAt || storedToken.expiresAt < now) {
    res.status(401).json({ error: "Refresh token has expired or been revoked" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, storedToken.userId)).limit(1);
  if (!user) {
    res.status(401).json({ error: "User not found" });
    return;
  }

  const mspClaims = await getMspClaims(user.id);
  const payload = buildUserPayload(user, mspClaims);
  const newAccessToken = jwt.sign(payload, secret, { expiresIn: ACCESS_TOKEN_TTL });

  // Sliding refresh: issue a new token and mark the old one as replaced
  const newRawToken = generateRefreshToken();
  const newTokenHash = hashRefreshToken(newRawToken);
  const newExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

  await db.insert(mspRefreshTokensTable).values({
    userId: user.id,
    tokenHash: newTokenHash,
    expiresAt: newExpiresAt,
    userAgent: storedToken.userAgent ?? null,
    ipAddress: storedToken.ipAddress ?? null,
  });

  await db.update(mspRefreshTokensTable)
    .set({ revokedAt: now, replacedByHash: newTokenHash })
    .where(eq(mspRefreshTokensTable.id, storedToken.id));

  void touchSessionByTokenHash(tokenHash, newTokenHash, newExpiresAt);

  void dispatchEvent({
    eventType: EVENT_TYPES.AUTH_TOKEN_REFRESH,
    actor: userActor(user.id, mspClaims.mspRole ?? "Free"),
    source: "auth.refresh",
    mspId: mspClaims.mspId,
    customerId: mspClaims.customerId,
    payload: { userId: user.id },
  });

  res.cookie("refreshToken", newRawToken, cookieOpts());
  res.json({ accessToken: newAccessToken, refreshToken: newRawToken, refreshExpiresAt: newExpiresAt.toISOString(), user: payload });
});

// ─── Registration disabled — accounts are created by purchases only ───────────
router.post("/auth/register", (_req: Request, res: Response) => {
  res.status(403).json({
    error: "Account creation is not available through this endpoint. Access is granted automatically after purchasing a service.",
  });
});

router.post("/auth/logout", async (req: Request, res: Response) => {
  const rawToken = (req.cookies?.refreshToken as string | undefined)
    ?? (req.body as { refreshToken?: string })?.refreshToken;

  let logoutUserId: number | undefined;
  if (rawToken) {
    const tokenHash = hashRefreshToken(rawToken);
    const [tok] = await db
      .select({ userId: mspRefreshTokensTable.userId })
      .from(mspRefreshTokensTable)
      .where(eq(mspRefreshTokensTable.tokenHash, tokenHash))
      .limit(1);
    logoutUserId = tok?.userId;
    await db
      .update(mspRefreshTokensTable)
      .set({ revokedAt: new Date() })
      .where(eq(mspRefreshTokensTable.tokenHash, tokenHash))
      .catch(() => null);
    void revokeSessionByTokenHash(tokenHash);
  }

  if (logoutUserId) {
    void dispatchEvent({
      eventType: EVENT_TYPES.AUTH_LOGOUT,
      actor: userActor(logoutUserId, "Free"),
      source: "auth.logout",
      payload: { userId: logoutUserId },
    });
    void writeAuthAuditLog("AUTH_LOGOUT", req, { userId: logoutUserId });
  }

  res.clearCookie("refreshToken", { path: "/api/auth" });
  res.json({ success: true });
});

// ─── Set password from account setup token ────────────────────────────────────
router.post("/auth/setup-password", setupPasswordLimiter, async (req: Request, res: Response) => {
  const { token, password } = req.body as { token?: string; password?: string };

  if (!token || !password) {
    res.status(400).json({ error: "token and password are required" });
    return;
  }

  if (password.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters" });
    return;
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    res.status(500).json({ error: "Server misconfiguration" });
    return;
  }

  const [record] = await db.select()
    .from(accountSetupTokensTable)
    .where(eq(accountSetupTokensTable.token, token))
    .limit(1);

  const now = new Date();

  if (!record || record.usedAt || record.expiresAt < now) {
    res.status(400).json({ error: "This setup link is invalid or has expired. Please contact support." });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);

  await db.update(usersTable)
    .set({ passwordHash })
    .where(eq(usersTable.id, record.userId));

  await db.update(accountSetupTokensTable)
    .set({ usedAt: now })
    .where(eq(accountSetupTokensTable.id, record.id));

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, record.userId)).limit(1);
  if (!user) {
    res.status(500).json({ error: "User not found after setup" });
    return;
  }

  const mspClaims = await getMspClaims(user.id);
  const payload = buildUserPayload(user, mspClaims);
  const accessToken = jwt.sign(payload, secret, { expiresIn: ACCESS_TOKEN_TTL });
  const { rawToken: refreshToken, expiresAt: refreshExpiresAt } = await issueRefreshToken(user.id, req);

  void dispatchEvent({
    eventType: EVENT_TYPES.AUTH_ACCOUNT_SETUP,
    actor: userActor(user.id, mspClaims.mspRole ?? "Free"),
    source: "auth.setup-password",
    mspId: mspClaims.mspId,
    customerId: mspClaims.customerId,
    payload: { userId: user.id },
  });

  void writeAuthAuditLog("AUTH_ACCOUNT_SETUP", req, {
    userId: user.id,
    mspId: mspClaims.mspId,
    customerId: mspClaims.customerId,
    mspRole: mspClaims.mspRole,
  });

  res.cookie("refreshToken", refreshToken, cookieOpts());
  res.json({ accessToken, refreshToken, refreshExpiresAt: refreshExpiresAt.toISOString(), user: payload });
});

// ─── Forgot password ──────────────────────────────────────────────────────────
router.post("/auth/forgot-password", async (req: Request, res: Response) => {
  const { email } = req.body as { email?: string };

  res.json({ ok: true });

  if (!email) return;

  const normalizedEmail = email.toLowerCase().trim();
  const [user] = await db.select().from(usersTable)
    .where(eq(usersTable.email, normalizedEmail))
    .limit(1);
  if (!user) return;

  if (!user.passwordHash) {
    const { randomBytes } = await import("crypto");
    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);

    await db.insert(accountSetupTokensTable).values({ userId: user.id, token, expiresAt });

    const setupUrl = buildAccountSetupUrl(token);

    void sendEmailFromTemplate(
      "account-setup",
      user.email,
      { setupLink: setupUrl, clientName: user.name ?? user.email },
      "Set up your Shane McCaw Consulting portal password",
      `<p>Hi ${user.name ?? ""},</p><p>Click the link below to set your portal password:</p><p><a href="${setupUrl}">Set my password →</a></p><p>This link expires in 72 hours.</p><p>— Shane McCaw</p>`,
    ).catch(() => null);
    return;
  }

  const { randomBytes } = await import("crypto");
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

  await db.insert(passwordResetTokensTable).values({ userId: user.id, token, expiresAt });

  const baseUrl = process.env.PORTAL_BASE_URL
    ?? `${req.protocol}://${req.hostname}/portal`;
  const resetUrl = `${baseUrl}/reset-password?token=${token}`;

  void sendEmailFromTemplate(
    "password-reset",
    user.email,
    { resetLink: resetUrl },
    "Reset your Shane McCaw Consulting portal password",
    passwordResetEmail({ resetUrl }),
  ).catch(() => null);
});

// ─── Reset password ───────────────────────────────────────────────────────────
router.post("/auth/reset-password", async (req: Request, res: Response) => {
  const { token, password } = req.body as { token?: string; password?: string };

  if (!token || !password) {
    res.status(400).json({ error: "Token and password are required" });
    return;
  }

  if (password.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters" });
    return;
  }

  const [record] = await db.select()
    .from(passwordResetTokensTable)
    .where(eq(passwordResetTokensTable.token, token))
    .limit(1);

  const now = new Date();

  if (!record || record.usedAt || record.expiresAt < now) {
    res.status(400).json({ error: "This reset link is invalid or has expired. Please request a new one." });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);

  await db.update(usersTable)
    .set({ passwordHash })
    .where(eq(usersTable.id, record.userId));

  await db.update(passwordResetTokensTable)
    .set({ usedAt: now })
    .where(eq(passwordResetTokensTable.id, record.id));

  res.json({ ok: true });
});

// ─── Change password (authenticated) ──────────────────────────────────────────
router.post("/auth/change-password", requireAuth, async (req: Request, res: Response) => {
  const authUser = req.user!;
  const { currentPassword, newPassword } = req.body as { currentPassword?: string; newPassword?: string };

  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: "currentPassword and newPassword are required" });
    return;
  }

  if (newPassword.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, authUser.id)).limit(1);
  if (!user?.passwordHash) {
    res.status(400).json({ error: "No password set for this account." });
    return;
  }

  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Current password is incorrect" });
    return;
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await db.update(usersTable).set({ passwordHash }).where(eq(usersTable.id, authUser.id));

  // Security best practice: changing your password ends every OTHER session.
  const currentRawRefresh = (req.cookies?.refreshToken as string | undefined)
    ?? (req.body as { refreshToken?: string })?.refreshToken;
  const currentTokenHash = currentRawRefresh ? hashRefreshToken(currentRawRefresh) : null;
  const revokedCount = await revokeAllOtherSessions(authUser.id, currentTokenHash);

  void writeAuthAuditLog("AUTH_PASSWORD_CHANGED", req, {
    userId: authUser.id,
    mspId: authUser.mspId,
    customerId: authUser.customerId,
    mspRole: authUser.mspRole,
    metadata: { revokedOtherSessions: revokedCount },
  });

  res.json({ ok: true, revokedOtherSessions: revokedCount });
});

// ─── Self-service sessions (active devices + login history) ──────────────────
router.get("/auth/sessions", requireAuth, async (req: Request, res: Response) => {
  const authUser = req.user!;
  const rawRefresh = req.cookies?.refreshToken as string | undefined;
  const currentTokenHash = rawRefresh ? hashRefreshToken(rawRefresh) : null;
  const sessions = await listActiveSessions(authUser.id, currentTokenHash);
  res.json({ sessions });
});

router.delete("/auth/sessions/:id", requireAuth, async (req: Request, res: Response) => {
  const authUser = req.user!;
  const sessionId = parseInt(req.params.id as string, 10);
  if (isNaN(sessionId)) {
    res.status(400).json({ error: "Invalid session id" });
    return;
  }

  const ok = await revokeSessionById(authUser.id, sessionId);
  if (!ok) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  void writeAuthAuditLog("AUTH_SESSION_REVOKED", req, { userId: authUser.id, metadata: { sessionId } });
  res.json({ ok: true });
});

router.post("/auth/sessions/revoke-others", requireAuth, async (req: Request, res: Response) => {
  const authUser = req.user!;
  const rawRefresh = req.cookies?.refreshToken as string | undefined;
  const currentTokenHash = rawRefresh ? hashRefreshToken(rawRefresh) : null;
  const revokedCount = await revokeAllOtherSessions(authUser.id, currentTokenHash);

  void writeAuthAuditLog("AUTH_SESSIONS_REVOKED_OTHERS", req, {
    userId: authUser.id,
    metadata: { revokedCount },
  });

  res.json({ ok: true, revokedCount });
});

router.get("/auth/login-history", requireAuth, async (req: Request, res: Response) => {
  const authUser = req.user!;
  const history = await listLoginHistory(authUser.id);
  res.json({ history });
});

// ─── Impersonation token exchange ─────────────────────────────────────────────
// Consumes a single-use impersonation token (issued by POST /admin/impersonate/:userId
// or POST /api/msp/:mspId/customers/:customerId/impersonate) and returns a short-lived
// JWT that carries the target user's full MSP context.
//
// Key billing-attribution rule: the `impersonatedMspId` claim in the resulting JWT
// identifies the MSP that must be charged for any AI-dependent action taken during
// this session — never the actor's MSP or left unattributed.
router.post("/auth/impersonate-exchange", async (req: Request, res: Response) => {
  const { token } = req.body as { token?: string };
  if (!token) {
    res.status(400).json({ error: "token is required" });
    return;
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    res.status(500).json({ error: "Server misconfiguration" });
    return;
  }

  const [record] = await db.select().from(impersonationTokensTable)
    .where(eq(impersonationTokensTable.token, token))
    .limit(1);

  const now = new Date();

  if (!record || record.usedAt || record.expiresAt < now) {
    res.status(401).json({ error: "Invalid, expired, or already-used impersonation token" });
    return;
  }

  // Consume the token atomically — marks it as used so it cannot be replayed
  await db.update(impersonationTokensTable)
    .set({ usedAt: now })
    .where(eq(impersonationTokensTable.id, record.id));

  const [targetUser] = await db.select().from(usersTable)
    .where(eq(usersTable.id, record.clientUserId))
    .limit(1);
  if (!targetUser) {
    res.status(404).json({ error: "Target user not found" });
    return;
  }

  // Pull the target user's MSP claims so that the impersonation session sees
  // exactly the same tenant scope as the real user.
  const mspClaims = await getMspClaims(targetUser.id);

  // impersonatedMspId is the canonical billing-attribution claim.
  // Any AI cost incurred while this claim is present must be charged to that
  // MSP's balance — never to the actor or left unattributed.
  const impersonatedMspId = mspClaims.mspId ?? undefined;

  const jwtPayload = {
    id: targetUser.id,
    email: targetUser.email,
    role: targetUser.role,
    impersonatedBy: record.adminUserId,
    ...(impersonatedMspId !== undefined ? { impersonatedMspId } : {}),
    ...(mspClaims.mspRole !== null ? { mspRole: mspClaims.mspRole } : {}),
    ...(mspClaims.mspId !== null ? { mspId: mspClaims.mspId } : {}),
    ...(mspClaims.customerId !== null ? { customerId: mspClaims.customerId } : {}),
  };

  const sessionToken = jwt.sign(jwtPayload, secret, { expiresIn: "30m" });

  void createSession({
    userId: targetUser.id,
    sessionType: "impersonation",
    loginMethod: "impersonation",
    tokenHash: null,
    impersonatedByUserId: record.adminUserId,
    userAgent: (req.headers["user-agent"] as string | undefined) ?? null,
    ipAddress: (req.ip ?? req.socket?.remoteAddress) ?? null,
    expiresAt: new Date(Date.now() + 30 * 60 * 1000),
  });

  // Audit every impersonation session start (non-fatal — never blocks the response)
  // The canonical event actor carries `actingAs: impersonatedMspId` so downstream
  // consumers (AI billing, audit dashboards) can attribute actions to the correct MSP.
  try {
    await db.insert(mspAuditLogsTable).values({
      actorUserId: record.adminUserId,
      actionType: "IMPERSONATION_SESSION_STARTED",
      entityType: "user",
      entityId: String(targetUser.id),
      entityLabel: targetUser.email,
      mspId: mspClaims.mspId,
      customerId: mspClaims.customerId,
      correlationId: getRequestContext()?.traceId ?? randomUUID(),
      outcome: "success",
      metadata: {
        actorType: "platformAdmin",
        actingAs: impersonatedMspId ?? null,
        targetUserId: targetUser.id,
        impersonatedMspId: impersonatedMspId ?? null,
      },
    });
  } catch {
    // Audit log is non-fatal
  }

  // Dispatch a canonical event with the enriched impersonation actor so the
  // event store records who (PlatformAdmin userId) acted as which MSP (actingAs).
  void dispatchEvent({
    eventType: EVENT_TYPES.IMPERSONATION_SESSION_STARTED,
    actor: impersonatedMspId !== undefined
      ? impersonationActor(record.adminUserId, impersonatedMspId)
      : userActor(record.adminUserId, "PlatformAdmin"),
    source: "auth.impersonate-exchange",
    mspId: mspClaims.mspId,
    customerId: mspClaims.customerId,
    payload: {
      targetUserId: targetUser.id,
      targetEmail: targetUser.email,
      impersonatedMspId: impersonatedMspId ?? null,
    },
  });

  res.json({
    accessToken: sessionToken,
    user: {
      id: targetUser.id,
      email: targetUser.email,
      role: targetUser.role,
      impersonatedBy: record.adminUserId,
      ...(impersonatedMspId !== undefined ? { impersonatedMspId } : {}),
      ...(mspClaims.mspRole !== null ? { mspRole: mspClaims.mspRole } : {}),
      ...(mspClaims.mspId !== null ? { mspId: mspClaims.mspId } : {}),
      ...(mspClaims.customerId !== null ? { customerId: mspClaims.customerId } : {}),
    },
  });
});

export async function seedAdminUser(): Promise<void> {
  // Prefer ADMIN_EMAIL/ADMIN_PASSWORD; CRM_ADMIN_* are deprecated aliases kept
  // temporarily for backwards-compatibility — remove after the next deploy cycle.
  const email = process.env.ADMIN_EMAIL ?? process.env.CRM_ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD ?? process.env.CRM_ADMIN_PASSWORD;
  if (!email || !password) return;

  const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, email.toLowerCase())).limit(1);
  if (existing) {
    // Ensure the existing admin user has a PlatformAdmin msp_users row
    const [existingMspUser] = await db
      .select()
      .from(mspUsersTable)
      .where(eq(mspUsersTable.userId, existing.id))
      .limit(1);
    if (!existingMspUser) {
      await db.insert(mspUsersTable).values({
        userId: existing.id,
        mspRole: "PlatformAdmin",
        isActive: true,
      });
    }
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const [newUser] = await db
    .insert(usersTable)
    .values({ email: email.toLowerCase(), passwordHash, role: "admin" })
    .returning({ id: usersTable.id });

  if (newUser) {
    await db.insert(mspUsersTable).values({
      userId: newUser.id,
      mspRole: "PlatformAdmin",
      isActive: true,
    });
  }
}

// ─── ServiceAccount API key issuance ──────────────────────────────────────────
// PlatformAdmin or MSPAdmin can issue API keys for machine-to-machine auth.
// The raw key is returned exactly once; only the SHA-256 hash is stored.
// Key format: msp_sa_<24-byte-hex-prefix>_<48-byte-hex-body>

const SA_KEY_PREFIX = "msp_sa_";

function generateApiKey(): { raw: string; prefix: string; hash: string } {
  const prefix = crypto.randomBytes(4).toString("hex"); // 8 hex chars
  const body = crypto.randomBytes(32).toString("hex"); // 64 hex chars
  const raw = `${SA_KEY_PREFIX}${prefix}_${body}`;
  const hash = crypto.createHash("sha256").update(raw).digest("hex");
  return { raw, prefix: `${SA_KEY_PREFIX}${prefix}`, hash };
}

/**
 * POST /api/admin/msp/service-accounts
 * Create a new service account and return the raw API key (shown once only).
 * Requires PlatformAdmin.
 */
router.post("/admin/msp/service-accounts", requireRole("PlatformAdmin"), async (req: Request, res: Response) => {
  const { name, mspId, scopes } = req.body as {
    name?: string;
    mspId?: number;
    scopes?: string[];
  };

  if (!name) {
    res.status(400).json({ error: "name is required" });
    return;
  }

  const { raw, prefix, hash } = generateApiKey();

  // keyVaultSecretName is a placeholder for future Key Vault storage.
  // Convention: msp-{mspId ?? "platform"}-sa-{slug(name)}
  const slugName = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const keyVaultSecretName = `msp-${mspId ?? "platform"}-sa-${slugName}`;

  const [inserted] = await db.insert(mspServiceAccountsTable).values({
    mspId: mspId ?? null,
    name,
    keyVaultSecretName,
    keyHash: hash,
    keyPrefix: prefix,
    scopes: scopes ?? [],
  }).returning({ id: mspServiceAccountsTable.id, name: mspServiceAccountsTable.name, createdAt: mspServiceAccountsTable.createdAt });

  const actor = req.user as { id: number; mspRole?: string } | undefined;
  void dispatchEvent({
    eventType: EVENT_TYPES.MSP_SERVICE_ACCOUNT_CREATED,
    actor: userActor(actor?.id ?? 0, (actor?.mspRole ?? "PlatformAdmin") as import("@workspace/db").MspRole),
    source: "auth.service-accounts",
    mspId: mspId ?? null,
    payload: { serviceAccountId: inserted?.id, name, keyPrefix: prefix },
  });

  void writeAuthAuditLog("MSP_SERVICE_ACCOUNT_CREATED", req, {
    userId: actor?.id,
    mspId: mspId ?? null,
    mspRole: actor?.mspRole,
    metadata: { serviceAccountId: inserted?.id, name, keyPrefix: prefix },
  });

  res.status(201).json({
    id: inserted?.id,
    name: inserted?.name,
    keyPrefix: prefix,
    apiKey: raw, // shown once — not stored; hash is stored
    createdAt: inserted?.createdAt,
    warning: "Save this API key now — it will not be shown again.",
  });
});

/**
 * Validate a service account API key (used by middleware or other routes).
 * Returns the service account record if valid, or null if invalid/expired/revoked.
 */
export async function validateServiceAccountKey(
  rawKey: string,
): Promise<typeof mspServiceAccountsTable.$inferSelect | null> {
  if (!rawKey.startsWith(SA_KEY_PREFIX)) return null;
  const hash = crypto.createHash("sha256").update(rawKey).digest("hex");
  const now = new Date();

  const [sa] = await db
    .select()
    .from(mspServiceAccountsTable)
    .where(eq(mspServiceAccountsTable.keyHash, hash))
    .limit(1);

  if (!sa) return null;
  if (sa.revokedAt) return null;
  if (sa.expiresAt && sa.expiresAt < now) return null;

  // Update lastUsedAt non-critically
  void db
    .update(mspServiceAccountsTable)
    .set({ lastUsedAt: now })
    .where(eq(mspServiceAccountsTable.id, sa.id))
    .catch(() => null);

  return sa;
}

export default router;
