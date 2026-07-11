/**
 * Platform Agreement routes — versioned MSA/DPA for Shane ↔ MSP
 *
 * Public (no auth):
 *   GET  /api/platform/agreement/current          — returns active agreement text
 *
 * MSP-authenticated:
 *   GET  /api/platform/agreement/acceptance-status — has the caller accepted the current version?
 *   POST /api/platform/agreement/accept            — record clickwrap acceptance
 *
 * Admin (PlatformAdmin or legacy admin role):
 *   GET   /api/admin/platform-agreements            — list all versions
 *   POST  /api/admin/platform-agreements            — create a new version (draft)
 *   PATCH /api/admin/platform-agreements/:id/publish — publish, becomes the current version
 *   PUT   /api/admin/platform-agreements/:id        — update draft body/title/version
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, platformAgreementsTable, mspAgreementAcceptancesTable } from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import { requireAuth, requireRole } from "../middlewares/requireAuth.ts";
import { logger } from "../lib/logger.ts";

const router: IRouter = Router();

// ── Public: fetch the current active agreement ────────────────────────────────

router.get("/platform/agreement/current", async (_req: Request, res: Response) => {
  try {
    const [agreement] = await db
      .select()
      .from(platformAgreementsTable)
      .where(eq(platformAgreementsTable.isCurrentVersion, true))
      .limit(1);

    if (!agreement) {
      res.json({ agreement: null });
      return;
    }
    res.json({ agreement });
  } catch (err) {
    logger.error({ err }, "platform-agreements: failed to fetch current agreement");
    res.status(500).json({ error: "Failed to fetch agreement" });
  }
});

// ── MSP: check acceptance status ─────────────────────────────────────────────

router.get("/platform/agreement/acceptance-status", requireAuth, async (req: Request, res: Response) => {
  const user = req.user!;

  try {
    const [current] = await db
      .select({ id: platformAgreementsTable.id, version: platformAgreementsTable.version })
      .from(platformAgreementsTable)
      .where(eq(platformAgreementsTable.isCurrentVersion, true))
      .limit(1);

    if (!current) {
      // No published agreement yet — nothing to accept
      res.json({ required: false, accepted: true });
      return;
    }

    const [acceptance] = await db
      .select({ id: mspAgreementAcceptancesTable.id, acceptedAt: mspAgreementAcceptancesTable.acceptedAt })
      .from(mspAgreementAcceptancesTable)
      .where(
        and(
          eq(mspAgreementAcceptancesTable.userId, user.id),
          eq(mspAgreementAcceptancesTable.agreementVersion, current.version),
        ),
      )
      .limit(1);

    res.json({
      required: true,
      accepted: !!acceptance,
      acceptedAt: acceptance?.acceptedAt ?? null,
      version: current.version,
    });
  } catch (err) {
    logger.error({ err }, "platform-agreements: failed to check acceptance status");
    res.status(500).json({ error: "Failed to check acceptance status" });
  }
});

// ── MSP: record acceptance (clickwrap) ───────────────────────────────────────

router.post("/platform/agreement/accept", requireAuth, async (req: Request, res: Response) => {
  const user = req.user!;
  const { checkboxConfirmed } = req.body as { checkboxConfirmed?: boolean };

  if (!checkboxConfirmed) {
    res.status(400).json({ error: "You must check the agreement checkbox to proceed" });
    return;
  }

  try {
    const [current] = await db
      .select()
      .from(platformAgreementsTable)
      .where(eq(platformAgreementsTable.isCurrentVersion, true))
      .limit(1);

    if (!current) {
      // No published agreement — nothing to accept
      res.json({ ok: true, message: "No agreement currently published" });
      return;
    }

    // Idempotent: if already accepted this version, return success
    const [existing] = await db
      .select({ id: mspAgreementAcceptancesTable.id })
      .from(mspAgreementAcceptancesTable)
      .where(
        and(
          eq(mspAgreementAcceptancesTable.userId, user.id),
          eq(mspAgreementAcceptancesTable.agreementVersion, current.version),
        ),
      )
      .limit(1);

    if (existing) {
      res.json({ ok: true });
      return;
    }

    const ip = (req.ip ?? req.socket?.remoteAddress) ?? null;
    const ua = req.headers["user-agent"] ?? null;

    const effectiveRole = user.role === "admin" ? "PlatformAdmin" : user.mspRole;
    const mspId = user.mspId ?? null;

    await db.insert(mspAgreementAcceptancesTable).values({
      mspId,
      userId: user.id,
      agreementVersion: current.version,
      agreementId: current.id,
      ipAddress: ip,
      userAgent: ua,
      checkboxConfirmed: true,
    });

    logger.info(
      { userId: user.id, mspId, version: current.version, ip, role: effectiveRole },
      "platform-agreements: acceptance recorded",
    );

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "platform-agreements: failed to record acceptance");
    res.status(500).json({ error: "Failed to record acceptance" });
  }
});

// ── Admin: list all agreement versions ───────────────────────────────────────

router.get("/admin/platform-agreements", requireRole("PlatformAdmin"), async (_req: Request, res: Response) => {
  try {
    const agreements = await db
      .select()
      .from(platformAgreementsTable)
      .orderBy(desc(platformAgreementsTable.createdAt));
    res.json({ agreements });
  } catch (err) {
    logger.error({ err }, "platform-agreements: failed to list");
    res.status(500).json({ error: "Failed to list agreements" });
  }
});

// ── Admin: create a new draft version ────────────────────────────────────────

router.post("/admin/platform-agreements", requireRole("PlatformAdmin"), async (req: Request, res: Response) => {
  const { version, title, body } = req.body as { version?: string; title?: string; body?: string };

  if (!version || !body) {
    res.status(400).json({ error: "version and body are required" });
    return;
  }

  try {
    const [created] = await db
      .insert(platformAgreementsTable)
      .values({
        version,
        title: title?.trim() || "Platform MSA + DPA",
        body,
        isCurrentVersion: false,
        publishedByUserId: req.user!.id,
      })
      .returning();

    res.status(201).json({ agreement: created });
  } catch (err) {
    logger.error({ err }, "platform-agreements: failed to create");
    res.status(500).json({ error: "Failed to create agreement version" });
  }
});

// ── Admin: update a draft ─────────────────────────────────────────────────────

router.put("/admin/platform-agreements/:id", requireRole("PlatformAdmin"), async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { version, title, body } = req.body as { version?: string; title?: string; body?: string };

  try {
    const [existing] = await db
      .select({ isCurrentVersion: platformAgreementsTable.isCurrentVersion })
      .from(platformAgreementsTable)
      .where(eq(platformAgreementsTable.id, id))
      .limit(1);

    if (!existing) { res.status(404).json({ error: "Not found" }); return; }
    if (existing.isCurrentVersion) {
      res.status(400).json({ error: "Cannot edit a published agreement. Create a new version instead." });
      return;
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (version !== undefined) updates.version = version;
    if (title !== undefined) updates.title = title;
    if (body !== undefined) updates.body = body;

    const [updated] = await db
      .update(platformAgreementsTable)
      .set(updates)
      .where(eq(platformAgreementsTable.id, id))
      .returning();

    res.json({ agreement: updated });
  } catch (err) {
    logger.error({ err }, "platform-agreements: failed to update");
    res.status(500).json({ error: "Failed to update agreement" });
  }
});

// ── Admin: publish a version (makes it the current version) ──────────────────

router.patch("/admin/platform-agreements/:id/publish", requireRole("PlatformAdmin"), async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  try {
    const [target] = await db
      .select()
      .from(platformAgreementsTable)
      .where(eq(platformAgreementsTable.id, id))
      .limit(1);

    if (!target) { res.status(404).json({ error: "Agreement not found" }); return; }

    // In a transaction: unset current from all others, then publish this one
    await db.transaction(async (tx: typeof db) => {
      await tx
        .update(platformAgreementsTable)
        .set({ isCurrentVersion: false, updatedAt: new Date() });

      await tx
        .update(platformAgreementsTable)
        .set({
          isCurrentVersion: true,
          publishedAt: new Date(),
          publishedByUserId: req.user!.id,
          updatedAt: new Date(),
        })
        .where(eq(platformAgreementsTable.id, id));
    });

    logger.info({ id, version: target.version, userId: req.user!.id }, "platform-agreements: version published");
    res.json({ ok: true, version: target.version });
  } catch (err) {
    logger.error({ err }, "platform-agreements: failed to publish");
    res.status(500).json({ error: "Failed to publish agreement" });
  }
});

export default router;
