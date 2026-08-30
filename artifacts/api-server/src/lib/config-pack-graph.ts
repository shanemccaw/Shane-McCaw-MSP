/**
 * config-pack-graph.ts
 *
 * Pure graph-materialization logic for Config Packs — no DB, no executor
 * imports, so it is unit-testable in isolation. The IO half (pack loading,
 * definition/version persistence, run firing) lives in
 * config-pack-orchestrator.ts.
 *
 * Graph shape — a strict LINEAR chain, deliberately:
 * the executor's pause path (break_glass_verification_gate → pauseForApproval)
 * abandons anything still in the BFS ready-queue (workflow-executor.ts:8459),
 * and resumeWorkflowRun() re-seeds ONLY the gate's successors (:9307). Any
 * parallel branch not fully executed before the pause would be silently lost
 * across the pause/resume boundary. The chain is a topological linearization
 * of the effective dependency graph (sort_order as tie-break), so every
 * dependency edge is still honoured.
 *
 * Effective dependencies: config_pack_templates.depends_on_override REPLACES
 * the template's own depends_on when present (non-null) — the quickstart seed
 * is consistent with this reading (breakglass-assign-global-admin has base
 * dependsOn [] and override ["breakglass-user-create"]).
 *
 * Verification gates: a template flagged requiresVerificationGate gets a
 * break_glass_verification_gate spliced in immediately after it, and every
 * template that depended on it now (transitively, via the linear chain)
 * depends on the gate instead. When MULTIPLE templates in a pack are flagged
 * (quickstart flags both breakglass-user-create and
 * breakglass-assign-global-admin), only the FIRST flagged template in
 * topological order gets a gate: a pack run carries exactly one break-glass
 * secret, and the gate redacts it from the persisted payload at pause — a
 * second gate would find no plaintext and hard-fail. Everything after the
 * single gate (including the later flagged templates and all their
 * dependents) already runs strictly post-verification, which is the safety
 * property the flag exists for.
 */

import type { WfEdge, WfGraph, WfNode, WfNodeData } from "@workspace/db";

/** Entra "Global Administrator" role definition id — matches the value
 *  hard-coded in the breakglass-assign-global-admin seed template. Used as
 *  the default {{roleDefinitionId}} for pim-role-assignment-rules. */
export const GLOBAL_ADMIN_ROLE_DEFINITION_ID = "62e90394-69f5-4237-9190-012177145e10";

export const GATE_SECRET_FIELD = "generatedPassword";
export const GATE_ACCOUNT_ID_FIELD = "breakGlassAccountId";

/** Flat payload keys produced MID-RUN by the post-create mapping node — never
 *  required from the caller and excluded from upfront validation (only when
 *  the pack actually contains a gated create step). Both casings of the
 *  break-glass user id are emitted because the seeded templates reference
 *  {{breakGlassUserId}} (capital G) while the original gate map emitted only
 *  the lowercase variant (Git #1316). */
export const MID_RUN_PROVIDED_VARIABLES = [
  "breakglassUserId",
  "breakGlassUserId",
  "principalId",
  GATE_ACCOUNT_ID_FIELD,
] as const;

export interface PackTemplateResolved {
  templateId: string | null;
  checkKey: string | null;
  parameterMapping: Record<string, string> | null;
  label: string | null;
  sortOrder: number;
  /** depends_on_override (when non-null) REPLACES the template's own dependsOn. */
  effectiveDependsOn: string[];
  requiresVerificationGate: boolean;
  requiredVariables: string[];
}

export class ConfigPackError extends Error {
  constructor(
    public readonly code:
      | "pack_not_found"
      | "pack_not_active"
      | "pack_empty"
      | "dependency_not_in_pack"
      | "dependency_cycle"
      | "customer_not_found"
      | "customer_not_connected"
      | "customer_not_testbed"
      | "customer_write_consent_missing"
      | "tenant_domain_unresolved"
      | "missing_variables"
      | "concurrency_limit"
      // #1497 — Change Control gate: the write path was reached without an
      // approved, unconsumed CR that authorizes writing to the target tenant.
      | "change_request_not_authorized"
      // #1911 — this pack mints a credential and the Key Vault store that must
      // hold it is not configured. Fail closed: refusing the run is correct,
      // writing the credential into the database instead is the bug #1900 filed.
      | "generated_secret_store_unavailable",
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ConfigPackError";
  }
}

