/**
 * msp-sales-bundles.ts
 *
 * MSP Sales Bundle Builder — lets MSPs compose, price, and assign
 * platform-authored Monitoring Packages under their own branded bundles.
 *
 * Plan gating:
 *   - Single-package bundles: available on all tiers.
 *   - Multi-package (custom composition): requirePlanFeature("custom_bundle_composition").
 *
 * Routes:
 *   GET    /api/msp/monitoring-packages                         — list available packages
 *   GET    /api/msp/sales-bundles/pricing-preview               — compute cost from packageKeys[]
 *   GET    /api/msp/sales-bundles                               — list MSP's bundles (paginated)
 *   POST   /api/msp/sales-bundles                               — create bundle
 *   GET    /api/msp/sales-bundles/:bundleId                     — get bundle detail
 *   PATCH  /api/msp/sales-bundles/:bundleId                     — update bundle
 *   DELETE /api/msp/sales-bundles/:bundleId                     — delete draft/archived bundle
 *   GET    /api/msp/sales-bundles/:bundleId/assignments         — list assignments
 *   POST   /api/msp/sales-bundles/:bundleId/assignments         — assign bundle to customer
 *   DELETE /api/msp/sales-bundles/:bundleId/assignments/:assignmentId — revoke assignment
 *   GET    /api/msp/customers/:customerId/bundle-assignments     — a customer's own bundle assignments
 */

import { Router, type Request, type Response } from "express";
import {
  db,
  monitoringPackagesTable,
  mspSalesBundlesTable,
  mspSalesBundleAssignmentsTable,
  mspCustomersTable,
  mspEventStoreTable,
  mspAuditLogsTable,
} from "@workspace/db";
import { eq, and, inArray, sql } from "drizzle-orm";
import { requireRole } from "../middlewares/requireAuth.ts";
import { requirePlanFeature } from "../lib/msp-entitlement.ts";
import { randomUUID } from "crypto";
import { logger } from "../lib/logger.ts";
const log = logger.child({ channel: "tenant.msp-admin" });
import { getRequestContext } from "../lib/request-context.ts";
import { z } from "zod";

const router = Router();

// ── Helpers ────────────────────────────────────────────────────────────────────

function p(val: string | string[] | undefined): string {
  return Array.isArray(val) ? (val[0] ?? "") : (val ?? "");
}

function apiErr(res: Response, status: number, message: string) {
  res.status(status).json({ error: message });
}

function getMspId(req: Request): number | null {
  const user = req.user!;
  if (user.role === "admin" || user.mspRole === "PlatformAdmin") {
    const q = parseInt(p(req.query["mspId"] as string | undefined), 10);
    // Fall back to the user's own mspId (e.g. PlatformAdmin browsing their own MSP)
    if (isNaN(q)) return user.mspId ?? null;
    return q;
  }
  return user.mspId ?? null;
}

/** Compute internal cost from a list of package keys. */
async function computeInternalCost(packageKeys: string[]): Promise<number> {
  if (packageKeys.length === 0) return 0;
  const packages = await db
    .select({ platformCostCents: monitoringPackagesTable.platformCostCents })
    .from(monitoringPackagesTable)
    .where(inArray(monitoringPackagesTable.key, packageKeys));
  return packages.reduce((sum, p) => sum + (p.platformCostCents ?? 0), 0);
}

/** Emit an MSP event for bundle assignment activation. */
async function emitBundleActivationEvents(
  mspId: number,
  customerId: number,
  bundleId: string,
  packageKeys: string[],
  correlationId: string,
  actorUserId: number,
) {
  if (packageKeys.length === 0) return;
  const events = packageKeys.map((packageKey) => ({
    mspId,
    customerId,
    eventType: "bundle.package.activated",
    source: "msp-sales-bundles",
    actor: { id: actorUserId, role: "MSPAdmin" as const, type: "user" as const },
    meta: { tenant: { mspId, customerId } },
    payload: { bundleId, packageKey, activatedAt: new Date().toISOString() } as Record<string, unknown>,
    correlationId,
    ownerType: "msp" as const,
  }));
  await db.insert(mspEventStoreTable).values(events);
}

