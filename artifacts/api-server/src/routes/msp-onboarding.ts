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
import { randomBytes } from "crypto";
import {
  db,
  mspsTable,
  mspUsersTable,
  mspOnboardingLinksTable,
  usersTable,
} from "@workspace/db";
import { eq, and, isNull, gte, or } from "drizzle-orm";
import { requireRole } from "../middlewares/requireAuth.ts";
import { logger } from "../lib/logger.ts";

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

    logger.info({ mspId, customerEmail, serviceId, ttl }, "msp-onboarding: link generated");

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
        isDirectBusiness: mspsTable.isDirectBusiness,
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

    if (!mspUser || mspUser.isDirectBusiness) {
      res.json({ action: "proceed" });
      return;
    }

    if (mspUser.mspStatus === "active" || mspUser.mspStatus === "trial") {
      const portalUrl = mspUser.mspDomain
        ? `https://${mspUser.mspDomain}`
        : process.env.PORTAL_BASE_URL ?? "";

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

export default router;
