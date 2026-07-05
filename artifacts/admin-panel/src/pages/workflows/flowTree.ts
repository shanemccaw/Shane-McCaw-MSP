/**
 * flowTree.ts
 *
 * Converts between the flat graph format (nodes + edges) used by the
 * executor and storage, and the nested FlowStep tree used by the new
 * Power Automate-style FlowCanvas UI.
 *
 * The executor-facing save format is UNCHANGED — all conversion is UI-only.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FlowStep {
  id: string;
  nodeType: string;
  data: Record<string, unknown>;
  /**
   * Populated for container nodes (foreach / condition / switch_case).
   *
   * foreach:      { body: FlowStep[] }
   * condition:    { yes: FlowStep[], no: FlowStep[] }
   * switch_case:  { [caseId]: FlowStep[], __default__: FlowStep[] }
   */
  branches?: Record<string, FlowStep[]>;
}

export interface StoredNode {
  id: string;
  type?: string;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

export interface StoredEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  style?: Record<string, unknown>;
  animated?: boolean;
}

export const CONTAINER_TYPES = new Set(["foreach", "condition", "switch_case"]);

/**
 * Data-aware container check.
 * Returns true for static container types and fetch_news_headlines (which
 * always renders hot / notHot branches regardless of autoBuildCampaign).
 */
export function isContainerNode(node: StoredNode): boolean {
  const type = (node.data.nodeType as string) || node.type || "";
  if (CONTAINER_TYPES.has(type)) return true;
  if (type === "fetch_news_headlines") return true;
  return false;
}

// ── Graph → Tree ──────────────────────────────────────────────────────────────