async function writeAudit(req: Request, params: {
  actionType: string;
  entityType: string;
  entityId: string;
  metadata?: Record<string, unknown>;
}) {
  const user = req.user!;
  await db.insert(mspAuditLogsTable).values({
    actorUserId: user.id,
    actorRole: user.mspRole ?? user.role,
    actionType: params.actionType,
    entityType: params.entityType,
    entityId: params.entityId,
    correlationId: getRequestContext()?.traceId ?? randomUUID(),
    ipAddress: req.ip,
    userAgent: req.get("user-agent"),
    outcome: "success",
    metadata: params.metadata,
  });
}

// ── Zod schemas ────────────────────────────────────────────────────────────────

const createBundleSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  monitoringPackageKeys: z.array(z.string().min(1)).min(1).max(20),
  resalePriceCents: z.number().int().min(0),
  trialDays: z.number().int().min(1).max(365).nullable().optional(),
  status: z.enum(["draft", "active"]).optional().default("draft"),
});

const updateBundleSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).nullable().optional(),
  monitoringPackageKeys: z.array(z.string().min(1)).min(1).max(20).optional(),
  resalePriceCents: z.number().int().min(0).optional(),
  trialDays: z.number().int().min(1).max(365).nullable().optional(),
  status: z.enum(["draft", "active", "archived"]).optional(),
});

const assignBundleSchema = z.object({
  customerId: z.number().int().positive(),
  tenantId: z.string().optional(),
});

// ── GET /api/msp/monitoring-packages ──────────────────────────────────────────
// Lists all active platform-authored monitoring packages available to the MSP.
// Does not gate on plan — the UI uses requiredPlanFeature to inform the user,
// and bundle creation gates on custom_bundle_composition.

router.get(
  "/msp/monitoring-packages",
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    const mspId = getMspId(req);
    if (!mspId) { apiErr(res, 400, "mspId required"); return; }
    try {
      const packages = await db
        .select({
          id: monitoringPackagesTable.id,
          packageId: monitoringPackagesTable.packageId,
          key: monitoringPackagesTable.key,
          label: monitoringPackagesTable.label,
          description: monitoringPackagesTable.description,
          engines: monitoringPackagesTable.engines,
          platformCostCents: monitoringPackagesTable.platformCostCents,
          requiredPlanFeature: monitoringPackagesTable.requiredPlanFeature,
          status: monitoringPackagesTable.status,
          createdAt: monitoringPackagesTable.createdAt,
        })
        .from(monitoringPackagesTable)
        .where(eq(monitoringPackagesTable.status, "active"))
        .orderBy(monitoringPackagesTable.label);
      res.json({ packages });
    } catch (err) {
      log.error({ err, mspId }, "msp-sales-bundles: list monitoring packages failed");
      res.status(500).json({ error: "Failed to list monitoring packages" });
    }
  },
);

// ── GET /api/msp/sales-bundles/pricing-preview ────────────────────────────────
// Compute internalCostCents for a set of package keys (no side effects).
// Query: ?packageKeys[]=key1&packageKeys[]=key2

