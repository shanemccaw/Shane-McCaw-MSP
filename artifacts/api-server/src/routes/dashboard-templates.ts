/**
 * dashboard-templates.ts
 *
 * Small admin-only CRUD surface for `dashboard_templates`, backing Step 4b's
 * Admin Dashboard Designer (artifacts/admin-panel/src/pages/dashboard-designer.tsx).
 * PlatformAdmin only — this is a design surface, not customer/MSP-facing.
 *
 * This is intentionally minimal: enough for the designer to save/load a single
 * template's canvas layout. It does NOT implement the full template-resolution
 * logic (walking overrides, picking the right template for a given customer's
 * live dashboard) — that belongs to a later step that actually serves
 * customer/MSP dashboards.
 *
 * ── mspId scoping ──────────────────────────────────────────────────────────────
 * dashboard_templates.mspId is NOT NULL, but a PlatformAdmin session has no
 * mspId of its own (platform admins aren't tied to one MSP — this is a
 * multi-tenant MSP platform where each MSP could have its own templates). So
 * every route here requires an explicit `mspId` query/body param rather than
 * reading req.user.mspId; the designer UI provides an MSP picker (reusing the
 * existing GET /api/admin/msps list) to supply it.
 *
 * Routes:
 *   GET    /api/admin/dashboard-templates                       list, ?mspId= required, optional ?templateType=
 *   GET    /api/admin/dashboard-templates/lookup                one by mspId+templateType+targetKey (targetKey omitted/empty for null)
 *   POST   /api/admin/dashboard-templates                       create or update (upsert by mspId+templateType+targetKey)
 *   DELETE /api/admin/dashboard-templates/:id
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { dashboardTemplatesTable, DASHBOARD_TEMPLATE_TYPES } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import { requireRole } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";

const log = logger.child({ channel: "engine.dashboard" });

const router: IRouter = Router();

// ── Shared widget-instance schema (matches WidgetInstance in @workspace/dashboard-canvas) ──

const widgetInstanceSchema = z.object({
  i: z.string().min(1),
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  w: z.number().int().min(1),
  h: z.number().int().min(1),
  metricKey: z.string().min(1),
  rendererType: z.string().min(1),
  displayMode: z.enum(["count", "percentage"]).optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
});

function parseMspId(raw: unknown): number | null {
  const n = typeof raw === "string" ? Number(raw) : typeof raw === "number" ? raw : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** targetKey is null for msp_overview/customer_default, a real string otherwise. */
function normalizeTargetKey(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  return s.length > 0 ? s : null;
}

// ── GET /api/admin/dashboard-templates — list ──────────────────────────────────

router.get("/admin/dashboard-templates", requireRole("PlatformAdmin"), async (req: Request, res: Response) => {
  const mspId = parseMspId(req.query.mspId);
  if (!mspId) {
    res.status(400).json({ error: "mspId query param is required" });
    return;
  }
  const templateType = typeof req.query.templateType === "string" ? req.query.templateType : undefined;
  if (templateType && !DASHBOARD_TEMPLATE_TYPES.includes(templateType as (typeof DASHBOARD_TEMPLATE_TYPES)[number])) {
    res.status(400).json({ error: `Invalid templateType. Must be one of: ${DASHBOARD_TEMPLATE_TYPES.join(", ")}` });
    return;
  }

  try {
    const conditions = [eq(dashboardTemplatesTable.mspId, mspId)];
    if (templateType) {
      conditions.push(eq(dashboardTemplatesTable.templateType, templateType as (typeof DASHBOARD_TEMPLATE_TYPES)[number]));
    }
    const templates = await db
      .select()
      .from(dashboardTemplatesTable)
      .where(and(...conditions))
      .orderBy(dashboardTemplatesTable.templateType, dashboardTemplatesTable.targetKey);
    res.json({ templates });
  } catch (err) {
    log.error({ err, mspId }, "dashboard-templates: list failed");
    res.status(500).json({ error: "Failed to list dashboard templates" });
  }
});

// ── GET /api/admin/dashboard-templates/lookup — one by type+key ───────────────

