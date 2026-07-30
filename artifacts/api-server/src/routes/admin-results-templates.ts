/**
 * admin-results-templates.ts
 *
 * Audit-logged CRUD for the results_templates registry — the admin-editable
 * mapping of each assessment product (services row) to one of the 4 fixed
 * Results Template families, modeled on admin-document-types.ts. All routes
 * are admin-only.
 *
 * Registry infra only (#162, parent #161). No results-page rendering lives
 * here — that's a separate phase (#163).
 *
 * Routes
 * ──────
 * GET    /api/admin/results-templates                      — list all (optional ?family=)
 * GET    /api/admin/results-templates/:key                 — get one by its own key
 * GET    /api/admin/results-templates/by-service/:serviceId — get one by mapped services.id
 * POST   /api/admin/results-templates                      — create (audit-logged)
 * PUT    /api/admin/results-templates/:key                 — update (audit-logged)
 * POST   /api/admin/results-templates/:key/deactivate       — soft-deactivate (audit-logged)
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, resultsTemplatesTable, auditLogsTable, RESULTS_TEMPLATE_FAMILIES } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";
import { invalidateResultsTemplateCache } from "../lib/results-templates";
import { logger } from "../lib/logger";
const log = logger.child({ channel: "engine.assessment-results" });
import { z } from "zod";

const router: IRouter = Router();

// ── Validation schemas ─────────────────────────────────────────────────────────

const createSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9_]+$/, "key must be lowercase letters, digits, or underscores"),
  label: z.string().min(1).max(200),
  family: z.enum(RESULTS_TEMPLATE_FAMILIES),
  serviceId: z.number().int().positive(),
  config: z.record(z.unknown()).default({}),
  narrativeCopyHints: z.record(z.string()).default({}),
  sortOrder: z.number().int().default(0),
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
      entityType: "results_template",
      entityId,
      entityLabel,
      metadata: metadata ?? {},
    });
  } catch (err) {
    log.warn({ err, actionType, entityId }, "admin-results-templates: audit log insert failed (non-fatal)");
  }
}

// ── List ───────────────────────────────────────────────────────────────────────

router.get("/admin/results-templates", requireAdmin, async (req: Request, res: Response) => {
  try {
    const family = req.query["family"];
    const conditions = typeof family === "string" && (RESULTS_TEMPLATE_FAMILIES as readonly string[]).includes(family)
      ? [eq(resultsTemplatesTable.family, family as (typeof RESULTS_TEMPLATE_FAMILIES)[number])]
      : [];
    const rows = await db
      .select()
      .from(resultsTemplatesTable)
      .where(conditions.length ? conditions[0] : undefined)
      .orderBy(asc(resultsTemplatesTable.sortOrder));
    res.json(rows);
  } catch (err) {
    log.error({ err }, "admin-results-templates: list failed");
    res.status(500).json({ error: "Failed to fetch results templates" });
  }
});

// ── Get one by key ─────────────────────────────────────────────────────────────

router.get("/admin/results-templates/:key", requireAdmin, async (req: Request, res: Response) => {
  const templateKey = String(req.params.key);
  try {
    const [row] = await db
      .select()
      .from(resultsTemplatesTable)
      .where(eq(resultsTemplatesTable.key, templateKey))
      .limit(1);
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (err) {
    log.error({ err }, "admin-results-templates: get failed");
    res.status(500).json({ error: "Failed to fetch results template" });
  }
});

// ── Get one by mapped service id ─────────────────────────────────────────────────

router.get("/admin/results-templates/by-service/:serviceId", requireAdmin, async (req: Request, res: Response) => {
  const serviceId = parseInt(String(req.params.serviceId ?? ""), 10);
  if (isNaN(serviceId)) {
    res.status(400).json({ error: "serviceId must be a number" });
    return;
  }
  try {
    const [row] = await db
      .select()
      .from(resultsTemplatesTable)
      .where(eq(resultsTemplatesTable.serviceId, serviceId))
      .limit(1);
    if (!row) { res.status(404).json({ error: "No results template mapped for this service" }); return; }
    res.json(row);
  } catch (err) {
    log.error({ err, serviceId }, "admin-results-templates: get-by-service failed");
    res.status(500).json({ error: "Failed to fetch results template" });
  }
});

// ── Create ─────────────────────────────────────────────────────────────────────

router.post("/admin/results-templates", requireAdmin, async (req: Request, res: Response) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error", details: parsed.error.flatten() });
    return;
  }
  const { key, label, family, serviceId, config, narrativeCopyHints, sortOrder, isActive } = parsed.data;

  try {
    const [row] = await db
      .insert(resultsTemplatesTable)
      .values({ key, label, family, serviceId, config, narrativeCopyHints, sortOrder, isActive })
      .returning();

    invalidateResultsTemplateCache();
    await auditLog(req, "create", key, label, { data: parsed.data });
    res.status(201).json(row);
  } catch (err: unknown) {
    const e = err as { code?: string; constraint?: string };
    if (e.code === "23505") {
      const message = e.constraint?.includes("service_id")
        ? `Service ${serviceId} already has a results template mapped`
        : `A results template with key "${key}" already exists`;
      res.status(409).json({ error: message });
      return;
    }
    log.error({ err }, "admin-results-templates: create failed");
    res.status(500).json({ error: "Failed to create results template" });
  }
});

// ── Update ─────────────────────────────────────────────────────────────────────

router.put("/admin/results-templates/:key", requireAdmin, async (req: Request, res: Response) => {
  const templateKey = String(req.params.key);
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error", details: parsed.error.flatten() });
    return;
  }

  try {
    const [existing] = await db
      .select()
      .from(resultsTemplatesTable)
      .where(eq(resultsTemplatesTable.key, templateKey))
      .limit(1);
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }

    const [updated] = await db
      .update(resultsTemplatesTable)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(resultsTemplatesTable.key, templateKey))
      .returning();

    invalidateResultsTemplateCache();
    await auditLog(req, "update", templateKey, updated?.label ?? templateKey, {
      before: existing,
      after: parsed.data,
    });
    res.json(updated);
  } catch (err: unknown) {
    const e = err as { code?: string; constraint?: string };
    if (e.code === "23505") {
      res.status(409).json({ error: "Another results template already maps to that service" });
      return;
    }
    log.error({ err }, "admin-results-templates: update failed");
    res.status(500).json({ error: "Failed to update results template" });
  }
});

// ── Deactivate ─────────────────────────────────────────────────────────────────
// Soft-toggle only — never a hard delete, mirroring document_types (a future
// consumer may reference the key by free text once #163 lands).

router.post("/admin/results-templates/:key/deactivate", requireAdmin, async (req: Request, res: Response) => {
  const templateKey = String(req.params.key);
  try {
    const [existing] = await db
      .select()
      .from(resultsTemplatesTable)
      .where(eq(resultsTemplatesTable.key, templateKey))
      .limit(1);
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }

    const [updated] = await db
      .update(resultsTemplatesTable)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(resultsTemplatesTable.key, templateKey))
      .returning();

    invalidateResultsTemplateCache();
    await auditLog(req, "deactivate", templateKey, existing.label, {});
    res.json(updated);
  } catch (err) {
    log.error({ err }, "admin-results-templates: deactivate failed");
    res.status(500).json({ error: "Failed to deactivate results template" });
  }
});

export default router;
