import { Router, type IRouter, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { db, usersTable, passwordResetTokensTable, impersonationTokensTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { CookieOptions } from "express";
import { sendEmail, passwordResetEmail } from "../lib/mailer";

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many registration attempts from this IP. Please try again in an hour." },
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many login attempts from this IP. Please try again in 15 minutes." },
});

const router: IRouter = Router();

const REFRESH_TOKEN_TTL_DAYS = 30;
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

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const payload = { id: user.id, email: user.email, name: user.name ?? undefined, company: user.company ?? undefined, phone: user.phone ?? undefined, address: user.address ?? undefined, addressCity: user.addressCity ?? undefined, addressState: user.addressState ?? undefined, addressZip: user.addressZip ?? undefined, role: user.role };

  const accessToken = jwt.sign(payload, secret, { expiresIn: ACCESS_TOKEN_TTL });
  const refreshToken = jwt.sign({ id: user.id }, secret, { expiresIn: `${REFRESH_TOKEN_TTL_DAYS}d` });

  res.cookie("refreshToken", refreshToken, cookieOpts());
  res.json({ accessToken, user: payload });
});

router.post("/auth/refresh", async (req: Request, res: Response) => {
  const token = req.cookies?.refreshToken as string | undefined;
  if (!token) {
    res.status(401).json({ error: "No refresh token" });
    return;
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    res.status(500).json({ error: "Server misconfiguration" });
    return;
  }

  let decoded: { id: number };
  try {
    decoded = jwt.verify(token, secret) as { id: number };
  } catch {
    res.status(401).json({ error: "Invalid or expired refresh token" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, decoded.id)).limit(1);
  if (!user) {
    res.status(401).json({ error: "User not found" });
    return;
  }

  const payload = { id: user.id, email: user.email, name: user.name ?? undefined, company: user.company ?? undefined, phone: user.phone ?? undefined, address: user.address ?? undefined, addressCity: user.addressCity ?? undefined, addressState: user.addressState ?? undefined, addressZip: user.addressZip ?? undefined, role: user.role };
  const accessToken = jwt.sign(payload, secret, { expiresIn: ACCESS_TOKEN_TTL });
  const newRefreshToken = jwt.sign({ id: user.id }, secret, { expiresIn: `${REFRESH_TOKEN_TTL_DAYS}d` });

  res.cookie("refreshToken", newRefreshToken, cookieOpts());
  res.json({ accessToken, user: payload });
});

router.post("/auth/register", registerLimiter, async (req: Request, res: Response) => {
  const { email, password, name } = req.body as { email?: string; password?: string; name?: string };

  if (!email || !password) {
    res.status(400).json({ error: "email and password are required" });
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

  const normalizedEmail = email.toLowerCase().trim();
  const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, normalizedEmail)).limit(1);
  if (existing) {
    res.status(409).json({ error: "An account with that email already exists" });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const [user] = await db
    .insert(usersTable)
    .values({ email: normalizedEmail, passwordHash, role: "client", name: name?.trim() || null })
    .returning();

  const payload = { id: user.id, email: user.email, name: user.name ?? undefined, company: user.company ?? undefined, phone: user.phone ?? undefined, address: user.address ?? undefined, addressCity: user.addressCity ?? undefined, addressState: user.addressState ?? undefined, addressZip: user.addressZip ?? undefined, role: user.role };
  const accessToken = jwt.sign(payload, secret, { expiresIn: ACCESS_TOKEN_TTL });
  const refreshToken = jwt.sign({ id: user.id }, secret, { expiresIn: `${REFRESH_TOKEN_TTL_DAYS}d` });

  res.cookie("refreshToken", refreshToken, cookieOpts());
  res.status(201).json({ accessToken, user: payload });
});

router.post("/auth/logout", (_req: Request, res: Response) => {
  res.clearCookie("refreshToken", { path: "/api/auth" });
  res.json({ success: true });
});

// ─── Forgot password ──────────────────────────────────────────────────────────
// Always returns 200 to prevent email enumeration — caller cannot know if
// the address matched an account.
router.post("/auth/forgot-password", async (req: Request, res: Response) => {
  const { email } = req.body as { email?: string };

  // Respond immediately — never reveal whether the email exists
  res.json({ ok: true });

  if (!email) return;

  const normalizedEmail = email.toLowerCase().trim();
  const [user] = await db.select().from(usersTable)
    .where(eq(usersTable.email, normalizedEmail))
    .limit(1);
  if (!user) return;

  const { randomBytes } = await import("crypto");
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

  await db.insert(passwordResetTokensTable).values({ userId: user.id, token, expiresAt });

  const baseUrl = process.env.PORTAL_BASE_URL
    ?? `${req.protocol}://${req.hostname}/crm`;
  const resetUrl = `${baseUrl}/reset-password?token=${token}`;

  void sendEmail(
    user.email,
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

// ─── Impersonation token exchange ─────────────────────────────────────────────
// Called by the CRM portal to bootstrap a one-time impersonation session.
// The URL token is a random hex string stored in the DB — consumed on first use.
// Returns a fresh short-lived JWT so the original URL token is never reused.
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

  await db.update(impersonationTokensTable)
    .set({ usedAt: now })
    .where(eq(impersonationTokensTable.id, record.id));

  const [client] = await db.select().from(usersTable)
    .where(eq(usersTable.id, record.clientUserId))
    .limit(1);
  if (!client || client.role !== "client") {
    res.status(404).json({ error: "Client not found" });
    return;
  }

  const sessionToken = jwt.sign(
    { id: client.id, email: client.email, role: "client" as const, impersonatedBy: record.adminUserId },
    secret,
    { expiresIn: "30m" },
  );

  res.json({
    accessToken: sessionToken,
    user: {
      id: client.id,
      email: client.email,
      role: "client" as const,
      impersonatedBy: record.adminUserId,
    },
  });
});

export async function seedAdminUser(): Promise<void> {
  const email = process.env.CRM_ADMIN_EMAIL ?? process.env.ADMIN_EMAIL;
  const password = process.env.CRM_ADMIN_PASSWORD ?? process.env.ADMIN_PASSWORD;
  if (!email || !password) return;

  const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, email.toLowerCase())).limit(1);
  if (existing) return;

  const passwordHash = await bcrypt.hash(password, 12);
  await db.insert(usersTable).values({ email: email.toLowerCase(), passwordHash, role: "admin" });
}

export default router;
