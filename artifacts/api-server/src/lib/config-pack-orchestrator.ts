/**
 * config-pack-orchestrator.ts
 *
 * Materializes a Config Pack (config_packs + config_pack_templates joined to
 * baseline_action_templates) into a REAL Workflow Definition + published
 * Version, then fires a run for a customer through the standard engine
 * (fireWorkflowForDefinition → wf_runs → executeWorkflowRun). No parallel
 * execution path: every pack execution is a visible Workflow Engine run, so
 * the Workflow Runs page and the break-glass by-run endpoint work unchanged.
 *
 * The pure graph-materialization rules (linear chain, gate splicing,
 * dependency-override semantics) live in config-pack-graph.ts.
 */

import { db } from "@workspace/db";
import {
  baselineActionTemplatesTable,
  configPacksTable,
  configPackTemplatesTable,
  mspCustomersTable,
  wfDefinitionsTable,
  wfVersionsTable,
  type ConfigPack,
  type WfGraph,
} from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { generateStrongPassword } from "../routes/break-glass-verification";
import { fireWorkflowForDefinition } from "./workflow-executor";
import { graphFetchForTenant } from "./graph";
import { logger } from "./logger";
const log = logger.child({ channel: "engine.config-pack" });
import {
  buildConfigPackGraph,
  configPackDefinitionName,
  ConfigPackError,
  GATE_SECRET_FIELD,
  GLOBAL_ADMIN_ROLE_DEFINITION_ID,
  MID_RUN_PROVIDED_VARIABLES,
  type PackTemplateResolved,
} from "./config-pack-graph";

export { ConfigPackError, type PackTemplateResolved } from "./config-pack-graph";

// ── Pack loading ───────────────────────────────────────────────────────────────

export async function loadConfigPack(packKey: string): Promise<{
  pack: ConfigPack;
  templates: PackTemplateResolved[];
}> {
  const [pack] = await db
    .select()
    .from(configPacksTable)
    .where(eq(configPacksTable.packKey, packKey))
    .limit(1);

  if (!pack) throw new ConfigPackError("pack_not_found", `Config pack '${packKey}' not found`);
  if (pack.status !== "active") {
    throw new ConfigPackError("pack_not_active", `Config pack '${packKey}' has status '${pack.status}'`);
  }

  // Archived templates are grandfathered into packs that reference them, so
  // membership is NOT filtered by template status here.
  const rows = await db
    .select({
      templateId: configPackTemplatesTable.templateId,
      sortOrder: configPackTemplatesTable.sortOrder,
      dependsOnOverride: configPackTemplatesTable.dependsOnOverride,
      baseDependsOn: baselineActionTemplatesTable.dependsOn,
      requiresVerificationGate: baselineActionTemplatesTable.requiresVerificationGate,
      requiredVariables: baselineActionTemplatesTable.requiredVariables,
      label: baselineActionTemplatesTable.label,
    })
    .from(configPackTemplatesTable)
    .innerJoin(
      baselineActionTemplatesTable,
      eq(configPackTemplatesTable.templateId, baselineActionTemplatesTable.templateId),
    )
    .where(eq(configPackTemplatesTable.packId, pack.id))
    .orderBy(configPackTemplatesTable.sortOrder);

  if (rows.length === 0) {
    throw new ConfigPackError("pack_empty", `Config pack '${packKey}' has no templates assigned`);
  }

  const templates: PackTemplateResolved[] = rows.map((r) => ({
    templateId: r.templateId,
    label: r.label,
    sortOrder: r.sortOrder,
    effectiveDependsOn: r.dependsOnOverride ?? r.baseDependsOn ?? [],
    requiresVerificationGate: r.requiresVerificationGate,
    requiredVariables: r.requiredVariables ?? [],
  }));

  return { pack, templates };
}

// ── Definition / version persistence ───────────────────────────────────────────

/**
 * Upsert the pack's Workflow Definition and ensure a published version whose
 * graph matches the current materialization. Reuses the existing published
 * version when the graph is unchanged; otherwise archives it and publishes a
 * new version (the one-published-per-definition unique index requires the
 * archive step). Old runs keep pointing at their original version rows.
 */
