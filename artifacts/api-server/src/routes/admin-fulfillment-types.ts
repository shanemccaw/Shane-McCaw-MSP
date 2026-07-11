/**
 * admin-fulfillment-types.ts
 *
 * Audit-logged CRUD for the fulfillment_types registry plus a manual
 * resolve endpoint for testing. All routes are admin-only.
 *
 * Routes
 * ──────
 * GET    /api/admin/fulfillment-types          — list all types
 * GET    /api/admin/fulfillment-types/:key     — get one type
 * POST   /api/admin/fulfillment-types          — create (audit-logged)
 * PUT    /api/admin/fulfillment-types/:key     — update (audit-logged)
 * DELETE /api/admin/fulfillment-types/:key     — delete (audit-logged)
 * POST   /api/admin/fulfillment-types/resolve  — manually trigger resolve_fulfillment
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, fulfillmentTypesTable, auditLogsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";
import { resolveFulfillment } from "../lib/resolve-fulfillment";
import { logger } from "../lib/logger";
import { z } from "zod";
import { randomUUID } from "crypto";

const router: IRouter = Router();

// ── Validation schemas ─────────────────────────────────────────────────────────

const FIRED_WHEN_VALUES = ["purchase", "signal", "manual"] as const;

const createSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9_]+$/, "key must be lowercase letters, digits, or underscores"),
  label: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  firedWhen: z.array(z.enum(FIRED_WHEN_VALUES)).default([]),
  recurring: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

const updateSchema = createSchema
  .omit({ key: true })
  .partial()
  .refine((d) => Object.keys(d).length > 0, { message: "Nothing to update" });

// ── Audit helper ───────────────────────────────────────────────────────────────

async function auditLog(
  req: Request,
  actionType: string,
  entityId: string,
  entityLabel: string,
  metadata?: Record<string, unknown>,
) {
  try {
    const actor = req.user as { id?: number; email?: string; role?: string } | undefined;
    await db.insert(auditLogsTable).values({
      actorUserId: actor?.id ?? null,
      actorName: actor?.email ?? "admin",
      actorRole: "admin",
      actionType,
      entityType: "fulfillment_type",
      entityId,
      entityLabel,
      metadata: metadata ?? {},
    });
  } catch (err) {
    logger.warn({ err, actionType, entityId }, "admin-fulfillment-types: audit log insert failed (non-fatal)");
  }
}

// ── List ───────────────────────────────────────────────────────────────────────

router.get("/admin/fulfillment-types", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const rows = await db
      .select()
      .from(fulfillmentTypesTable)
      .orderBy(desc(fulfillmentTypesTable.createdAt));
    res.json(rows);
  } catch (err) {
    logger.error({ err }, "admin-fulfillment-types: list failed");
    res.status(500).json({ error: "Failed to fetch fulfillment types" });
  }
});

// ── Export fulfillment types as JSON ──────────────────────────────────────────
// NOTE: must be registered before /:key so Express does not swallow "export" as a key param.

router.get("/admin/fulfillment-types/export", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const rows = await db.select().from(fulfillmentTypesTable).orderBy(desc(fulfillmentTypesTable.createdAt));
    const records = rows.map(r => ({
      key: r.key,
      label: r.label,
      description: r.description,
      firedWhen: r.firedWhen,
      recurring: r.recurring,
      isActive: r.isActive,
    }));
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      records,
      fulfillmentTypes: records,
    };
    res.setHeader("Content-Disposition", 'attachment; filename="fulfillment-types-export.json"');
    res.json(payload);
  } catch (err) {
    logger.error({ err }, "admin-fulfillment-types: export failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Export failed" });
  }
});

// ── Import template ────────────────────────────────────────────────────────────
// NOTE: must be registered before /:key for the same reason as /export above.

router.get("/admin/fulfillment-types/import-template", requireAdmin, (_req: Request, res: Response) => {
  const template = {
    version: 1,
    fulfillmentTypes: [
      {
        key: "example_type",
        label: "Example Type",
        description: "Fires when a client completes an example action.",
        firedWhen: ["purchase"],
        recurring: false,
        isActive: true,
      },
    ],
  };
  res.setHeader("Content-Disposition", 'attachment; filename="fulfillment-types-import-template.json"');
  res.json(template);
});

// ── Get one ────────────────────────────────────────────────────────────────────

router.get("/admin/fulfillment-types/:key", requireAdmin, async (req: Request, res: Response) => {
  const typeKey = String(req.params.key);
  try {
    const [row] = await db
      .select()
      .from(fulfillmentTypesTable)
      .where(eq(fulfillmentTypesTable.key, typeKey))
      .limit(1);
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (err) {
    logger.error({ err }, "admin-fulfillment-types: get failed");
    res.status(500).json({ error: "Failed to fetch fulfillment type" });
  }
});

// ── Create ─────────────────────────────────────────────────────────────────────

router.post("/admin/fulfillment-types", requireAdmin, async (req: Request, res: Response) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error", details: parsed.error.flatten() });
    return;
  }

  try {
    const [row] = await db
      .insert(fulfillmentTypesTable)
      .values(parsed.data)
      .returning();

    await auditLog(req, "create", parsed.data.key, parsed.data.label, { data: parsed.data });
    res.status(201).json(row);
  } catch (err: unknown) {
    const e = err as { code?: string };
    if (e.code === "23505") {
      res.status(409).json({ error: `A fulfillment type with key "${parsed.data.key}" already exists` });
      return;
    }
    logger.error({ err }, "admin-fulfillment-types: create failed");
    res.status(500).json({ error: "Failed to create fulfillment type" });
  }
});

// ── Update ─────────────────────────────────────────────────────────────────────

router.put("/admin/fulfillment-types/:key", requireAdmin, async (req: Request, res: Response) => {
  const typeKey = String(req.params.key);
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error", details: parsed.error.flatten() });
    return;
  }

  try {
    const [existing] = await db
      .select()
      .from(fulfillmentTypesTable)
      .where(eq(fulfillmentTypesTable.key, typeKey))
      .limit(1);
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }

    const [updated] = await db
      .update(fulfillmentTypesTable)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(fulfillmentTypesTable.key, typeKey))
      .returning();

    await auditLog(req, "update", typeKey, updated?.label ?? typeKey, {
      before: existing,
      after: parsed.data,
    });
    res.json(updated);
  } catch (err) {
    logger.error({ err }, "admin-fulfillment-types: update failed");
    res.status(500).json({ error: "Failed to update fulfillment type" });
  }
});

// ── Delete ─────────────────────────────────────────────────────────────────────

router.delete("/admin/fulfillment-types/:key", requireAdmin, async (req: Request, res: Response) => {
  const typeKey = String(req.params.key);
  try {
    const [existing] = await db
      .select()
      .from(fulfillmentTypesTable)
      .where(eq(fulfillmentTypesTable.key, typeKey))
      .limit(1);
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }

    await db
      .delete(fulfillmentTypesTable)
      .where(eq(fulfillmentTypesTable.key, typeKey));

    await auditLog(req, "delete", typeKey, existing.label, { deleted: existing });
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "admin-fulfillment-types: delete failed");
    res.status(500).json({ error: "Failed to delete fulfillment type" });
  }
});

// ── Manual resolve (test / backfill) ──────────────────────────────────────────
// Allows an admin to manually fire resolve_fulfillment from the panel without
// a real purchase or signal. Generates a fresh idempotency key so it always
// emits (unless the same uuid is supplied twice).

const resolveSchema = z.object({
  fulfillmentTypeKey: z.string().min(1),
  payload: z.record(z.unknown()).default({}),
  idempotencyKey: z.string().optional(),
});

router.post("/admin/fulfillment-types/resolve", requireAdmin, async (req: Request, res: Response) => {
  const parsed = resolveSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error", details: parsed.error.flatten() });
    return;
  }

  const { fulfillmentTypeKey, payload, idempotencyKey } = parsed.data;
  const key = idempotencyKey ?? `manual:${fulfillmentTypeKey}:${randomUUID()}`;

  const result = await resolveFulfillment({
    fulfillmentTypeKey,
    idempotencyKey: key,
    trigger: "manual",
    payload,
  });

  await auditLog(req, "manual_resolve", fulfillmentTypeKey, fulfillmentTypeKey, {
    result,
    idempotencyKey: key,
  });

  res.json(result);
});

// ── Import fulfillment types from JSON ────────────────────────────────────────

router.post("/admin/fulfillment-types/import", requireAdmin, async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as { version?: number; fulfillmentTypes?: unknown[]; records?: unknown[] };
    if (body.version !== undefined && body.version !== 1) {
      res.status(400).json({ error: `Unsupported export version: ${body.version}. Only version 1 is supported.` });
      return;
    }
    const typeList = Array.isArray(body.records) ? body.records : body.fulfillmentTypes;
    if (!Array.isArray(typeList)) {
      res.status(400).json({ error: "Body must contain a 'fulfillmentTypes' or 'records' array" });
      return;
    }
    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const item of typeList as Record<string, unknown>[]) {
      const parsed = createSchema.safeParse(item);
      if (!parsed.success) {
        errors.push(`Key "${String(item.key ?? "?")}" validation failed: ${JSON.stringify(parsed.error.flatten())}`);
        skipped++;
        continue;
      }
      const { key, label, description, firedWhen, recurring, isActive } = parsed.data;
      try {
        await db.insert(fulfillmentTypesTable).values({ key, label, description, firedWhen, recurring, isActive })
          .onConflictDoUpdate({
            target: fulfillmentTypesTable.key,
            set: { label, description, firedWhen, recurring, isActive },
          });
        imported++;
      } catch (e) {
        errors.push(`Key "${key}": ${e instanceof Error ? e.message : String(e)}`);
        skipped++;
      }
    }
    res.json({ imported, skipped, errors });
  } catch (err) {
    logger.error({ err }, "admin-fulfillment-types: import failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Import failed" });
  }
});

export default router;
