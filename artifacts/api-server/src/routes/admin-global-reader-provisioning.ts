// artifacts/api-server/src/routes/admin-global-reader-provisioning.ts
//
// #1130 (part of #1128): admin-panel surface for the Global Reader directory-
// role provisioning (lib/global-reader-role-provisioning.ts). consent.ts fires
// the assignment automatically on every `writeBack` consent success; this route
// exists for the same two cases the DLP provisioning route covers — backfill
// (tenants whose write-back consent predates this assignment) and manual retry
// (the assignment was blocked because write-back consent wasn't granted yet at
// the time of the automatic run). Both routes work for ANY connected tenant.

import { Router, type IRouter, type Request, type Response } from "express";
import { db, tenantsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";
import { getGlobalReaderProvisioningState, provisionGlobalReaderForTenant } from "../lib/global-reader-role-provisioning.ts";
import { logger } from "../lib/logger.ts";
const log = logger.child({ channel: "tenant.provisioning" });

const router: IRouter = Router();

async function resolveTenant(customerId: unknown): Promise<{ id: number; tenantId: string; name: string } | null> {
  if (typeof customerId !== "number" || !Number.isInteger(customerId) || customerId <= 0) return null;
  const [row] = await db
    .select({ id: tenantsTable.id, tenantId: tenantsTable.tenantId, name: tenantsTable.customerName })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, customerId))
    .limit(1);
  return row ?? null;
}

// ─── GET /admin/customers/:customerId/global-reader-provisioning ─────────────
// Real current state: not_provisioned / provisioned, backed by a best-effort
// live role-assignment read with an audit-log fallback (see
// getGlobalReaderProvisioningState's own doc comment for why the live read
// isn't always reachable — the READ app lacks RoleManagement.Read.Directory).
router.get("/admin/customers/:customerId/global-reader-provisioning", requireAdmin, async (req: Request, res: Response) => {
  const customer = await resolveTenant(Number(req.params.customerId));
  if (!customer) {
    res.status(404).json({ error: "Customer not found" });
    return;
  }
  if (!customer.tenantId) {
    res.json({ status: "not_provisioned", roleAssigned: false, roleAssignedSource: "none", lastRun: null, reason: "Tenant has no connected Microsoft 365 tenant yet" });
    return;
  }
  try {
    const state = await getGlobalReaderProvisioningState(customer.tenantId, customer.id);
    res.json(state);
  } catch (err) {
    log.error({ err, customerId: customer.id }, "admin-global-reader-provisioning: failed to read state");
    res.status(500).json({ error: "Failed to load Global Reader provisioning state" });
  }
});

// ─── POST /admin/customers/:customerId/global-reader-provisioning/trigger ────
// Manual re-trigger — backfill or retry. Idempotent by construction (a
// duplicate assignment is classified as already_done, never an error), so
// re-running against an already-provisioned tenant is a safe no-op.
router.post("/admin/customers/:customerId/global-reader-provisioning/trigger", requireAdmin, async (req: Request, res: Response) => {
  const customer = await resolveTenant(Number(req.params.customerId));
  if (!customer) {
    res.status(404).json({ error: "Customer not found" });
    return;
  }
  if (!customer.tenantId) {
    res.status(400).json({ error: "Tenant has no connected Microsoft 365 tenant yet" });
    return;
  }
  try {
    const result = await provisionGlobalReaderForTenant(customer.tenantId, customer.id, "admin_manual_retrigger", {
      actorUserId: req.user?.id ?? null,
      actorName: req.user?.email ?? "admin",
    });
    res.json(result);
  } catch (err) {
    // provisionGlobalReaderForTenant's own contract is "never throws" — this
    // only catches a genuinely unexpected failure so the route itself never
    // 500s silently without a body.
    log.error({ err, customerId: customer.id }, "admin-global-reader-provisioning: trigger failed unexpectedly");
    res.status(500).json({ error: "Failed to trigger Global Reader provisioning" });
  }
});

export default router;