export function graphToTree(rawNodes: StoredNode[], rawEdges: StoredEdge[]): FlowStep[] {
  if (rawNodes.length === 0) return [];

  // Build outgoing edge map and incoming edge count
  const outEdges = new Map<string, StoredEdge[]>();
  const inEdgeCount = new Map<string, number>();
  for (const e of rawEdges) {
    if (!outEdges.has(e.source)) outEdges.set(e.source, []);
    outEdges.get(e.source)!.push(e);
    inEdgeCount.set(e.target, (inEdgeCount.get(e.target) ?? 0) + 1);
  }

  const nodeMap = new Map<string, StoredNode>(rawNodes.map(n => [n.id, n]));

  function nodeType(n: StoredNode): string {
    return ((n.data.nodeType as string) || n.type || "action");
  }

  // Global visited set prevents infinite cycles and double-rendering
  const visited = new Set<string>();

  /**
   * Walk from startId WITHOUT modifying global visited.
   * Stops at nodes that have more than one incoming edge (merge/join points)
   * so that those nodes are NOT mistakenly included in a branch's node set.
   */
  function localCollect(startId: string | null | undefined): Set<string> {
    if (!startId) return new Set();
    const collected = new Set<string>();
    const queue: string[] = [startId];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (collected.has(id) || visited.has(id)) continue;
      // Stop at merge points (multiple incoming edges), but only after collecting
      // at least one node so the branch start itself is always included
      if (collected.size > 0 && (inEdgeCount.get(id) ?? 0) > 1) continue;
      collected.add(id);
      for (const e of outEdges.get(id) ?? []) {
        queue.push(e.target);
      }
    }
    return collected;
  }

  /**
   * Given the node sets reachable from each branch, find the first node that
   * any branch terminal points to but that is NOT inside any branch.
   * This is the post-branch continuation.
   *
   * Retry back-edges point from a branch terminal back to a node that was
   * already visited (it lives before the condition in the main sequence) or
   * that is the target of edges from visited nodes outside the branch set.
   * Either case means the candidate is NOT the post-branch continuation and
   * must be skipped; otherwise graphToTree would mis-classify branch nodes as
   * part of the main sequence on reload.
   */
  function findContinuation(branchSets: Set<string>[]): string | null {
    const allBranch = new Set<string>(branchSets.flatMap(s => [...s]));
    for (const id of allBranch) {
      for (const e of outEdges.get(id) ?? []) {
        if (!allBranch.has(e.target) && !visited.has(e.target) && nodeMap.has(e.target)) {
          // Skip if the candidate is also the target of an edge from a visited
          // node outside allBranch — that signals a retry back-edge (a branch
          // terminal pointing back to a node earlier in the main sequence that
          // has since been visited).
          const isBackEdgeTarget = rawEdges.some(
            re => re.target === e.target && visited.has(re.source) && !allBranch.has(re.source)
          );
          if (isBackEdgeTarget) continue;
          return e.target;
        }
      }
    }
    return null;
  }

  /**
   * Build a sequence of FlowSteps starting at startId.
   * Stops when we reach visited, missing, or a node in stopSet.
   */
  function buildSequence(startId: string | null | undefined, stopSet?: Set<string>): FlowStep[] {
    if (!startId || visited.has(startId) || stopSet?.has(startId)) return [];
    const node = nodeMap.get(startId);
    if (!node) return [];

    visited.add(startId);
    const type = nodeType(node);
    const step: FlowStep = { id: node.id, nodeType: type, data: node.data };
    const out = outEdges.get(startId) ?? [];

    // ── ForEach ──────────────────────────────────────────────────────────────
    if (type === "foreach") {
      const bodyEdge = out.find(e => e.sourceHandle === "body");
      const doneEdge =
        out.find(e => e.sourceHandle === "done") ??
        out.find(e => !e.sourceHandle && e.target !== bodyEdge?.target);

      step.branches = { body: bodyEdge ? buildSequence(bodyEdge.target, stopSet) : [] };

      const result: FlowStep[] = [step];
      if (doneEdge && !visited.has(doneEdge.target) && !stopSet?.has(doneEdge.target)) {
        result.push(...buildSequence(doneEdge.target, stopSet));
      }
      return result;
    }

    // ── Fetch News Headlines (hot / notHot branches) ──────────────────────────
    if (type === "fetch_news_headlines") {
      const hotEdge    = out.find(e => e.sourceHandle === "hot");
      const notHotEdge = out.find(e => e.sourceHandle === "notHot");
      const nextEdge   = out.find(e => !e.sourceHandle);

      step.branches = {
        hot:    hotEdge    ? buildSequence(hotEdge.target,    stopSet) : [],
        notHot: notHotEdge ? buildSequence(notHotEdge.target, stopSet) : [],
      };

      const result: FlowStep[] = [step];
      if (nextEdge && !visited.has(nextEdge.target) && !stopSet?.has(nextEdge.target)) {
        result.push(...buildSequence(nextEdge.target, stopSet));
      }
      return result;
    }

    // ── Condition (If/Else) ───────────────────────────────────────────────────
    if (type === "condition") {
      const yesEdge = out.find(e => e.sourceHandle === "yes");
      const noEdge  = out.find(e => e.sourceHandle === "no");

      const yesSet = localCollect(yesEdge?.target);
      const noSet  = localCollect(noEdge?.target);
      let continuationId = findContinuation([yesSet, noSet]);
      // Fallback: when both branches are empty (e.g. freshly inserted node with a
      // plain outgoing edge), treat the plain edge as the continuation so the node
      // that follows is still rendered in the parent sequence.
      if (!continuationId) {
        const plainEdge = out.find(e => !e.sourceHandle);
        if (plainEdge) continuationId = plainEdge.target;
      }
      const branchStop = new Set<string>([...(stopSet ?? []), ...(continuationId ? [continuationId] : [])]);

      step.branches = {
        yes: yesEdge ? buildSequence(yesEdge.target, branchStop) : [],
        no:  noEdge  ? buildSequence(noEdge.target,  branchStop) : [],
      };

      // Mark branch node sets as visited so they aren't re-rendered at a higher level
      for (const id of yesSet) visited.add(id);
      for (const id of noSet)  visited.add(id);

      const result: FlowStep[] = [step];
      if (continuationId && !visited.has(continuationId) && !stopSet?.has(continuationId)) {
        result.push(...buildSequence(continuationId, stopSet));
      }
      return result;
    }

    // ── Switch / Case ─────────────────────────────────────────────────────────
    if (type === "switch_case") {
      const cases = (node.data.cases as Array<{ id: string; label?: string }> | undefined) ?? [];
      const branches: Record<string, FlowStep[]> = {};

      const branchDefs: { key: string; handle: string; targetId?: string }[] = [
        ...cases.map(c => ({ key: c.id, handle: `case-${c.id}`, targetId: out.find(e => e.sourceHandle === `case-${c.id}`)?.target })),
        { key: "__default__", handle: "default", targetId: out.find(e => e.sourceHandle === "default" || e.sourceHandle === "__default__")?.target },
      ];

      const branchSets = branchDefs.map(b => localCollect(b.targetId));
      let continuationId = findContinuation(branchSets);
      // Fallback: when all branches are empty (e.g. freshly inserted node with a
      // plain outgoing edge), treat the plain edge as the continuation.
      if (!continuationId) {
        const plainEdge = out.find(e => !e.sourceHandle);
        if (plainEdge) continuationId = plainEdge.target;
      }
      const branchStop = new Set<string>([...(stopSet ?? []), ...(continuationId ? [continuationId] : [])]);

      branchDefs.forEach((b, i) => {
        branches[b.key] = b.targetId ? buildSequence(b.targetId, branchStop) : [];
        for (const id of branchSets[i]) visited.add(id);
      });
      step.branches = branches;

      const result: FlowStep[] = [step];
      if (continuationId && !visited.has(continuationId) && !stopSet?.has(continuationId)) {
        result.push(...buildSequence(continuationId, stopSet));
      }
      return result;
    }

    // ── Regular node ──────────────────────────────────────────────────────────
    const mainEdge = out.find(e => !e.sourceHandle);
    const result: FlowStep[] = [step];
    if (mainEdge && !visited.has(mainEdge.target) && !stopSet?.has(mainEdge.target)) {
      result.push(...buildSequence(mainEdge.target, stopSet));
    }
    return result;
  }

  // Start from the "start" node if present; otherwise the first node
  const startNode = rawNodes.find(n => nodeType(n) === "start") ?? rawNodes[0];
  const mainSequence = buildSequence(startNode.id);

  // Append orphan nodes not reachable from start
  const orphans = rawNodes
    .filter(n => !visited.has(n.id))
    .map(n => ({ id: n.id, nodeType: nodeType(n), data: n.data }));

  return [...mainSequence, ...orphans];
}

