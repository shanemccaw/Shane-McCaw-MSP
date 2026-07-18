/**
 * dashboard-overrides.ts
 *
 * Customer/MSP-facing surface for `dashboard_overrides` — Step 4c. Lets a
 * CustomerUser or MSPOperator+ view their resolved dashboard (template +
 * their own saved deltas merged) and save/reset those deltas.
 *
 * This is deliberately narrow, matching the two viewer-facing template types:
 *   - "customer_default" -> CustomerUser,  scopeType "customer",  scopeId = msp_customers.id
 *   - "msp_overview"     -> MSPOperator+,  scopeType "msp_user",  scopeId = msp_users.id
 * Resolving/merging "assessment"/"project"/"monitoring_package" templates is
 * out of scope here (separate per-page wiring decision, not yet made).
 *
 * Editing is constrained, not freeform: an override can only hide/reposition/
 * resize widgets that already exist in the template's own canvasLayout. It can
 * never introduce a widget id the template doesn't have — that's enforced here
 * server-side (PUT strips/rejects unknown widget ids), not just in the UI.
 *
 * overrideLayout delta shape (never a full layout copy):
 *   {
 *     hidden: string[]                              // widget `i`s to hide
 *     positions: Record<string, {x,y,w,h}>           // widget `i` -> new placement
 *   }
 *
 * Routes:
 *   GET    /api/dashboard/resolved   resolve the caller's template + override -> merged view
 *   PUT    /api/dashboard/overrides  save the caller's override deltas (insert or update)
 *   DELETE /api/dashboard/overrides  reset — delete the caller's override row
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  dashboardTemplatesTable,
  dashboardOverridesTable,
  mspUsersTable,
  type DashboardTemplate,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { requireRole } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";

const log = logger.child({ channel: "engine.dashboard" });

const router: IRouter = Router();

// ── Shared types ────────────────────────────────────────────────────────────

interface OverrideLayout {
  [key: string]: unknown;
  hidden: string[];
  positions: Record<string, { x: number; y: number; w: number; h: number }>;
}

type ResolvedScope =
  | { templateType: "customer_default"; scopeType: "customer"; scopeId: number }
  | { templateType: "msp_overview"; scopeType: "msp_user"; scopeId: number };

function emptyOverrideLayout(): OverrideLayout {
  return { hidden: [], positions: {} };
}

function parseOverrideLayout(raw: unknown): OverrideLayout {
  const obj = (raw ?? {}) as Partial<OverrideLayout>;
  return {
    hidden: Array.isArray(obj.hidden) ? obj.hidden.filter((h): h is string => typeof h === "string") : [],
    positions: obj.positions && typeof obj.positions === "object" ? (obj.positions as OverrideLayout["positions"]) : {},
  };
}

/** Apply an override's deltas on top of a template's canvasLayout, dropping hidden widgets. */
function mergeLayout(canvasLayout: DashboardTemplate["canvasLayout"], override: OverrideLayout) {
  const hidden = new Set(override.hidden);
  return canvasLayout
    .filter((w) => !hidden.has(w.i))
    .map((w) => {
      const pos = override.positions[w.i];
      return pos ? { ...w, x: pos.x, y: pos.y, w: pos.w, h: pos.h } : w;
    });
}

/**
 * Determine which template/scope this caller resolves against, per the MVP's
 * two supported template types. Returns null if the caller's role isn't one
 * of the two supported viewer roles, or scope info is missing from the JWT.
 */
async function resolveCallerScope(req: Request): Promise<ResolvedScope | { error: string } | null> {
  const user = req.user!;
  const effectiveRole = user.role === "admin" ? "PlatformAdmin" : user.mspRole;

  if (effectiveRole === "CustomerUser" || effectiveRole === "Free") {
    if (user.customerId == null) return { error: "No customer association on this session" };
    return { templateType: "customer_default", scopeType: "customer", scopeId: user.customerId };
  }

  if (effectiveRole === "MSPOperator" || effectiveRole === "MSPAdmin" || effectiveRole === "PlatformAdmin") {
    const [mspUser] = await db
      .select({ id: mspUsersTable.id })
      .from(mspUsersTable)
      .where(eq(mspUsersTable.userId, user.id))
      .limit(1);
    if (!mspUser) return { error: "No MSP user profile found for this session" };
    return { templateType: "msp_overview", scopeType: "msp_user", scopeId: mspUser.id };
  }

  return null;
}

async function findDefaultTemplate(mspId: number, templateType: "customer_default" | "msp_overview") {
  const [template] = await db
    .select()
    .from(dashboardTemplatesTable)
    .where(
      and(
        eq(dashboardTemplatesTable.mspId, mspId),
        eq(dashboardTemplatesTable.templateType, templateType),
        eq(dashboardTemplatesTable.isDefault, true),
      ),
    )
    .limit(1);
  return template ?? null;
}

async function findOverride(templateId: number, scopeType: "customer" | "msp_user", scopeId: number) {
  const [override] = await db
    .select()
    .from(dashboardOverridesTable)
    .where(
      and(
        eq(dashboardOverridesTable.templateId, templateId),
        eq(dashboardOverridesTable.scopeType, scopeType),
        eq(dashboardOverridesTable.scopeId, scopeId),
      ),
    )
    .limit(1);
  return override ?? null;
}

// ── GET /api/dashboard/resolved ────────────────────────────────────────────

