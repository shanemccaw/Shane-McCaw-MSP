/**
 * admin-write-permissions.ts — Git #1875
 *
 * GET /api/admin/write-permissions?customerId=<n>
 *
 * Answers the one question the "Packs & Remediations" testing surface could not
 * previously answer: **would this write actually be allowed, or is it a
 * guaranteed 403?**
 *
 * Before #1875 that surface derived its green "Run (real)" button purely from
 * "does the executable exist in the DB", so every pack and micro-remediation
 * rendered as ready to fire while the write app was being refused
 * `403 Authorization_RequestDenied` on literally every write. The two write-back
 * gates the platform already had (`msps.write_back_enabled` and
 * `tenants.consent.writeBack`) do not catch this: run 30301 passed BOTH and
 * still 403'd, because completing the consent redirect says nothing about which
 * permissions the app registration declared at that moment.
 *
 * So this endpoint reads three independent things and reports them separately:
 *   1. the MSP write-back toggle          (local DB)
 *   2. the tenant's writeBack consent     (local DB)
 *   3. the permissions the write app's service principal ACTUALLY holds in that
 *      tenant's Entra directory  (live, via getGrantedWriteAppPermissionsForTenant)
 * and then, per pack and per micro-remediation, which permissions its real steps
 * require (lib/graph-write-permissions.ts) and which of those are missing.
 *
 * requireAdmin. Strictly read-only — it issues Graph GETs and never a write.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  tenantsTable,
  mspsTable,
  servicesTable,
  configPacksTable,
  configPackTemplatesTable,
  baselineActionTemplatesTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";
import { getGrantedWriteAppPermissionsForTenant } from "../lib/graph";
import {
  requiredPermissionsForWrite,
  isNonGraphEndpoint,
  DERIVED_WRITE_APP_PERMISSIONS,
  DOCUMENTED_BUT_NOT_REQUESTED,
  APP_ONLY_UNSUPPORTED_OPERATIONS,
} from "../lib/graph-write-permissions";
import { resolveServiceExecutable } from "../lib/remediation-catalog";

const log = logger.child({ channel: "integration.azure" });

const router: IRouter = Router();

/** Per-executable verdict the UI renders directly. */
interface PermissionVerdict {
  /** Every Graph application permission this executable's real steps need. */
  required: string[];
  /**
   * Permissions this executable needs, that the tenant has not consented, and
   * that the platform DOES ask customers for — i.e. the ones a consent would
   * fix. Non-empty ⇒ a run here is a guaranteed 403.
   */
  missing: string[];
  /**
   * Permissions a step genuinely needs that the platform deliberately does not
   * request from customers. These will never appear in `granted`, so the
   * product is permanently unavailable by choice — reported apart from
   * `missing` so the UI doesn't imply consenting would fix it.
   */
  notRequested: string[];
  /**
   * Steps whose endpoint is not Microsoft Graph at all (Exchange Online /
   * Defender). No Graph permission can make these work — the sole executor has
   * no transport for them.
   */
  nonGraphSteps: string[];
  /**
   * Graph write steps this table has NO rule for. Their permission requirement
   * is unknown, which is emphatically not the same as "none": a step counted as
   * needing nothing would make the executable render green on the strength of a
   * gap in this table. The UI must show these as unverified, never as ready.
   */
  unmappedSteps: string[];
  /**
   * Graph write steps that ARE mapped, and whose answer is that no application
   * permission exists for them at all (Git #1901). Distinct from `unmappedSteps`
   * — we know exactly what these need, and the answer is "nothing will work".
   * Distinct from `missing` — consenting to more cannot clear them. An
   * executable holding one of these can never be fully ready on the app-only
   * credential, and the UI must say so rather than showing it as satisfied.
   */
  appOnlyUnsupportedSteps: string[];
}