// ── Tree → Graph ──────────────────────────────────────────────────────────────

let _edgeSeq = 0;
function newEdgeId() { return `e-auto-${++_edgeSeq}`; }

const STEP_H   = 130;
const BRANCH_W = 360;

/**
 * Convert a FlowStep tree back to a flat nodes+edges graph.
 *
 * For condition/switch_case, each branch terminal emits an edge to the next
 * step in the parent sequence (the "continuation"). For foreach, the continuation
 * uses the "done" sourceHandle.
 */
export function treeToGraph(steps: FlowStep[], startX = 320, startY = 80): { nodes: StoredNode[]; edges: StoredEdge[] } {
  _edgeSeq = 0;
  const allNodes: StoredNode[] = [];
  const allEdges: StoredEdge[] = [];

  /**
   * Lay out a sequence of steps and return the IDs of the "terminal" nodes
   * (nodes that need to be connected to whatever follows this sequence).
   */
  function doLayout(
    seqSteps: FlowStep[],
    x: number,
    y0: number,
    /** Node IDs + optional sourceHandle that feed into the first step of this sequence. */
    feeders: Array<{ id: string; handle?: string }>,
  ): { terminals: Array<{ id: string; handle?: string }>; nextY: number } {
    let y = y0;
    let feeders_ = feeders;

    for (let i = 0; i < seqSteps.length; i++) {
      const step = seqSteps[i];

      allNodes.push({ id: step.id, type: step.nodeType, position: { x, y }, data: step.data });

      // Wire all feeders → this step
      for (const f of feeders_) {
        allEdges.push({ id: newEdgeId(), source: f.id, target: step.id, sourceHandle: f.handle });
      }
      y += STEP_H;

      if (!step.branches) {
        // Plain step — it feeds the next step via a plain (no-handle) edge
        feeders_ = [{ id: step.id }];
        continue;
      }

      // ── ForEach ────────────────────────────────────────────────────────────
      if (step.nodeType === "foreach") {
        const bodySteps = step.branches["body"] ?? [];
        const { nextY: afterBody } = doLayout(bodySteps, x + BRANCH_W, y, [{ id: step.id, handle: "body" }]);
        y = afterBody + 40;
        // Continuation from foreach uses "done" handle
        feeders_ = [{ id: step.id, handle: "done" }];
      }

      // ── Fetch News Headlines (hot / notHot branches side-by-side) ─────────
      else if (step.nodeType === "fetch_news_headlines" && step.branches) {
        const hotSteps    = step.branches["hot"]    ?? [];
        const notHotSteps = step.branches["notHot"] ?? [];
        const leftX  = x - BRANCH_W / 2;
        const rightX = x + BRANCH_W / 2;
        const { nextY: hotEnd }    = doLayout(hotSteps,    leftX,  y, [{ id: step.id, handle: "hot" }]);
        const { nextY: notHotEnd } = doLayout(notHotSteps, rightX, y, [{ id: step.id, handle: "notHot" }]);
        y = Math.max(hotEnd, notHotEnd) + 40;
        feeders_ = [{ id: step.id }];
      }

      // ── Condition ──────────────────────────────────────────────────────────
      else if (step.nodeType === "condition") {
        const yesSteps = step.branches["yes"] ?? [];
        const noSteps  = step.branches["no"]  ?? [];
        const leftX  = x - BRANCH_W / 2;
        const rightX = x + BRANCH_W / 2;

        const { terminals: yesTerm, nextY: yEnd } = doLayout(yesSteps, leftX,  y, [{ id: step.id, handle: "yes" }]);
        const { terminals: noTerm,  nextY: nEnd } = doLayout(noSteps,  rightX, y, [{ id: step.id, handle: "no"  }]);
        y = Math.max(yEnd, nEnd) + 40;
        feeders_ = [...yesTerm, ...noTerm];
        // If both branches are empty, condition itself feeds the next step plainly
        if (feeders_.length === 0) feeders_ = [{ id: step.id }];
      }

      // ── Switch / Case ──────────────────────────────────────────────────────
      else if (step.nodeType === "switch_case") {
        const branchKeys = Object.keys(step.branches);
        const n = branchKeys.length;
        const totalW = (n - 1) * BRANCH_W;
        let maxEndY = y;
        const allTerminals: Array<{ id: string; handle?: string }> = [];

        branchKeys.forEach((key, bi) => {
          const bSteps = step.branches![key] ?? [];
          const bx = x - totalW / 2 + bi * BRANCH_W;
          const handle = key === "__default__" ? "default" : `case-${key}`;
          const { terminals: bTerm, nextY: bEnd } = doLayout(bSteps, bx, y, [{ id: step.id, handle }]);
          maxEndY = Math.max(maxEndY, bEnd);
          allTerminals.push(...bTerm);
        });
        y = maxEndY + 40;
        feeders_ = allTerminals.length > 0 ? allTerminals : [{ id: step.id }];
      }
    }

    return { terminals: feeders_, nextY: y };
  }

  doLayout(steps, startX, startY, []);
  return { nodes: allNodes, edges: allEdges };
}

