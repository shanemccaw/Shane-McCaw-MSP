// artifacts/api-server/src/routes/admin-dlp-provisioning.ts
//
// #249 (#246 chunk C): admin-panel surface for the DLP/Label Purview
// role-group provisioning chain (lib/dlp-role-group-provisioning.ts).
// consent.ts fires the chain automatically on every `graph` consent success;
// this route exists for the two cases #246 called out explicitly — backfill
// (tenants that consented before this chain existed) and manual retry (the
// chain failed or was blocked partway, most commonly because the tenant's
// separate `writeBack` consent wasn't granted yet at the time of the
// automatic run). Both routes work for ANY connected tenant, not just
// testbed ones — unlike admin-write-actions.ts's Launch Control template
// testing surface, this is the platform's real onboarding-time provisioning
// path and must be exercisable for every real customer.

import { Router, type IRouter, type Request, type Response } from "express";
import { db, tenantsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";
import { getDlpProvisioningState, provisionDlpRoleGroupForTenant } from "../lib/dlp-role-group-provisioning.ts";
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

// ─── GET /admin/customers/:customerId/dlp-provisioning ───────────────────────
// Real current state: not_provisioned / partially_provisioned / provisioned,
// backed by live Graph reads for the group + membership, and the most recent
// audit-log entry for the Purview role-group assignment step (see
// getDlpProvisioningState's own doc comment for why that half isn't a live
// read too — no Graph/PS read endpoint exists for Purview role-group
// membership today).
router.get("/admin/customers/:customerId/dlp-provisioning", requireAdmin, async (req: Request, res: Response) => {
  const customer = await resolveTenant(Number(req.params.customerId));
  if (!customer) {
    res.status(404).json({ error: "Customer not found" });
    return;
  }
  if (!customer.tenantId) {
    res.json({ status: "not_provisioned", groupExists: false, servicePrincipalIsMember: false, targetAppId: null, targetAppIdSource: null, lastRun: null, reason: "Tenant has no connected Microsoft 365 tenant yet" });
    return;
  }
  try {
    const state = await getDlpProvisioningState(customer.tenantId, customer.id);
    res.json(state);
  } catch (err) {
    log.error({ err, customerId: customer.id }, "admin-dlp-provisioning: failed to read state");
    res.status(500).json({ error: "Failed to load DLP provisioning state" });
  }
});

// ─── POST /admin/customers/:customerId/dlp-provisioning/trigger ──────────────
// Manual re-trigger — backfill or retry. Idempotent by construction (every
// step in provisionDlpRoleGroupForTenant checks live/audit state before
// writing), so re-running against an already-provisioned tenant is a safe
// no-op that reports "already_done" per step, never a duplicate group or a
// duplicate role-group membership error.
router.post("/admin/customers/:customerId/dlp-provisioning/trigger", requireAdmin, async (req: Request, res: Response) => {
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
    const result = await provisionDlpRoleGroupForTenant(customer.tenantId, customer.id, "admin_manual_retrigger", {
      actorUserId: req.user?.id ?? null,
      actorName: req.user?.email ?? "admin",
    });
    res.json(result);
  } catch (err) {
    // provisionDlpRoleGroupForTenant's own contract is "never throws" — this
    // only catches a genuinely unexpected failure so the route itself never
    // 500s silently without a body.
    log.error({ err, customerId: customer.id }, "admin-dlp-provisioning: trigger failed unexpectedly");
    res.status(500).json({ error: "Failed to trigger DLP role-group provisioning" });
  }
});

export default router;
