/**
 * portal-remediation-fix-routes.ts — the fix-route dimension over the wire (#1539).
 *
 *   GET /api/portal/remediation/fix-routes
 *     — for the calling customer's tenant, every remediation item that has a
 *       known fix route, resolved to one of the three shapes and carrying the
 *       affordance data that shape needs.
 *
 * This is the foundation the rest of the Remediation Tracking module builds on:
 * an item cannot be turned into a worked-list row, armed with a Change Control,
 * or closed with evidence until it knows WHICH kind of item it is. That resolution
 * is `min(what the finding supports, what the tenant permits)` and lives in
 * `../lib/remediation-fix-route.ts`; this route is the thin, tenant-scoped
 * exposure of it — it computes shapes, it does not decide or arm a CR.
 *
 * THE ITEM SET is the union of (a) checks with a PUBLISHED knowledge-base row —
 * the ones with authored, human-verified fix content — and (b) checks a live,
 * execution-ready config pack maps. A check in (b) but not (a) is still a real
 * item: the platform can run it even with no authored prose yet, and the shape
 * says so. Nothing is fabricated — an empty tenant returns an empty list.
 *
 * SCOPE STOP: this ends at the wire contract. There is no `artifacts/portal`
 * page for Remediation Tracking yet (no design export exists), and #1539 does
 * not create one.
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

import { requireRole } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";
import { resolveFixRoute, resolveTenantWriteCeiling, FIX_ROUTE_AFFORDANCE } from "../lib/remediation-fix-route";

const log = logger.child({ channel: "engine.remediation-tracker" });

const router: IRouter = Router();

/** One resolved remediation item on the wire. */
interface WireFixRouteItem {
  readonly checkKey: string;
  /** The check's human title — KB `title` override, else `monitor_checks.label`, else the key. */
  readonly title: string;
  /** The resolved shape for THIS tenant. */
  readonly fixRoute: RemediationFixRoute;
  /** The finding-side authored ceiling before tenant consent — null when no KB row exists yet. */
  readonly findingCapability: RemediationFixRoute | null;
  /** "execute" | "copy" | "link" — how the primary control behaves for this shape. */
  readonly affordance: "execute" | "copy" | "link";
  /** A live, execution-ready config pack maps this check. */
  readonly hasWritePack: boolean;
  /** Affordance payload — only what the shape actually renders; nulls where absent. */
  readonly adminCenterPath: string | null;
  readonly adminCenterUrl: string | null;
  readonly validationCommand: string | null;
}

/** tenants.id off the JWT's `customerId` claim — same resolution as the rest of this journey. */
function resolveCustomerId(req: Request): number | null {
  const id = (req.user as { customerId?: number } | undefined)?.customerId;
  return typeof id === "number" && !isNaN(id) ? id : null;
}

router.get(
  "/portal/remediation/fix-routes",
  requireRole("Assessment"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = resolveCustomerId(req);
    if (customerId === null) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }

    try {
      // ── Tenant side: the write-back ceiling for this customer ────────────────
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

      // ── Finding side: published KB rows + checks a live pack maps ────────────
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

      // Checks with a live, execution-ready config pack (template_id set, pack active).
      const packRows = await db
        .select({ checkKey: configPackTemplatesTable.checkKey })
        .from(configPackTemplatesTable)
        .innerJoin(configPacksTable, eq(configPacksTable.id, configPackTemplatesTable.packId))
        .where(and(isNotNull(configPackTemplatesTable.checkKey), isNotNull(configPackTemplatesTable.templateId), eq(configPacksTable.status, "active")));

      const packCheckKeys = new Set<string>();
      for (const r of packRows) if (r.checkKey) packCheckKeys.add(r.checkKey);

      const kbByKey = new Map(kbRows.map((r) => [r.checkKey, r]));
      const allKeys = [...new Set([...kbByKey.keys(), ...packCheckKeys])];

      // Human labels for any key without a KB `title` override.
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
      log.error({ err, customerId }, "GET /portal/remediation/fix-routes failed");
      res.status(500).json({ error: "Failed to resolve remediation fix routes" });
    }
  },
);

export default router;
