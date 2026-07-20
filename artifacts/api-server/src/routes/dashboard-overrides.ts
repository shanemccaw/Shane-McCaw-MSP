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
 * Resolving/merging "assessment"/"project" templates is out of scope here —
 * blocked on a separate, already-tracked backlog gap: projectsTable links to
 * a customer via clientUserId -> usersTable.id with no working path back to
 * mspId/customerId. "monitoring_package" resolution IS supported (see
 * resolveMonitoringPackageKeys below) — a customer's active Sales Bundle
 * assignments determine which monitoring_package dashboards apply to them.
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
 *     rendererTypes: Record<string, string>          // widget `i` -> new rendererType
 *   }
 *
 * rendererTypes only ever changes *how* an existing widget's metric is
 * displayed (e.g. Stat -> Gauge) — it can never introduce a metricKey that
 * wasn't already in the template, same constraint as hidden/positions. The
 * PUT handler additionally rejects a rendererType that isn't shape-compatible
 * with that widget's metric, per @workspace/dashboard-registry's
 * getValidRenderersForMetric (the same compatibility rule the MSP-side
 * Designer palette uses).
 *
 * Routes:
 *   GET    /api/dashboard/resolved       resolve the caller's single default template
 *                                         (customer_default or msp_overview) + override -> merged view
 *   GET    /api/dashboard/resolved-list  resolve EVERY applicable dashboard for the caller —
 *                                         customer_default/msp_overview plus one entry per active
 *                                         monitoring_package the caller's customer has been sold
 *                                         (and an MSP has actually built a template for)
 *   PUT    /api/dashboard/overrides      save the caller's override deltas (insert or update)
 *   DELETE /api/dashboard/overrides      reset — delete the caller's override row
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  dashboardTemplatesTable,
  dashboardOverridesTable,
  mspUsersTable,
  mspSalesBundleAssignmentsTable,
  mspSalesBundlesTable,
  monitoringPackagesTable,
  type DashboardTemplate,
} from "@workspace/db";
import { getValidRenderersForMetric } from "@workspace/dashboard-registry";
import { and, eq, inArray } from "drizzle-orm";
import { requireRole } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";

const log = logger.child({ channel: "engine.dashboard" });

const router: IRouter = Router();

// ── Shared types ────────────────────────────────────────────────────────────

export interface OverrideLayout {
  [key: string]: unknown;
  hidden: string[];
  positions: Record<string, { x: number; y: number; w: number; h: number }>;
  rendererTypes: Record<string, string>;
}

export type ResolvedScope =
  | { templateType: "customer_default"; scopeType: "customer"; scopeId: number }
  | { templateType: "msp_overview"; scopeType: "msp_user"; scopeId: number };

function emptyOverrideLayout(): OverrideLayout {
  return { hidden: [], positions: {}, rendererTypes: {} };
}

function parseOverrideLayout(raw: unknown): OverrideLayout {
  const obj = (raw ?? {}) as Partial<OverrideLayout>;
  return {
    hidden: Array.isArray(obj.hidden) ? obj.hidden.filter((h): h is string => typeof h === "string") : [],
    positions: obj.positions && typeof obj.positions === "object" ? (obj.positions as OverrideLayout["positions"]) : {},
    rendererTypes:
      obj.rendererTypes && typeof obj.rendererTypes === "object" ? (obj.rendererTypes as OverrideLayout["rendererTypes"]) : {},
  };
}

/** Apply an override's deltas on top of a template's canvasLayout, dropping hidden widgets. */
function mergeLayout(canvasLayout: DashboardTemplate["canvasLayout"], override: OverrideLayout) {
  const hidden = new Set(override.hidden);
  return canvasLayout
    .filter((w) => !hidden.has(w.i))
    .map((w) => {
      const pos = override.positions[w.i];
      const rendererType = override.rendererTypes[w.i];
      return {
        ...w,
        ...(pos ? { x: pos.x, y: pos.y, w: pos.w, h: pos.h } : {}),
        ...(rendererType ? { rendererType } : {}),
      };
    });
}

/**
 * Determine which template/scope this caller resolves against, per the MVP's
 * two supported template types. Returns null if the caller's role isn't one
 * of the two supported viewer roles, or scope info is missing from the JWT.
 */