function verdict(
  required: Set<string>,
  notRequested: Set<string>,
  nonGraphSteps: string[],
  unmappedSteps: string[],
  appOnlyUnsupportedSteps: string[],
  granted: Set<string>,
  grantedReadable: boolean,
): PermissionVerdict {
  // If the live read failed we must NOT claim everything is missing (that would
  // be inventing a refusal) nor that nothing is (that would be the false-green
  // this issue exists to kill). The caller surfaces `grantedError` instead and
  // renders an explicit unknown state.
  const missing = grantedReadable
    ? [...required].filter((p) => !granted.has(p) && !notRequested.has(p)).sort()
    : [];
  return {
    required: [...required].sort(),
    missing,
    notRequested: [...notRequested].sort(),
    nonGraphSteps,
    unmappedSteps,
    appOnlyUnsupportedSteps,
  };
}

router.get("/admin/write-permissions", requireAdmin, async (req: Request, res: Response) => {
  const customerId = Number(req.query.customerId);
  if (!Number.isInteger(customerId) || customerId <= 0) {
    res.status(400).json({ error: "customerId query parameter is required" });
    return;
  }

  try {
    // ── The customer's tenant + both local write-back gates ───────────────────
    const [row] = await db
      .select({
        tenantId: tenantsTable.tenantId,
        consent: tenantsTable.consent,
        mspId: tenantsTable.mspId,
        writeBackEnabled: mspsTable.writeBackEnabled,
      })
      .from(tenantsTable)
      .innerJoin(mspsTable, eq(mspsTable.id, tenantsTable.mspId))
      .where(eq(tenantsTable.id, customerId))
      .limit(1);

    if (!row) {
      res.status(404).json({ error: `Customer ${customerId} not found` });
      return;
    }

    const writeConsentStatus = row.consent?.writeBack?.status ?? "none";

    // ── What the write app actually holds in that tenant, read live ───────────
    const live = await getGrantedWriteAppPermissionsForTenant(row.tenantId);
    const granted = new Set(live.granted);
    const grantedReadable = live.error === null;

    // ── Every pack's real steps, and every micro-remediation's real template ──
    const services = await db
      .select({
        id: servicesTable.id,
        slug: servicesTable.slug,
        category: servicesTable.category,
        typeAttributes: servicesTable.typeAttributes,
      })
      .from(servicesTable)
      .where(inArray(servicesTable.category, ["config_pack", "micro_remediation"]));

    const resolved = services.map((s) => ({
      s,
      exec: resolveServiceExecutable({ slug: s.slug, category: s.category, typeAttributes: s.typeAttributes }),
    }));

    const packKeys = [
      ...new Set(resolved.map((r) => (r.exec.kind === "config_pack" ? r.exec.packKey : null)).filter((k): k is string => !!k)),
    ];
    const microTemplateIds = [
      ...new Set(resolved.map((r) => (r.exec.kind === "micro_remediation" ? r.exec.templateId : null)).filter((k): k is string => !!k)),
    ];

    // Pack steps, joined through to the template that carries the real endpoint.
    const packSteps = packKeys.length
      ? await db
          .select({
            packKey: configPacksTable.packKey,
            templateId: baselineActionTemplatesTable.templateId,
            method: baselineActionTemplatesTable.method,
            endpoint: baselineActionTemplatesTable.endpoint,
            bodyTemplate: baselineActionTemplatesTable.bodyTemplate,
          })
          .from(configPacksTable)
          .innerJoin(configPackTemplatesTable, eq(configPackTemplatesTable.packId, configPacksTable.id))
          .innerJoin(
            baselineActionTemplatesTable,
            eq(baselineActionTemplatesTable.templateId, configPackTemplatesTable.templateId),
          )
          .where(inArray(configPacksTable.packKey, packKeys))
          .orderBy(configPacksTable.packKey, configPackTemplatesTable.sortOrder)
      : [];

    const microTemplates = microTemplateIds.length
      ? await db
          .select({
            templateId: baselineActionTemplatesTable.templateId,
            method: baselineActionTemplatesTable.method,
            endpoint: baselineActionTemplatesTable.endpoint,
            bodyTemplate: baselineActionTemplatesTable.bodyTemplate,
          })
          .from(baselineActionTemplatesTable)
          .where(inArray(baselineActionTemplatesTable.templateId, microTemplateIds))
      : [];

    // ── Fold each pack's steps into one verdict ───────────────────────────────
    const byPack: Record<string, PermissionVerdict> = {};
    for (const key of packKeys) {
      const required = new Set<string>();
      const notRequested = new Set<string>();
      const nonGraphSteps: string[] = [];
      const unmappedSteps: string[] = [];
      const appOnlyUnsupportedSteps: string[] = [];
      for (const step of packSteps.filter((s) => s.packKey === key)) {
        if (isNonGraphEndpoint(step.endpoint)) {
          nonGraphSteps.push(`${step.templateId} (${step.method} ${step.endpoint})`);
          continue;
        }
        const look = requiredPermissionsForWrite(step.method, step.endpoint, {
          templateId: step.templateId,
          body: step.bodyTemplate,
        });
        if (!look.rule) unmappedSteps.push(`${step.templateId} (${step.method} ${step.endpoint})`);
        if (look.appOnlyUnsupported) {
          appOnlyUnsupportedSteps.push(`${step.templateId} (${step.method} ${step.endpoint})`);
        }
        for (const p of look.required) required.add(p);
        for (const p of look.notRequested) notRequested.add(p);
      }
      byPack[key] = verdict(
        required, notRequested, nonGraphSteps, unmappedSteps, appOnlyUnsupportedSteps, granted, grantedReadable,
      );
    }

    // ── And each micro-remediation's single template ──────────────────────────
    const byTemplate: Record<string, PermissionVerdict> = {};
    for (const tpl of microTemplates) {
      const required = new Set<string>();
      const notRequested = new Set<string>();
      const nonGraphSteps: string[] = [];
      const unmappedSteps: string[] = [];
      const appOnlyUnsupportedSteps: string[] = [];
      if (isNonGraphEndpoint(tpl.endpoint)) {
        nonGraphSteps.push(`${tpl.templateId} (${tpl.method} ${tpl.endpoint})`);
      } else {
        const look = requiredPermissionsForWrite(tpl.method, tpl.endpoint, {
          templateId: tpl.templateId,
          body: tpl.bodyTemplate,
        });
        if (!look.rule) unmappedSteps.push(`${tpl.templateId} (${tpl.method} ${tpl.endpoint})`);
        if (look.appOnlyUnsupported) {
          appOnlyUnsupportedSteps.push(`${tpl.templateId} (${tpl.method} ${tpl.endpoint})`);
        }
        for (const p of look.required) required.add(p);
        for (const p of look.notRequested) notRequested.add(p);
      }
      byTemplate[tpl.templateId] = verdict(
        required, notRequested, nonGraphSteps, unmappedSteps, appOnlyUnsupportedSteps, granted, grantedReadable,
      );
    }

    res.json({
      customerId,
      tenantId: row.tenantId,
      checkedAt: new Date().toISOString(),
      // Gate 1 and Gate 2, the two graphWriteForTenant enforces locally.
      mspWriteBackEnabled: row.writeBackEnabled,
      writeConsentStatus,
      // Gate 3 — the one nothing was checking, read live from Entra.
      writeAppId: live.writeAppId,
      writeAppServicePrincipalId: live.servicePrincipalId,
      granted: live.granted,
      grantedError: live.error,
      // The full set the platform asks a customer to consent to, and the
      // documented-but-deliberately-unrequested ones, so the UI can explain a
      // permanent refusal rather than implying it is a misconfiguration.
      platformRequired: [...DERIVED_WRITE_APP_PERMISSIONS],
      platformMissing: live.error === null
        ? DERIVED_WRITE_APP_PERMISSIONS.filter((p) => !granted.has(p))
        : [],
      documentedButNotRequested: DOCUMENTED_BUT_NOT_REQUESTED,
      // #1901 — operations with no application permission at any tier. Not a
      // scope we declined to request; one that does not exist to request.
      appOnlyUnsupportedOperations: APP_ONLY_UNSUPPORTED_OPERATIONS,
      byPack,
      byTemplate,
    });
  } catch (err) {
    log.error({ err, customerId }, "admin-write-permissions: check failed");
    res.status(500).json({ error: "Failed to check write permissions" });
  }
});

export default router;