export const configPackDefinitionName = (packKey: string): string => `Config Pack: ${packKey}`;

/**
 * Node ids must contain NO dots: interp()'s {{steps.<nodeId>.data.id}} path
 * resolution splits on ".", so a node id derived from a dotted template id
 * (the seeded packs use ids like "quickstart-v1.create-ca-exclusion-group")
 * could never be referenced by a mapping node (Git #1316).
 */
export const nodeIdSafe = (raw: string): string => raw.replace(/\./g, "-");

export const templateNodeId = (templateId: string): string => `tpl-${nodeIdSafe(templateId)}`;

/**
 * Payload keys the orchestrator derives ITSELF for every pack run — from the
 * customer/tenant/run context, or generated (the break-glass secret), or
 * produced mid-run by the gate's output-mapping node. They are never required
 * from the operator, so the run UI must not prompt for them.
 *
 * Kept next to runConfigPackForCustomer's payload construction (its source of
 * truth) so the plan endpoint's operator-input list can't drift from what the
 * orchestrator actually supplies.
 */
export const AUTO_DERIVED_VARIABLES: readonly string[] = [
  "packKey",
  "packId",
  "tenantName",
  "tenantDomain",
  "organizationId",
  "currentDateTime",
  "roleDefinitionId",
  "customerId",
  GATE_SECRET_FIELD,
  ...MID_RUN_PROVIDED_VARIABLES,
];

/**
 * The required variables an OPERATOR must supply for a pack run: the union of
 * every template's requiredVariables, minus the ones the orchestrator derives
 * itself (AUTO_DERIVED_VARIABLES). These — e.g. tenantPrefix, which has no
 * derivable source — are the only inputs the run UI needs to collect, and are
 * exactly the set runConfigPackForCustomer's missing-variables guard would
 * otherwise reject at run time. Order follows first appearance in the chain.
 */
export function operatorRequiredVariables(ordered: PackTemplateResolved[]): string[] {
  const derived = new Set(AUTO_DERIVED_VARIABLES);
  const packProvided = packProvidedVariables(ordered);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of ordered) {
    for (const v of t.requiredVariables) {
      if (!derived.has(v) && !packProvided.has(v) && !seen.has(v)) {
        seen.add(v);
        out.push(v);
      }
    }
  }
  return out;
}

/**
 * Payload keys the pack's OWN parameterMapping rows produce mid-run: each
 * mapped key becomes a sql_query mapping node in the materialized graph (fed
 * from the source step's output), so it is provided during the run and must
 * be excluded from upfront missing-variable validation — same reasoning as
 * MID_RUN_PROVIDED_VARIABLES, but data-driven per pack (Git #1316).
 */
export function packProvidedVariables(templates: PackTemplateResolved[]): Set<string> {
  const out = new Set<string>();
  for (const t of templates) {
    for (const k of Object.keys(t.parameterMapping ?? {})) out.add(k);
  }
  return out;
}

export function getStepId(t: { templateId?: string | null; checkKey?: string | null }): string {
  return t.templateId || t.checkKey || "unknown-step";
}

/** Kahn topological sort with sortOrder tie-break. Throws on unknown deps / cycles. */
export function topologicalOrder(templates: PackTemplateResolved[]): PackTemplateResolved[] {
  const byId = new Map(templates.map((t) => [getStepId(t), t]));

  for (const t of templates) {
    const stepId = getStepId(t);
    for (const dep of t.effectiveDependsOn) {
      if (!byId.has(dep)) {
        throw new ConfigPackError(
          "dependency_not_in_pack",
          `Template '${stepId}' depends on '${dep}', which is not part of this pack`,
          { templateId: stepId, missingDependency: dep },
        );
      }
    }
  }

  const remainingDeps = new Map<string, Set<string>>(
    templates.map((t) => [getStepId(t), new Set(t.effectiveDependsOn)]),
  );
  const orderedIds = new Set<string>();
  const ordered: PackTemplateResolved[] = [];

  while (ordered.length < templates.length) {
    const ready = templates
      .filter((t) => !orderedIds.has(getStepId(t)) && (remainingDeps.get(getStepId(t))?.size ?? 0) === 0)
      .sort((a, b) => a.sortOrder - b.sortOrder);

    if (ready.length === 0) {
      const stuck = templates.filter((t) => !orderedIds.has(getStepId(t))).map((t) => getStepId(t));
      throw new ConfigPackError(
        "dependency_cycle",
        `Dependency cycle among pack templates: ${stuck.join(", ")}`,
        { templateIds: stuck },
      );
    }

    const next = ready[0]!;
    const nextId = getStepId(next);
    ordered.push(next);
    orderedIds.add(nextId);
    for (const deps of remainingDeps.values()) deps.delete(nextId);
  }

  return ordered;
}

