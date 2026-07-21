/**
 * msp-launch-control.ts
 *
 * M365 Launch Control — an MSP-facing console where a technician executes
 * real, live M365 write actions against a customer's tenant, one action at a
 * time. Distinct from Mission Control (the existing customer monitoring
 * dashboard).
 *
 * Auth: requireRole("MSPOperator") + requireMspScope("params") (path-based
 * :mspId). Every customerId is additionally re-checked via
 * assertCustomerAccess so a staff member can never reach a customer outside
 * their own MSP, or outside their per-staff tenant scope.
 *
 * Entitlement model (two independent axes, both must clear for "included"):
 *   - MSP-side: services.type_attributes.tierCapabilities, via
 *     launch_control_safe_write / launch_control_gated_write (msp-entitlement.ts).
 *   - Customer-side: the customer's purchased Monitoring tier (services.tier,
 *     resolved via msp_customers -> msp_users -> client_services -> services —
 *     NOT the MSP sales-bundle path, which can't distinguish Enhanced from
 *     Premium) against a catalog action's min_bundled_tier.
 * write_action_catalog.required_capability_key is intentionally never read —
 * no add-on/capability-grant mechanism exists yet (see task history).
 *
 * TEMPORARY STAGING RESTRICTION: execute only ever runs against a customer
 * flagged isTestbed — this is a real Graph write against a real tenant, and
 * the general live-tenant restriction is a separate, later task.
 *
 * Routes:
 *   GET  /api/msp/:mspId/launch-control/actions?customerId=:customerId
 *   POST /api/msp/:mspId/launch-control/execute
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  writeActionCatalogTable,
  baselineActionTemplatesTable,
  mspCustomersTable,
  clientServicesTable,
  servicesTable,
  type WriteActionCatalog,
} from "@workspace/db";
import { eq, and, asc } from "drizzle-orm";
import { requireRole, requireMspScope, assertCustomerAccess } from "../middlewares/requireAuth";
import { loadTier, tierAllowsFeature } from "../lib/msp-entitlement";
import { resolveCustomerPortalUserId } from "../lib/tenant-signals";
import { logger } from "../lib/logger";

const log = logger.child({ channel: "engine.launch-control" });

const router: IRouter = Router();

function p(val: string | string[] | undefined): string {
  return Array.isArray(val) ? (val[0] ?? "") : (val ?? "");
}

// Monitoring tier rank, used only to compare a customer's purchased tier
// against a catalog action's min_bundled_tier. Not independently
// re-verified against live services.tier values in this session (no DB
// access here) — Basic/Enhanced/Premium are the three names given for this
// task; an unrecognized tier name resolves to null and fails closed (see
// resolveTierRank), never silently grants coverage.
const MONITORING_TIER_RANK: Record<string, number> = {
  basic: 0,
  enhanced: 1,
  premium: 2,
};

function resolveTierRank(tierName: string | null | undefined): number | null {
  if (!tierName) return null;
  const rank = MONITORING_TIER_RANK[tierName.toLowerCase()];
  return rank ?? null;
}

/**
 * Resolve a customer's purchased Monitoring tier (services.tier) via the
 * real join chain: msp_customers.id -> msp_users (active) -> users.id ->
 * client_services.clientUserId -> client_services.serviceId -> services.id.
 * Deliberately NOT the MSP sales-bundle / monitoring_packages path — that
 * path can't distinguish an Enhanced customer from a Premium one, since both
 * share the same monitoring_packages.key.
 */
async function resolveCustomerMonitoringTier(customerId: number): Promise<string | null> {
  const portalUserId = await resolveCustomerPortalUserId(customerId);
  if (portalUserId === null) return null;

  const [row] = await db
    .select({ tier: servicesTable.tier })
    .from(clientServicesTable)
    .innerJoin(servicesTable, eq(servicesTable.id, clientServicesTable.serviceId))
    .where(and(eq(clientServicesTable.clientUserId, portalUserId), eq(clientServicesTable.status, "active")))
    .orderBy(asc(clientServicesTable.id))
    .limit(1);

  return row?.tier ?? null;
}

type Availability = "included" | "billable_upsell" | "a_la_carte";

/**
 * The single source of truth for whether a write_action_catalog row is
 * usable by this MSP for this customer right now. Used by both the GET
 * listing (informational) and POST execute (the actual re-validation gate —
 * never trusts a client-supplied availability label).
 */
function computeAvailability(
  row: Pick<WriteActionCatalog, "safeOrGated" | "minBundledTier">,
  tier: Awaited<ReturnType<typeof loadTier>>,
  customerTierRank: number | null,
): Availability {
  const capabilityKey = row.safeOrGated === "gated" ? "launch_control_gated_write" : "launch_control_safe_write";
  if (!tierAllowsFeature(tier, capabilityKey)) return "a_la_carte";

  const requiredRank = resolveTierRank(row.minBundledTier);
  if (requiredRank === null) return "included";
  if (customerTierRank !== null && customerTierRank >= requiredRank) return "included";
  return "billable_upsell";
}

// ── GET /msp/:mspId/launch-control/actions ────────────────────────────────────

