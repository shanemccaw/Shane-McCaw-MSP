/**
 * admin-remediation-catalog.ts
 *
 * GET /api/admin/remediation-catalog
 *
 * The read-only backing for the admin-panel "Packs & Remediations" testbed
 * testing surface (Git #1172). Returns every sellable Quick-Start Write Pack
 * (services.category='config_pack') and micro-remediation
 * (services.category='micro_remediation') joined to the REAL executable that
 * fulfils it — resolved through the one canonical wiring in
 * lib/remediation-catalog.ts — plus whether that executable actually exists in
 * the DB and is therefore runnable against a testbed tenant.
 *
 * The surface does NOT introduce a new execution path: to actually run a
 * product the UI calls the existing, already-testbed-gated endpoints —
 * POST /api/admin/config-packs/:packKey/run(/plan) for packs, and
 * POST /api/admin/write-actions/:templateId/preview|execute for micro-
 * remediations. This endpoint only tells the UI which key to send.
 *
 * requireAdmin. Read-only — never mutates a tenant.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  servicesTable,
  configPacksTable,
  configPackTemplatesTable,
  baselineActionTemplatesTable,
} from "@workspace/db";
import { inArray, sql } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";
import { resolveServiceExecutable } from "../lib/remediation-catalog";

const log = logger.child({ channel: "admin.clients" });

const router: IRouter = Router();

interface CatalogProduct {
  serviceId: number;
  name: string;
  slug: string | null;
  category: string | null;
  priceCents: number | null;
  visibility: string;
  isPublic: boolean;
  /** Honest per-product readiness note carried in type_attributes (signal_pending, scopes_pending, …). */
  executionReadiness: string | null;
  requiredPermission: string | null;
  /** The resolved executable + whether it really exists and is runnable. */
  executable: {
    kind: "config_pack" | "micro_remediation" | "unwired" | "not_in_catalog";
    packKey?: string;
    templateId?: string;
    reason?: string;
    existsInDb: boolean;
    /** config_pack: number of steps; micro_remediation: undefined. */
    stepCount?: number;
    /** micro_remediation executable detail (when the template exists). */
    method?: string;
    endpoint?: string;
    requiredVariables?: string[];
    reversible?: boolean;
    requiresVerificationGate?: boolean;
  };
  /** True iff the executable exists in the DB — i.e. a testbed run would resolve. */
  testbedRunnable: boolean;
}

function readAttr(typeAttributes: unknown, key: string): string | null {
  if (typeAttributes && typeof typeAttributes === "object") {
    const v = (typeAttributes as Record<string, unknown>)[key];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

router.get("/admin/remediation-catalog", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const services = await db
      .select({
        id: servicesTable.id,
        name: servicesTable.name,
        slug: servicesTable.slug,
        category: servicesTable.category,
        priceCents: servicesTable.priceCents,
        visibility: servicesTable.visibility,
        isPublic: servicesTable.isPublic,
        typeAttributes: servicesTable.typeAttributes,
      })
      .from(servicesTable)
      .where(inArray(servicesTable.category, ["config_pack", "micro_remediation"]))
      .orderBy(servicesTable.category, servicesTable.name);

    // Resolve every product to its executable first, then batch-check existence.
    const resolved = services.map((s) => ({
      service: s,
      exec: resolveServiceExecutable({ slug: s.slug, category: s.category, typeAttributes: s.typeAttributes }),
    }));

    const wantedPackKeys = [
      ...new Set(resolved.map((r) => (r.exec.kind === "config_pack" ? r.exec.packKey : null)).filter((k): k is string => !!k)),
    ];
    const wantedTemplateIds = [
      ...new Set(resolved.map((r) => (r.exec.kind === "micro_remediation" ? r.exec.templateId : null)).filter((k): k is string => !!k)),
    ];

    // Config packs that exist + their step counts.
    const packRows = wantedPackKeys.length
      ? await db
          .select({
            packKey: configPacksTable.packKey,
            stepCount: sql<number>`count(${configPackTemplatesTable.id})::int`,
          })
          .from(configPacksTable)
          .leftJoin(configPackTemplatesTable, sql`${configPackTemplatesTable.packId} = ${configPacksTable.id}`)
          .where(inArray(configPacksTable.packKey, wantedPackKeys))
          .groupBy(configPacksTable.packKey)
      : [];
    const packByKey = new Map(packRows.map((p) => [p.packKey, p]));

    // Micro-remediation templates that exist + their executable detail.
    const templateRows = wantedTemplateIds.length
      ? await db
          .select({
            templateId: baselineActionTemplatesTable.templateId,
            method: baselineActionTemplatesTable.method,
            endpoint: baselineActionTemplatesTable.endpoint,
            requiredVariables: baselineActionTemplatesTable.requiredVariables,
            reversible: baselineActionTemplatesTable.reversible,
            requiresVerificationGate: baselineActionTemplatesTable.requiresVerificationGate,
          })
          .from(baselineActionTemplatesTable)
          .where(inArray(baselineActionTemplatesTable.templateId, wantedTemplateIds))
      : [];
    const templateById = new Map(templateRows.map((t) => [t.templateId, t]));

    const products: CatalogProduct[] = resolved.map(({ service: s, exec }) => {
      let executable: CatalogProduct["executable"];
      if (exec.kind === "config_pack") {
        const pack = packByKey.get(exec.packKey);
        executable = { kind: "config_pack", packKey: exec.packKey, existsInDb: Boolean(pack), stepCount: pack?.stepCount };
      } else if (exec.kind === "micro_remediation") {
        const tpl = templateById.get(exec.templateId);
        executable = {
          kind: "micro_remediation",
          templateId: exec.templateId,
          existsInDb: Boolean(tpl),
          method: tpl?.method,
          endpoint: tpl?.endpoint,
          requiredVariables: tpl?.requiredVariables ?? undefined,
          reversible: tpl?.reversible,
          requiresVerificationGate: tpl?.requiresVerificationGate,
        };
      } else if (exec.kind === "unwired") {
        executable = { kind: "unwired", reason: exec.reason, existsInDb: false };
      } else {
        executable = { kind: "not_in_catalog", existsInDb: false };
      }

      return {
        serviceId: s.id,
        name: s.name,
        slug: s.slug,
        category: s.category,
        priceCents: s.priceCents,
        visibility: s.visibility,
        isPublic: s.isPublic,
        executionReadiness: readAttr(s.typeAttributes, "executionReadiness"),
        requiredPermission: readAttr(s.typeAttributes, "requiredPermission"),
        executable,
        testbedRunnable: executable.existsInDb,
      };
    });

    const packs = products.filter((p) => p.category === "config_pack");
    const microRemediations = products.filter((p) => p.category === "micro_remediation");

    res.json({
      packs,
      microRemediations,
      summary: {
        packCount: packs.length,
        microRemediationCount: microRemediations.length,
        runnablePackCount: packs.filter((p) => p.testbedRunnable).length,
        runnableMicroRemediationCount: microRemediations.filter((p) => p.testbedRunnable).length,
        unwiredMicroRemediations: microRemediations
          .filter((p) => p.executable.kind === "unwired")
          .map((p) => ({ slug: p.slug, reason: p.executable.reason })),
      },
    });
  } catch (err) {
    log.error({ err }, "admin-remediation-catalog: list failed");
    res.status(500).json({ error: "Failed to load remediation catalog" });
  }
});

export default router;
