/**
 * MSP Onboarding Routes
 *
 * Handles the full customer onboarding lifecycle:
 *
 *   POST /api/msp/onboarding/generate-link
 *     MSP operator generates a single-use, expiring customer onboarding link.
 *     Requires MSPOperator role or above.
 *
 *   GET  /api/public/onboarding/link/:token
 *     Public — customer validates a link, gets MSP branding + pre-selected service info.
 *
 *   POST /api/public/checkout/gate
 *     Public — email gate check. Returns:
 *       - { action: "redirect", portalUrl } if an active MSP already owns this email
 *       - { action: "proceed" } for new or suspended-MSP customers
 *
 *   GET  /api/public/msps/direct
 *     Public — returns the direct-business MSP row (Shane's own MSP) for use in
 *     checkout flows that don't go through an MSP-generated link.
 *
 * Bot-protection: all public POST routes are rate-limited. Honeypot field
 * validation is applied where forms are submitted.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { randomBytes, createHash } from "crypto";
import {
  db,
  mspsTable,
  mspUsersTable,
  mspOnboardingLinksTable,
  mspInvitesTable,
  mspRefreshTokensTable,
  usersTable,
} from "@workspace/db";
import { eq, and, isNull, gte, or } from "drizzle-orm";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { requireRole } from "../middlewares/requireAuth.ts";
import { getMspPortalBaseUrl } from "../lib/portal-url.ts";
import { logger } from "../lib/logger.ts";
const log = logger.child({ channel: "tenant.msp-admin" });
import { z } from "zod";

const router: IRouter = Router();

const isDev = process.env.NODE_ENV !== "production";

// ── Rate limiters (bot protection) ────────────────────────────────────────────

const publicCheckoutLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: isDev ? 500 : 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many requests. Please wait a few minutes and try again." },
});

const generateLinkLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: isDev ? 500 : 100,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many link generation requests. Please try again later." },
});

// ── Honeypot helper ────────────────────────────────────────────────────────────
// If the hidden `_hp` field is present and non-empty in the body, it's a bot.

function honeypotTriggered(body: Record<string, unknown>): boolean {
  const hp = body["_hp"];
  return hp !== undefined && hp !== null && hp !== "";
}

// ── POST /api/msp/onboarding/generate-link ─────────────────────────────────────

router.post(
  "/msp/onboarding/generate-link",
  generateLinkLimiter,
  requireRole("MSPOperator"),
  async (req: Request, res: Response): Promise<void> => {
    const {
      customerEmail,
      serviceId,
      note,
      ttlHours = 72,
    } = req.body as {
      customerEmail?: string;
      serviceId?: number;
      note?: string;
      ttlHours?: number;
    };

    if (!customerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
      res.status(400).json({ error: "A valid customerEmail is required" });
      return;
    }

    const mspId = req.user!.mspId;
    if (!mspId) {
      res.status(403).json({ error: "No MSP scope on this token" });
      return;
    }

    const [msp] = await db
      .select({ id: mspsTable.id, name: mspsTable.name, slug: mspsTable.slug, status: mspsTable.status })
      .from(mspsTable)
      .where(eq(mspsTable.id, mspId))
      .limit(1);

    if (!msp || msp.status === "suspended") {
      res.status(403).json({ error: "MSP is not active" });
      return;
    }

    const token = randomBytes(32).toString("hex");
    const ttl = Math.min(Math.max(Number(ttlHours) || 72, 1), 168);
    const expiresAt = new Date(Date.now() + ttl * 60 * 60 * 1000);

    await db.insert(mspOnboardingLinksTable).values({
      token,
      mspId,
      customerEmail: customerEmail.toLowerCase().trim(),
      serviceId: serviceId ?? null,
      note: note?.trim() || null,
      expiresAt,
      createdByUserId: req.user!.id,
    });

    log.info({ mspId, customerEmail, serviceId, ttl }, "msp-onboarding: link generated");

    const baseUrl = process.env.SITE_URL ?? "";
    const link = `${baseUrl}/onboarding/${token}`;

    res.json({ token, link, expiresAt });
  },
);

// ── GET /api/public/onboarding/link/:token ─────────────────────────────────────

router.get("/public/onboarding/link/:token", async (req: Request, res: Response): Promise<void> => {
  const { token } = req.params as { token: string };
  if (!token) {
    res.status(400).json({ error: "Token is required" });
    return;
  }

  const now = new Date();
  const [row] = await db
    .select({
      token: mspOnboardingLinksTable.token,
      mspId: mspOnboardingLinksTable.mspId,
      customerEmail: mspOnboardingLinksTable.customerEmail,
      serviceId: mspOnboardingLinksTable.serviceId,
      note: mspOnboardingLinksTable.note,
      redirectPortalUrl: mspOnboardingLinksTable.redirectPortalUrl,
      expiresAt: mspOnboardingLinksTable.expiresAt,
      usedAt: mspOnboardingLinksTable.usedAt,
      mspName: mspsTable.name,
      mspSlug: mspsTable.slug,
      mspLogoUrl: mspsTable.logoUrl,
      mspPrimaryColor: mspsTable.primaryColor,
      mspStatus: mspsTable.status,
    })
    .from(mspOnboardingLinksTable)
    .innerJoin(mspsTable, eq(mspsTable.id, mspOnboardingLinksTable.mspId))
    .where(eq(mspOnboardingLinksTable.token, token))
    .limit(1);

  if (!row) {
    res.status(404).json({ error: "This onboarding link does not exist" });
    return;
  }

  if (row.usedAt) {
    res.status(410).json({ error: "This onboarding link has already been used" });
    return;
  }

  if (row.expiresAt < now) {
    res.status(410).json({ error: "This onboarding link has expired. Please ask your provider for a new one." });
    return;
  }

  if (row.mspStatus === "suspended") {
    res.status(403).json({ error: "The MSP associated with this link is not currently active." });
    return;
  }

  res.json({
    token: row.token,
    customerEmail: row.customerEmail,
    serviceId: row.serviceId,
    note: row.note,
    redirectPortalUrl: row.redirectPortalUrl,
    expiresAt: row.expiresAt,
    msp: {
      id: row.mspId,
      name: row.mspName,
      slug: row.mspSlug,
      logoUrl: row.mspLogoUrl,
      primaryColor: row.mspPrimaryColor,
    },
  });
});

// ── POST /api/public/checkout/gate ─────────────────────────────────────────────
//
// Gate logic:
//   1. Look up the email in users + msp_users.
//   2. If a msp_users row exists and its MSP is active → redirect to that MSP's portal.
//      This includes the direct-business MSP itself (Shane's own book) — an
//      existing direct-business customer has a real msp_users row like any
//      reseller customer and must resolve the same way, just with mspDomain
//      typically null (falls back to PORTAL_BASE_URL, the shared msp-portal).
//   3. If no msp_users row, or the MSP is suspended/revoked → allow proceed
//      (will be assigned to the direct-business MSP row at provisioning time).

router.post(
  "/public/checkout/gate",
  publicCheckoutLimiter,
  async (req: Request, res: Response): Promise<void> => {
    const body = req.body as Record<string, unknown>;

    if (honeypotTriggered(body)) {
      res.json({ action: "proceed" });
      return;
    }

    const email = typeof body["email"] === "string" ? body["email"].toLowerCase().trim() : "";
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ error: "A valid email is required" });
      return;
    }

    const [user] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.email, email))
      .limit(1);

    if (!user) {
      res.json({ action: "proceed" });
      return;
    }

    const [mspUser] = await db
      .select({
        mspId: mspUsersTable.mspId,
        mspStatus: mspsTable.status,
        mspSlug: mspsTable.slug,
        mspName: mspsTable.name,
        mspDomain: mspsTable.domain,
      })
      .from(mspUsersTable)
      .innerJoin(mspsTable, eq(mspsTable.id, mspUsersTable.mspId))
      .where(
        and(
          eq(mspUsersTable.userId, user.id),
          eq(mspUsersTable.isActive, true),
        ),
      )
      .limit(1);

    if (!mspUser) {
      res.json({ action: "proceed" });
      return;
    }

    if (mspUser.mspStatus === "active" || mspUser.mspStatus === "trial") {
      // Reseller MSPs redirect to their own portal domain; the direct-business
      // MSP (mspDomain typically null) falls back to the platform's canonical
      // client-portal URL. Use getMspPortalBaseUrl() — which targets the
      // msp-portal artifact (/portal, where client/customer users actually
      // sign in) — NOT getPortalBaseUrl(), which targets the /crm staff artifact
      // and is a dead end for a client logging in from the public /login gate
      // (it renders no usable client login, so a valid email "goes nowhere").
      // getMspPortalBaseUrl() also resolves REPLIT_DOMAINS when PORTAL_BASE_URL
      // is unset, so a deployed environment still yields a real URL rather than
      // the empty string a bare env read would produce; /portal's RootRedirect
      // then lands the user on the login form.
      const portalUrl = mspUser.mspDomain
        ? `https://${mspUser.mspDomain}`
        : getMspPortalBaseUrl();

      res.json({
        action: "redirect",
        portalUrl,
        mspName: mspUser.mspName,
        mspSlug: mspUser.mspSlug,
      });
      return;
    }

    res.json({ action: "proceed" });
  },
);

// ── GET /api/public/msps/direct ────────────────────────────────────────────────
// Returns the direct-business MSP row for use in direct (non-brokered) checkout.

router.get("/public/msps/direct", async (_req: Request, res: Response): Promise<void> => {
  const [msp] = await db
    .select({
      id: mspsTable.id,
      name: mspsTable.name,
      slug: mspsTable.slug,
      logoUrl: mspsTable.logoUrl,
      primaryColor: mspsTable.primaryColor,
      status: mspsTable.status,
    })
    .from(mspsTable)
    .where(
      and(
        eq(mspsTable.isDirectBusiness, true),
        or(eq(mspsTable.status, "active"), eq(mspsTable.status, "trial")),
      ),
    )
    .limit(1);

  if (!msp) {
    res.status(404).json({ error: "No direct-business MSP configured" });
    return;
  }

  res.json(msp);
});

// ── Public invite endpoints ────────────────────────────────────────────────────

const inviteAcceptLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: isDev ? 500 : 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many requests. Please wait and try again." },
});

// GET /api/public/msp-invite/:token
// Validates token — returns MSP name, pre-filled email, role for the accept page.

router.get("/public/msp-invite/:token", inviteAcceptLimiter, async (req: Request, res: Response): Promise<void> => {
  const { token } = req.params as { token: string };
  if (!token) { res.status(400).json({ error: "Token is required" }); return; }

  const now = new Date();
  const [row] = await db
    .select({
      id: mspInvitesTable.id,
      invitedEmail: mspInvitesTable.invitedEmail,
      mspRole: mspInvitesTable.mspRole,
      expiresAt: mspInvitesTable.expiresAt,
      usedAt: mspInvitesTable.usedAt,
      mspId: mspInvitesTable.mspId,
      mspName: mspsTable.name,
      mspSlug: mspsTable.slug,
      mspLogoUrl: mspsTable.logoUrl,
      mspPrimaryColor: mspsTable.primaryColor,
      mspStatus: mspsTable.status,
    })
    .from(mspInvitesTable)
    .innerJoin(mspsTable, eq(mspsTable.id, mspInvitesTable.mspId))
    .where(eq(mspInvitesTable.token, token))
    .limit(1);

  if (!row) {
    res.status(404).json({ error: "This invite link does not exist." });
    return;
  }

  if (row.usedAt) {
    res.status(410).json({ error: "This invite link has already been used." });
    return;
  }

  if (row.expiresAt < now) {
    res.status(410).json({ error: "This invite link has expired. Please ask your administrator to send a new one." });
    return;
  }

  if (row.mspStatus === "suspended") {
    res.status(403).json({ error: "The organisation associated with this invite is not currently active." });
    return;
  }

  res.json({
    invitedEmail: row.invitedEmail,
    mspRole: row.mspRole,
    expiresAt: row.expiresAt,
    msp: {
      id: row.mspId,
      name: row.mspName,
      slug: row.mspSlug,
      logoUrl: row.mspLogoUrl,
      primaryColor: row.mspPrimaryColor,
    },
  });
});

// POST /api/public/msp-invite/:token/accept
// Validates token, creates (or finds) user, inserts msp_users row, burns token.
// Body: { name?, password? } — password required only for new users.

const acceptInviteSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  password: z.string().min(8).optional(),
});

router.post("/public/msp-invite/:token/accept", inviteAcceptLimiter, async (req: Request, res: Response): Promise<void> => {
  const { token } = req.params as { token: string };
  if (!token) { res.status(400).json({ error: "Token is required" }); return; }

  const parsed = acceptInviteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join("; ") });
    return;
  }

  const now = new Date();
  const [row] = await db
    .select({
      id: mspInvitesTable.id,
      invitedEmail: mspInvitesTable.invitedEmail,
      mspRole: mspInvitesTable.mspRole,
      expiresAt: mspInvitesTable.expiresAt,
      usedAt: mspInvitesTable.usedAt,
      mspId: mspInvitesTable.mspId,
      mspStatus: mspsTable.status,
      mspSlug: mspsTable.slug,
    })
    .from(mspInvitesTable)
    .innerJoin(mspsTable, eq(mspsTable.id, mspInvitesTable.mspId))
    .where(eq(mspInvitesTable.token, token))
    .limit(1);

  if (!row) {
    res.status(404).json({ error: "This invite link does not exist." });
    return;
  }

  if (row.usedAt) {
    res.status(410).json({ error: "This invite link has already been used." });
    return;
  }

  if (row.expiresAt < now) {
    res.status(410).json({ error: "This invite link has expired. Please ask your administrator to send a new one." });
    return;
  }

  if (row.mspStatus === "suspended") {
    res.status(403).json({ error: "The organisation associated with this invite is not currently active." });
    return;
  }

  const email = row.invitedEmail;

  // Look up existing user by email
  const [existingUser] = await db
    .select({ id: usersTable.id, email: usersTable.email })
    .from(usersTable)
    .where(eq(usersTable.email, email))
    .limit(1);

  // ── Auth enforcement for existing accounts ──────────────────────────────────
  // If the invited email already has an account, the requester MUST be
  // authenticated as that user (proven via JWT). We never allow a token alone
  // to silently reassign another user's MSP membership.
  if (existingUser) {
    const authHeader = req.headers.authorization;
    let authenticatedEmail: string | null = null;

    if (authHeader?.startsWith("Bearer ")) {
      const jwtToken = authHeader.slice(7);
      const jwtSecret = process.env.JWT_SECRET;
      if (jwtSecret) {
        try {
          const payload = jwt.verify(jwtToken, jwtSecret) as { email?: string };
          authenticatedEmail = payload.email?.toLowerCase() ?? null;
        } catch {
          // Invalid/expired token — treat as unauthenticated
        }
      }
    }

    if (!authenticatedEmail) {
      res.status(401).json({
        error: "This email already has an account. Please sign in to accept this invitation.",
        requiresSignIn: true,
      });
      return;
    }

    if (authenticatedEmail !== email.toLowerCase()) {
      res.status(403).json({
        error: `You are signed in with a different account. Please sign in as ${email} to accept this invitation.`,
      });
      return;
    }
  } else {
    // New user path — name and password required
    if (!parsed.data.name?.trim()) {
      res.status(400).json({ error: "Name is required for new accounts" });
      return;
    }
    if (!parsed.data.password) {
      res.status(400).json({ error: "Password is required for new accounts" });
      return;
    }
  }

  // ── Atomic transaction: burn token (with double-accept guard) + provision user ─
  let acceptedUserId: number | null = null;
  try {
    await db.transaction(async (tx) => {
      // Burn the token atomically — the WHERE usedAt IS NULL guard prevents
      // two concurrent requests from both succeeding (double-accept race).
      const burned = await tx
        .update(mspInvitesTable)
        .set({ usedAt: now })
        .where(and(eq(mspInvitesTable.id, row.id), isNull(mspInvitesTable.usedAt)))
        .returning({ id: mspInvitesTable.id });

      if (!burned.length) {
        throw Object.assign(new Error("ALREADY_USED"), { status: 410 });
      }

      // Create or reuse user
      let userId: number;
      if (existingUser) {
        userId = existingUser.id;
      } else {
        const passwordHash = await bcrypt.hash(parsed.data.password!, 12);
        const [newUser] = await tx
          .insert(usersTable)
          .values({ email, name: parsed.data.name!.trim(), passwordHash })
          .returning({ id: usersTable.id });
        userId = newUser!.id;
      }

      // Upsert msp_users
      const [existingMspUser] = await tx
        .select({ id: mspUsersTable.id, mspId: mspUsersTable.mspId, isActive: mspUsersTable.isActive })
        .from(mspUsersTable)
        .where(eq(mspUsersTable.userId, userId))
        .limit(1);

      if (existingMspUser) {
        if (!(existingMspUser.mspId === row.mspId && existingMspUser.isActive)) {
          await tx
            .update(mspUsersTable)
            .set({ mspId: row.mspId, mspRole: row.mspRole as "MSPAdmin" | "MSPOperator", isActive: true, updatedAt: new Date() })
            .where(eq(mspUsersTable.id, existingMspUser.id));
        }
      } else {
        await tx.insert(mspUsersTable).values({
          userId,
          mspId: row.mspId,
          mspRole: row.mspRole as "MSPAdmin" | "MSPOperator",
          isActive: true,
        });
      }

      acceptedUserId = userId;
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "ALREADY_USED") {
      res.status(410).json({ error: "This invite link has already been used." });
      return;
    }
    throw err;
  }

  log.info({ userId: acceptedUserId, mspId: row.mspId, role: row.mspRole }, "msp-invite: invite accepted");

  // Issue auth tokens so the accepting user lands on the portal dashboard
  // without a separate login step (same pattern as auth.ts login flow).
  const jwtSecret = process.env.JWT_SECRET;
  if (jwtSecret && acceptedUserId !== null) {
    try {
      const [acceptedUserRow] = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.id, acceptedUserId))
        .limit(1);

      const [mspUserRow] = await db
        .select()
        .from(mspUsersTable)
        .where(eq(mspUsersTable.userId, acceptedUserId))
        .limit(1);

      if (acceptedUserRow && mspUserRow) {
        const payload = {
          id: acceptedUserRow.id,
          email: acceptedUserRow.email,
          name: acceptedUserRow.name ?? undefined,
          role: acceptedUserRow.role,
          mspRole: mspUserRow.mspRole ?? undefined,
          mspId: mspUserRow.mspId ?? undefined,
          mspSlug: row.mspSlug,
        };

        const accessToken = jwt.sign(payload, jwtSecret, { expiresIn: "15m" });

        const rawRefreshToken = randomBytes(48).toString("hex");
        const tokenHash = createHash("sha256").update(rawRefreshToken).digest("hex");
        const refreshExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

        await db.insert(mspRefreshTokensTable).values({
          userId: acceptedUserId,
          tokenHash,
          expiresAt: refreshExpiresAt,
          userAgent: req.headers["user-agent"] ?? null,
          ipAddress: (req.ip ?? req.socket?.remoteAddress) ?? null,
        });

        res.json({
          ok: true,
          mspSlug: row.mspSlug,
          accessToken,
          refreshToken: rawRefreshToken,
          refreshExpiresAt: refreshExpiresAt.toISOString(),
        });
        return;
      }
    } catch (tokenErr) {
      log.warn({ err: tokenErr }, "msp-invite: failed to issue tokens, continuing without auto-login");
    }
  }

  res.json({ ok: true, mspSlug: row.mspSlug });
});

export default router;