// ── Graph mutation helpers ─────────────────────────────────────────────────────
// These operate directly on the flat graph so WorkflowBuilderPage doesn't
// need to convert to tree and back for every mutation.

/** Insert a new node after `afterNodeId` on the edge with optional sourceHandle. */
export function graphInsertStep(
  nodes: StoredNode[],
  edges: StoredEdge[],
  newNode: StoredNode,
  afterNodeId: string,
  sourceHandle?: string,
): { nodes: StoredNode[]; edges: StoredEdge[] } {
  const sh = sourceHandle || undefined;

  // Find the existing outgoing edge from afterNodeId matching the handle
  const existingEdge = edges.find(
    e => e.source === afterNodeId && (sh ? e.sourceHandle === sh : !e.sourceHandle),
  );

  const nextEdges = edges.filter(e => e !== existingEdge);
  nextEdges.push({ id: `e-ins-${newNode.id}-a`, source: afterNodeId, target: newNode.id, sourceHandle: sh });
  if (existingEdge) {
    nextEdges.push({ id: `e-ins-${newNode.id}-b`, source: newNode.id, target: existingEdge.target });
  }

  return { nodes: [...nodes, newNode], edges: nextEdges };
}

/**
 * Remove a node and reconnect its predecessor to its successor.
 * Handles foreach "done" and branch-first-node sourceHandles.
 */
export function graphRemoveStep(
  nodes: StoredNode[],
  edges: StoredEdge[],
  nodeId: string,
): { nodes: StoredNode[]; edges: StoredEdge[] } {
  const inEdge  = edges.find(e => e.target === nodeId);
  // Successor: prefer plain edge, then "done" (foreach continuation)
  const outEdge =
    edges.find(e => e.source === nodeId && !e.sourceHandle) ??
    edges.find(e => e.source === nodeId && e.sourceHandle === "done");

  const nextEdges = edges.filter(e => e.source !== nodeId && e.target !== nodeId);

  if (inEdge && outEdge) {
    nextEdges.push({
      id: `e-del-${nodeId}`,
      source: inEdge.source,
      target: outEdge.target,
      sourceHandle: inEdge.sourceHandle ?? undefined,
    });
  }

  return { nodes: nodes.filter(n => n.id !== nodeId), edges: nextEdges };
}