/**
 * Build the executable graph for a pack: a linear chain over the topological
 * order, with (map → gate) spliced in after the first gate-flagged template.
 */
export function buildConfigPackGraph(templates: PackTemplateResolved[]): {
  graph: WfGraph;
  ordered: PackTemplateResolved[];
  gatedTemplateId: string | null;
  /** Flagged templates whose gate was coalesced into the pack's single gate. */
  coalescedGateTemplateIds: string[];
} {
  const ordered = topologicalOrder(templates);

  const nodes: WfNode[] = [];
  const edges: WfEdge[] = [];
  let y = 80;
  const nextPos = () => {
    const pos = { x: 300, y };
    y += 140;
    return pos;
  };

  nodes.push({ id: "start", type: "start", position: nextPos(), data: { nodeType: "start", label: "Config Pack Run" } });

  let prev: { id: string; sourceHandle?: string } = { id: "start" };
  let edgeSeq = 0;
  const link = (targetId: string) => {
    edges.push({
      id: `e${++edgeSeq}`,
      source: prev.id,
      target: targetId,
      ...(prev.sourceHandle ? { sourceHandle: prev.sourceHandle } : {}),
    });
  };

  let gatedTemplateId: string | null = null;
  const coalescedGateTemplateIds: string[] = [];
  let lastMonitorNodeId: string | null = null;

  for (let i = 0; i < ordered.length; i++) {
    const t = ordered[i];
    // We need a unique identifier for the node. 
    // Fallback to checkKey or a sequential index if templateId is null.
    const stepUniqueId = t.templateId ?? t.checkKey ?? `step-${i}`;
    const nodeId = templateNodeId(stepUniqueId);

    if (t.checkKey) {
      // 1. Add Execute Monitor Check node
      nodes.push({
        id: nodeId,
        type: "execute_monitor_check",
        position: nextPos(),
        data: {
          nodeType: "execute_monitor_check",
          label: t.label ?? `Monitor Check: ${t.checkKey}`,
          checkKey: t.checkKey,
          customerId: "{{customerId}}",
        },
      });
      link(nodeId);
      prev = { id: nodeId }; // No 'success' handle enforced for monitor check yet, just sequential
      lastMonitorNodeId = nodeId;
    }

    // 2. Add Parameter Mapping node for a MONITOR-CHECK step: the mapping reads
    // the check's extractedProperties, so it runs after the check and before
    // the template. A checkKey-less template step's mapping is handled below,
    // AFTER its template node — its source (the template's own Graph response)
    // does not exist until the template has run (Git #1316).
    if (t.checkKey && t.parameterMapping && Object.keys(t.parameterMapping).length > 0) {
      const mapNodeId = `map-${nodeIdSafe(stepUniqueId)}-outputs`;
      const mapKeys = Object.keys(t.parameterMapping);
      // E.g. SELECT $1::text AS "mappedKey"
      // using the first item's property from extractedProperties
      const queryParts = mapKeys.map((k, idx) => `$${idx + 1}::text AS "${k}"`);
      const query = `SELECT ${queryParts.join(", ")}`;

      const sourceNodeId = lastMonitorNodeId || nodeId;
      // The values come from the monitor check's extracted properties or static values
      // For simplicity in the wizard, parameterMapping maps "payloadVariable" -> "extractedPropertyPath"
      // If the mapping starts with "static:", we treat the rest as a literal value.
      const params = mapKeys.map(k => {
        const val = t.parameterMapping![k];
        return val.startsWith("static:")
          ? val.slice(7)
          : `{{steps.${sourceNodeId}.extractedProperties.0.${val}}}`;
      });

      nodes.push({
        id: mapNodeId,
        type: "action",
        position: nextPos(),
        data: {
          nodeType: "action",
          actionType: "sql_query",
          label: "Map Pipeline Step Outputs",
          query,
          params: params as unknown as WfNodeData["params"],
        },
      });
      link(mapNodeId);
      prev = { id: mapNodeId };
    }

    if (t.templateId) {
      const tplId = t.templateId;
      const tplNodeId = templateNodeId(tplId);
      nodes.push({
        id: tplNodeId,
        type: "execute_baseline_template",
        position: nextPos(),
        data: {
          nodeType: "execute_baseline_template",
          label: t.label ?? undefined,
          templateId: tplId,
          customerId: "{{customerId}}",
        },
      });
      link(tplNodeId);
      // execute_baseline_template routes outgoing edges via switchChosenHandle —
      // the happy-path edge MUST carry sourceHandle "success" or it is skipped.
      prev = { id: tplNodeId, sourceHandle: "success" };

      // Template-output parameter mapping (checkKey-less step): feed the
      // template's own Graph response fields into flat payload keys for later
      // steps — e.g. quickstart-v1's exclusion-group create maps its new group
      // id to {{breakGlassGroupId}} (Git #1316). "static:" values pass through.
      if (!t.checkKey && t.parameterMapping && Object.keys(t.parameterMapping).length > 0) {
        const mapNodeId = `map-${nodeIdSafe(tplId)}-tpl-outputs`;
        const mapKeys = Object.keys(t.parameterMapping);
        const query = `SELECT ${mapKeys.map((k, idx) => `$${idx + 1}::text AS "${k}"`).join(", ")}`;
        const params = mapKeys.map((k) => {
          const val = t.parameterMapping![k];
          return val.startsWith("static:")
            ? val.slice(7)
            : `{{steps.${tplNodeId}.data.${val}}}`;
        });
        nodes.push({
          id: mapNodeId,
          type: "action",
          position: nextPos(),
          data: {
            nodeType: "action",
            actionType: "sql_query",
            label: "Map Pipeline Step Outputs",
            query,
            params: params as unknown as WfNodeData["params"],
          },
        });
        link(mapNodeId);
        prev = { id: mapNodeId };
      }

      if (t.requiresVerificationGate && gatedTemplateId === null) {
        gatedTemplateId = tplId;

        const mapNodeId = `map-${nodeIdSafe(tplId)}-outputs`;
        nodes.push({
          id: mapNodeId,
          type: "action",
          position: nextPos(),
          data: {
            nodeType: "action",
            actionType: "sql_query",
            label: "Map Break-Glass Step Outputs",
            query:
              'SELECT $1::text AS "breakglassUserId", $1::text AS "breakGlassUserId", $1::text AS "principalId", $1::text AS "breakGlassAccountId"',
            params: [`{{steps.${tplNodeId}.data.id}}`] as unknown as WfNodeData["params"],
          },
        });
        link(mapNodeId);
        prev = { id: mapNodeId };

      const gateNodeId = `gate-${nodeIdSafe(tplId)}`;
      nodes.push({
        id: gateNodeId,
        type: "break_glass_verification_gate",
        position: nextPos(),
        data: {
          nodeType: "break_glass_verification_gate",
          label: "Tenant-Admin Verification Gate",
          // Explicit field wiring — no reliance on gate defaults, so the keys
          // the orchestrator stamps on the payload and the keys the gate reads
          // can never drift apart.
          secretField: GATE_SECRET_FIELD,
          customerIdField: "customerId",
          accountIdField: GATE_ACCOUNT_ID_FIELD,
        },
      });
      link(gateNodeId);
      // Resume follows edges with no sourceHandle (treated as "approved").
      prev = { id: gateNodeId };
    } else if (t.requiresVerificationGate) {
      coalescedGateTemplateIds.push(tplId);
    }
  }
  }

  nodes.push({ id: "end", type: "end", position: nextPos(), data: { nodeType: "end", label: "Pack Complete" } });
  link("end");

  return { graph: { nodes, edges }, ordered, gatedTemplateId, coalescedGateTemplateIds };
}