router.get(
  "/msp/sales-bundles/pricing-preview",
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    const mspId = getMspId(req);
    if (!mspId) { apiErr(res, 400, "mspId required"); return; }
    try {
      const raw = req.query["packageKeys"];
      const packageKeys: string[] = Array.isArray(raw)
        ? (raw as string[]).filter(Boolean)
        : raw
          ? [String(raw)]
          : [];

      if (packageKeys.length === 0) {
        res.json({ packageKeys: [], internalCostCents: 0, breakdown: [] });
        return;
      }

      const packages = await db
        .select({
          key: monitoringPackagesTable.key,
          label: monitoringPackagesTable.label,
          platformCostCents: monitoringPackagesTable.platformCostCents,
          engines: monitoringPackagesTable.engines,
          requiredPlanFeature: monitoringPackagesTable.requiredPlanFeature,
          status: monitoringPackagesTable.status,
        })
        .from(monitoringPackagesTable)
        .where(inArray(monitoringPackagesTable.key, packageKeys));

      const breakdown = packages.map((pkg) => ({
        key: pkg.key,
        label: pkg.label,
        platformCostCents: pkg.platformCostCents,
        engines: pkg.engines,
        requiredPlanFeature: pkg.requiredPlanFeature,
        available: pkg.status === "active",
      }));
      const internalCostCents = breakdown.reduce((s, b) => s + (b.platformCostCents ?? 0), 0);
      res.json({ packageKeys, internalCostCents, breakdown });
    } catch (err) {
      log.error({ err, mspId }, "msp-sales-bundles: pricing preview failed");
      res.status(500).json({ error: "Failed to compute pricing preview" });
    }
  },
);

// ── GET /api/msp/sales-bundles ─────────────────────────────────────────────────

router.get(
  "/msp/sales-bundles",
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    const mspId = getMspId(req);
    if (!mspId) { apiErr(res, 400, "mspId required"); return; }
    try {
      const status = p(req.query["status"] as string | undefined) || null;
      const limit = Math.min(100, Math.max(1, parseInt(p(req.query["limit"] as string | undefined), 10) || 50));
      const offset = Math.max(0, parseInt(p(req.query["offset"] as string | undefined), 10) || 0);

      const whereClause = status
        ? and(
            eq(mspSalesBundlesTable.mspId, mspId),
            eq(mspSalesBundlesTable.status, status as "draft" | "active" | "archived"),
          )
        : eq(mspSalesBundlesTable.mspId, mspId);

      const [bundles, [{ total }]] = await Promise.all([
        db
          .select()
          .from(mspSalesBundlesTable)
          .where(whereClause)
          .orderBy(sql`${mspSalesBundlesTable.createdAt} DESC`)
          .limit(limit)
          .offset(offset),
        db
          .select({ total: sql<number>`count(*)` })
          .from(mspSalesBundlesTable)
          .where(whereClause),
      ]);

      res.json({ bundles, total: Number(total), limit, offset });
    } catch (err) {
      log.error({ err, mspId }, "msp-sales-bundles: list failed");
      res.status(500).json({ error: "Failed to list sales bundles" });
    }
  },
);

// ── POST /api/msp/sales-bundles ────────────────────────────────────────────────
// Creating a bundle with more than one package requires the custom_bundle_composition feature.
// We check this inline because the gating depends on the body payload.

router.post(
  "/msp/sales-bundles",
  requireRole("MSPAdmin"),
  async (req: Request, res: Response) => {
    const mspId = getMspId(req);
    if (!mspId) { apiErr(res, 400, "mspId required"); return; }

    const parsed = createBundleSchema.safeParse(req.body);
    if (!parsed.success) {
      apiErr(res, 400, parsed.error.errors.map((e) => e.message).join(", "));
      return;
    }
    const body = parsed.data;

    // Plan-gate multi-package composition
    if (body.monitoringPackageKeys.length > 1) {
      const gateMiddleware = requirePlanFeature("custom_bundle_composition");
      let gated = false;
      await new Promise<void>((resolve) => {
        gateMiddleware(req, res, () => { resolve(); });
        // If response was already sent (gate rejected), mark as gated
        if (res.headersSent) { gated = true; resolve(); }
      });
      if (gated || res.headersSent) return;
    }

    try {
      // Validate that all packageKeys exist and are active
      const foundPkgs = await db
        .select({ key: monitoringPackagesTable.key, platformCostCents: monitoringPackagesTable.platformCostCents, status: monitoringPackagesTable.status })
        .from(monitoringPackagesTable)
        .where(inArray(monitoringPackagesTable.key, body.monitoringPackageKeys));

      const foundKeys = new Set(foundPkgs.map((p) => p.key));
      const missing = body.monitoringPackageKeys.filter((k) => !foundKeys.has(k));
      if (missing.length > 0) {
        apiErr(res, 400, `Unknown monitoring package keys: ${missing.join(", ")}`);
        return;
      }
      const inactive = foundPkgs.filter((p) => p.status !== "active").map((p) => p.key);
      if (inactive.length > 0) {
        apiErr(res, 400, `Inactive monitoring package keys: ${inactive.join(", ")}`);
        return;
      }

      const internalCostCents = foundPkgs.reduce((s, p) => s + (p.platformCostCents ?? 0), 0);

      const [bundle] = await db
        .insert(mspSalesBundlesTable)
        .values({
          mspId,
          name: body.name,
          description: body.description,
          monitoringPackageKeys: body.monitoringPackageKeys,
          internalCostCents,
          resalePriceCents: body.resalePriceCents,
          status: body.status ?? "draft",
          trialDays: body.trialDays ?? null,
          createdByUserId: req.user!.id,
          updatedByUserId: req.user!.id,
        })
        .returning();

      await writeAudit(req, {
        actionType: "bundle.created",
        entityType: "msp_sales_bundle",
        entityId: bundle.bundleId,
        metadata: { name: bundle.name, packageCount: body.monitoringPackageKeys.length },
      });

      res.status(201).json({ bundle });
    } catch (err) {
      log.error({ err, mspId }, "msp-sales-bundles: create failed");
      res.status(500).json({ error: "Failed to create sales bundle" });
    }
  },
);