router.get("/dashboard/resolved", requireRole("CustomerUser"), async (req: Request, res: Response) => {
  const user = req.user!;
  if (user.mspId == null) {
    res.status(400).json({ error: "No MSP association on this session" });
    return;
  }

  const scope = await resolveCallerScope(req);
  if (scope == null) {
    res.status(403).json({ error: "This role cannot resolve a dashboard" });
    return;
  }
  if ("error" in scope) {
    res.status(400).json({ error: scope.error });
    return;
  }

  try {
    const template = await findDefaultTemplate(user.mspId, scope.templateType);
    if (!template) {
      res.json({ configured: false });
      return;
    }

    const override = await findOverride(template.id, scope.scopeType, scope.scopeId);
    const overrideLayout = override ? parseOverrideLayout(override.overrideLayout) : emptyOverrideLayout();
    const widgets = mergeLayout(template.canvasLayout, overrideLayout);

    res.json({
      configured: true,
      editable: template.allowCustomerEdit,
      templateId: template.id,
      templateType: template.templateType,
      widgets,
      hasOverride: Boolean(override),
    });
  } catch (err) {
    log.error({ err, userId: user.id, templateType: scope.templateType }, "dashboard-overrides: resolve failed");
    res.status(500).json({ error: "Failed to resolve dashboard" });
  }
});

// ── PUT /api/dashboard/overrides — save deltas ─────────────────────────────

const positionSchema = z.object({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  w: z.number().int().min(1),
  h: z.number().int().min(1),
});

const saveOverrideBodySchema = z.object({
  hidden: z.array(z.string().min(1)).optional().default([]),
  positions: z.record(z.string(), positionSchema).optional().default({}),
});

router.put("/dashboard/overrides", requireRole("CustomerUser"), async (req: Request, res: Response) => {
  const user = req.user!;
  if (user.mspId == null) {
    res.status(400).json({ error: "No MSP association on this session" });
    return;
  }

  const scope = await resolveCallerScope(req);
  if (scope == null) {
    res.status(403).json({ error: "This role cannot save a dashboard override" });
    return;
  }
  if ("error" in scope) {
    res.status(400).json({ error: scope.error });
    return;
  }

  const parsed = saveOverrideBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }

  try {
    const template = await findDefaultTemplate(user.mspId, scope.templateType);
    if (!template) {
      res.status(404).json({ error: "No dashboard template configured for this scope" });
      return;
    }
    if (!template.allowCustomerEdit) {
      res.status(403).json({ error: "This dashboard does not allow editing" });
      return;
    }

    // Enforce constrained editing server-side: strip/reject any widget id that
    // isn't actually present in the template's own canvasLayout. A hand-crafted
    // request naming a widget the template doesn't have is rejected outright,
    // not silently dropped — that's the real enforcement point, not the UI.
    const validIds = new Set(template.canvasLayout.map((w) => w.i));
    const invalidHidden = parsed.data.hidden.filter((id) => !validIds.has(id));
    const invalidPositions = Object.keys(parsed.data.positions).filter((id) => !validIds.has(id));
    if (invalidHidden.length > 0 || invalidPositions.length > 0) {
      res.status(400).json({
        error: "Override references widget ids not present in the template",
        invalidWidgetIds: [...new Set([...invalidHidden, ...invalidPositions])],
      });
      return;
    }

    const overrideLayout: OverrideLayout = {
      hidden: parsed.data.hidden,
      positions: parsed.data.positions,
    };

    const existing = await findOverride(template.id, scope.scopeType, scope.scopeId);

    let saved;
    if (existing) {
      [saved] = await db
        .update(dashboardOverridesTable)
        .set({ overrideLayout, updatedAt: new Date() })
        .where(eq(dashboardOverridesTable.id, existing.id))
        .returning();
    } else {
      [saved] = await db
        .insert(dashboardOverridesTable)
        .values({
          templateId: template.id,
          scopeType: scope.scopeType,
          scopeId: scope.scopeId,
          overrideLayout,
        })
        .returning();
    }

    log.info(
      {
        userId: user.id,
        templateId: template.id,
        scopeType: scope.scopeType,
        scopeId: scope.scopeId,
        hiddenCount: overrideLayout.hidden.length,
        positionCount: Object.keys(overrideLayout.positions).length,
        action: existing ? "update" : "create",
      },
      "dashboard-overrides: override saved",
    );

    res.status(existing ? 200 : 201).json({ override: saved });
  } catch (err) {
    log.error({ err, userId: user.id, templateType: scope.templateType }, "dashboard-overrides: save failed");
    res.status(500).json({ error: "Failed to save dashboard override" });
  }
});

// ── DELETE /api/dashboard/overrides — reset to template default ───────────

router.delete("/dashboard/overrides", requireRole("CustomerUser"), async (req: Request, res: Response) => {
  const user = req.user!;
  if (user.mspId == null) {
    res.status(400).json({ error: "No MSP association on this session" });
    return;
  }

  const scope = await resolveCallerScope(req);
  if (scope == null) {
    res.status(403).json({ error: "This role cannot reset a dashboard override" });
    return;
  }
  if ("error" in scope) {
    res.status(400).json({ error: scope.error });
    return;
  }

  try {
    const template = await findDefaultTemplate(user.mspId, scope.templateType);
    if (!template) {
      res.status(404).json({ error: "No dashboard template configured for this scope" });
      return;
    }

    await db
      .delete(dashboardOverridesTable)
      .where(
        and(
          eq(dashboardOverridesTable.templateId, template.id),
          eq(dashboardOverridesTable.scopeType, scope.scopeType),
          eq(dashboardOverridesTable.scopeId, scope.scopeId),
        ),
      );

    log.info(
      { userId: user.id, templateId: template.id, scopeType: scope.scopeType, scopeId: scope.scopeId },
      "dashboard-overrides: override reset",
    );

    res.json({ ok: true });
  } catch (err) {
    log.error({ err, userId: user.id, templateType: scope.templateType }, "dashboard-overrides: reset failed");
    res.status(500).json({ error: "Failed to reset dashboard override" });
  }
});

export default router;
