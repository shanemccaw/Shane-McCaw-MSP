/**
 * dashboard-templates.ts
 *
 * CRUD surface for `dashboard_templates`, backing both:
 *   - Step 4b's Admin Dashboard Designer (artifacts/admin-panel/src/pages/dashboard-designer.tsx),
 *     PlatformAdmin only, cross-MSP.
 *   - The MSP-facing Dashboard Designer (artifacts/msp-portal/src/pages/dashboard-designer.tsx),
 *     MSPAdmin/MSPOperator, always scoped to their own MSP.
 *
 * This is intentionally minimal: enough for a designer to save/load a single
 * template's canvas layout. It does NOT implement the full template-resolution
 * logic (walking overrides, picking the right template for a given customer's
 * live dashboard) — that belongs to a later step that actually serves
 * customer/MSP dashboards.
 *
 * ── mspId scoping ──────────────────────────────────────────────────────────────
 * dashboard_templates.mspId is NOT NULL, but a PlatformAdmin session has no
 * mspId of its own (platform admins aren't tied to one MSP — this is a
 * multi-tenant MSP platform where each MSP could have its own templates). So
 * the /api/admin/* routes require an explicit `mspId` query/body param rather
 * than reading req.user.mspId; the admin designer UI provides an MSP picker
 * (reusing the existing GET /api/admin/msps list) to supply it.
 *
 * The /api/msp/* routes are the second, MSP-scoped path added alongside that:
 * MSPAdmin/MSPOperator callers have a real mspId of their own
 * (req.user.mspId), so those routes read it from the session — never from a
 * query/body param — and reject (403) any attempt to supply a different one.
 * This mirrors the dual-role branching precedent in dashboard-data.ts (POST
 * /api/dashboard/resolve): PlatformAdmin's explicit-param flow is untouched,
 * MSP roles get an own-identity-only second path, same handlers underneath.
 *
 * Routes:
 *   GET    /api/admin/dashboard-templates             list, ?mspId= required, optional ?templateType=
 *   GET    /api/admin/dashboard-templates/lookup       one by mspId+templateType+targetKey (targetKey omitted/empty for null)
 *   POST   /api/admin/dashboard-templates              create or update (upsert by mspId+templateType+targetKey)
 *   DELETE /api/admin/dashboard-templates/:id
 *
 *   GET    /api/msp/dashboard-templates                list, own mspId, optional ?templateType=
 *   GET    /api/msp/dashboard-templates/lookup          one by own mspId+templateType+targetKey
 *   POST   /api/msp/dashboard-templates                 create or update, own mspId only
 *   DELETE /api/msp/dashboard-templates/:id
 *
 *   GET    /api/msp/services?type=assessment|project    minimal catalog list for the
 *                                                        portal designer's targetKey picker
 *                                                        (servicesTable is a global platform
 *                                                        catalog, not per-MSP — same table
 *                                                        the admin designer already reads via
 *                                                        /api/admin/services, just without the
 *                                                        admin gate and full row shape).
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { db, servicesTable } from "@workspace/db";
import { dashboardTemplatesTable, DASHBOARD_TEMPLATE_TYPES } from "@workspace/db";
import { and, asc, eq, isNull } from "drizzle-orm";
import { requireRole } from "../middlewares/requireAuth";
import { detectProductType } from "../lib/productTypeConfig";
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

/**
 * Resolves the mspId to scope this request against, for both the admin
 * (explicit-param, PlatformAdmin-only) and msp (own-identity) route families.
 *
 * - requireOwn=false (admin routes): mspId comes from `rawMspId`. Returns null
 *   (caller 400s) if missing/invalid — PlatformAdmin has no mspId of its own.
 * - requireOwn=true (msp routes): mspId comes from req.user.mspId. If the
 *   caller also supplied `rawMspId` and it doesn't match their own, that's a
 *   403 (an MSP-role user trying to name a foreign mspId), signaled by
 *   returning "forbidden".
 */
function resolveScopedMspId(req: Request, rawMspId: unknown, requireOwn: boolean): number | null | "forbidden" {
  if (requireOwn) {
    const ownMspId = req.user?.mspId;
    if (!ownMspId) return null;
    const requested = parseMspId(rawMspId);
    if (requested != null && requested !== ownMspId) return "forbidden";
    return ownMspId;
  }
  return parseMspId(rawMspId);
}

// ── GET /dashboard-templates — list ────────────────────────────────────────────

async function listHandler(req: Request, res: Response, requireOwn: boolean) {
  const mspId = resolveScopedMspId(req, req.query.mspId, requireOwn);
  if (mspId === "forbidden") {
    res.status(403).json({ error: "You may only access your own MSP's dashboard templates" });
    return;
  }
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
}