// ── GET /api/msp/sales-bundles/:bundleId ──────────────────────────────────────

router.get(
  "/msp/sales-bundles/:bundleId",
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    const mspId = getMspId(req);
    if (!mspId) { apiErr(res, 400, "mspId required"); return; }
    const bundleId = p(req.params["bundleId"]);
    try {
      const [bundle] = await db
        .select()
        .from(mspSalesBundlesTable)
        .where(and(
          eq(mspSalesBundlesTable.bundleId, bundleId),
          eq(mspSalesBundlesTable.mspId, mspId),
        ));
      if (!bundle) { apiErr(res, 404, "Bundle not found"); return; }

      // Enrich with package details
      const packages = bundle.monitoringPackageKeys.length > 0
        ? await db
            .select({
              key: monitoringPackagesTable.key,
              label: monitoringPackagesTable.label,
              description: monitoringPackagesTable.description,
              engines: monitoringPackagesTable.engines,
              platformCostCents: monitoringPackagesTable.platformCostCents,
              requiredPlanFeature: monitoringPackagesTable.requiredPlanFeature,
              status: monitoringPackagesTable.status,
            })
            .from(monitoringPackagesTable)
            .where(inArray(monitoringPackagesTable.key, bundle.monitoringPackageKeys))
        : [];

      const [{ assignmentCount }] = await db
        .select({ assignmentCount: sql<number>`count(*)` })
        .from(mspSalesBundleAssignmentsTable)
        .where(and(
          eq(mspSalesBundleAssignmentsTable.bundleId, bundleId),
          eq(mspSalesBundleAssignmentsTable.status, "active"),
        ));

      res.json({ bundle, packages, activeAssignmentCount: Number(assignmentCount) });
    } catch (err) {
      log.error({ err, mspId, bundleId }, "msp-sales-bundles: get failed");
      res.status(500).json({ error: "Failed to get bundle" });
    }
  },
);

// ── PATCH /api/msp/sales-bundles/:bundleId ────────────────────────────────────

