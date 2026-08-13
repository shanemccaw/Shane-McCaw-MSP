/**
 * msp-m365-sla.ts
 *
 * MSP-facing M365 Third-Party SLA accountability view — per-customer,
 * per-service Uptime Percentage against Microsoft's own 99.9% Monthly
 * Uptime Percentage SLA commitment, computed by sla-uptime.ts from the
 * history m365-health-sample.ts's hourly seeded workflow accumulates.
 *
 * Distinct from /api/msp/sla/* (msp-sla.ts) — that's the MSP's own internal
 * ticket response/resolution SLA engine, an unrelated domain that happens
 * to share the word "SLA". This is Microsoft's third-party uptime
 * commitment, not the MSP's own.
 *
 * Routes (MSPOperator+, mspId from JWT claim via resolveMspIdStrict, staff
 * customer scoping applied):
 *   GET /api/msp/m365-sla — per-customer, per-service 30/90-day uptime %
 *     and breach flags across the caller's book, filterable by customerId.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, tenantsTable } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { requireRole, resolveStaffScopedCustomerIds } from "../middlewares/requireAuth";
import { resolveMspIdStrict } from "../lib/resolve-msp-id.ts";
import { computeM365UptimeForTenant, SLA_TARGET_UPTIME_PERCENT } from "../lib/sla-uptime";
import { logger } from "../lib/logger";

const log = logger.child({ channel: "integration.azure" });

const router: IRouter = Router();

router.get("/msp/m365-sla", requireRole("MSPOperator"), async (req: Request, res: Response) => {
  try {
    const mspId = resolveMspIdStrict(req);
    if (mspId === null) {
      res.status(403).json({ error: "MSP context required" });
      return;
    }

    const customerIdParam = req.query["customerId"] ? Number(req.query["customerId"]) : undefined;
    const customerIdFilter = typeof customerIdParam === "number" && !isNaN(customerIdParam) ? customerIdParam : undefined;

    // Per-staff customer scoping, same chokepoint as msp-alerts.ts. null = unrestricted.
    const scopedIds = await resolveStaffScopedCustomerIds(req.user!);

    // tenants.tenant_id is NOT NULL UNIQUE, so the old isNotNull(tenantId)
    // predicate that guarded msp_customers' nullable tenant GUID is now a
    // tautology and has been dropped rather than left as misleading noise.
    const conditions = [eq(tenantsTable.mspId, mspId)];
    if (scopedIds !== null) conditions.push(inArray(tenantsTable.id, scopedIds));
    if (customerIdFilter !== undefined) conditions.push(eq(tenantsTable.id, customerIdFilter));

    const customers = await db
      .select({ id: tenantsTable.id, name: tenantsTable.customerName, tenantId: tenantsTable.tenantId })
      .from(tenantsTable)
      .where(and(...conditions));

    const results = [];
    for (const customer of customers) {
      // Cheap empty-string defense only — a NULL tenant GUID is no longer possible.
      if (!customer.tenantId) continue;
      const services = await computeM365UptimeForTenant(customer.tenantId);
      results.push({
        customerId: customer.id,
        customerName: customer.name,
        tenantId: customer.tenantId,
        services,
      });
    }

    res.json({ target: SLA_TARGET_UPTIME_PERCENT, customers: results });
  } catch (err) {
    log.error({ err }, "msp-m365-sla: GET /msp/m365-sla failed");
    res.status(500).json({ error: "Failed to fetch M365 SLA data" });
  }
});

export default router;
