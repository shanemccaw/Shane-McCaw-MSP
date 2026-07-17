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
 *  the pack actually contains a gated create step). */
export const MID_RUN_PROVIDED_VARIABLES = [
  "breakglassUserId",
  "principalId",
  GATE_ACCOUNT_ID_FIELD,
] as const;

export interface PackTemplateResolved {
  templateId: string;
  label: string;
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
      | "tenant_domain_unresolved"
      | "missing_variables"
      | "concurrency_limit",
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ConfigPackError";
  }
}

export const configPackDefinitionName = (packKey: string): string => `Config Pack: ${packKey}`;

export const templateNodeId = (templateId: string): string => `tpl-${templateId}`;

/** Kahn topological sort with sortOrder tie-break. Throws on unknown deps / cycles. */
export function topologicalOrder(templates: PackTemplateResolved[]): PackTemplateResolved[] {
  const byId = new Map(templates.map((t) => [t.templateId, t]));

  for (const t of templates) {
    for (const dep of t.effectiveDependsOn) {
      if (!byId.has(dep)) {
        throw new ConfigPackError(
          "dependency_not_in_pack",
          `Template '${t.templateId}' depends on '${dep}', which is not part of this pack`,
          { templateId: t.templateId, missingDependency: dep },
        );
      }
    }
  }

  const remainingDeps = new Map<string, Set<string>>(
    templates.map((t) => [t.templateId, new Set(t.effectiveDependsOn)]),
  );
  const orderedIds = new Set<string>();
  const ordered: PackTemplateResolved[] = [];

  while (ordered.length < templates.length) {
    const ready = templates
      .filter((t) => !orderedIds.has(t.templateId) && (remainingDeps.get(t.templateId)?.size ?? 0) === 0)
      .sort((a, b) => a.sortOrder - b.sortOrder);

    if (ready.length === 0) {
      const stuck = templates.filter((t) => !orderedIds.has(t.templateId)).map((t) => t.templateId);
      throw new ConfigPackError(
        "dependency_cycle",
        `Dependency cycle among pack templates: ${stuck.join(", ")}`,
        { templateIds: stuck },
      );
    }

    const next = ready[0]!;
    ordered.push(next);
    orderedIds.add(next.templateId);
    for (const deps of remainingDeps.values()) deps.delete(next.templateId);
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

  for (const t of ordered) {
    const nodeId = templateNodeId(t.templateId);
    nodes.push({
      id: nodeId,
      type: "execute_baseline_template",
      position: nextPos(),
      data: {
        nodeType: "execute_baseline_template",
        label: t.label,
        templateId: t.templateId,
        customerId: "{{customerId}}",
      },
    });
    link(nodeId);
    // execute_baseline_template routes outgoing edges via switchChosenHandle —
    // the happy-path edge MUST carry sourceHandle "success" or it is skipped.
    prev = { id: nodeId, sourceHandle: "success" };

    if (t.requiresVerificationGate && gatedTemplateId === null) {
      gatedTemplateId = t.templateId;

      // Map the created account's id (Graph response) from the step-output
      // namespace into the FLAT payload keys the downstream templates'
      // required variables and the gate's accountIdField read. Step outputs
      // only surface as {{steps.<nodeId>.data.id}} — a flat {{breakglassUserId}}
      // does not appear in the payload on its own.
      const mapNodeId = `map-${t.templateId}-outputs`;
      nodes.push({
        id: mapNodeId,
        type: "action",
        position: nextPos(),
        data: {
          nodeType: "action",
          actionType: "sql_query",
          label: "Map Break-Glass Step Outputs",
          query:
            'SELECT $1::text AS "breakglassUserId", $1::text AS "principalId", $1::text AS "breakGlassAccountId"',
          // WfNodeData types params as Record<string, unknown>, but the
          // executor's sql_query branch reads it as a positional array.
          params: [`{{steps.${nodeId}.data.id}}`] as unknown as WfNodeData["params"],
        },
      });
      link(mapNodeId);
      prev = { id: mapNodeId };

      const gateNodeId = `gate-${t.templateId}`;
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
      coalescedGateTemplateIds.push(t.templateId);
    }
  }

  nodes.push({ id: "end", type: "end", position: nextPos(), data: { nodeType: "end", label: "Pack Complete" } });
  link("end");

  return { graph: { nodes, edges }, ordered, gatedTemplateId, coalescedGateTemplateIds };
}
