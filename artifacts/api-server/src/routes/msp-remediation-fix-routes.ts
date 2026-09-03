/**
 * msp-remediation-fix-routes.ts — Git #2670, Feature #1684 (Remediation
 * Tracking, MSP Console). MSP-side mirror of `portal-remediation-fix-
 * routes.ts` (#1539) — the fix-route dimension (which of the three item
 * kinds an item is, for this tenant), resolved for `:customerId` under an
 * MSP ownership check instead of the caller's own JWT `customerId` claim.
 * Feature #1684: "manage the three fix shapes."
 *
 *   GET /api/msp/customers/:customerId/remediation/fix-routes
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  remediationKnowledgeBaseTable,
  configPackTemplatesTable,
  configPacksTable,
  monitorChecksTable,
  tenantsTable,
  type RemediationFixRoute,
} from "@workspace/db";
import { and, eq, inArray, isNotNull } from "drizzle-orm";

import { requireRole, assertCustomerAccess } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";
import { resolveFixRoute, resolveTenantWriteCeiling, FIX_ROUTE_AFFORDANCE } from "../lib/remediation-fix-route";

const log = logger.child({ channel: "engine.remediation-tracker" });

const router: IRouter = Router();

interface WireFixRouteItem {
  readonly checkKey: string;
  readonly title: string;
  readonly fixRoute: RemediationFixRoute;
  readonly findingCapability: RemediationFixRoute | null;
  readonly affordance: "execute" | "copy" | "link";
  readonly hasWritePack: boolean;
  readonly adminCenterPath: string | null;
  readonly adminCenterUrl: string | null;
  readonly validationCommand: string | null;
}

/** Same resolve+authorize idiom as msp-remediation-tracker.ts. */
async function resolveAuthorizedCustomerId(req: Request, res: Response): Promise<number | null> {
  const customerId = parseInt(req.params.customerId as string, 10);
  if (isNaN(customerId)) {
    res.status(400).json({ error: "Invalid customerId" });
    return null;
  }
  if (!(await assertCustomerAccess(req.user!, customerId))) {
    res.status(404).json({ error: "Customer not found" });
    return null;
  }
  return customerId;
}

router.get(
  "/msp/customers/:customerId/remediation/fix-routes",
  requireRole("MSPOperator"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = await resolveAuthorizedCustomerId(req, res);
    if (customerId === null) return;

    try {
      const [tenant] = await db
        .select({ consent: tenantsTable.consent })
        .from(tenantsTable)
        .where(eq(tenantsTable.id, customerId))
        .limit(1);

      if (!tenant) {
        res.status(404).json({ error: "Tenant not found" });
        return;
      }
      const tenantWriteCeiling = resolveTenantWriteCeiling(tenant.consent);

      const kbRows = await db
        .select({
          checkKey: remediationKnowledgeBaseTable.checkKey,
          title: remediationKnowledgeBaseTable.title,
          capability: remediationKnowledgeBaseTable.fixRouteCapability,
          adminCenterPath: remediationKnowledgeBaseTable.adminCenterPath,
          adminCenterUrl: remediationKnowledgeBaseTable.adminCenterUrl,
          validationCommand: remediationKnowledgeBaseTable.validationCommand,
        })
        .from(remediationKnowledgeBaseTable)
        .where(eq(remediationKnowledgeBaseTable.status, "published"));

      const packRows = await db
        .select({ checkKey: configPackTemplatesTable.checkKey })
        .from(configPackTemplatesTable)
        .innerJoin(configPacksTable, eq(configPacksTable.id, configPackTemplatesTable.packId))
        .where(and(isNotNull(configPackTemplatesTable.checkKey), isNotNull(configPackTemplatesTable.templateId), eq(configPacksTable.status, "active")));

      const packCheckKeys = new Set<string>();
      for (const r of packRows) if (r.checkKey) packCheckKeys.add(r.checkKey);

      const kbByKey = new Map(kbRows.map((r) => [r.checkKey, r]));
      const allKeys = [...new Set([...kbByKey.keys(), ...packCheckKeys])];

      const labelByKey = new Map<string, string>();
      if (allKeys.length > 0) {
        const labels = await db
          .select({ key: monitorChecksTable.key, label: monitorChecksTable.label })
          .from(monitorChecksTable)
          .where(inArray(monitorChecksTable.key, allKeys));
        for (const l of labels) labelByKey.set(l.key, l.label);
      }

      const items: WireFixRouteItem[] = allKeys
        .map((checkKey): WireFixRouteItem => {
          const kb = kbByKey.get(checkKey);
          const writePackAvailable = packCheckKeys.has(checkKey);
          const capability = kb?.capability ?? null;
          const fixRoute = resolveFixRoute({ capability, writePackAvailable, consent: tenant.consent });
          const title = kb?.title?.trim() || labelByKey.get(checkKey) || checkKey;
          return {
            checkKey,
            title,
            fixRoute,
            findingCapability: capability,
            affordance: FIX_ROUTE_AFFORDANCE[fixRoute],
            hasWritePack: writePackAvailable,
            adminCenterPath: kb?.adminCenterPath ?? null,
            adminCenterUrl: kb?.adminCenterUrl ?? null,
            validationCommand: kb?.validationCommand ?? null,
          };
        })
        .sort((a, b) => a.title.localeCompare(b.title));

      res.json({ tenantWriteCeiling, items });
    } catch (err) {
      log.error({ err, customerId }, "GET /msp/customers/:customerId/remediation/fix-routes failed");
      res.status(500).json({ error: "Failed to resolve remediation fix routes" });
    }
  },
);

export default router;