/**
 * Swap a node with the previous sibling in the same branch sequence.
 * Correctly handles branch-first nodes whose predecessor edge has a sourceHandle.
 */
export function graphMoveStepUp(
  nodes: StoredNode[],
  edges: StoredEdge[],
  nodeId: string,
): { nodes: StoredNode[]; edges: StoredEdge[] } {
  const inEdge = edges.find(e => e.target === nodeId);
  if (!inEdge) return { nodes, edges }; // no predecessor at all

  // If the incoming edge has a sourceHandle, this is the first in its branch — can't move up
  if (inEdge.sourceHandle) return { nodes, edges };

  const prevId = inEdge.source;
  const prevInEdge = edges.find(e => e.target === prevId);
  if (!prevInEdge) return { nodes, edges }; // prev has no predecessor (it's the graph root)

  const outEdge = edges.find(e => e.source === nodeId && !e.sourceHandle);

  const kept = edges.filter(e => e !== inEdge && e !== prevInEdge && !(e.source === nodeId && e.target === outEdge?.target));

  kept.push({ id: `e-mu-a-${nodeId}`, source: prevInEdge.source, target: nodeId, sourceHandle: prevInEdge.sourceHandle ?? undefined });
  kept.push({ id: `e-mu-b-${nodeId}`, source: nodeId, target: prevId });
  if (outEdge) {
    kept.push({ id: `e-mu-c-${nodeId}`, source: prevId, target: outEdge.target });
  }

  return { nodes, edges: kept };
}

/**
 * Swap a node with the next sibling in the same branch sequence.
 * Handles foreach "done" continuation and branch-first-node sourceHandles.
 */
export function graphMoveStepDown(
  nodes: StoredNode[],
  edges: StoredEdge[],
  nodeId: string,
): { nodes: StoredNode[]; edges: StoredEdge[] } {
  const outEdge =
    edges.find(e => e.source === nodeId && !e.sourceHandle) ??
    edges.find(e => e.source === nodeId && e.sourceHandle === "done");
  if (!outEdge) return { nodes, edges }; // already last

  const nextId = outEdge.target;
  const nextOutEdge = edges.find(e => e.source === nextId && !e.sourceHandle);
  const inEdge = edges.find(e => e.target === nodeId);

  const kept = edges.filter(e => e !== outEdge && e !== nextOutEdge && e !== inEdge);

  if (inEdge) {
    kept.push({ id: `e-md-a-${nodeId}`, source: inEdge.source, target: nextId, sourceHandle: inEdge.sourceHandle ?? undefined });
  }
  kept.push({ id: `e-md-b-${nodeId}`, source: nextId, target: nodeId });
  if (nextOutEdge) {
    kept.push({ id: `e-md-c-${nodeId}`, source: nodeId, target: nextOutEdge.target });
  }

  return { nodes, edges: kept };
}

// ── Tree-level step insertion ─────────────────────────────────────────────────

/**
 * Insert `newStep` immediately after the step with `afterId` in the tree.
 * Searches the top-level sequence first, then recurses into container branches.
 * Returns the mutated tree, or the original reference when `afterId` is not found.
 */
export function treeInsertStepAfter(
  steps: FlowStep[],
  afterId: string,
  newStep: FlowStep,
): FlowStep[] {
  const idx = steps.findIndex(s => s.id === afterId);
  if (idx !== -1) {
    const arr = [...steps];
    arr.splice(idx + 1, 0, newStep);
    return arr;
  }

  // Recurse into container branches
  let changed = false;
  const newSteps = steps.map(step => {
    if (!step.branches) return step;
    let branchChanged = false;
    const newBranches: Record<string, FlowStep[]> = {};
    for (const [key, branchSteps] of Object.entries(step.branches)) {
      const updated = treeInsertStepAfter(branchSteps, afterId, newStep);
      newBranches[key] = updated;
      if (updated !== branchSteps) branchChanged = true;
    }
    if (branchChanged) {
      changed = true;
      return { ...step, branches: newBranches };
    }
    return step;
  });

  return changed ? newSteps : steps;
}