router.patch(
  "/msp/sales-bundles/:bundleId",
  requireRole("MSPAdmin"),
  async (req: Request, res: Response) => {
    const mspId = getMspId(req);
    if (!mspId) { apiErr(res, 400, "mspId required"); return; }
    const bundleId = p(req.params["bundleId"]);

    const parsed = updateBundleSchema.safeParse(req.body);
    if (!parsed.success) {
      apiErr(res, 400, parsed.error.errors.map((e) => e.message).join(", "));
      return;
    }
    const body = parsed.data;

    try {
      const [existing] = await db
        .select()
        .from(mspSalesBundlesTable)
        .where(and(
          eq(mspSalesBundlesTable.bundleId, bundleId),
          eq(mspSalesBundlesTable.mspId, mspId),
        ));
      if (!existing) { apiErr(res, 404, "Bundle not found"); return; }

      // Plan-gate if adding multiple packages
      const newKeys = body.monitoringPackageKeys ?? existing.monitoringPackageKeys;
      if (newKeys.length > 1) {
        const gateMiddleware = requirePlanFeature("custom_bundle_composition");
        let gated = false;
        await new Promise<void>((resolve) => {
          gateMiddleware(req, res, () => { resolve(); });
          if (res.headersSent) { gated = true; resolve(); }
        });
        if (gated || res.headersSent) return;
      }

      // Recompute internal cost if package keys changed
      let internalCostCents = existing.internalCostCents;
      if (body.monitoringPackageKeys) {
        const foundPkgs = await db
          .select({ key: monitoringPackagesTable.key, platformCostCents: monitoringPackagesTable.platformCostCents, status: monitoringPackagesTable.status })
          .from(monitoringPackagesTable)
          .where(inArray(monitoringPackagesTable.key, body.monitoringPackageKeys));

        const foundKeys = new Set(foundPkgs.map((p) => p.key));
        const missing = body.monitoringPackageKeys.filter((k) => !foundKeys.has(k));
        if (missing.length > 0) { apiErr(res, 400, `Unknown monitoring package keys: ${missing.join(", ")}`); return; }
        const inactive = foundPkgs.filter((p) => p.status !== "active").map((p) => p.key);
        if (inactive.length > 0) { apiErr(res, 400, `Inactive monitoring package keys: ${inactive.join(", ")}`); return; }
        internalCostCents = foundPkgs.reduce((s, p) => s + (p.platformCostCents ?? 0), 0);
      }

      const updates: Partial<typeof mspSalesBundlesTable.$inferInsert> = {
        updatedAt: new Date(),
        updatedByUserId: req.user!.id,
        internalCostCents,
      };
      if (body.name !== undefined) updates.name = body.name;
      if (body.description !== undefined) updates.description = body.description ?? undefined;
      if (body.monitoringPackageKeys !== undefined) updates.monitoringPackageKeys = body.monitoringPackageKeys;
      if (body.resalePriceCents !== undefined) updates.resalePriceCents = body.resalePriceCents;
      if ("trialDays" in body) updates.trialDays = body.trialDays ?? undefined;
      if (body.status !== undefined) updates.status = body.status;

      const [updated] = await db
        .update(mspSalesBundlesTable)
        .set(updates)
        .where(and(
          eq(mspSalesBundlesTable.bundleId, bundleId),
          eq(mspSalesBundlesTable.mspId, mspId),
        ))
        .returning();

      await writeAudit(req, {
        actionType: "bundle.updated",
        entityType: "msp_sales_bundle",
        entityId: bundleId,
        metadata: { changes: Object.keys(updates) },
      });

      res.json({ bundle: updated });
    } catch (err) {
      log.error({ err, mspId, bundleId }, "msp-sales-bundles: patch failed");
      res.status(500).json({ error: "Failed to update bundle" });
    }
  },
);

// ── DELETE /api/msp/sales-bundles/:bundleId ───────────────────────────────────
// Only bundles with no active assignments can be deleted.