router.get(
  "/msp/:mspId/launch-control/actions",
  requireRole("MSPOperator"),
  requireMspScope("params"),
  async (req: Request, res: Response): Promise<void> => {
    const mspId = parseInt(p(req.params["mspId"]), 10);
    if (isNaN(mspId)) { res.status(400).json({ error: "mspId must be a number" }); return; }

    const customerId = parseInt(p(req.query["customerId"] as string | string[] | undefined), 10);
    if (isNaN(customerId)) { res.status(400).json({ error: "customerId query param is required" }); return; }

    try {
      if (!(await assertCustomerAccess(req.user!, customerId))) {
        res.status(403).json({ error: "Access to this customer is not permitted" });
        return;
      }

      const [tier, customerTier, catalog] = await Promise.all([
        loadTier(mspId),
        resolveCustomerMonitoringTier(customerId),
        db.select().from(writeActionCatalogTable).orderBy(asc(writeActionCatalogTable.sortOrder)),
      ]);
      const customerTierRank = resolveTierRank(customerTier);

      const actions = catalog.map((row) => ({
        ...row,
        availability: computeAvailability(row, tier, customerTierRank),
      }));

      res.json({ actions, customerTier });
    } catch (err) {
      log.error({ err, mspId, customerId }, "GET /msp/:mspId/launch-control/actions failed");
      res.status(500).json({ error: "Failed to load launch control actions" });
    }
  },
);

// ── POST /msp/:mspId/launch-control/execute ───────────────────────────────────

router.post(
  "/msp/:mspId/launch-control/execute",
  requireRole("MSPOperator"),
  requireMspScope("params"),
  async (req: Request, res: Response): Promise<void> => {
    const mspId = parseInt(p(req.params["mspId"]), 10);
    if (isNaN(mspId)) { res.status(400).json({ error: "mspId must be a number" }); return; }

    const body = req.body as { templateId?: string; customerId?: number; variables?: Record<string, string> };
    const templateId = typeof body.templateId === "string" ? body.templateId : "";
    const customerId = typeof body.customerId === "number" ? body.customerId : NaN;
    if (!templateId || isNaN(customerId)) {
      res.status(400).json({ error: "templateId and customerId are required" });
      return;
    }

    try {
      if (!(await assertCustomerAccess(req.user!, customerId))) {
        res.status(403).json({ error: "Access to this customer is not permitted" });
        return;
      }

      // Re-validate from scratch — never trust a client-supplied availability
      // label. write_action_catalog has no FK to baseline_action_templates,
      // so the catalog row is resolved by actionName === templateId (the two
      // tables share one identifier space; most catalog rows have no
      // matching baseline_action_templates row yet).
      const [catalogRow] = await db
        .select()
        .from(writeActionCatalogTable)
        .where(eq(writeActionCatalogTable.actionName, templateId))
        .limit(1);
      if (!catalogRow) {
        res.status(404).json({ error: "Action not found in the write action catalog" });
        return;
      }

      const [tier, customerTier] = await Promise.all([
        loadTier(mspId),
        resolveCustomerMonitoringTier(customerId),
      ]);
      const availability = computeAvailability(catalogRow, tier, resolveTierRank(customerTier));
      if (availability !== "included") {
        res.status(402).json({ error: "This action is not included in your current plan for this customer", availability });
        return;
      }

      const [customer] = await db
        .select({
          id: mspCustomersTable.id,
          tenantId: mspCustomersTable.tenantId,
          isTestbed: mspCustomersTable.isTestbed,
          name: mspCustomersTable.name,
        })
        .from(mspCustomersTable)
        .where(eq(mspCustomersTable.id, customerId))
        .limit(1);
      if (!customer?.tenantId) {
        res.status(400).json({ error: "Selected customer has no connected tenant" });
        return;
      }
      // TEMPORARY STAGING RESTRICTION: Launch Control only runs against a
      // testbed-flagged customer for now — this is a real Graph write, and
      // lifting this restriction for live customer tenants is a separate,
      // later task (out of scope here).
      if (!customer.isTestbed) {
        res.status(403).json({ error: "Launch Control is only available for a customer flagged isTestbed" });
        return;
      }

      const [template] = await db
        .select()
        .from(baselineActionTemplatesTable)
        .where(eq(baselineActionTemplatesTable.templateId, templateId))
        .limit(1);
      if (!template) {
        res.status(404).json({ error: "This action is in the catalog but has no runnable template yet" });
        return;
      }

      const { runBaselineTemplateAgainstTenant } = await import("../lib/workflow-executor");
      const payload: Record<string, unknown> = { ...(body.variables ?? {}), customerId };
      const result = await runBaselineTemplateAgainstTenant(
        templateId,
        customer.tenantId,
        customerId,
        payload,
        "launch_control",
      );

      log.info(
        { mspId, templateId, customerId, tenantId: customer.tenantId, success: result.success, userId: req.user?.id },
        "msp-launch-control: execute completed",
      );
      res.json({ result, tenant: { customerId: customer.id, name: customer.name } });
    } catch (err) {
      log.error({ err, mspId, templateId, customerId }, "POST /msp/:mspId/launch-control/execute failed");
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to execute action" });
    }
  },
);

export default router;
