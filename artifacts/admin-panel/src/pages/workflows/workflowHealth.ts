/**
 * workflowHealth.ts
 *
 * Pure function that scores a workflow graph (0–100) and emits a list of
 * issue objects.  No side-effects, no I/O — safe to call on every save.
 *
 * Ruleset (exact per-rule penalty, NOT severity-bucketed):
 *  −10 each  HTTP / external node without a downstream error-handler edge
 *  −7  each  condition arm that shadows a sibling (unreachable duplicate handle)
 *  −8  each  condition / switch arm whose branch has no End or join node
 *  −5        parallel node with > 5 branches
 *  −2  each  node with no label (uses default type name)
 */

import type { StoredNode, StoredEdge } from "./FlowCanvas";

export type IssueSeverity = "high" | "medium" | "low";

export interface HealthIssue {
  severity: IssueSeverity;
  message: string;
  nodeId: string | null;
  /** Exact score deduction for this issue (rule-specific, not severity-bucketed) */
  penalty: number;
}

export interface HealthReport {
  score: number;
  issues: HealthIssue[];
}

const EXTERNAL_NODE_TYPES = new Set([
  "http_request",
  "send_email",
  "send_sms",
  "execute_runbook",
  "update_m365_profile",
  "generate_document",
  "post_linkedin",
  "post_twitter",
  "post_facebook",
  "send_browser_notification",
  "send_mobile_push",
  "send_campaign_email",
]);

export function scoreWorkflow(
  nodes: StoredNode[],
  edges: StoredEdge[]
): HealthReport {
  const issues: HealthIssue[] = [];

  if (nodes.length === 0) return { score: 100, issues: [] };

  const outEdges = new Map<string, StoredEdge[]>();
  const inEdges = new Map<string, StoredEdge[]>();
  for (const n of nodes) {
    outEdges.set(n.id, []);
    inEdges.set(n.id, []);
  }
  for (const e of edges) {
    outEdges.get(e.source)?.push(e);
    inEdges.get(e.target)?.push(e);
  }

  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  function nodeType(id: string): string {
    return (nodeMap.get(id)?.data?.nodeType as string | undefined) ?? "action";
  }

  function nodeLabel(id: string): string {
    const n = nodeMap.get(id);
    if (!n) return id;
    return ((n.data?.label as string | undefined) ?? "").trim();
  }

  function hasDownstreamErrorHandler(startId: string): boolean {
    const visited = new Set<string>();
    const queue = [startId];
    while (queue.length) {
      const cur = queue.shift()!;
      if (visited.has(cur)) continue;
      visited.add(cur);
      const out = outEdges.get(cur) ?? [];
      for (const e of out) {
        if (e.sourceHandle === "onError" || e.sourceHandle === "error") return true;
        if (!visited.has(e.target)) queue.push(e.target);
      }
    }
    return false;
  }

  function branchReachesTerminal(startId: string): boolean {
    const visited = new Set<string>();
    const queue = [startId];
    while (queue.length) {
      const cur = queue.shift()!;
      if (visited.has(cur)) continue;
      visited.add(cur);
      const t = nodeType(cur);
      if (t === "end" || t === "join" || t === "cancel_workflow") return true;
      const out = outEdges.get(cur) ?? [];
      for (const e of out) {
        if (!visited.has(e.target)) queue.push(e.target);
      }
    }
    return false;
  }

  // Rule 0: detect nodes that are unreachable from the Start node (dead branches / orphaned steps).
  // These are flagged per-node with -7 each, matching the unreachable-arm penalty.
  const startNode = nodes.find(n => nodeType(n.id) === "start");
  const reachableFromStart = new Set<string>();
  if (startNode) {
    const queue = [startNode.id];
    while (queue.length) {
      const cur = queue.shift()!;
      if (reachableFromStart.has(cur)) continue;
      reachableFromStart.add(cur);
      for (const e of outEdges.get(cur) ?? []) {
        if (!reachableFromStart.has(e.target)) queue.push(e.target);
      }
    }
  } else {
    // No start node — treat all as reachable to avoid false positives on empty/partial graphs
    nodes.forEach(n => reachableFromStart.add(n.id));
  }

  for (const node of nodes) {
    const ntype = nodeType(node.id);
    if (ntype !== "start" && !reachableFromStart.has(node.id)) {
      issues.push({
        severity: "medium",
        penalty: 7,
        message: `"${nodeLabel(node.id) || ntype}" is unreachable — no path from Start reaches this node`,
        nodeId: node.id,
      });
    }
  }

  for (const node of nodes) {
    const ntype = nodeType(node.id);

    // Rule 1: external/HTTP nodes must have an error-handler edge somewhere downstream (-10 each)
    if (EXTERNAL_NODE_TYPES.has(ntype)) {
      if (!hasDownstreamErrorHandler(node.id)) {
        issues.push({
          severity: "high",
          penalty: 10,
          message: `"${nodeLabel(node.id) || ntype}" has no error handler — failures will crash the workflow`,
          nodeId: node.id,
        });
      }
    }

    // Rules 2 & 3: condition / switch arms
    if (ntype === "condition" || ntype === "switch_case") {
      const branches = outEdges.get(node.id) ?? [];
      const seenHandles = new Map<string, string>(); // handle → first edge id
      for (const edge of branches) {
        const handle = edge.sourceHandle ?? "default";

        // Rule 2: duplicate source handle (logically dead / unreachable sibling arm) (-7 each)
        if (seenHandles.has(handle)) {
          issues.push({
            severity: "medium",
            penalty: 7,
            message: `Duplicate branch "${handle}" on "${nodeLabel(node.id) || ntype}" — one arm is unreachable`,
            nodeId: node.id,
          });
        }
        seenHandles.set(handle, edge.id);

        // Rule 3: branch arm has no terminal node (-8 each)
        if (!branchReachesTerminal(edge.target)) {
          issues.push({
            severity: "medium",
            penalty: 8,
            message: `Branch "${handle}" of "${nodeLabel(node.id) || ntype}" has no End or Join node`,
            nodeId: node.id,
          });
        }
      }
    }

    // Rule 4: parallel node with > 5 branches (-5 flat)
    if (ntype === "parallel") {
      const branchCount = (outEdges.get(node.id) ?? []).filter(
        e => e.sourceHandle !== "done"
      ).length;
      if (branchCount > 5) {
        issues.push({
          severity: "low",
          penalty: 5,
          message: `Parallel node "${nodeLabel(node.id) || "Parallel"}" has ${branchCount} branches (> 5) — may be hard to maintain`,
          nodeId: node.id,
        });
      }
    }

    // Rule 5: unlabelled step (-2 each)
    const isStartOrEnd = ntype === "start" || ntype === "end";
    if (!isStartOrEnd && !nodeLabel(node.id)) {
      issues.push({
        severity: "low",
        penalty: 2,
        message: `Step "${node.id}" (${ntype}) has no label — add one for clarity`,
        nodeId: node.id,
      });
    }
  }

  // Use exact per-rule penalty (NOT severity * fixed_amount)
  const totalPenalty = issues.reduce((sum, i) => sum + i.penalty, 0);
  const score = Math.max(0, Math.min(100, 100 - totalPenalty));

  return { score, issues };
}

export function scoreColor(score: number): string {
  if (score >= 80) return "#22C55E";
  if (score >= 60) return "#F59E0B";
  return "#EF4444";
}