export async function persistConfigPackWorkflow(
  packKey: string,
  packLabel: string,
  graph: WfGraph,
): Promise<{ definitionId: number; versionId: number; reusedVersion: boolean }> {
  const name = configPackDefinitionName(packKey);

  let [definition] = await db
    .select()
    .from(wfDefinitionsTable)
    .where(eq(wfDefinitionsTable.name, name))
    .limit(1);

  if (!definition) {
    [definition] = await db
      .insert(wfDefinitionsTable)
      .values({
        name,
        description:
          `Materialized from config pack '${packKey}' (${packLabel}). ` +
          "Regenerated automatically on each run request when the pack contents change — edit the pack, not this definition.",
        metadata: { configPack: packKey, orchestrated: true },
      })
      .returning();
  }
  if (!definition) throw new Error(`Failed to upsert workflow definition '${name}'`);

  const [latestPublished] = await db
    .select()
    .from(wfVersionsTable)
    .where(and(eq(wfVersionsTable.definitionId, definition.id), eq(wfVersionsTable.status, "published")))
    .orderBy(desc(wfVersionsTable.versionNumber))
    .limit(1);

  if (latestPublished && JSON.stringify(latestPublished.graph) === JSON.stringify(graph)) {
    return { definitionId: definition.id, versionId: latestPublished.id, reusedVersion: true };
  }

  const [latestAny] = await db
    .select({ versionNumber: wfVersionsTable.versionNumber })
    .from(wfVersionsTable)
    .where(eq(wfVersionsTable.definitionId, definition.id))
    .orderBy(desc(wfVersionsTable.versionNumber))
    .limit(1);
  const nextVersionNumber = (latestAny?.versionNumber ?? 0) + 1;

  const versionId = await db.transaction(async (tx) => {
    if (latestPublished) {
      await tx
        .update(wfVersionsTable)
        .set({ status: "archived", updatedAt: new Date() })
        .where(eq(wfVersionsTable.id, latestPublished.id));
    }
    const [inserted] = await tx
      .insert(wfVersionsTable)
      .values({
        definitionId: definition.id,
        versionNumber: nextVersionNumber,
        label: `v${nextVersionNumber} — materialized from pack`,
        status: "published",
        graph,
      })
      .returning({ id: wfVersionsTable.id });
    if (!inserted) throw new Error(`Failed to insert workflow version for '${name}'`);
    return inserted.id;
  });

  log.info(
    { packKey, definitionId: definition.id, versionId, versionNumber: nextVersionNumber },
    "config-pack-orchestrator: published materialized workflow version",
  );
  return { definitionId: definition.id, versionId, reusedVersion: false };
}

// ── Variable resolution ────────────────────────────────────────────────────────

/** Resolve the tenant's default domain via Graph when msp_customers.domain is
 *  NULL (it is nullable and neither customer-creation path requires it). */
async function resolveDefaultDomainViaGraph(tenantId: string): Promise<string | null> {
  try {
    const res = await graphFetchForTenant(tenantId, "/domains?$select=id,isDefault");
    if (!res.ok) {
      log.warn({ tenantId, status: res.status }, "config-pack-orchestrator: /domains lookup failed");
      return null;
    }
    const body = (await res.json()) as { value?: Array<{ id?: string; isDefault?: boolean }> };
    const domains = body.value ?? [];
    const preferred = domains.find((d) => d.isDefault) ?? domains[0];
    return preferred?.id ?? null;
  } catch (err) {
    log.warn({ err, tenantId }, "config-pack-orchestrator: /domains lookup threw");
    return null;
  }
}

// ── Run orchestration ──────────────────────────────────────────────────────────

export interface RunConfigPackResult {
  runId: number;
  definitionId: number;
  versionId: number;
  reusedVersion: boolean;
  gated: boolean;
  templateOrder: string[];
}