export async function resolveCallerScope(req: Request): Promise<ResolvedScope | { error: string } | null> {
  const user = req.user!;
  const effectiveRole = user.role === "admin" ? "PlatformAdmin" : user.mspRole;

  if (effectiveRole === "CustomerUser" || effectiveRole === "Free" || effectiveRole === "Assessment") {
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

export async function findDefaultTemplate(mspId: number, templateType: "customer_default" | "msp_overview") {
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

/** Merge a specific template against the caller's override for that scope -> the same shape GET /resolved returns. */
export async function resolveTemplate(template: DashboardTemplate, scopeType: "customer" | "msp_user", scopeId: number) {
  const override = await findOverride(template.id, scopeType, scopeId);
  const overrideLayout = override ? parseOverrideLayout(override.overrideLayout) : emptyOverrideLayout();
  const widgets = mergeLayout(template.canvasLayout, overrideLayout);

  return {
    configured: true as const,
    editable: template.allowCustomerEdit,
    templateId: template.id,
    templateType: template.templateType,
    widgets,
    hasOverride: Boolean(override),
  };
}

/**
 * Resolves the template a PUT/DELETE /overrides call should target.
 *
 * - No targetKey supplied (the common case, and the only case before tabs
 *   existed): the caller's default template for their scope's templateType
 *   (customer_default or msp_overview) — identical to prior behavior.
 * - targetKey supplied: must be a monitoring_package the caller's customer
 *   actually has active (per resolveMonitoringPackageKeys) — anything else is
 *   rejected, not silently ignored, since this is also the write-path
 *   authorization check (a customer can't save overrides against a package
 *   they were never sold, or another MSP's template).
 */
async function resolveTargetTemplate(
  mspId: number,
  scope: ResolvedScope,
  targetKey: string | null,
): Promise<DashboardTemplate | null | "forbidden"> {
  if (targetKey == null) {
    return findDefaultTemplate(mspId, scope.templateType);
  }
  if (scope.templateType !== "customer_default") return "forbidden";

  const customerId = scope.scopeId;
  const allowedKeys = await resolveMonitoringPackageKeys(mspId, customerId);
  if (!allowedKeys.includes(targetKey)) return "forbidden";

  const [template] = await db
    .select()
    .from(dashboardTemplatesTable)
    .where(
      and(
        eq(dashboardTemplatesTable.mspId, mspId),
        eq(dashboardTemplatesTable.templateType, "monitoring_package"),
        eq(dashboardTemplatesTable.targetKey, targetKey),
      ),
    )
    .limit(1);
  return template ?? null;
}

/**
 * Which monitoring_package targetKeys apply to a customer, derived from their
 * active Sales Bundle assignments. A customer can have more than one active
 * assignment — msp_sales_bundle_assignments has no uniqueness constraint on
 * customerId alone, only plain indexes — so each active assignment's bundle
 * contributes its own package keys, deduped across all of them.
 */
async function resolveMonitoringPackageKeys(mspId: number, customerId: number): Promise<string[]> {
  const assignments = await db
    .select({ bundleId: mspSalesBundleAssignmentsTable.bundleId })
    .from(mspSalesBundleAssignmentsTable)
    .where(
      and(
        eq(mspSalesBundleAssignmentsTable.mspId, mspId),
        eq(mspSalesBundleAssignmentsTable.customerId, customerId),
        eq(mspSalesBundleAssignmentsTable.status, "active"),
      ),
    );
  if (assignments.length === 0) return [];

  const bundleIds = [...new Set(assignments.map((a) => a.bundleId))];
  const bundles = await db
    .select({ monitoringPackageKeys: mspSalesBundlesTable.monitoringPackageKeys })
    .from(mspSalesBundlesTable)
    .where(inArray(mspSalesBundlesTable.bundleId, bundleIds));

  const keys = new Set<string>();
  for (const bundle of bundles) {
    for (const key of bundle.monitoringPackageKeys) keys.add(key);
  }
  return [...keys];
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

    res.json(await resolveTemplate(template, scope.scopeType, scope.scopeId));
  } catch (err) {
    log.error({ err, userId: user.id, templateType: scope.templateType }, "dashboard-overrides: resolve failed");
    res.status(500).json({ error: "Failed to resolve dashboard" });
  }
});

// ── GET /api/dashboard/resolved-list — every applicable dashboard ─────────
//
// customer_default/msp_overview (same as /resolved) plus one entry per active
// monitoring_package the caller's customer has been sold AND an MSP has
// actually built a dashboard_templates row for. "project"/"assessment" are
// excluded — blocked on the projectsTable -> mspId/customerId linkage gap.

router.get("/dashboard/resolved-list", requireRole("CustomerUser"), async (req: Request, res: Response) => {
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
    const entries: Array<{
      templateType: DashboardTemplate["templateType"];
      targetKey: string | null;
      label: string;
      resolved: Awaited<ReturnType<typeof resolveTemplate>> | { configured: false };
    }> = [];

    const defaultTemplate = await findDefaultTemplate(user.mspId, scope.templateType);
    if (defaultTemplate) {
      entries.push({
        templateType: scope.templateType,
        targetKey: null,
        label: scope.templateType === "customer_default" ? "Overview" : "MSP Overview",
        resolved: await resolveTemplate(defaultTemplate, scope.scopeType, scope.scopeId),
      });
    }

    // Monitoring package dashboards only apply to customer-scoped viewers —
    // an MSPOperator/MSPAdmin/PlatformAdmin viewing "msp_overview" has no
    // single customerId to resolve packages against.
    if (scope.templateType === "customer_default" && user.customerId != null) {
      const packageKeys = await resolveMonitoringPackageKeys(user.mspId, user.customerId);
      if (packageKeys.length > 0) {
        const packageTemplates = await db
          .select()
          .from(dashboardTemplatesTable)
          .where(
            and(
              eq(dashboardTemplatesTable.mspId, user.mspId),
              eq(dashboardTemplatesTable.templateType, "monitoring_package"),
              inArray(dashboardTemplatesTable.targetKey, packageKeys),
            ),
          );

        if (packageTemplates.length > 0) {
          const packages = await db
            .select({ key: monitoringPackagesTable.key, label: monitoringPackagesTable.label })
            .from(monitoringPackagesTable)
            .where(inArray(monitoringPackagesTable.key, packageTemplates.map((t) => t.targetKey!)));
          const labelByKey = new Map(packages.map((p) => [p.key, p.label]));

          for (const template of packageTemplates) {
            entries.push({
              templateType: "monitoring_package",
              targetKey: template.targetKey,
              label: labelByKey.get(template.targetKey!) ?? template.targetKey!,
              resolved: await resolveTemplate(template, scope.scopeType, scope.scopeId),
            });
          }
        }
      }
    }

    res.json({ dashboards: entries });
  } catch (err) {
    log.error({ err, userId: user.id, templateType: scope.templateType }, "dashboard-overrides: resolved-list failed");
    res.status(500).json({ error: "Failed to resolve dashboards" });
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
  // widget `i` -> new rendererType (e.g. "Bar" swapped in for "Trend"). Never
  // changes which metric a widget shows, only how — see the header comment.
  rendererTypes: z.record(z.string(), z.string().min(1)).optional().default({}),
  // Present only when saving an override for a monitoring_package tab; omitted
  // (or null) targets the caller's default template, same as before tabs existed.
  targetKey: z.string().min(1).nullable().optional(),
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
    const template = await resolveTargetTemplate(user.mspId, scope, parsed.data.targetKey ?? null);
    if (template === "forbidden") {
      res.status(403).json({ error: "You do not have access to that dashboard" });
      return;
    }
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
    const widgetsById = new Map(template.canvasLayout.map((w) => [w.i, w]));
    const validIds = new Set(widgetsById.keys());
    const invalidHidden = parsed.data.hidden.filter((id) => !validIds.has(id));
    const invalidPositions = Object.keys(parsed.data.positions).filter((id) => !validIds.has(id));
    const invalidRendererTypes = Object.keys(parsed.data.rendererTypes).filter((id) => !validIds.has(id));
    if (invalidHidden.length > 0 || invalidPositions.length > 0 || invalidRendererTypes.length > 0) {
      res.status(400).json({
        error: "Override references widget ids not present in the template",
        invalidWidgetIds: [...new Set([...invalidHidden, ...invalidPositions, ...invalidRendererTypes])],
      });
      return;
    }

    // A rendererType change is still constrained to swap: the metric a widget
    // shows can't change, and the new renderer must actually be able to render
    // that metric's data shape (per the registry's shape/ScoreRing/Smart rules)
    // — a hand-crafted request naming an incompatible renderer is rejected, not
    // silently applied to render nonsense.
    const incompatibleRendererTypes: Array<{ widgetId: string; rendererType: string }> = [];
    for (const [widgetId, rendererType] of Object.entries(parsed.data.rendererTypes)) {
      const widget = widgetsById.get(widgetId)!;
      const validTypes = getValidRenderersForMetric(widget.metricKey).map((r) => r.type);
      if (!validTypes.includes(rendererType)) {
        incompatibleRendererTypes.push({ widgetId, rendererType });
      }
    }
    if (incompatibleRendererTypes.length > 0) {
      res.status(400).json({
        error: "Override requests a renderer type incompatible with a widget's metric",
        incompatibleRendererTypes,
      });
      return;
    }

    const overrideLayout: OverrideLayout = {
      hidden: parsed.data.hidden,
      positions: parsed.data.positions,
      rendererTypes: parsed.data.rendererTypes,
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
        rendererTypeCount: Object.keys(overrideLayout.rendererTypes).length,
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

  const rawTargetKey = req.query.targetKey;
  const targetKey = typeof rawTargetKey === "string" && rawTargetKey.length > 0 ? rawTargetKey : null;

  try {
    const template = await resolveTargetTemplate(user.mspId, scope, targetKey);
    if (template === "forbidden") {
      res.status(403).json({ error: "You do not have access to that dashboard" });
      return;
    }
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
