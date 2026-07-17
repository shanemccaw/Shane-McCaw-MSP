/**
 * admin-monitor-checks.ts
 *
 * Audit-logged CRUD for the Monitor Check catalog and Monitoring Packages.
 * Platform-authored only — MSPs can never create or edit checks.
 *
 * Routes:
 *   GET    /api/admin/monitor-checks
 *   POST   /api/admin/monitor-checks
 *   GET    /api/admin/monitor-checks/:key
 *   PATCH  /api/admin/monitor-checks/:key
 *   DELETE /api/admin/monitor-checks/:key   (archive only, blocked if in active assignment)
 *
 *   GET    /api/admin/monitoring-packages
 *   POST   /api/admin/monitoring-packages
 *   GET    /api/admin/monitoring-packages/:key
 *   PATCH  /api/admin/monitoring-packages/:key
 *   DELETE /api/admin/monitoring-packages/:key
 *
 *   GET    /api/admin/monitoring-packages/:key/checks
 *   PUT    /api/admin/monitoring-packages/:key/checks   (replace full check list)
 *
 *   GET    /api/admin/monitor-checks/audit-log
 *
 *   POST   /api/admin/monitor-checks/:key/ingest-script-output  (air-gapped upload)
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  monitorChecksTable,
  monitoringPackagesTable,
  monitoringPackageChecksTable,
  monitorCheckAuditLogTable,
  tenantMonitorProfilesTable,
  usersTable,
  mspCustomersTable,
} from "@workspace/db";
import { eq, and, desc, inArray } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";
import { applyMapping, classifySeverity, validateOutputShape } from "../lib/monitor-executor";
import type { SeverityRule, MappingRule } from "../lib/monitor-executor";

const router: IRouter = Router();

// ── Helpers ────────────────────────────────────────────────────────────────────

async function writeAuditLog(opts: {
  action: string;
  checkKey?: string;
  packageKey?: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  adminUserId?: number;
  note?: string;
}) {
  try {
    await db.insert(monitorCheckAuditLogTable).values({
      action: opts.action,
      checkKey: opts.checkKey ?? null,
      packageKey: opts.packageKey ?? null,
      before: opts.before ?? null,
      after: opts.after ?? null,
      adminUserId: opts.adminUserId ?? null,
      note: opts.note ?? null,
    });
  } catch (err) {
    logger.warn({ err }, "admin-monitor-checks: audit log write failed (non-fatal)");
  }
}

function getAdminId(req: Request): number | undefined {
  return (req as unknown as { user?: { id?: number } }).user?.id;
}

// ── Monitor Checks CRUD ────────────────────────────────────────────────────────

router.get("/admin/monitor-checks", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const checks = await db
      .select()
      .from(monitorChecksTable)
      .orderBy(monitorChecksTable.key);
    res.json({ checks });
  } catch (err) {
    logger.error({ err }, "admin-monitor-checks: list failed");
    res.status(500).json({ error: "Failed to list monitor checks" });
  }
});

router.get("/admin/monitor-checks/audit-log", requireAdmin, async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Number((req.query as Record<string, string>).limit ?? "100"), 500);
    const logs = await db
      .select()
      .from(monitorCheckAuditLogTable)
      .orderBy(desc(monitorCheckAuditLogTable.createdAt))
      .limit(limit);
    res.json({ logs });
  } catch (err) {
    logger.error({ err }, "admin-monitor-checks: audit log list failed");
    res.status(500).json({ error: "Failed to list audit log" });
  }
});

router.get("/admin/monitor-checks/:key", requireAdmin, async (req: Request, res: Response) => {
  try {
    const key = req.params.key as string;
    const [check] = await db
      .select()
      .from(monitorChecksTable)
      .where(eq(monitorChecksTable.key, key))
      .limit(1);
    if (!check) return void res.status(404).json({ error: "Monitor check not found" });
    res.json({ check });
  } catch (err) {
    logger.error({ err }, "admin-monitor-checks: get failed");
    res.status(500).json({ error: "Failed to get monitor check" });
  }
});

router.post("/admin/monitor-checks", requireAdmin, async (req: Request, res: Response) => {
  try {
    const body = req.body as Record<string, unknown>;
    const adminId = getAdminId(req);

    if (!body.key || !body.label || !body.endpoint) {
      return void res.status(400).json({ error: "key, label, and endpoint are required" });
    }

    const [check] = await db
      .insert(monitorChecksTable)
      .values({
        key: String(body.key),
        label: String(body.label),
        description: body.description ? String(body.description) : null,
        endpoint: String(body.endpoint),
        method: body.method ? String(body.method) : "GET",
        requestBody: (body.requestBody as Record<string, unknown>) ?? null,
        selectParams: body.selectParams ? String(body.selectParams) : null,
        properties: (body.properties as string[]) ?? [],
        mapping: (body.mapping as MappingRule[]) ?? [],
        severityRules: (body.severityRules as SeverityRule[]) ?? [],
        outputSchema: (body.outputSchema as Record<string, unknown>) ?? null,
        engines: (body.engines as string[]) ?? [],
        frequency: (body.frequency ? String(body.frequency) : "daily") as "hourly" | "daily" | "live",
        requiresCustomerScript: Boolean(body.requiresCustomerScript),
        schemaVersion: 1,
        status: "active" as const,
        createdByAdminId: adminId ?? null,
        updatedByAdminId: adminId ?? null,
      })
      .returning();

    await writeAuditLog({ action: "create", checkKey: check!.key, after: check as unknown as Record<string, unknown>, adminUserId: adminId });
    res.status(201).json({ check });
  } catch (err) {
    logger.error({ err }, "admin-monitor-checks: create failed");
    const msg = err instanceof Error && err.message.includes("unique") ? "A check with that key already exists" : "Failed to create monitor check";
    res.status(400).json({ error: msg });
  }
});

router.patch("/admin/monitor-checks/:key", requireAdmin, async (req: Request, res: Response) => {
  try {
    const key = req.params.key as string;
    const body = req.body as Record<string, unknown>;
    const adminId = getAdminId(req);

    const [existing] = await db
      .select()
      .from(monitorChecksTable)
      .where(eq(monitorChecksTable.key, key))
      .limit(1);
    if (!existing) return void res.status(404).json({ error: "Monitor check not found" });

    // Increment schema version when endpoint or mapping changes
    const endpointChanged = body.endpoint != null && body.endpoint !== existing.endpoint;
    const mappingChanged = body.mapping != null && JSON.stringify(body.mapping) !== JSON.stringify(existing.mapping);
    const newSchemaVersion = (endpointChanged || mappingChanged)
      ? existing.schemaVersion + 1
      : existing.schemaVersion;

    const updates: Record<string, unknown> = {
      updatedByAdminId: adminId ?? null,
      updatedAt: new Date(),
      schemaVersion: newSchemaVersion,
    };

    const allowedFields = ["label", "description", "endpoint", "method", "requestBody", "selectParams",
      "properties", "mapping", "severityRules", "outputSchema", "engines", "frequency", "requiresCustomerScript", "status"];
    for (const f of allowedFields) {
      if (body[f] !== undefined) updates[f] = body[f];
    }

    const [updated] = await db
      .update(monitorChecksTable)
      .set(updates)
      .where(eq(monitorChecksTable.key, key))
      .returning();

    await writeAuditLog({ action: "update", checkKey: key, before: existing as unknown as Record<string, unknown>, after: updated as unknown as Record<string, unknown>, adminUserId: adminId });
    res.json({ check: updated });
  } catch (err) {
    logger.error({ err }, "admin-monitor-checks: update failed");
    res.status(500).json({ error: "Failed to update monitor check" });
  }
});

router.delete("/admin/monitor-checks/:key", requireAdmin, async (req: Request, res: Response) => {
  try {
    const key = req.params.key as string;
    const adminId = getAdminId(req);

    const [existing] = await db
      .select()
      .from(monitorChecksTable)
      .where(eq(monitorChecksTable.key, key))
      .limit(1);
    if (!existing) return void res.status(404).json({ error: "Monitor check not found" });

    // Check if referenced by any active package
    const refs = await db
      .select({ packageKey: monitoringPackageChecksTable.packageKey })
      .from(monitoringPackageChecksTable)
      .where(eq(monitoringPackageChecksTable.checkKey, key));

    if (refs.length > 0) {
      // Soft-deprecate: archive instead of delete, assignments grandfathered
      const [archived] = await db
        .update(monitorChecksTable)
        .set({ status: "archived", updatedAt: new Date(), updatedByAdminId: adminId ?? null })
        .where(eq(monitorChecksTable.key, key))
        .returning();
      await writeAuditLog({
        action: "archive",
        checkKey: key,
        before: existing as unknown as Record<string, unknown>,
        after: archived as unknown as Record<string, unknown>,
        adminUserId: adminId,
        note: `Referenced by packages: ${refs.map(r => r.packageKey).join(", ")} — archived (not deleted)`,
      });
      return void res.json({ archived: true, check: archived, packages: refs.map(r => r.packageKey) });
    }

    const [archived] = await db
      .update(monitorChecksTable)
      .set({ status: "archived", updatedAt: new Date(), updatedByAdminId: adminId ?? null })
      .where(eq(monitorChecksTable.key, key))
      .returning();
    await writeAuditLog({ action: "archive", checkKey: key, before: existing as unknown as Record<string, unknown>, after: archived as unknown as Record<string, unknown>, adminUserId: adminId });
    res.json({ archived: true, check: archived });
  } catch (err) {
    logger.error({ err }, "admin-monitor-checks: delete failed");
    res.status(500).json({ error: "Failed to archive monitor check" });
  }
});

// ── Air-gapped script output ingestion ────────────────────────────────────────

router.post("/admin/monitor-checks/:key/ingest-script-output", requireAdmin, async (req: Request, res: Response) => {
  try {
    const key = req.params.key as string;
    const body = req.body as Record<string, unknown>;

    const { tenantId, triggerId, scriptOutput } = body as {
      tenantId: string;
      triggerId: string;
      scriptOutput: unknown;
    };

    if (!tenantId || !triggerId || scriptOutput == null) {
      return void res.status(400).json({ error: "tenantId, triggerId, and scriptOutput are required" });
    }

    const [check] = await db
      .select()
      .from(monitorChecksTable)
      .where(eq(monitorChecksTable.key, key))
      .limit(1);
    if (!check) return void res.status(404).json({ error: "Monitor check not found" });

    // Validate shape deterministically
    const { valid, errors } = validateOutputShape(scriptOutput, check.outputSchema as Record<string, unknown>);

    // Apply mapping to raw output (treat as array of one object if not array)
    const items: unknown[] = Array.isArray(scriptOutput) ? scriptOutput : [scriptOutput];
    const extracted = applyMapping(items, (check.mapping ?? []) as MappingRule[], (check.properties ?? []) as string[]);
    extracted._schemaValid = valid;
    if (!valid) extracted._schemaErrors = errors;

    const severityMatched = classifySeverity((check.severityRules ?? []) as SeverityRule[], extracted);
    const idempotencyKey = `${tenantId}:${key}:${triggerId}`;

    await db
      .insert(tenantMonitorProfilesTable)
      .values({
        tenantId,
        checkKey: key,
        checkSchemaVersion: check.schemaVersion,
        triggerId,
        idempotencyKey,
        status: (valid ? "ok" : "error") as "ok" | "error" | "consent_revoked" | "requires_script",
        rawResponse: { scriptOutput } as Record<string, unknown>,
        extractedProperties: extracted,
        severityMatched,
        errorMessage: valid ? null : `Schema validation failed: ${errors.slice(0, 3).join("; ")}`,
        itemCount: items.length,
        pageCount: 1,
      })
      .onConflictDoNothing();

    res.json({ ingested: true, valid, errors, severityMatched });
  } catch (err) {
    logger.error({ err }, "admin-monitor-checks: ingest-script-output failed");
    res.status(500).json({ error: "Failed to ingest script output" });
  }
});

// ── Monitoring Packages CRUD ───────────────────────────────────────────────────

router.get("/admin/monitoring-packages", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const packages = await db
      .select()
      .from(monitoringPackagesTable)
      .orderBy(monitoringPackagesTable.key);
    res.json({ packages });
  } catch (err) {
    logger.error({ err }, "admin-monitor-checks: list packages failed");
    res.status(500).json({ error: "Failed to list monitoring packages" });
  }
});

router.get("/admin/monitoring-packages/:key", requireAdmin, async (req: Request, res: Response) => {
  try {
    const key = req.params.key as string;
    const [pkg] = await db
      .select()
      .from(monitoringPackagesTable)
      .where(eq(monitoringPackagesTable.key, key))
      .limit(1);
    if (!pkg) return void res.status(404).json({ error: "Monitoring package not found" });

    const checkLinks = await db
      .select()
      .from(monitoringPackageChecksTable)
      .where(eq(monitoringPackageChecksTable.packageKey, key))
      .orderBy(monitoringPackageChecksTable.sortOrder);

    const checkKeys = checkLinks.map(c => c.checkKey);
    const checks = checkKeys.length > 0
      ? await db.select().from(monitorChecksTable).where(inArray(monitorChecksTable.key, checkKeys))
      : [];

    const checkMap = new Map(checks.map(c => [c.key, c]));
    const orderedChecks = checkLinks.map(cl => ({ ...cl, check: checkMap.get(cl.checkKey) }));

    res.json({ package: pkg, checks: orderedChecks });
  } catch (err) {
    logger.error({ err }, "admin-monitor-checks: get package failed");
    res.status(500).json({ error: "Failed to get monitoring package" });
  }
});

router.post("/admin/monitoring-packages", requireAdmin, async (req: Request, res: Response) => {
  try {
    const body = req.body as Record<string, unknown>;
    const adminId = getAdminId(req);

    if (!body.key || !body.label) {
      return void res.status(400).json({ error: "key and label are required" });
    }

    const [pkg] = await db
      .insert(monitoringPackagesTable)
      .values({
        key: String(body.key),
        label: String(body.label),
        description: body.description ? String(body.description) : null,
        engines: (body.engines as string[]) ?? [],
        status: "active",
        createdByAdminId: adminId ?? null,
        updatedByAdminId: adminId ?? null,
      })
      .returning();

    await writeAuditLog({ action: "create", packageKey: pkg!.key, after: pkg as unknown as Record<string, unknown>, adminUserId: adminId });
    res.status(201).json({ package: pkg });
  } catch (err) {
    logger.error({ err }, "admin-monitor-checks: create package failed");
    const msg = err instanceof Error && err.message.includes("unique") ? "A package with that key already exists" : "Failed to create monitoring package";
    res.status(400).json({ error: msg });
  }
});

router.patch("/admin/monitoring-packages/:key", requireAdmin, async (req: Request, res: Response) => {
  try {
    const key = req.params.key as string;
    const body = req.body as Record<string, unknown>;
    const adminId = getAdminId(req);

    const [existing] = await db
      .select()
      .from(monitoringPackagesTable)
      .where(eq(monitoringPackagesTable.key, key))
      .limit(1);
    if (!existing) return void res.status(404).json({ error: "Monitoring package not found" });

    const updates: Record<string, unknown> = { updatedByAdminId: adminId ?? null, updatedAt: new Date() };
    for (const f of ["label", "description", "engines", "status"]) {
      if (body[f] !== undefined) updates[f] = body[f];
    }

    const [updated] = await db
      .update(monitoringPackagesTable)
      .set(updates)
      .where(eq(monitoringPackagesTable.key, key))
      .returning();

    await writeAuditLog({ action: "update", packageKey: key, before: existing as unknown as Record<string, unknown>, after: updated as unknown as Record<string, unknown>, adminUserId: adminId });
    res.json({ package: updated });
  } catch (err) {
    logger.error({ err }, "admin-monitor-checks: update package failed");
    res.status(500).json({ error: "Failed to update monitoring package" });
  }
});

router.delete("/admin/monitoring-packages/:key", requireAdmin, async (req: Request, res: Response) => {
  try {
    const key = req.params.key as string;
    const adminId = getAdminId(req);

    const [existing] = await db
      .select()
      .from(monitoringPackagesTable)
      .where(eq(monitoringPackagesTable.key, key))
      .limit(1);
    if (!existing) return void res.status(404).json({ error: "Monitoring package not found" });

    const [archived] = await db
      .update(monitoringPackagesTable)
      .set({ status: "archived", updatedAt: new Date(), updatedByAdminId: adminId ?? null })
      .where(eq(monitoringPackagesTable.key, key))
      .returning();

    await writeAuditLog({ action: "archive", packageKey: key, before: existing as unknown as Record<string, unknown>, after: archived as unknown as Record<string, unknown>, adminUserId: adminId });
    res.json({ archived: true, package: archived });
  } catch (err) {
    logger.error({ err }, "admin-monitor-checks: archive package failed");
    res.status(500).json({ error: "Failed to archive monitoring package" });
  }
});

// ── Package ↔ Check assignments ───────────────────────────────────────────────

router.get("/admin/monitoring-packages/:key/checks", requireAdmin, async (req: Request, res: Response) => {
  try {
    const key = req.params.key as string;
    const links = await db
      .select()
      .from(monitoringPackageChecksTable)
      .where(eq(monitoringPackageChecksTable.packageKey, key))
      .orderBy(monitoringPackageChecksTable.sortOrder);
    res.json({ checks: links });
  } catch (err) {
    logger.error({ err }, "admin-monitor-checks: list package checks failed");
    res.status(500).json({ error: "Failed to list package checks" });
  }
});

router.put("/admin/monitoring-packages/:key/checks", requireAdmin, async (req: Request, res: Response) => {
  try {
    const key = req.params.key as string;
    const body = req.body as { checkKeys: string[] };
    const adminId = getAdminId(req);

    if (!Array.isArray(body.checkKeys)) {
      return void res.status(400).json({ error: "checkKeys must be an array of check key strings" });
    }

    // Validate all check keys exist
    if (body.checkKeys.length > 0) {
      const existing = await db
        .select({ key: monitorChecksTable.key })
        .from(monitorChecksTable)
        .where(inArray(monitorChecksTable.key, body.checkKeys));
      const foundKeys = new Set(existing.map(e => e.key));
      const missing = body.checkKeys.filter(k => !foundKeys.has(k));
      if (missing.length > 0) {
        return void res.status(400).json({ error: `Unknown check keys: ${missing.join(", ")}` });
      }
    }

    // Replace all assignments in a transaction
    await db.transaction(async tx => {
      await tx.delete(monitoringPackageChecksTable).where(eq(monitoringPackageChecksTable.packageKey, key));
      if (body.checkKeys.length > 0) {
        await tx.insert(monitoringPackageChecksTable).values(
          body.checkKeys.map((ck, i) => ({ packageKey: key, checkKey: ck, sortOrder: i }))
        );
      }
    });

    await writeAuditLog({ action: "update_checks", packageKey: key, after: { checkKeys: body.checkKeys }, adminUserId: adminId });
    res.json({ updated: true, checkKeys: body.checkKeys });
  } catch (err) {
    logger.error({ err }, "admin-monitor-checks: update package checks failed");
    res.status(500).json({ error: "Failed to update package checks" });
  }
});

// ── Tenant profiles list across ALL tenants ───────────────────────────────────────

router.get("/admin/monitor-checks/profiles", requireAdmin, async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Number((req.query as Record<string, string>).limit ?? "200"), 1000);
    const profiles = await db
      .select()
      .from(tenantMonitorProfilesTable)
      .orderBy(desc(tenantMonitorProfilesTable.collectedAt))
      .limit(limit);

    const clients = await db
      .select({ tenantId: mspCustomersTable.tenantId, name: mspCustomersTable.name, company: mspCustomersTable.domain })
      .from(mspCustomersTable);

    const clientMap = new Map(clients.map(c => [c.tenantId, c]));

    const enrichedProfiles = profiles.map(p => {
      const client = clientMap.get(p.tenantId);
      return {
        ...p,
        clientName: client?.name ?? "Unknown Client",
        clientCompany: client?.company ?? "Unknown Company",
      };
    });

    res.json({ profiles: enrichedProfiles });
  } catch (err) {
    logger.error({ err }, "admin-monitor-checks: list all profiles failed");
    res.status(500).json({ error: "Failed to list tenant monitor profiles" });
  }
});

// ── Tenant profile history ────────────────────────────────────────────────────

router.get("/admin/monitor-checks/profiles/:tenantId", requireAdmin, async (req: Request, res: Response) => {
  try {
    const tenantId = req.params.tenantId as string;
    const limit = Math.min(Number((req.query as Record<string, string>).limit ?? "200"), 1000);
    const profiles = await db
      .select()
      .from(tenantMonitorProfilesTable)
      .where(eq(tenantMonitorProfilesTable.tenantId, tenantId))
      .orderBy(desc(tenantMonitorProfilesTable.collectedAt))
      .limit(limit);
    res.json({ profiles });
  } catch (err) {
    logger.error({ err }, "admin-monitor-checks: list profiles failed");
    res.status(500).json({ error: "Failed to list tenant monitor profiles" });
  }
});

export default router;
