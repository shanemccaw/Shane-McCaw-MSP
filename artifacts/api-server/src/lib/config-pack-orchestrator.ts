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
import { fireWorkflowForDefinition, GENERATED_SECRET_REFS_FIELD } from "./workflow-executor";
// Type-only — the store is imported dynamically so the Azure SDK is loaded only
// on a run that actually mints a credential (#1911).
import type { GeneratedSecretRef } from "./generated-secret-store";
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

// ── Generated credentials on the write path (#1911) ──────────────────────────
// Every payload field this orchestrator MINTS a credential into. A field listed
// here never reaches the database: it is stored in Key Vault and replaced by a
// reference before the run payload is persisted.
//
// A repo-wide grep for credential generation (#1911) found six generators. Only
// one of them mints a credential that is WRITTEN TO A CUSTOMER TENANT, which is
// the class #1900 is about:
//
//   • generateStrongPassword (routes/break-glass-verification.ts) — IN SCOPE.
//     Two call sites: here (the pack's break-glass account password,
//     `GATE_SECRET_FIELD`) and the admin-override reset in that same route,
//     which mints a replacement for an already-gated secret and stores it
//     through this same path at its own call site.
//
// The other five are platform-local and already store only a one-way hash, so
// none of them can leave a plaintext credential in the audit trail:
//
//   • the `Temp-…!9` reset passwords in routes/msp-settings.ts and
//     routes/portal-team.ts — bcrypt-hashed into users.password_hash, returned
//     to the caller once, never persisted in plaintext;
//   • generateSixDigitCode in lib/purchase-account-flow.ts and
//     routes/public-assessment-account.ts — bcrypt-hashed verification codes;
//   • generateWebhookSecret in lib/webhook-delivery.ts — referenced only by its
//     own test, so it mints nothing in production today.
//
// Add a field here if a new generator ever writes a credential to a tenant.
const GENERATED_CREDENTIAL_FIELDS: string[] = [GATE_SECRET_FIELD];

/** Field → the `purpose` tag its vault secret carries. */
const GENERATED_CREDENTIAL_PURPOSES: Record<string, string> = {
  [GATE_SECRET_FIELD]: "break-glass",
};

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
 * Upsert a Workflow Definition (by NAME) and ensure a published version whose
 * graph matches the current materialization. Reuses the existing published
 * version when the graph is unchanged; otherwise archives it and publishes a
 * new version (the one-published-per-definition unique index requires the
 * archive step). Old runs keep pointing at their original version rows.
 *
 * Generic over WHO is materializing — a config pack (`persistConfigPackWorkflow`
 * below) or an SOP's automated steps (#1559, `sop-execution.ts`'s
 * `persistSopWorkflow`) both call straight through this, so there is exactly one
 * definition/version-persistence implementation for anything that fires through
 * the Workflow Engine this way, matching #1559's "never a second execution
 * path" instruction.
 */
export async function persistMaterializedWorkflow(
  definitionName: string,
  description: string,
  metadata: Record<string, unknown>,
  graph: WfGraph,
): Promise<{ definitionId: number; versionId: number; reusedVersion: boolean }> {
  const name = definitionName;

  let [definition] = await db
    .select()
    .from(wfDefinitionsTable)
    .where(eq(wfDefinitionsTable.name, name))
    .limit(1);

  if (!definition) {
    [definition] = await db
      .insert(wfDefinitionsTable)
      .values({ name, description, metadata })
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
        label: `v${nextVersionNumber} — materialized`,
        status: "published",
        graph,
      })
      .returning({ id: wfVersionsTable.id });
    if (!inserted) throw new Error(`Failed to insert workflow version for '${name}'`);
    return inserted.id;
  });

  log.info(
    { definitionName: name, definitionId: definition.id, versionId, versionNumber: nextVersionNumber },
    "persistMaterializedWorkflow: published materialized workflow version",
  );
  return { definitionId: definition.id, versionId, reusedVersion: false };
}