router.delete(
  "/msp/sales-bundles/:bundleId",
  requireRole("MSPAdmin"),
  async (req: Request, res: Response) => {
    const mspId = getMspId(req);
    if (!mspId) { apiErr(res, 400, "mspId required"); return; }
    const bundleId = p(req.params["bundleId"]);
    try {
      const [existing] = await db
        .select()
        .from(mspSalesBundlesTable)
        .where(and(
          eq(mspSalesBundlesTable.bundleId, bundleId),
          eq(mspSalesBundlesTable.mspId, mspId),
        ));
      if (!existing) { apiErr(res, 404, "Bundle not found"); return; }

      const [{ n }] = await db
        .select({ n: sql<number>`count(*)` })
        .from(mspSalesBundleAssignmentsTable)
        .where(and(
          eq(mspSalesBundleAssignmentsTable.bundleId, bundleId),
          eq(mspSalesBundleAssignmentsTable.status, "active"),
        ));
      if (Number(n) > 0) {
        apiErr(res, 409, "Cannot delete a bundle with active assignments. Revoke all assignments first.");
        return;
      }

      await db.delete(mspSalesBundlesTable).where(
        and(
          eq(mspSalesBundlesTable.bundleId, bundleId),
          eq(mspSalesBundlesTable.mspId, mspId),
        ),
      );

      await writeAudit(req, {
        actionType: "bundle.deleted",
        entityType: "msp_sales_bundle",
        entityId: bundleId,
        metadata: { name: existing.name },
      });

      res.json({ ok: true });
    } catch (err) {
      log.error({ err, mspId, bundleId }, "msp-sales-bundles: delete failed");
      res.status(500).json({ error: "Failed to delete bundle" });
    }
  },
);

// ── GET /api/msp/sales-bundles/:bundleId/assignments ──────────────────────────

router.get(
  "/msp/sales-bundles/:bundleId/assignments",
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    const mspId = getMspId(req);
    if (!mspId) { apiErr(res, 400, "mspId required"); return; }
    const bundleId = p(req.params["bundleId"]);
    try {
      const [bundle] = await db
        .select({ bundleId: mspSalesBundlesTable.bundleId })
        .from(mspSalesBundlesTable)
        .where(and(
          eq(mspSalesBundlesTable.bundleId, bundleId),
          eq(mspSalesBundlesTable.mspId, mspId),
        ));
      if (!bundle) { apiErr(res, 404, "Bundle not found"); return; }

      const assignments = await db
        .select({
          id: mspSalesBundleAssignmentsTable.id,
          assignmentId: mspSalesBundleAssignmentsTable.assignmentId,
          bundleId: mspSalesBundleAssignmentsTable.bundleId,
          customerId: mspSalesBundleAssignmentsTable.customerId,
          tenantId: mspSalesBundleAssignmentsTable.tenantId,
          status: mspSalesBundleAssignmentsTable.status,
          activatedAt: mspSalesBundleAssignmentsTable.activatedAt,
          trialExpiresAt: mspSalesBundleAssignmentsTable.trialExpiresAt,
          assignedAt: mspSalesBundleAssignmentsTable.assignedAt,
          revokedAt: mspSalesBundleAssignmentsTable.revokedAt,
          customerName: mspCustomersTable.name,
          customerDomain: mspCustomersTable.domain,
        })
        .from(mspSalesBundleAssignmentsTable)
        .leftJoin(
          mspCustomersTable,
          eq(mspCustomersTable.id, mspSalesBundleAssignmentsTable.customerId),
        )
        .where(eq(mspSalesBundleAssignmentsTable.bundleId, bundleId))
        .orderBy(sql`${mspSalesBundleAssignmentsTable.assignedAt} DESC`);

      res.json({ assignments });
    } catch (err) {
      log.error({ err, mspId, bundleId }, "msp-sales-bundles: list assignments failed");
      res.status(500).json({ error: "Failed to list assignments" });
    }
  },
);

// ── POST /api/msp/sales-bundles/:bundleId/assignments ─────────────────────────
// Assigns a bundle to a customer + tenant. Emits activation events per package.
// Mixed-frequency packages are fanned out as individual events — each
// package's engine (Monitoring Package Engine or Live Monitor Engine) picks
// up the event matching its frequency.

