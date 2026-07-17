/**
 * admin-baseline-templates.ts
 *
 * Audit-logged CRUD for the Baseline Action Template catalog and Config Packs.
 * Platform-authored only — structural mirror of admin-monitor-checks.ts.
 *
 * Routes:
 *   GET    /api/admin/baseline-templates
 *   GET    /api/admin/baseline-templates/audit-log
 *   GET    /api/admin/baseline-templates/:templateId
 *   POST   /api/admin/baseline-templates
 *   PATCH  /api/admin/baseline-templates/:templateId
 *   DELETE /api/admin/baseline-templates/:templateId   (archive only, blocked-in-spirit — grandfathered if in a pack)
 *
 *   POST   /api/admin/baseline-templates/:templateId/test   (REAL execution against a connected
 *                                                              test tenant — not a dry run)
 *
 *   GET    /api/admin/config-packs
 *   POST   /api/admin/config-packs
 *   GET    /api/admin/config-packs/:packKey
 *   PATCH  /api/admin/config-packs/:packKey
 *   DELETE /api/admin/config-packs/:packKey
 *
 *   GET    /api/admin/config-packs/:packKey/templates        (list, with sortOrder)
 *   PATCH  /api/admin/config-packs/:packKey/templates/order   (bulk reorder / full-membership replace —
 *                                                                no direct Monitor Check equivalent since
 *                                                                reads don't need ordering)
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  baselineActionTemplatesTable,
  baselineActionTemplateAuditLogTable,
  configPacksTable,
  configPackTemplatesTable,
  mspCustomersTable,
} from "@workspace/db";
import { eq, and, desc, inArray, count } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";

const log = logger.child({ channel: "admin.clients" });

const router: IRouter = Router();

// ── Helpers ────────────────────────────────────────────────────────────────────

async function writeAuditLog(opts: {
  action: string;
  templateId?: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  adminId?: number;
}) {
  try {
    await db.insert(baselineActionTemplateAuditLogTable).values({
      action: opts.action,
      templateId: opts.templateId ?? null,
      beforeSnapshot: opts.before ?? null,
      afterSnapshot: opts.after ?? null,
      adminId: opts.adminId ?? null,
    });
  } catch (err) {
    log.warn({ err }, "admin-baseline-templates: audit log write failed (non-fatal)");
  }
}

function getAdminId(req: Request): number | undefined {
  return (req as unknown as { user?: { id?: number } }).user?.id;
}

// ── Baseline Action Templates CRUD ─────────────────────────────────────────────

router.get("/admin/baseline-templates", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const templates = await db
      .select()
      .from(baselineActionTemplatesTable)
      .orderBy(baselineActionTemplatesTable.templateId);

    // Fetch pack memberships for all templates (including archived packs)
    const packLinks = await db
      .select({
        templateId: configPackTemplatesTable.templateId,
        packId: configPackTemplatesTable.packId,
        sortOrder: configPackTemplatesTable.sortOrder,
        packKey: configPacksTable.packKey,
        packLabel: configPacksTable.label,
      })
      .from(configPackTemplatesTable)
      .leftJoin(configPacksTable, eq(configPacksTable.id, configPackTemplatesTable.packId));

    // Count templates per pack for total in pack
    const packTemplateCounts = await db
      .select({
        packId: configPackTemplatesTable.packId,
        count: count().as("count"),
      })
      .from(configPackTemplatesTable)
      .groupBy(configPackTemplatesTable.packId);

    const countMap = new Map(packTemplateCounts.map(p => [p.packId, p.count]));

    // Group pack links by templateId
    const packsByTemplate = new Map<string, Array<{ packKey: string; packLabel: string; sortOrder: number; totalInPack: number }>>();
    for (const link of packLinks) {
      if (!packsByTemplate.has(link.templateId)) {
        packsByTemplate.set(link.templateId, []);
      }
      packsByTemplate
        .get(link.templateId)!
        .push({
          packKey: link.packKey!,
          packLabel: link.packLabel!,
          sortOrder: link.sortOrder,
          totalInPack: countMap.get(link.packId) || 0,
        });
    }

    // Attach packs array to each template
    const templatesWithPacks = templates.map(t => ({
      ...t,
      packs: packsByTemplate.get(t.templateId) || [],
    }));

    res.json({ templates: templatesWithPacks });
  } catch (err) {
    log.error({ err }, "admin-baseline-templates: list failed");
    res.status(500).json({ error: "Failed to list baseline templates" });
  }
});

router.get("/admin/baseline-templates/audit-log", requireAdmin, async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Number((req.query as Record<string, string>).limit ?? "100"), 500);
    const logs = await db
      .select()
      .from(baselineActionTemplateAuditLogTable)
      .orderBy(desc(baselineActionTemplateAuditLogTable.createdAt))
      .limit(limit);
    res.json({ logs });
  } catch (err) {
    log.error({ err }, "admin-baseline-templates: audit log list failed");
    res.status(500).json({ error: "Failed to list audit log" });
  }
});

// Scoped customer picker for the Testing tab — only testbed-flagged customers
// with a connected tenant are eligible targets for a real Graph write.
// Registered ahead of the /:templateId GET below so "testbed-customers" is
// never swallowed as a templateId (same ordering rule as /audit-log above).
router.get("/admin/baseline-templates/testbed-customers", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const customers = await db
      .select({ id: mspCustomersTable.id, name: mspCustomersTable.name, tenantId: mspCustomersTable.tenantId })
      .from(mspCustomersTable)
      .where(and(eq(mspCustomersTable.isTestbed, true), eq(mspCustomersTable.status, "active")))
      .orderBy(mspCustomersTable.name);
    res.json({ customers: customers.filter(c => Boolean(c.tenantId)) });
  } catch (err) {
    log.error({ err }, "admin-baseline-templates: list testbed customers failed");
    res.status(500).json({ error: "Failed to list testbed customers" });
  }
});

router.get("/admin/baseline-templates/:templateId", requireAdmin, async (req: Request, res: Response) => {
  try {
    const templateId = req.params.templateId as string;
    const [template] = await db
      .select()
      .from(baselineActionTemplatesTable)
      .where(eq(baselineActionTemplatesTable.templateId, templateId))
      .limit(1);
    if (!template) return void res.status(404).json({ error: "Baseline template not found" });
    res.json({ template });
  } catch (err) {
    log.error({ err }, "admin-baseline-templates: get failed");
    res.status(500).json({ error: "Failed to get baseline template" });
  }
});

router.post("/admin/baseline-templates", requireAdmin, async (req: Request, res: Response) => {
  try {
    const body = req.body as Record<string, unknown>;
    const adminId = getAdminId(req);

    if (!body.templateId || !body.label || !body.category || !body.endpoint || !body.method) {
      return void res.status(400).json({ error: "templateId, label, category, endpoint, and method are required" });
    }
    if (!["POST", "PATCH", "PUT"].includes(String(body.method))) {
      return void res.status(400).json({ error: "method must be POST, PATCH, or PUT" });
    }

    const [template] = await db
      .insert(baselineActionTemplatesTable)
      .values({
        templateId: String(body.templateId),
        label: String(body.label),
        description: body.description ? String(body.description) : null,
        category: String(body.category),
        endpoint: String(body.endpoint),
        method: body.method as "POST" | "PATCH" | "PUT",
        bodyTemplate: (body.bodyTemplate as Record<string, unknown>) ?? {},
        requiredVariables: (body.requiredVariables as string[]) ?? [],
        successCriteria: (body.successCriteria as Record<string, unknown>) ?? {},
        dependsOn: (body.dependsOn as string[]) ?? [],
        requiresVerificationGate: Boolean(body.requiresVerificationGate),
        schemaVersion: 1,
        status: "active" as const,
        createdByAdminId: adminId ?? null,
        updatedByAdminId: adminId ?? null,
      })
      .returning();

    await writeAuditLog({ action: "create", templateId: template!.templateId, after: template as unknown as Record<string, unknown>, adminId });
    res.status(201).json({ template });
  } catch (err) {
    log.error({ err }, "admin-baseline-templates: create failed");
    const msg = err instanceof Error && err.message.includes("unique") ? "A template with that templateId already exists" : "Failed to create baseline template";
    res.status(400).json({ error: msg });
  }
});

router.patch("/admin/baseline-templates/:templateId", requireAdmin, async (req: Request, res: Response) => {
  try {
    const templateId = req.params.templateId as string;
    const body = req.body as Record<string, unknown>;
    const adminId = getAdminId(req);

    const [existing] = await db
      .select()
      .from(baselineActionTemplatesTable)
      .where(eq(baselineActionTemplatesTable.templateId, templateId))
      .limit(1);
    if (!existing) return void res.status(404).json({ error: "Baseline template not found" });

    if (body.method != null && !["POST", "PATCH", "PUT"].includes(String(body.method))) {
      return void res.status(400).json({ error: "method must be POST, PATCH, or PUT" });
    }

    // Increment schema version when endpoint or bodyTemplate changes (mirrors Monitor Check's
    // endpoint/mapping-change versioning — downstream config packs can detect drift)
    const endpointChanged = body.endpoint != null && body.endpoint !== existing.endpoint;
    const bodyTemplateChanged = body.bodyTemplate != null && JSON.stringify(body.bodyTemplate) !== JSON.stringify(existing.bodyTemplate);
    const newSchemaVersion = (endpointChanged || bodyTemplateChanged)
      ? existing.schemaVersion + 1
      : existing.schemaVersion;

    const updates: Record<string, unknown> = {
      updatedByAdminId: adminId ?? null,
      updatedAt: new Date(),
      schemaVersion: newSchemaVersion,
    };

    const allowedFields = ["label", "description", "category", "endpoint", "method", "bodyTemplate",
      "requiredVariables", "successCriteria", "dependsOn", "requiresVerificationGate", "status"];
    for (const f of allowedFields) {
      if (body[f] !== undefined) updates[f] = body[f];
    }

    const [updated] = await db
      .update(baselineActionTemplatesTable)
      .set(updates)
      .where(eq(baselineActionTemplatesTable.templateId, templateId))
      .returning();

    await writeAuditLog({ action: "update", templateId, before: existing as unknown as Record<string, unknown>, after: updated as unknown as Record<string, unknown>, adminId });
    res.json({ template: updated });
  } catch (err) {
    log.error({ err }, "admin-baseline-templates: update failed");
    res.status(500).json({ error: "Failed to update baseline template" });
  }
});

router.delete("/admin/baseline-templates/:templateId", requireAdmin, async (req: Request, res: Response) => {
  try {
    const templateId = req.params.templateId as string;
    const adminId = getAdminId(req);

    const [existing] = await db
      .select()
      .from(baselineActionTemplatesTable)
      .where(eq(baselineActionTemplatesTable.templateId, templateId))
      .limit(1);
    if (!existing) return void res.status(404).json({ error: "Baseline template not found" });

    // Check if referenced by any config pack — archive, never hard-delete
    // (mirrors Monitor Checks: grandfathered in existing packs)
    const refs = await db
      .select({ packId: configPackTemplatesTable.packId })
      .from(configPackTemplatesTable)
      .where(eq(configPackTemplatesTable.templateId, templateId));

    const [archived] = await db
      .update(baselineActionTemplatesTable)
      .set({ status: "archived", updatedAt: new Date(), updatedByAdminId: adminId ?? null })
      .where(eq(baselineActionTemplatesTable.templateId, templateId))
      .returning();

    if (refs.length > 0) {
      const packIds = [...new Set(refs.map(r => r.packId))];
      const packs = await db.select({ packKey: configPacksTable.packKey }).from(configPacksTable).where(inArray(configPacksTable.id, packIds));
      await writeAuditLog({
        action: "archive",
        templateId,
        before: existing as unknown as Record<string, unknown>,
        after: { ...archived, referencedByPacks: packs.map(p => p.packKey) } as unknown as Record<string, unknown>,
        adminId,
      });
      return void res.json({ archived: true, template: archived, packs: packs.map(p => p.packKey) });
    }

    await writeAuditLog({ action: "archive", templateId, before: existing as unknown as Record<string, unknown>, after: archived as unknown as Record<string, unknown>, adminId });
    res.json({ archived: true, template: archived });
  } catch (err) {
    log.error({ err }, "admin-baseline-templates: archive failed");
    res.status(500).json({ error: "Failed to archive baseline template" });
  }
});

// ── Testing — runs FOR REAL against a connected test tenant, not a dry run ─────

router.post("/admin/baseline-templates/:templateId/test", requireAdmin, async (req: Request, res: Response) => {
  try {
    const templateId = req.params.templateId as string;
    const body = req.body as { customerId?: number; variables?: Record<string, string> };

    if (!body.customerId) {
      return void res.status(400).json({ error: "customerId (a testbed customer) is required" });
    }

    const [customer] = await db
      .select({ id: mspCustomersTable.id, tenantId: mspCustomersTable.tenantId, isTestbed: mspCustomersTable.isTestbed, name: mspCustomersTable.name })
      .from(mspCustomersTable)
      .where(eq(mspCustomersTable.id, body.customerId))
      .limit(1);

    if (!customer?.tenantId) {
      return void res.status(400).json({ error: "Selected customer has no connected tenant" });
    }
    if (!customer.isTestbed) {
      return void res.status(400).json({ error: "Testing is only permitted against a customer flagged isTestbed — this is a REAL write, never point it at a live customer tenant" });
    }

    const [template] = await db
      .select()
      .from(baselineActionTemplatesTable)
      .where(eq(baselineActionTemplatesTable.templateId, templateId))
      .limit(1);
    if (!template) return void res.status(404).json({ error: "Baseline template not found" });

    const { runBaselineTemplateAgainstTenant } = await import("../lib/workflow-executor");
    const payload: Record<string, unknown> = { ...(body.variables ?? {}), customerId: body.customerId };
    const result = await runBaselineTemplateAgainstTenant(templateId, customer.tenantId, body.customerId, payload);

    log.info({ templateId, customerId: body.customerId, tenantId: customer.tenantId, success: result.success, adminId: getAdminId(req) }, "admin-baseline-templates: test execution completed");
    res.json({ result, tenant: { customerId: customer.id, name: customer.name } });
  } catch (err) {
    log.error({ err }, "admin-baseline-templates: test execution failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to execute test" });
  }
});

// ── Config Packs CRUD ───────────────────────────────────────────────────────────

router.get("/admin/config-packs", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const packs = await db
      .select()
      .from(configPacksTable)
      .orderBy(configPacksTable.packKey);
    res.json({ packs });
  } catch (err) {
    log.error({ err }, "admin-baseline-templates: list packs failed");
    res.status(500).json({ error: "Failed to list config packs" });
  }
});

router.get("/admin/config-packs/:packKey", requireAdmin, async (req: Request, res: Response) => {
  try {
    const packKey = req.params.packKey as string;
    const [pack] = await db
      .select()
      .from(configPacksTable)
      .where(eq(configPacksTable.packKey, packKey))
      .limit(1);
    if (!pack) return void res.status(404).json({ error: "Config pack not found" });

    const links = await db
      .select()
      .from(configPackTemplatesTable)
      .where(eq(configPackTemplatesTable.packId, pack.id))
      .orderBy(configPackTemplatesTable.sortOrder);

    const templateIds = links.map(l => l.templateId);
    const templates = templateIds.length > 0
      ? await db.select().from(baselineActionTemplatesTable).where(inArray(baselineActionTemplatesTable.templateId, templateIds))
      : [];

    const templateMap = new Map(templates.map(t => [t.templateId, t]));
    const orderedTemplates = links.map(l => ({ ...l, template: templateMap.get(l.templateId) }));

    res.json({ pack, templates: orderedTemplates });
  } catch (err) {
    log.error({ err }, "admin-baseline-templates: get pack failed");
    res.status(500).json({ error: "Failed to get config pack" });
  }
});

router.post("/admin/config-packs", requireAdmin, async (req: Request, res: Response) => {
  try {
    const body = req.body as Record<string, unknown>;

    if (!body.packKey || !body.label) {
      return void res.status(400).json({ error: "packKey and label are required" });
    }

    const [pack] = await db
      .insert(configPacksTable)
      .values({
        packKey: String(body.packKey),
        label: String(body.label),
        description: body.description ? String(body.description) : null,
        categories: (body.categories as string[]) ?? [],
        status: "active",
      })
      .returning();

    res.status(201).json({ pack });
  } catch (err) {
    log.error({ err }, "admin-baseline-templates: create pack failed");
    const msg = err instanceof Error && err.message.includes("unique") ? "A pack with that packKey already exists" : "Failed to create config pack";
    res.status(400).json({ error: msg });
  }
});

router.patch("/admin/config-packs/:packKey", requireAdmin, async (req: Request, res: Response) => {
  try {
    const packKey = req.params.packKey as string;
    const body = req.body as Record<string, unknown>;

    const [existing] = await db
      .select()
      .from(configPacksTable)
      .where(eq(configPacksTable.packKey, packKey))
      .limit(1);
    if (!existing) return void res.status(404).json({ error: "Config pack not found" });

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    for (const f of ["label", "description", "categories", "status"]) {
      if (body[f] !== undefined) updates[f] = body[f];
    }

    const [updated] = await db
      .update(configPacksTable)
      .set(updates)
      .where(eq(configPacksTable.packKey, packKey))
      .returning();

    res.json({ pack: updated });
  } catch (err) {
    log.error({ err }, "admin-baseline-templates: update pack failed");
    res.status(500).json({ error: "Failed to update config pack" });
  }
});

router.delete("/admin/config-packs/:packKey", requireAdmin, async (req: Request, res: Response) => {
  try {
    const packKey = req.params.packKey as string;

    const [existing] = await db
      .select()
      .from(configPacksTable)
      .where(eq(configPacksTable.packKey, packKey))
      .limit(1);
    if (!existing) return void res.status(404).json({ error: "Config pack not found" });

    const [archived] = await db
      .update(configPacksTable)
      .set({ status: "archived", updatedAt: new Date() })
      .where(eq(configPacksTable.packKey, packKey))
      .returning();

    res.json({ archived: true, pack: archived });
  } catch (err) {
    log.error({ err }, "admin-baseline-templates: archive pack failed");
    res.status(500).json({ error: "Failed to archive config pack" });
  }
});

// ── Pack ↔ Template assignments (ordered, with per-pack dependsOn overrides) ───

router.get("/admin/config-packs/:packKey/templates", requireAdmin, async (req: Request, res: Response) => {
  try {
    const packKey = req.params.packKey as string;
    const [pack] = await db.select({ id: configPacksTable.id }).from(configPacksTable).where(eq(configPacksTable.packKey, packKey)).limit(1);
    if (!pack) return void res.status(404).json({ error: "Config pack not found" });

    const links = await db
      .select()
      .from(configPackTemplatesTable)
      .where(eq(configPackTemplatesTable.packId, pack.id))
      .orderBy(configPackTemplatesTable.sortOrder);
    res.json({ templates: links });
  } catch (err) {
    log.error({ err }, "admin-baseline-templates: list pack templates failed");
    res.status(500).json({ error: "Failed to list pack templates" });
  }
});

interface PackTemplateOrderItem {
  templateId: string;
  sortOrder: number;
  dependsOnOverride?: string[] | null;
}

router.patch("/admin/config-packs/:packKey/templates/order", requireAdmin, async (req: Request, res: Response) => {
  try {
    const packKey = req.params.packKey as string;
    const body = req.body as { templates: PackTemplateOrderItem[] };

    if (!Array.isArray(body.templates)) {
      return void res.status(400).json({ error: "templates must be an array of {templateId, sortOrder, dependsOnOverride?}" });
    }

    const [pack] = await db.select({ id: configPacksTable.id }).from(configPacksTable).where(eq(configPacksTable.packKey, packKey)).limit(1);
    if (!pack) return void res.status(404).json({ error: "Config pack not found" });

    // Validate all template ids exist
    if (body.templates.length > 0) {
      const ids = body.templates.map(t => t.templateId);
      const existing = await db.select({ templateId: baselineActionTemplatesTable.templateId }).from(baselineActionTemplatesTable).where(inArray(baselineActionTemplatesTable.templateId, ids));
      const found = new Set(existing.map(e => e.templateId));
      const missing = ids.filter(id => !found.has(id));
      if (missing.length > 0) {
        return void res.status(400).json({ error: `Unknown template ids: ${missing.join(", ")}` });
      }
    }

    // Full-membership replace in a transaction — this endpoint is the single
    // source of truth for a pack's ordered template membership + per-pack
    // dependsOn overrides (no separate assign/PUT endpoint).
    await db.transaction(async tx => {
      await tx.delete(configPackTemplatesTable).where(eq(configPackTemplatesTable.packId, pack.id));
      if (body.templates.length > 0) {
        await tx.insert(configPackTemplatesTable).values(
          body.templates.map(t => ({
            packId: pack.id,
            templateId: t.templateId,
            sortOrder: t.sortOrder,
            dependsOnOverride: t.dependsOnOverride ?? null,
          })),
        );
      }
    });

    res.json({ updated: true, templates: body.templates });
  } catch (err) {
    log.error({ err }, "admin-baseline-templates: update pack template order failed");
    res.status(500).json({ error: "Failed to update pack templates" });
  }
});

export default router;
