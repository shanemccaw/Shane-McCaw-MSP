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
  tenantsTable,
  wfDefinitionsTable,
  wfVersionsTable,
  type ConfigPack,
  type TenantConsentMap,
  type WfGraph,
} from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { generateStrongPassword } from "../routes/break-glass-verification";
import { fireWorkflowForDefinition } from "./workflow-executor";
import { graphFetchForTenant } from "./graph";
import {
  bindChangeRequestToRun,
  claimChangeRequestForWrite,
  releaseChangeRequestClaim,
} from "./change-control-write-gate";
import { recordExecution } from "./msp-change-execution-store";
import { logger } from "./logger";
const log = logger.child({ channel: "engine.config-pack" });
import {
  buildConfigPackGraph,
  configPackDefinitionName,
  ConfigPackError,
  GATE_SECRET_FIELD,
  GLOBAL_ADMIN_ROLE_DEFINITION_ID,
  MID_RUN_PROVIDED_VARIABLES,
  getStepId,
  packProvidedVariables,
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
      id: configPackTemplatesTable.id,
      templateId: configPackTemplatesTable.templateId,
      checkKey: configPackTemplatesTable.checkKey,
      parameterMapping: configPackTemplatesTable.parameterMapping,
      sortOrder: configPackTemplatesTable.sortOrder,
      dependsOnOverride: configPackTemplatesTable.dependsOnOverride,
      baseDependsOn: baselineActionTemplatesTable.dependsOn,
      requiresVerificationGate: baselineActionTemplatesTable.requiresVerificationGate,
      requiredVariables: baselineActionTemplatesTable.requiredVariables,
      templateLabel: baselineActionTemplatesTable.label,
    })
    .from(configPackTemplatesTable)
    .leftJoin(
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
    checkKey: r.checkKey,
    parameterMapping: r.parameterMapping ?? null,
    label: r.templateLabel ?? r.checkKey ?? `step-${r.id}`,
    sortOrder: r.sortOrder,
    effectiveDependsOn: r.dependsOnOverride ?? r.baseDependsOn ?? [],
    requiresVerificationGate: r.requiresVerificationGate ?? false,
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

/** Resolve the tenant's default domain via Graph when tenants.domain is
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
  /** #1497 — the approved CR that authorized this write, when the run was fired
   *  through the Change Control gate; null for a testbed/purchase-authorized run. */
  authorizingChangeRequestId: number | null;
}

/** Everything a pack run (or a real dry-run preview of one) derives before
 *  anything fires: the loaded pack, materialized graph, the customer row, and
 *  the exact initial payload runConfigPackForCustomer would launch with. */
export interface ConfigPackRunContext {
  pack: ConfigPack;
  templates: PackTemplateResolved[];
  ordered: PackTemplateResolved[];
  graph: WfGraph;
  gatedTemplateId: string | null;
  customer: {
    id: number;
    name: string;
    tenantId: string;
    domain: string | null;
    isTestbed: boolean;
    consent: TenantConsentMap;
  };
  payload: Record<string, unknown>;
  /** Keys provided mid-run (gate outputs + the pack's own parameterMapping
   *  nodes) — legitimately absent from the initial payload. */
  midRunProvided: Set<string>;
  /** Required variables with NO source at all — the run endpoint refuses on
   *  these, and the dry-run reports them as not-self-executable. */
  missingVariables: string[];
}

/**
 * Load + validate + derive everything a run of `packKey` for `customerId`
 * needs, WITHOUT firing anything and WITHOUT the testbed/authorization guard —
 * the single payload-derivation implementation shared by
 * runConfigPackForCustomer and the real dry-run (config-pack-dry-run.ts), so a
 * previewed payload can never drift from the executed one (Git #1316).
 */
