/**
 * Outbound Webhooks Routes
 *
 * Portal endpoints (/api/portal/webhooks/*) — customer and MSP level.
 * Admin endpoints (/api/admin/webhooks/*) — platform admin view.
 *
 * Ownership model:
 *   - CustomerUser  → webhooks scoped to their customerId
 *   - MSPAdmin/MSPOperator → webhooks scoped to their mspId
 *   - PlatformAdmin → can read any webhook (admin endpoints)
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db, outboundWebhooksTable, outboundWebhookDeliveriesTable } from "@workspace/db";
import { requireAuth, requireAdmin } from "../middlewares/requireAuth.ts";
import { generateWebhookSecret, getDeliveryLog } from "../lib/webhook-delivery.ts";
import { logger } from "../lib/logger.ts";
const log = logger.child({ channel: "comms.webhook" });
import { EVENT_TYPES } from "../lib/event-bus.ts";

const router = Router();

// ── Canonical event types exposed for subscription selection ──────────────────

const SUBSCRIBABLE_EVENT_TYPES = [
  ...Object.values(EVENT_TYPES),
  // Additional platform-specific event types
  "signal.fired",
  "fulfillment.item.created",
  "fulfillment.item.updated",
  "offer.accepted",
  "offer.rejected",
  "monitoring.run.completed",
  "service.activated",
  "service.deactivated",
  "project.created",
  "project.completed",
  "invoice.created",
  "invoice.paid",
  "contract.signed",
] as const;

// ── Validation schemas ────────────────────────────────────────────────────────

const createWebhookSchema = z.object({
  label: z.string().min(1).max(120),
  url: z.string().url("Must be a valid HTTPS URL").refine(
    (u) => u.startsWith("https://") || u.startsWith("http://"),
    "URL must start with http:// or https://",
  ),
  eventTypes: z.array(z.string().min(1)).default([]),
});

const updateWebhookSchema = z.object({
  label: z.string().min(1).max(120).optional(),
  url: z.string().url("Must be a valid URL").optional(),
  eventTypes: z.array(z.string().min(1)).optional(),
  isActive: z.boolean().optional(),
});

// ── Helper: resolve owner context from auth token ─────────────────────────────

interface OwnerContext {
  ownerType: "msp" | "customer";
  mspId: number | null;
  customerId: number | null;
}

function resolveOwner(req: Request): OwnerContext | null {
  const user = req.user;
  if (!user) return null;

  // CustomerUser → webhook is scoped to their customer
  if (user.mspRole === "CustomerUser" && user.customerId) {
    return { ownerType: "customer", mspId: user.mspId ?? null, customerId: user.customerId };
  }

  // MSPAdmin / MSPOperator → webhook scoped to their MSP
  if (
    (user.mspRole === "MSPAdmin" || user.mspRole === "MSPOperator") &&
    user.mspId
  ) {
    return { ownerType: "msp", mspId: user.mspId, customerId: null };
  }

  // PlatformAdmin acting via portal endpoints — scope to msp if provided
  if (user.mspRole === "PlatformAdmin" || user.role === "admin") {
    const mspId = user.mspId ?? null;
    const customerId = user.customerId ?? null;
    const ownerType: "msp" | "customer" = customerId ? "customer" : "msp";
    return { ownerType, mspId, customerId };
  }

  return null;
}

function buildOwnerWhere(ctx: OwnerContext) {
  const conditions = [];
  if (ctx.mspId != null) conditions.push(eq(outboundWebhooksTable.mspId, ctx.mspId));
  if (ctx.customerId != null) conditions.push(eq(outboundWebhooksTable.customerId, ctx.customerId));
  return conditions;
}

// ── GET /api/portal/webhooks/event-types ─────────────────────────────────────

router.get("/portal/webhooks/event-types", requireAuth, (_req: Request, res: Response) => {
  res.json({ eventTypes: SUBSCRIBABLE_EVENT_TYPES });
});

// ── GET /api/portal/webhooks ──────────────────────────────────────────────────

router.get("/portal/webhooks", requireAuth, async (req: Request, res: Response) => {
  const ctx = resolveOwner(req);
  if (!ctx) {
    res.status(403).json({ error: "Insufficient permissions to list webhooks" });
    return;
  }

  const ownerConditions = buildOwnerWhere(ctx);
  const rows = await db
    .select({
      webhookId: outboundWebhooksTable.webhookId,
      label: outboundWebhooksTable.label,
      url: outboundWebhooksTable.url,
      secretPrefix: outboundWebhooksTable.secretPrefix,
      eventTypes: outboundWebhooksTable.eventTypes,
      isActive: outboundWebhooksTable.isActive,
      ownerType: outboundWebhooksTable.ownerType,
      mspId: outboundWebhooksTable.mspId,
      customerId: outboundWebhooksTable.customerId,
      createdAt: outboundWebhooksTable.createdAt,
      updatedAt: outboundWebhooksTable.updatedAt,
    })
    .from(outboundWebhooksTable)
    .where(ownerConditions.length > 0 ? and(...ownerConditions) : undefined)
    .orderBy(desc(outboundWebhooksTable.createdAt));

  res.json({ webhooks: rows });
});

// ── POST /api/portal/webhooks ─────────────────────────────────────────────────

router.post("/portal/webhooks", requireAuth, async (req: Request, res: Response) => {
  const ctx = resolveOwner(req);
  if (!ctx) {
    res.status(403).json({ error: "Insufficient permissions to create webhooks" });
    return;
  }

  const parsed = createWebhookSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
    return;
  }

  const { label, url, eventTypes } = parsed.data;
  const secret = generateWebhookSecret();
  const secretPrefix = secret.slice(0, 14); // "whsec_" + 8 chars of key

  const [row] = await db
    .insert(outboundWebhooksTable)
    .values({
      ownerType: ctx.ownerType,
      mspId: ctx.mspId,
      customerId: ctx.customerId,
      label,
      url,
      secret,
      secretPrefix,
      eventTypes,
      isActive: true,
    })
    .returning();

  if (!row) {
    res.status(500).json({ error: "Failed to create webhook" });
    return;
  }

  log.info(
    { webhookId: row.webhookId, label, mspId: ctx.mspId, customerId: ctx.customerId },
    "webhooks: created",
  );

  // Return full secret only on creation — never again
  res.status(201).json({
    webhook: {
      webhookId: row.webhookId,
      label: row.label,
      url: row.url,
      secret,
      secretPrefix: row.secretPrefix,
      eventTypes: row.eventTypes,
      isActive: row.isActive,
      ownerType: row.ownerType,
      mspId: row.mspId,
      customerId: row.customerId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    },
  });
});

// ── GET /api/portal/webhooks/:webhookId ───────────────────────────────────────

router.get("/portal/webhooks/:webhookId", requireAuth, async (req: Request, res: Response) => {
  const ctx = resolveOwner(req);
  if (!ctx) {
    res.status(403).json({ error: "Insufficient permissions" });
    return;
  }

  const webhookId = req.params['webhookId'] as string;
  const ownerConditions = buildOwnerWhere(ctx);

  const [row] = await db
    .select({
      webhookId: outboundWebhooksTable.webhookId,
      label: outboundWebhooksTable.label,
      url: outboundWebhooksTable.url,
      secretPrefix: outboundWebhooksTable.secretPrefix,
      eventTypes: outboundWebhooksTable.eventTypes,
      isActive: outboundWebhooksTable.isActive,
      ownerType: outboundWebhooksTable.ownerType,
      mspId: outboundWebhooksTable.mspId,
      customerId: outboundWebhooksTable.customerId,
      createdAt: outboundWebhooksTable.createdAt,
      updatedAt: outboundWebhooksTable.updatedAt,
    })
    .from(outboundWebhooksTable)
    .where(
      and(
        eq(outboundWebhooksTable.webhookId, webhookId),
        ...ownerConditions,
      ),
    )
    .limit(1);

  if (!row) {
    res.status(404).json({ error: "Webhook not found" });
    return;
  }

  res.json({ webhook: row });
});

// ── PATCH /api/portal/webhooks/:webhookId ─────────────────────────────────────

router.patch("/portal/webhooks/:webhookId", requireAuth, async (req: Request, res: Response) => {
  const ctx = resolveOwner(req);
  if (!ctx) {
    res.status(403).json({ error: "Insufficient permissions" });
    return;
  }

  const parsed = updateWebhookSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
    return;
  }

  const webhookId = req.params['webhookId'] as string;
  const ownerConditions = buildOwnerWhere(ctx);

  // Verify ownership
  const [existing] = await db
    .select({ webhookId: outboundWebhooksTable.webhookId })
    .from(outboundWebhooksTable)
    .where(and(eq(outboundWebhooksTable.webhookId, webhookId), ...ownerConditions))
    .limit(1);

  if (!existing) {
    res.status(404).json({ error: "Webhook not found" });
    return;
  }

  const updates: Partial<typeof outboundWebhooksTable.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (parsed.data.label !== undefined) updates.label = parsed.data.label;
  if (parsed.data.url !== undefined) updates.url = parsed.data.url;
  if (parsed.data.eventTypes !== undefined) updates.eventTypes = parsed.data.eventTypes;
  if (parsed.data.isActive !== undefined) updates.isActive = parsed.data.isActive;

  const [updated] = await db
    .update(outboundWebhooksTable)
    .set(updates)
    .where(eq(outboundWebhooksTable.webhookId, webhookId))
    .returning({
      webhookId: outboundWebhooksTable.webhookId,
      label: outboundWebhooksTable.label,
      url: outboundWebhooksTable.url,
      secretPrefix: outboundWebhooksTable.secretPrefix,
      eventTypes: outboundWebhooksTable.eventTypes,
      isActive: outboundWebhooksTable.isActive,
      ownerType: outboundWebhooksTable.ownerType,
      mspId: outboundWebhooksTable.mspId,
      customerId: outboundWebhooksTable.customerId,
      createdAt: outboundWebhooksTable.createdAt,
      updatedAt: outboundWebhooksTable.updatedAt,
    });

  res.json({ webhook: updated });
});

// ── DELETE /api/portal/webhooks/:webhookId ────────────────────────────────────

router.delete("/portal/webhooks/:webhookId", requireAuth, async (req: Request, res: Response) => {
  const ctx = resolveOwner(req);
  if (!ctx) {
    res.status(403).json({ error: "Insufficient permissions" });
    return;
  }

  const webhookId = req.params['webhookId'] as string;
  const ownerConditions = buildOwnerWhere(ctx);

  const [existing] = await db
    .select({ webhookId: outboundWebhooksTable.webhookId })
    .from(outboundWebhooksTable)
    .where(and(eq(outboundWebhooksTable.webhookId, webhookId), ...ownerConditions))
    .limit(1);

  if (!existing) {
    res.status(404).json({ error: "Webhook not found" });
    return;
  }

  await db
    .delete(outboundWebhooksTable)
    .where(eq(outboundWebhooksTable.webhookId, webhookId));

  res.status(204).send();
});

// ── POST /api/portal/webhooks/:webhookId/rotate-secret ───────────────────────

router.post(
  "/portal/webhooks/:webhookId/rotate-secret",
  requireAuth,
  async (req: Request, res: Response) => {
    const ctx = resolveOwner(req);
    if (!ctx) {
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }

    const webhookId = req.params['webhookId'] as string;
    const ownerConditions = buildOwnerWhere(ctx);

    const [existing] = await db
      .select({ webhookId: outboundWebhooksTable.webhookId })
      .from(outboundWebhooksTable)
      .where(and(eq(outboundWebhooksTable.webhookId, webhookId), ...ownerConditions))
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: "Webhook not found" });
      return;
    }

    const newSecret = generateWebhookSecret();
    const newPrefix = newSecret.slice(0, 14);

    await db
      .update(outboundWebhooksTable)
      .set({ secret: newSecret, secretPrefix: newPrefix, updatedAt: new Date() })
      .where(eq(outboundWebhooksTable.webhookId, webhookId));

    log.info({ webhookId }, "webhooks: secret rotated");

    // Return new secret once — caller must store it
    res.json({ secret: newSecret, secretPrefix: newPrefix });
  },
);

// ── GET /api/portal/webhooks/:webhookId/deliveries ───────────────────────────

router.get(
  "/portal/webhooks/:webhookId/deliveries",
  requireAuth,
  async (req: Request, res: Response) => {
    const ctx = resolveOwner(req);
    if (!ctx) {
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }

    const webhookId = req.params['webhookId'] as string;
    const ownerConditions = buildOwnerWhere(ctx);
    const limit = Math.min(Number(req.query.limit) || 50, 200);

    // Ownership check
    const [existing] = await db
      .select({ webhookId: outboundWebhooksTable.webhookId })
      .from(outboundWebhooksTable)
      .where(and(eq(outboundWebhooksTable.webhookId, webhookId), ...ownerConditions))
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: "Webhook not found" });
      return;
    }

    const deliveries = await getDeliveryLog(webhookId, limit);
    res.json({ deliveries });
  },
);

// ── Admin endpoints ───────────────────────────────────────────────────────────

router.get("/admin/webhooks", requireAdmin, async (req: Request, res: Response) => {
  const mspId = req.query.mspId ? Number(String(req.query.mspId)) : undefined;
  const customerId = req.query.customerId ? Number(String(req.query.customerId)) : undefined;

  const conditions = [];
  if (mspId) conditions.push(eq(outboundWebhooksTable.mspId, mspId));
  if (customerId) conditions.push(eq(outboundWebhooksTable.customerId, customerId));

  const rows = await db
    .select({
      webhookId: outboundWebhooksTable.webhookId,
      label: outboundWebhooksTable.label,
      url: outboundWebhooksTable.url,
      secretPrefix: outboundWebhooksTable.secretPrefix,
      eventTypes: outboundWebhooksTable.eventTypes,
      isActive: outboundWebhooksTable.isActive,
      ownerType: outboundWebhooksTable.ownerType,
      mspId: outboundWebhooksTable.mspId,
      customerId: outboundWebhooksTable.customerId,
      createdAt: outboundWebhooksTable.createdAt,
      updatedAt: outboundWebhooksTable.updatedAt,
    })
    .from(outboundWebhooksTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(outboundWebhooksTable.createdAt));

  res.json({ webhooks: rows });
});

router.get(
  "/admin/webhooks/:webhookId/deliveries",
  requireAdmin,
  async (req: Request, res: Response) => {
    const webhookId = req.params['webhookId'] as string;
    const limit = Math.min(Number(req.query.limit) || 50, 200);

    const [existing] = await db
      .select({ webhookId: outboundWebhooksTable.webhookId })
      .from(outboundWebhooksTable)
      .where(eq(outboundWebhooksTable.webhookId, webhookId))
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: "Webhook not found" });
      return;
    }

    const deliveries = await getDeliveryLog(webhookId, limit);
    res.json({ deliveries });
  },
);

export default router;
