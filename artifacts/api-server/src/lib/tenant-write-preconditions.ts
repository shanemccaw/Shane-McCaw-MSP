/**
 * tenant-write-preconditions.ts
 *
 * Git #4528 — the IO half of the #4513 tenant preconditions, shared by every
 * path that fires `baseline_action_templates`-class writes at a customer tenant:
 *
 *   - Config Pack runs      (config-pack-orchestrator.ts, prepareConfigPackRun)
 *   - a single execute_action (routes/admin-execute-action.ts)
 *   - SOP runs              (sop-execution.ts, runSopForCustomer)
 *
 * #4513 gated only the pack path, so an execute_action or an SOP step could still
 * create a Conditional Access policy on a tenant without Entra ID P1 (failing
 * part-way, after earlier writes landed) or turn Security Defaults off with no
 * enforcing replacement. There is ONE evaluation — the pure
 * `evaluateConfigPackPreconditions` — and this module only loads what it needs:
 * each step's recorded license requirement and, when any step carries one, the
 * tenant's live `/subscribedSkus` set (read once; a failed read fails closed).
 *
 * Where a step's license requirement comes from:
 *   - A step with a template id (pack, execute_action) uses that template's own
 *     `write_action_catalog.required_license_skus` rows — unchanged from #4513.
 *   - An SOP step has no template id: it is an operator-typed Graph string. It
 *     inherits every requirement the catalog records for a template addressing
 *     the same Graph write (`graphWriteShape` — same method, same path with
 *     placeholders normalized). The license a Graph resource needs does not
 *     depend on which template or SOP sends the request.
 */

import { db, baselineActionTemplatesTable, writeActionCatalogTable } from "@workspace/db";
import { inArray, isNotNull } from "drizzle-orm";
import { getSubscribedSkuPartNumbersForTenant } from "./license-gate.ts";
import {
  evaluateConfigPackPreconditions,
  graphWriteShape,
  type PackPreconditionStep,
} from "./config-pack-preconditions.ts";
import type { ConfigPackError } from "./config-pack-graph.ts";
import type { CaEnforcementMode } from "./ca-enforcement-mode.ts";
import { logger } from "./logger.ts";

const log = logger.child({ channel: "engine.config-pack" });

function skuList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((s): s is string => typeof s === "string") : [];
}

/** Every non-empty `required_license_skus` list the catalog records, per template id. */
export async function loadRequiredLicenseSkuListsByTemplate(
  templateIds: readonly string[],
): Promise<Map<string, string[][]>> {
  const out = new Map<string, string[][]>();
  if (templateIds.length === 0) return out;
  const rows = await db
    .select({
      templateId: writeActionCatalogTable.templateId,
      requiredLicenseSkus: writeActionCatalogTable.requiredLicenseSkus,
    })
    .from(writeActionCatalogTable)
    .where(inArray(writeActionCatalogTable.templateId, [...templateIds]));
  for (const row of rows) {
    const skus = skuList(row.requiredLicenseSkus);
    if (!row.templateId || skus.length === 0) continue;
    const lists = out.get(row.templateId) ?? [];
    lists.push(skus);
    out.set(row.templateId, lists);
  }
  return out;
}

/** Every catalog-recorded license requirement, keyed by the Graph write shape of
 *  the template it is recorded against (for steps with no template id). */
export async function loadRequiredLicenseSkuListsByGraphShape(): Promise<Map<string, string[][]>> {
  const catalogRows = await db
    .select({
      templateId: writeActionCatalogTable.templateId,
      requiredLicenseSkus: writeActionCatalogTable.requiredLicenseSkus,
    })
    .from(writeActionCatalogTable)
    .where(isNotNull(writeActionCatalogTable.requiredLicenseSkus));
  const byTemplate = new Map<string, string[][]>();
  for (const row of catalogRows) {
    const skus = skuList(row.requiredLicenseSkus);
    if (!row.templateId || skus.length === 0) continue;
    byTemplate.set(row.templateId, [...(byTemplate.get(row.templateId) ?? []), skus]);
  }
  const out = new Map<string, string[][]>();
  if (byTemplate.size === 0) return out;

  const templates = await db
    .select({
      templateId: baselineActionTemplatesTable.templateId,
      method: baselineActionTemplatesTable.method,
      endpoint: baselineActionTemplatesTable.endpoint,
    })
    .from(baselineActionTemplatesTable)
    .where(inArray(baselineActionTemplatesTable.templateId, [...byTemplate.keys()]));
  for (const t of templates) {
    const shape = graphWriteShape(t.method, t.endpoint);
    const lists = out.get(shape) ?? [];
    for (const skus of byTemplate.get(t.templateId) ?? []) {
      const key = [...skus].sort().join("|");
      if (!lists.some((l) => [...l].sort().join("|") === key)) lists.push(skus);
    }
    out.set(shape, lists);
  }
  return out;
}

/**
 * Evaluate the #4513 preconditions for `steps` against `tenantId`'s live license
 * set. Returns the typed refusal (`license_required` /
 * `security_defaults_replacement_not_enforcing`) or null. The caller refuses
 * BEFORE authorizing, persisting or firing anything.
 */
export async function resolveTenantWritePreconditionRefusal(opts: {
  /** Key for logs and the refusal's default subject (a pack key, service slug or SOP id). */
  packKey: string;
  subject?: string;
  steps: PackPreconditionStep[];
  tenantId: string;
  payload: Record<string, unknown>;
  /** #4522 — a Config Pack run's explicit choice; omitted = monitor-first. */
  caEnforcementMode?: CaEnforcementMode;
}): Promise<ConfigPackError | null> {
  const { packKey, subject, steps, tenantId, payload, caEnforcementMode } = opts;
  if (steps.length === 0) return null;

  const tenantSkus = steps.some((s) => s.requiredLicenseSkuLists.length > 0)
    ? await getSubscribedSkuPartNumbersForTenant(tenantId)
    : null;

  const refusal = evaluateConfigPackPreconditions({ packKey, subject, steps, payload, tenantSkus, caEnforcementMode });
  if (refusal) {
    log.warn(
      { packKey, tenantId, code: refusal.code, details: refusal.details },
      "tenant-write-preconditions: tenant precondition not met — the write will not run",
    );
  }
  return refusal;
}
