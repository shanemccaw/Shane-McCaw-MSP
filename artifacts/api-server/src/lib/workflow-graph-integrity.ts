/**
 * workflow-graph-integrity.ts
 *
 * Pure structural checks for a Workflow Engine graph — no DB, no executor
 * imports — so the graph builders, the version persister and the executor can
 * all share one definition of "this graph can actually run".
 *
 * Why these two defects specifically (Git #4510): the executor queues a node only
 * once every incoming edge has resolved (resolvedCount === inDegree). A
 * self-loop `X → X` counts toward X's in-degree but can never resolve before X
 * runs, so X is never queued; duplicate node ids collapse into one map entry
 * while every edge still counts, with the same result. Either way the ready
 * queue drains early and the run is recorded "completed" having executed
 * nothing past the break — for a config-pack remediation, a false "applied"
 * record whose Change Request is then closed as done. These checks turn that
 * silent completion into a loud refusal.
 */

import type { WfGraph } from "@workspace/db";

export interface GraphStructuralDefects {
  /** Node ids that appear on more than one node. */
  duplicateNodeIds: string[];
  /** Edges whose source and target are the same node. */
  selfLoops: Array<{ edgeId: string; nodeId: string }>;
}

export function findGraphStructuralDefects(graph: WfGraph): GraphStructuralDefects {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const n of graph.nodes ?? []) {
    if (seen.has(n.id)) duplicates.add(n.id);
    else seen.add(n.id);
  }

  const selfLoops = (graph.edges ?? [])
    .filter((e) => e.source === e.target)
    .map((e) => ({ edgeId: e.id, nodeId: e.source }));

  return { duplicateNodeIds: [...duplicates], selfLoops };
}

export function hasGraphStructuralDefects(defects: GraphStructuralDefects): boolean {
  return defects.duplicateNodeIds.length > 0 || defects.selfLoops.length > 0;
}

/** One-line human description, suitable for wf_runs.error_message and logs. */
export function describeGraphStructuralDefects(defects: GraphStructuralDefects): string {
  const parts: string[] = [];
  if (defects.duplicateNodeIds.length > 0) {
    parts.push(`duplicate node ids: ${defects.duplicateNodeIds.join(", ")}`);
  }
  if (defects.selfLoops.length > 0) {
    parts.push(`self-loop edges: ${defects.selfLoops.map((s) => `${s.edgeId} (${s.nodeId} → ${s.nodeId})`).join(", ")}`);
  }
  return `Workflow graph is structurally invalid and would silently skip nodes — ${parts.join("; ")}`;
}

/** Throws when the graph has duplicate node ids or self-loop edges. */
export function assertGraphStructurallySound(graph: WfGraph, context: string): void {
  const defects = findGraphStructuralDefects(graph);
  if (hasGraphStructuralDefects(defects)) {
    throw new Error(`${context}: ${describeGraphStructuralDefects(defects)}`);
  }
}