/** Config-pack-specific wrapper over `persistMaterializedWorkflow` — unchanged behavior/signature. */
export async function persistConfigPackWorkflow(
  packKey: string,
  packLabel: string,
  graph: WfGraph,
): Promise<{ definitionId: number; versionId: number; reusedVersion: boolean }> {
  return persistMaterializedWorkflow(
    configPackDefinitionName(packKey),
    `Materialized from config pack '${packKey}' (${packLabel}). ` +
      "Regenerated automatically on each run request when the pack contents change — edit the pack, not this definition.",
    { configPack: packKey, orchestrated: true },
    graph,
  );
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
    //
    // #1911 — this value is IN-MEMORY ONLY. `prepareConfigPackRun` is also what
    // the Buy flow's dry-run calls, and a dry-run must not mint a vault secret it
    // will never deliver (that is an orphan on every preview). The real run stores
    // it in Key Vault and swaps it for a reference before anything is persisted —
    // see `persistGeneratedSecretsForRun` below.
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
      // #1773 — a CR scoped to a specific pack at raise time may only
      // authorize THIS pack; an unscoped CR is unaffected.
      targetKey: `pack:${packKey}`,
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
  // #1911 — everything the vault holds for this run, so a failure between the
  // store and a live run can purge rather than orphan it. Runs 30166, 30171 and
  // 30301 all died in exactly this window.
  const storedSecrets: Array<[string, GeneratedSecretRef]> = [];

  try {
    // ── Generated credentials go to Key Vault; the payload carries a REFERENCE ──
    // The in-memory `ctx.payload` keeps the real value (nothing here needs it, but
    // it stays the single source for the run about to be fired); `persistedPayload`
    // is what actually reaches `wf_runs.payload`, and it never holds the plaintext.
    // The executor resolves the reference back into its own in-memory payload at
    // run start, so the tenant write still happens with the real password.
    const payload = ctx.payload;
    const persistedPayload = await persistGeneratedSecretsForRun(payload, customerId, storedSecrets);

    const { definitionId, versionId, reusedVersion } = await persistConfigPackWorkflow(packKey, pack.label, graph);

    const runId = await fireWorkflowForDefinition(
      definitionId,
      "manual",
      opts.triggeredBy ?? `config-pack:${packKey}:customer:${customerId}`,
      persistedPayload,
      { versionId },
    );

    if (!runId) {
      throw new ConfigPackError(
        "concurrency_limit",
        `Run not started — the definition's concurrency limit is reached (another '${packKey}' run is in flight)`,
      );
    }

    // Stamp the run id onto each stored secret's tags now that it exists — this is
    // what lets the orphan sweep correlate a vault secret with the run that owns
    // it. Non-fatal; the sweep falls back to the age/expiry rule without it.
    if (storedSecrets.length > 0) {
      const { bindGeneratedSecretToRun } = await import("./generated-secret-store");
      await Promise.all(storedSecrets.map(([, ref]) => bindGeneratedSecretToRun(ref, runId)));
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
    // #1911 — a run that never started must not leave a credential behind in the
    // vault. This is the eager half of the cleanup; the executor's terminal-state
    // purge covers a run that started and then failed, and the orphan-sweep node
    // is the backstop for both.
    if (storedSecrets.length > 0) {
      const { purgeGeneratedSecret } = await import("./generated-secret-store");
      for (const [field, ref] of storedSecrets) {
        await purgeGeneratedSecret(ref, `config pack run never started (customer ${customerId}, field ${field})`);
      }
    }
    throw err;
  }
}

/**
 * Swap every generated credential on a run payload for a Key Vault reference,
 * returning the payload that is safe to PERSIST. The input payload is not
 * mutated — the caller keeps the real values in memory.
 *
 * Fail-CLOSED: with no store configured this throws rather than falling back to
 * writing the credential into the database. That fallback is precisely the
 * behaviour #1900 recorded, and "the database must never hold the value at any
 * point" is not satisfiable by a code path that quietly writes it when Azure is
 * unreachable.
 *
 * Exported for #1911's own verification harness.
 */
export async function persistGeneratedSecretsForRun(
  payload: Record<string, unknown>,
  customerId: number,
  storedSecrets: Array<[string, GeneratedSecretRef]> = [],
): Promise<Record<string, unknown>> {
  const generatedFields = GENERATED_CREDENTIAL_FIELDS.filter(
    (field) => typeof payload[field] === "string" && (payload[field] as string).length > 0,
  );
  if (generatedFields.length === 0) return { ...payload };

  const { generatedSecretStoreConfigured, storeGeneratedSecret } = await import("./generated-secret-store");
  if (!generatedSecretStoreConfigured()) {
    throw new ConfigPackError(
      "generated_secret_store_unavailable",
      "This pack generates a credential, and the generated-credential store is not configured "
      + "(GENERATED_SECRET_VAULT_URL or AZURE_KEY_VAULT_URL, plus AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET). "
      + "The run is refused rather than writing the credential to the database.",
      { generatedFields },
    );
  }

  const persisted: Record<string, unknown> = { ...payload };
  const refs: Record<string, GeneratedSecretRef> = {
    ...((payload[GENERATED_SECRET_REFS_FIELD] as Record<string, GeneratedSecretRef> | undefined) ?? {}),
  };

  for (const field of generatedFields) {
    const ref = await storeGeneratedSecret({
      value: payload[field] as string,
      purpose: GENERATED_CREDENTIAL_PURPOSES[field] ?? "generated",
      customerId,
    });
    storedSecrets.push([field, ref]);
    refs[field] = ref;
    delete persisted[field];
  }

  persisted[GENERATED_SECRET_REFS_FIELD] = refs;
  log.info(
    { customerId, fields: generatedFields, secretNames: storedSecrets.map(([, r]) => r.secretName) },
    "config-pack-orchestrator: generated credentials stored in Key Vault — the run payload carries references only",
  );
  return persisted;
}