export async function runConfigPackForCustomer(opts: {
  packKey: string;
  customerId: number;
  /** Caller-supplied variable values (e.g. tenantPrefix — it has NO derivable
   *  source, so it must be passed explicitly). Cannot override customerId or
   *  the generated break-glass password. */
  variables?: Record<string, string>;
  triggeredBy?: string;
}): Promise<RunConfigPackResult> {
  const { packKey, customerId } = opts;

  const { pack, templates } = await loadConfigPack(packKey);

  const [customer] = await db
    .select()
    .from(mspCustomersTable)
    .where(eq(mspCustomersTable.id, customerId))
    .limit(1);

  if (!customer) throw new ConfigPackError("customer_not_found", `Customer ${customerId} not found`);
  if (!customer.tenantId) {
    throw new ConfigPackError(
      "customer_not_connected",
      `Customer ${customerId} has no connected tenant (tenant_id is empty)`,
    );
  }
  // v1 guard, mirroring POST /admin/baseline-templates/:templateId/test: pack
  // runs perform REAL Graph writes, so until purchase/consent-triggered
  // automation ships, only testbed customers are runnable.
  if (!customer.isTestbed) {
    throw new ConfigPackError(
      "customer_not_testbed",
      `Customer ${customerId} is not a testbed customer — config pack runs write to the live tenant and are limited to testbed customers for now`,
    );
  }

  const { graph, ordered, gatedTemplateId, coalescedGateTemplateIds } = buildConfigPackGraph(templates);
  if (coalescedGateTemplateIds.length > 0) {
    log.info(
      { packKey, gatedTemplateId, coalescedGateTemplateIds },
      "config-pack-orchestrator: verification-gate flags coalesced into the pack's single gate (they run post-verification)",
    );
  }

  // ── Initial payload ──
  // tenantName: msp_customers.name is NOT NULL — reliable.
  // tenantDomain: msp_customers.domain is nullable — fall back to the Graph
  //   default domain of the connected tenant.
  // organizationId: the Graph organization object id IS the tenant GUID, so no
  //   lookup is needed — customer.tenant_id is supplied directly.
  const requiredVars = new Set(ordered.flatMap((t) => t.requiredVariables));

  let tenantDomain: string | null = customer.domain;
  if (!tenantDomain && requiredVars.has("tenantDomain")) {
    tenantDomain = await resolveDefaultDomainViaGraph(customer.tenantId);
    if (!tenantDomain) {
      throw new ConfigPackError(
        "tenant_domain_unresolved",
        `Customer ${customerId} has no domain on record and the tenant default domain could not be resolved via Graph`,
      );
    }
  }

  const payload: Record<string, unknown> = {
    packKey,
    packId: pack.id,
    tenantName: customer.name,
    organizationId: customer.tenantId,
    currentDateTime: new Date().toISOString(),
    roleDefinitionId: GLOBAL_ADMIN_ROLE_DEFINITION_ID,
    ...(tenantDomain ? { tenantDomain } : {}),
    ...(opts.variables ?? {}),
    customerId,
  };

  if (gatedTemplateId !== null || requiredVars.has(GATE_SECRET_FIELD)) {
    // Reuse the platform's single break-glass password generator; the gate's
    // secretField is wired to this exact key.
    payload[GATE_SECRET_FIELD] = generateStrongPassword();
  }

  // ── Fail fast on unresolvable variables (e.g. tenantPrefix) ──
  const midRunProvided = new Set<string>(gatedTemplateId !== null ? MID_RUN_PROVIDED_VARIABLES : []);
  const missing = [...requiredVars].filter(
    (v) => !midRunProvided.has(v) && (payload[v] === undefined || payload[v] === ""),
  );
  if (missing.length > 0) {
    throw new ConfigPackError(
      "missing_variables",
      `Missing required variables for pack '${packKey}': ${missing.join(", ")}. Pass them in the request body under "variables".`,
      { missingVariables: missing },
    );
  }

  const { definitionId, versionId, reusedVersion } = await persistConfigPackWorkflow(packKey, pack.label, graph);

  const runId = await fireWorkflowForDefinition(
    definitionId,
    "manual",
    opts.triggeredBy ?? `config-pack:${packKey}:customer:${customerId}`,
    payload,
    { versionId },
  );

  if (!runId) {
    throw new ConfigPackError(
      "concurrency_limit",
      `Run not started — the definition's concurrency limit is reached (another '${packKey}' run is in flight)`,
    );
  }

  log.info(
    { packKey, customerId, runId, definitionId, versionId, gated: gatedTemplateId !== null },
    "config-pack-orchestrator: run fired",
  );

  return {
    runId,
    definitionId,
    versionId,
    reusedVersion,
    gated: gatedTemplateId !== null,
    templateOrder: ordered.map((t) => t.templateId),
  };
}