router.get("/admin/dashboard-templates", requireRole("PlatformAdmin"), (req, res) => listHandler(req, res, false));
router.get("/msp/dashboard-templates", requireRole("MSPOperator"), (req, res) => listHandler(req, res, true));

// ── GET /dashboard-templates/lookup — one by type+key ──────────────────────────

async function lookupHandler(req: Request, res: Response, requireOwn: boolean) {
  const mspId = resolveScopedMspId(req, req.query.mspId, requireOwn);
  if (mspId === "forbidden") {
    res.status(403).json({ error: "You may only access your own MSP's dashboard templates" });
    return;
  }
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
}

router.get("/admin/dashboard-templates/lookup", requireRole("PlatformAdmin"), (req, res) => lookupHandler(req, res, false));
router.get("/msp/dashboard-templates/lookup", requireRole("MSPOperator"), (req, res) => lookupHandler(req, res, true));

// ── POST /dashboard-templates — create or update (upsert) ─────────────────────

const saveBodySchema = z.object({
  mspId: z.number().int().positive(),
  templateType: z.enum(DASHBOARD_TEMPLATE_TYPES),
  targetKey: z.string().min(1).nullable().optional(),
  canvasLayout: z.array(widgetInstanceSchema),
  allowCustomerEdit: z.boolean().optional(),
  isDefault: z.boolean().optional(),
});

async function saveHandler(req: Request, res: Response, requireOwn: boolean) {
  const parsed = saveBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }

  const mspId = resolveScopedMspId(req, parsed.data.mspId, requireOwn);
  if (mspId === "forbidden") {
    res.status(403).json({ error: "You may only save dashboard templates for your own MSP" });
    return;
  }
  if (!mspId) {
    res.status(400).json({ error: "mspId is required" });
    return;
  }

  const { templateType, canvasLayout, allowCustomerEdit, isDefault } = parsed.data;
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
}

router.post("/admin/dashboard-templates", requireRole("PlatformAdmin"), (req, res) => saveHandler(req, res, false));
router.post("/msp/dashboard-templates", requireRole("MSPOperator"), (req, res) => saveHandler(req, res, true));

// ── DELETE /dashboard-templates/:id ────────────────────────────────────────────

async function deleteHandler(req: Request, res: Response, requireOwn: boolean) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid template id" });
    return;
  }

  try {
    if (requireOwn) {
      const ownMspId = req.user?.mspId;
      if (!ownMspId) {
        res.status(400).json({ error: "No MSP association on this session" });
        return;
      }
      const [existing] = await db
        .select({ id: dashboardTemplatesTable.id, mspId: dashboardTemplatesTable.mspId })
        .from(dashboardTemplatesTable)
        .where(eq(dashboardTemplatesTable.id, id))
        .limit(1);
      if (!existing) {
        res.status(404).json({ error: "Template not found" });
        return;
      }
      if (existing.mspId !== ownMspId) {
        res.status(403).json({ error: "You may only delete your own MSP's dashboard templates" });
        return;
      }
    }

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
}

router.delete("/admin/dashboard-templates/:id", requireRole("PlatformAdmin"), (req, res) => deleteHandler(req, res, false));
router.delete("/msp/dashboard-templates/:id", requireRole("MSPOperator"), (req, res) => deleteHandler(req, res, true));

// ── GET /api/msp/services — minimal catalog list for the targetKey picker ──────

router.get("/msp/services", requireRole("MSPOperator"), async (req: Request, res: Response) => {
  const type = typeof req.query.type === "string" ? req.query.type : undefined;
  if (type && type !== "assessment" && type !== "project") {
    res.status(400).json({ error: `type must be "assessment" or "project"` });
    return;
  }

  try {
    const rows = await db
      .select({
        id: servicesTable.id,
        slug: servicesTable.slug,
        name: servicesTable.name,
        serviceClass: servicesTable.serviceClass,
        deliveryType: servicesTable.deliveryType,
        billingType: servicesTable.billingType,
        fulfillmentType: servicesTable.fulfillmentType,
      })
      .from(servicesTable)
      .orderBy(asc(servicesTable.sortOrder), asc(servicesTable.createdAt));

    const services = type
      ? rows.filter((s) => detectProductType(s.serviceClass, s.deliveryType, s.billingType, s.fulfillmentType) === type)
      : rows;

    res.json({ services: services.map((s) => ({ id: s.id, slug: s.slug, name: s.name })) });
  } catch (err) {
    log.error({ err, type }, "dashboard-templates: msp services list failed");
    res.status(500).json({ error: "Failed to list services" });
  }
});

export default router;