router.post(
  "/msp/sales-bundles/:bundleId/assignments",
  requireRole("MSPAdmin"),
  async (req: Request, res: Response) => {
    const mspId = getMspId(req);
    if (!mspId) { apiErr(res, 400, "mspId required"); return; }
    const bundleId = p(req.params["bundleId"]);

    const parsed = assignBundleSchema.safeParse(req.body);
    if (!parsed.success) {
      apiErr(res, 400, parsed.error.errors.map((e) => e.message).join(", "));
      return;
    }
    const { customerId, tenantId } = parsed.data;

    try {
      // Verify bundle belongs to this MSP and is active
      const [bundle] = await db
        .select()
        .from(mspSalesBundlesTable)
        .where(and(
          eq(mspSalesBundlesTable.bundleId, bundleId),
          eq(mspSalesBundlesTable.mspId, mspId),
        ));
      if (!bundle) { apiErr(res, 404, "Bundle not found"); return; }
      if (bundle.status !== "active") {
        apiErr(res, 409, "Only active bundles can be assigned. Activate the bundle first.");
        return;
      }

      // Verify customer belongs to this MSP
      const [customer] = await db
        .select({ id: mspCustomersTable.id, tenantId: mspCustomersTable.tenantId })
        .from(mspCustomersTable)
        .where(and(
          eq(mspCustomersTable.id, customerId),
          eq(mspCustomersTable.mspId, mspId),
        ));
      if (!customer) { apiErr(res, 404, "Customer not found in this MSP"); return; }

      const resolvedTenantId = tenantId ?? customer.tenantId ?? null;

      // Compute trial expiry
      const trialExpiresAt = bundle.trialDays
        ? new Date(Date.now() + bundle.trialDays * 24 * 60 * 60 * 1000)
        : null;

      const now = new Date();

      const [assignment] = await db
        .insert(mspSalesBundleAssignmentsTable)
        .values({
          bundleId,
          mspId,
          customerId,
          tenantId: resolvedTenantId ?? undefined,
          status: "active",
          activatedAt: now,
          trialExpiresAt: trialExpiresAt ?? undefined,
          assignedByUserId: req.user!.id,
          assignedAt: now,
        })
        .returning();

      // Fan-out one activation event per monitoring package (mixed-frequency support)
      // Each engine picks up events matching its monitored package keys.
      await emitBundleActivationEvents(
        mspId,
        customerId,
        bundleId,
        bundle.monitoringPackageKeys,
        assignment.assignmentId,
        req.user!.id,
      );

      await writeAudit(req, {
        actionType: "bundle.assigned",
        entityType: "msp_sales_bundle_assignment",
        entityId: assignment.assignmentId,
        metadata: {
          bundleId,
          customerId,
          tenantId: resolvedTenantId,
          packageCount: bundle.monitoringPackageKeys.length,
          hasTrial: !!trialExpiresAt,
        },
      });

      res.status(201).json({ assignment });
    } catch (err) {
      log.error({ err, mspId, bundleId }, "msp-sales-bundles: assign failed");
      res.status(500).json({ error: "Failed to assign bundle" });
    }
  },
);

// ── DELETE /api/msp/sales-bundles/:bundleId/assignments/:assignmentId ─────────