export async function prepareConfigPackRun(opts: {
  packKey: string;
  customerId: number;
  variables?: Record<string, string>;
}): Promise<ConfigPackRunContext> {
  const { packKey, customerId } = opts;

  const { pack, templates } = await loadConfigPack(packKey);

  // Explicit column list — consent is read only for the purchase-authorization
  // guard below (write-back consent), nothing else from the jsonb is needed.
  const [customer] = await db
    .select({
      id: tenantsTable.id,
      name: tenantsTable.customerName,
      tenantId: tenantsTable.tenantId,
      domain: tenantsTable.domain,
      isTestbed: tenantsTable.isTestbed,
      consent: tenantsTable.consent,
    })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, customerId))
    .limit(1);

  if (!customer) throw new ConfigPackError("customer_not_found", `Customer ${customerId} not found`);
  if (!customer.tenantId) {
    throw new ConfigPackError(
      "customer_not_connected",
      `Customer ${customerId} has no connected tenant (tenant_id is empty)`,
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
  // tenantName: tenants.customer_name is NOT NULL — reliable.
  // tenantDomain: tenants.domain is nullable — fall back to the Graph
  //   default domain of the connected tenant.
  // organizationId: the Graph organization object id IS the tenant GUID, so no
  //   lookup is needed — customer.tenant_id is supplied directly.
  // domain / tenantId: aliases of the two above under the names the SEEDED
  //   baseline templates actually reference ({{domain}}, {{tenantId}}) — the
  //   orchestrator was authored against tenantDomain/organizationId while the
  //   seed rows were authored against domain/tenantId, so without the aliases
  //   every seeded pack failed the missing-variables guard (Git #1316).
  const requiredVars = new Set(ordered.flatMap((t) => t.requiredVariables));

  let tenantDomain: string | null = customer.domain;
  if (!tenantDomain && (requiredVars.has("tenantDomain") || requiredVars.has("domain"))) {
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
    tenantId: customer.tenantId,
    currentDateTime: new Date().toISOString(),
    roleDefinitionId: GLOBAL_ADMIN_ROLE_DEFINITION_ID,
    ...(tenantDomain ? { tenantDomain, domain: tenantDomain } : {}),
    ...(opts.variables ?? {}),
    customerId,
  };

  if (gatedTemplateId !== null || requiredVars.has(GATE_SECRET_FIELD)) {
    // Reuse the platform's single break-glass password generator; the gate's
    // secretField is wired to this exact key.
    payload[GATE_SECRET_FIELD] = generateStrongPassword();
  }

  // Keys legitimately absent upfront: the gate's own mapped outputs (only when
  // the pack is gated) plus every key the pack's parameterMapping nodes
  // produce mid-run.
  const midRunProvided = new Set<string>([
    ...(gatedTemplateId !== null ? MID_RUN_PROVIDED_VARIABLES : []),
    ...packProvidedVariables(templates),
  ]);
  const missingVariables = [...requiredVars].filter(
    (v) => !midRunProvided.has(v) && (payload[v] === undefined || payload[v] === ""),
  );

  return {
    pack,
    templates,
    ordered,
    graph,
    gatedTemplateId,
    customer,
    payload,
    midRunProvided,
    missingVariables,
  };
}

export async function runConfigPackForCustomer(opts: {
  packKey: string;
  customerId: number;
  /** Caller-supplied variable values (e.g. tenantPrefix — it has NO derivable
   *  source, so it must be passed explicitly). Cannot override customerId or
   *  the generated break-glass password. */
  variables?: Record<string, string>;
  triggeredBy?: string;
  /** Present ONLY when a paid, write-consented checkout session authorizes
   *  this run (routes/public-purchase-packs.ts, Git #1316). This is what lets
   *  a run target a real (non-testbed) customer tenant: the route has already
   *  verified paid + read consent + write consent + the self-executable
   *  allowlist, and the write-back consent is re-verified here fail-closed. */
  purchaseAuthorization?: { checkoutSessionId: string };
  /** Present when an APPROVED Change Request authorizes this run (#1497) — the
   *  operator/AI write path (execute_write_pack). The CR is the permission to
   *  write: it is verified (approved, unconsumed, scoped to this tenant) and
   *  atomically claimed here BEFORE anything fires, then bound to the run it
   *  authorizes. An approved CR authorizes even a live (non-testbed) tenant,
   *  the same way `purchaseAuthorization` does. Fail-closed: an unauthorized or
   *  already-consumed CR throws `change_request_not_authorized` and nothing
   *  fires. */
  changeRequestAuthorization?: { changeRequestId: number };
}): Promise<RunConfigPackResult> {
  const { packKey, customerId } = opts;

  const ctx = await prepareConfigPackRun({ packKey, customerId, variables: opts.variables });
  const { pack, graph, ordered, gatedTemplateId, customer } = ctx;

  // Non-authorizing validation first — it writes nothing, so it is safe to run
  // before the CR gate claims anything (a claim followed by a validation throw
  // would strand the CR mid-flight).
  if (ctx.missingVariables.length > 0) {
    throw new ConfigPackError(
      "missing_variables",
      `Missing required variables for pack '${packKey}': ${ctx.missingVariables.join(", ")}. Pass them in the request body under "variables".`,
      { missingVariables: ctx.missingVariables },
    );
  }

  // ── Authorization to fire a REAL tenant write — fail-closed ─────────────────
  // Pack runs perform REAL Graph writes. Exactly one lawful path must hold, or
  // nothing fires:
  //   A) changeRequestAuthorization — an APPROVED Change Request IS the
  //      permission to write (#1497). Verified + atomically CLAIMED here before
  //      anything fires; authorizes even a live (non-testbed) tenant, which is
  //      the whole point of the control-flow inversion.
  //   B) purchaseAuthorization — a paid, write-consented checkout (Git #1316),
  //      re-verified here fail-closed even though the route already gates it.
  //   C) testbed customer — manual admin validation, the original v1 surface.
  //
  // tenants.is_testbed is NOT NULL DEFAULT false (deliberately independent of
  // msps.is_testbed — an MSP-level testbed flag must never authorize a write
  // against a production tenant), so a tenant created by any path that doesn't
  // set it explicitly fails CLOSED into the stricter branches here.
  let claimedChangeRequestId: number | null = null;
  let claimedMspId: number | null = null;
  if (opts.changeRequestAuthorization) {
    // The CR is scoped on (mspId, tenantId), the same pair every Change Control
    // read uses. Resolve the customer's mspId to scope the lookup.
    const [tenantRow] = await db
      .select({ mspId: tenantsTable.mspId })
      .from(tenantsTable)
      .where(eq(tenantsTable.id, customerId))
      .limit(1);
    if (!tenantRow) {
      throw new ConfigPackError("customer_not_found", `Customer ${customerId} not found`);
    }
    const claim = await claimChangeRequestForWrite({
      changeRequestId: opts.changeRequestAuthorization.changeRequestId,
      mspId: tenantRow.mspId,
      tenantId: customer.tenantId,
    });
    if (!claim.ok) {
      throw new ConfigPackError(
        "change_request_not_authorized",
        `Change request ${opts.changeRequestAuthorization.changeRequestId} does not authorize this write: ${claim.reason}`,
        { changeRequestId: opts.changeRequestAuthorization.changeRequestId, reason: claim.reason },
      );
    }
    claimedChangeRequestId = claim.changeRequestId;
    claimedMspId = tenantRow.mspId;
  } else if (!customer.isTestbed) {
    if (!opts.purchaseAuthorization) {
      throw new ConfigPackError(
        "customer_not_testbed",
        `Customer ${customerId} is not a testbed customer — config pack runs write to the live tenant and require a testbed customer, an approved change request, or an authorizing purchase session`,
      );
    }
    if (customer.consent?.writeBack?.status !== "granted") {
      throw new ConfigPackError(
        "customer_write_consent_missing",
        `Customer ${customerId} has not granted write-back consent — a purchase-authorized pack run requires a granted write consent`,
      );
    }
  }

  // From here a CR may already be CLAIMED (in_progress). Any failure before the
  // run is bound must RELEASE it so the approved CR can authorize a retry rather
  // than being stranded in_progress forever.
  try {
    const payload = ctx.payload;

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

    // Cite the authorizing CR on the run it authorized. Its completion is what
    // later closes the CR (settleAuthorizedChangeRequests).
    if (claimedChangeRequestId !== null) {
      await bindChangeRequestToRun(claimedChangeRequestId, runId);

      // Open the EXECUTION record (#1499) that binds this CR to the run that is
      // executing it, capturing the approved plan (the ordered step set) now so
      // it can later be diffed against the run's real per-node outcome. The crRef
      // is written back onto this row when the run completes
      // (settleChangeExecutions). Non-fatal: recording the execution must never
      // break the tenant write it is only observing.
      if (claimedMspId !== null) {
        const plannedPlan = {
          packKey,
          capturedAt: new Date().toISOString(),
          actions: ordered.map((t) => ({
            templateId: t.templateId ?? null,
            checkKey: t.checkKey ?? null,
            label: t.label,
            changeKind: t.templateId ? "update" : "check",
          })),
        };
        await recordExecution({
          changeRequestId: claimedChangeRequestId,
          mspId: claimedMspId,
          tenantId: customer.tenantId,
          executorKind: "runbook_run",
          wfRunId: runId,
          packKey,
          plannedPlan,
        }).catch((recErr: unknown) => {
          log.error(
            { err: recErr, changeRequestId: claimedChangeRequestId, runId },
            "config-pack-orchestrator: failed to open CR execution record (non-fatal)",
          );
        });
      }
    }

    log.info(
      {
        packKey,
        customerId,
        runId,
        definitionId,
        versionId,
        gated: gatedTemplateId !== null,
        authorizingChangeRequestId: claimedChangeRequestId,
      },
      "config-pack-orchestrator: run fired",
    );

    return {
      runId,
      definitionId,
      versionId,
      reusedVersion,
      gated: gatedTemplateId !== null,
      templateOrder: ordered.map((t) => getStepId(t)),
      authorizingChangeRequestId: claimedChangeRequestId,
    };
  } catch (err) {
    if (claimedChangeRequestId !== null) {
      await releaseChangeRequestClaim(claimedChangeRequestId).catch((releaseErr: unknown) => {
        log.error(
          { err: releaseErr, changeRequestId: claimedChangeRequestId },
          "config-pack-orchestrator: failed to release CR claim after a run error",
        );
      });
    }
    throw err;
  }
}