// ── Cross-level drag helpers ───────────────────────────────────────────────────

/** Find a step anywhere in the tree (including nested branches). */
export function treeFindStep(steps: FlowStep[], id: string): FlowStep | null {
  for (const step of steps) {
    if (step.id === id) return step;
    if (step.branches) {
      for (const branch of Object.values(step.branches)) {
        const found = treeFindStep(branch, id);
        if (found) return found;
      }
    }
  }
  return null;
}

/** Remove a step by ID anywhere in the tree. Returns same reference if not found. */
export function treeRemoveStep(steps: FlowStep[], id: string): FlowStep[] {
  const idx = steps.findIndex(s => s.id === id);
  if (idx !== -1) {
    const arr = [...steps];
    arr.splice(idx, 1);
    return arr;
  }
  let changed = false;
  const newSteps = steps.map(step => {
    if (!step.branches) return step;
    let branchChanged = false;
    const newBranches: Record<string, FlowStep[]> = {};
    for (const [key, branchSteps] of Object.entries(step.branches)) {
      const removed = treeRemoveStep(branchSteps, id);
      newBranches[key] = removed;
      if (removed !== branchSteps) branchChanged = true;
    }
    if (branchChanged) { changed = true; return { ...step, branches: newBranches }; }
    return step;
  });
  return changed ? newSteps : steps;
}

/**
 * Move `draggedId` to the START of the specified branch inside `containerId`.
 * Works across any nesting level. Prevents moving a container into itself.
 */
export function treeMoveStepIntoBranch(
  steps: FlowStep[],
  draggedId: string,
  containerId: string,
  branchKey: string,
): FlowStep[] {
  if (draggedId === containerId) return steps;
  const draggedOrNull = treeFindStep(steps, draggedId);
  if (!draggedOrNull) return steps;
  const dragged: FlowStep = draggedOrNull;

  const withoutDragged = treeRemoveStep(steps, draggedId);

  function insertInto(seq: FlowStep[]): { result: FlowStep[]; changed: boolean } {
    let seqChanged = false;
    const mapped = seq.map(step => {
      if (step.id === containerId && step.branches) {
        const branchSteps = step.branches[branchKey] ?? [];
        seqChanged = true;
        return { ...step, branches: { ...step.branches, [branchKey]: [dragged, ...branchSteps] } };
      }
      if (step.branches) {
        let bChanged = false;
        const newBranches: Record<string, FlowStep[]> = {};
        for (const [k, v] of Object.entries(step.branches)) {
          const { result, changed } = insertInto(v);
          newBranches[k] = result;
          if (changed) bChanged = true;
        }
        if (bChanged) { seqChanged = true; return { ...step, branches: newBranches }; }
      }
      return step;
    });
    return { result: seqChanged ? mapped : seq, changed: seqChanged };
  }

  const { result, changed } = insertInto(withoutDragged);
  return changed ? result : steps;
}

// ── Tree-level reorder (for drag-and-drop) ────────────────────────────────────

/**
 * Reorder `draggedId` to immediately before or after `targetId` within
 * the same branch sequence. Searches recursively through all container branches.
 * Returns the mutated tree, or the original reference when unchanged.
 */
export function treeReorderStep(
  steps: FlowStep[],
  draggedId: string,
  targetId: string,
  position: "before" | "after",
): FlowStep[] {
  const di = steps.findIndex(s => s.id === draggedId);
  const ti = steps.findIndex(s => s.id === targetId);

  if (di !== -1 && ti !== -1 && di !== ti) {
    const arr = [...steps];
    const [dragged] = arr.splice(di, 1);
    const newTi = arr.findIndex(s => s.id === targetId);
    const insertAt = position === "before" ? newTi : newTi + 1;
    arr.splice(Math.max(0, insertAt), 0, dragged);
    return arr;
  }

  // Recurse into container branches
  let changed = false;
  const newSteps = steps.map(step => {
    if (!step.branches) return step;
    let branchChanged = false;
    const newBranches: Record<string, FlowStep[]> = {};
    for (const [key, branchSteps] of Object.entries(step.branches)) {
      const reordered = treeReorderStep(branchSteps, draggedId, targetId, position);
      newBranches[key] = reordered;
      if (reordered !== branchSteps) branchChanged = true;
    }
    if (branchChanged) {
      changed = true;
      return { ...step, branches: newBranches };
    }
    return step;
  });

  return changed ? newSteps : steps;
}