router.delete(
  "/msp/sales-bundles/:bundleId/assignments/:assignmentId",
  requireRole("MSPAdmin"),
  async (req: Request, res: Response) => {
    const mspId = getMspId(req);
    if (!mspId) { apiErr(res, 400, "mspId required"); return; }
    const bundleId = p(req.params["bundleId"]);
    const assignmentId = p(req.params["assignmentId"]);
    try {
      const [assignment] = await db
        .select()
        .from(mspSalesBundleAssignmentsTable)
        .where(and(
          eq(mspSalesBundleAssignmentsTable.assignmentId, assignmentId),
          eq(mspSalesBundleAssignmentsTable.bundleId, bundleId),
          eq(mspSalesBundleAssignmentsTable.mspId, mspId),
        ));
      if (!assignment) { apiErr(res, 404, "Assignment not found"); return; }
      if (assignment.status === "revoked") {
        apiErr(res, 409, "Assignment already revoked"); return;
      }

      const [updated] = await db
        .update(mspSalesBundleAssignmentsTable)
        .set({ status: "revoked", revokedAt: new Date(), updatedAt: new Date() })
        .where(eq(mspSalesBundleAssignmentsTable.assignmentId, assignmentId))
        .returning();

      // Emit deactivation events per package
      const [bundle] = await db
        .select({ monitoringPackageKeys: mspSalesBundlesTable.monitoringPackageKeys })
        .from(mspSalesBundlesTable)
        .where(eq(mspSalesBundlesTable.bundleId, bundleId));

      if (bundle?.monitoringPackageKeys.length) {
        const events = bundle.monitoringPackageKeys.map((packageKey) => ({
          mspId,
          customerId: assignment.customerId,
          eventType: "bundle.package.deactivated",
          source: "msp-sales-bundles",
          actor: { id: req.user!.id, role: "MSPAdmin" as const, type: "user" as const },
          meta: { tenant: { mspId, customerId: assignment.customerId } },
          payload: { bundleId, packageKey, revokedAt: new Date().toISOString() } as Record<string, unknown>,
          correlationId: assignmentId,
          ownerType: "msp" as const,
        }));
        await db.insert(mspEventStoreTable).values(events);
      }

      await writeAudit(req, {
        actionType: "bundle.assignment.revoked",
        entityType: "msp_sales_bundle_assignment",
        entityId: assignmentId,
        metadata: { bundleId, customerId: assignment.customerId },
      });

      res.json({ assignment: updated });
    } catch (err) {
      log.error({ err, mspId, bundleId, assignmentId }, "msp-sales-bundles: revoke assignment failed");
      res.status(500).json({ error: "Failed to revoke assignment" });
    }
  },
);

// ── GET /api/msp/customers/:customerId/bundle-assignments ─────────────────────
// Customer-centric complement to GET /msp/sales-bundles/:bundleId/assignments
// (which lists a bundle's customers) — this lists a single customer's own
// bundle assignments, joined with bundle name/status, for display on the
// customer record. Read-only; does not duplicate the assign/revoke routes above.

router.get(
  "/msp/customers/:customerId/bundle-assignments",
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    const mspId = getMspId(req);
    if (!mspId) { apiErr(res, 400, "mspId required"); return; }
    const customerId = parseInt(p(req.params["customerId"]), 10);
    if (isNaN(customerId)) { apiErr(res, 400, "Invalid customerId"); return; }
    try {
      const [customer] = await db
        .select({ id: mspCustomersTable.id })
        .from(mspCustomersTable)
        .where(and(
          eq(mspCustomersTable.id, customerId),
          eq(mspCustomersTable.mspId, mspId),
        ));
      if (!customer) { apiErr(res, 404, "Customer not found in this MSP"); return; }

      const assignments = await db
        .select({
          id: mspSalesBundleAssignmentsTable.id,
          assignmentId: mspSalesBundleAssignmentsTable.assignmentId,
          bundleId: mspSalesBundleAssignmentsTable.bundleId,
          status: mspSalesBundleAssignmentsTable.status,
          activatedAt: mspSalesBundleAssignmentsTable.activatedAt,
          trialExpiresAt: mspSalesBundleAssignmentsTable.trialExpiresAt,
          assignedAt: mspSalesBundleAssignmentsTable.assignedAt,
          revokedAt: mspSalesBundleAssignmentsTable.revokedAt,
          bundleName: mspSalesBundlesTable.name,
          bundleStatus: mspSalesBundlesTable.status,
        })
        .from(mspSalesBundleAssignmentsTable)
        .innerJoin(
          mspSalesBundlesTable,
          eq(mspSalesBundlesTable.bundleId, mspSalesBundleAssignmentsTable.bundleId),
        )
        .where(and(
          eq(mspSalesBundleAssignmentsTable.customerId, customerId),
          eq(mspSalesBundleAssignmentsTable.mspId, mspId),
        ))
        .orderBy(sql`${mspSalesBundleAssignmentsTable.assignedAt} DESC`);

      res.json({ assignments });
    } catch (err) {
      log.error({ err, mspId, customerId }, "msp-sales-bundles: list customer assignments failed");
      res.status(500).json({ error: "Failed to list customer bundle assignments" });
    }
  },
);

export default router;