router.get("/admin/dashboard-templates/lookup", requireRole("PlatformAdmin"), async (req: Request, res: Response) => {
  const mspId = parseMspId(req.query.mspId);
  const templateType = typeof req.query.templateType === "string" ? req.query.templateType : undefined;
  if (!mspId || !templateType || !DASHBOARD_TEMPLATE_TYPES.includes(templateType as (typeof DASHBOARD_TEMPLATE_TYPES)[number])) {
    res.status(400).json({ error: "mspId and a valid templateType are required" });
    return;
  }
  const targetKey = normalizeTargetKey(req.query.targetKey);

  try {
    const [template] = await db
      .select()
      .from(dashboardTemplatesTable)
      .where(
        and(
          eq(dashboardTemplatesTable.mspId, mspId),
          eq(dashboardTemplatesTable.templateType, templateType as (typeof DASHBOARD_TEMPLATE_TYPES)[number]),
          targetKey == null ? isNull(dashboardTemplatesTable.targetKey) : eq(dashboardTemplatesTable.targetKey, targetKey),
        ),
      )
      .limit(1);
    res.json({ template: template ?? null });
  } catch (err) {
    log.error({ err, mspId, templateType, targetKey }, "dashboard-templates: lookup failed");
    res.status(500).json({ error: "Failed to look up dashboard template" });
  }
});

// ── POST /api/admin/dashboard-templates — create or update (upsert) ───────────

const saveBodySchema = z.object({
  mspId: z.number().int().positive(),
  templateType: z.enum(DASHBOARD_TEMPLATE_TYPES),
  targetKey: z.string().min(1).nullable().optional(),
  canvasLayout: z.array(widgetInstanceSchema),
  allowCustomerEdit: z.boolean().optional(),
  isDefault: z.boolean().optional(),
});

router.post("/admin/dashboard-templates", requireRole("PlatformAdmin"), async (req: Request, res: Response) => {
  const parsed = saveBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const { mspId, templateType, canvasLayout, allowCustomerEdit, isDefault } = parsed.data;
  const targetKey = normalizeTargetKey(parsed.data.targetKey);

  // msp_overview / customer_default never carry a targetKey; the other three require one.
  const requiresTargetKey = templateType === "assessment" || templateType === "project" || templateType === "monitoring_package";
  if (requiresTargetKey && !targetKey) {
    res.status(400).json({ error: `templateType "${templateType}" requires a targetKey` });
    return;
  }
  if (!requiresTargetKey && targetKey) {
    res.status(400).json({ error: `templateType "${templateType}" must not have a targetKey` });
    return;
  }

  try {
    const [existing] = await db
      .select({ id: dashboardTemplatesTable.id })
      .from(dashboardTemplatesTable)
      .where(
        and(
          eq(dashboardTemplatesTable.mspId, mspId),
          eq(dashboardTemplatesTable.templateType, templateType),
          targetKey == null ? isNull(dashboardTemplatesTable.targetKey) : eq(dashboardTemplatesTable.targetKey, targetKey),
        ),
      )
      .limit(1);

    let saved;
    if (existing) {
      [saved] = await db
        .update(dashboardTemplatesTable)
        .set({
          canvasLayout,
          ...(allowCustomerEdit !== undefined ? { allowCustomerEdit } : {}),
          ...(isDefault !== undefined ? { isDefault } : {}),
          updatedAt: new Date(),
        })
        .where(eq(dashboardTemplatesTable.id, existing.id))
        .returning();
    } else {
      [saved] = await db
        .insert(dashboardTemplatesTable)
        .values({
          mspId,
          templateType,
          targetKey,
          canvasLayout,
          allowCustomerEdit: allowCustomerEdit ?? true,
          isDefault: isDefault ?? false,
        })
        .returning();
    }

    log.info(
      {
        adminUserId: req.user?.id,
        mspId,
        templateType,
        targetKey,
        widgetCount: canvasLayout.length,
        action: existing ? "update" : "create",
      },
      "dashboard-templates: template saved",
    );

    res.status(existing ? 200 : 201).json({ template: saved });
  } catch (err) {
    log.error({ err, mspId, templateType, targetKey }, "dashboard-templates: save failed");
    res.status(500).json({ error: "Failed to save dashboard template" });
  }
});

// ── DELETE /api/admin/dashboard-templates/:id ──────────────────────────────────

router.delete("/admin/dashboard-templates/:id", requireRole("PlatformAdmin"), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid template id" });
    return;
  }

  try {
    const [deleted] = await db
      .delete(dashboardTemplatesTable)
      .where(eq(dashboardTemplatesTable.id, id))
      .returning({ id: dashboardTemplatesTable.id });

    if (!deleted) {
      res.status(404).json({ error: "Template not found" });
      return;
    }

    log.info({ adminUserId: req.user?.id, templateId: id }, "dashboard-templates: template deleted");
    res.json({ ok: true });
  } catch (err) {
    log.error({ err, templateId: id }, "dashboard-templates: delete failed");
    res.status(500).json({ error: "Failed to delete dashboard template" });
  }
});

export default router;
