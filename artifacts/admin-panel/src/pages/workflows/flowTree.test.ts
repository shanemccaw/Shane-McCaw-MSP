/**
 * flowTree.test.ts
 *
 * Round-trip and mutation tests for the flowTree conversion layer.
 * Run with: pnpm --filter @workspace/admin-panel run test (vitest)
 */

import { describe, it, expect } from "vitest";
import {
  graphToTree,
  treeToGraph,
  treeInsertStepAfter,
  treeReorderStep,
  graphInsertStep,
  graphRemoveStep,
  graphMoveStepUp,
  graphMoveStepDown,
} from "./flowTree";
import type { StoredNode, StoredEdge, FlowStep } from "./flowTree";

// ── Helpers ───────────────────────────────────────────────────────────────────

function node(id: string, nodeType: string): StoredNode {
  return { id, type: nodeType, position: { x: 0, y: 0 }, data: { nodeType, label: id } };
}

function edge(id: string, source: string, target: string, sourceHandle?: string): StoredEdge {
  return { id, source, target, sourceHandle };
}

/** Convert a tree back to graph, then back to tree — result should equal input. */
function roundTrip(steps: FlowStep[]) {
  const g = treeToGraph(steps);
  return graphToTree(g.nodes, g.edges);
}

/** Find a step anywhere in the tree by id. */
function findStep(steps: FlowStep[], id: string): FlowStep | undefined {
  for (const s of steps) {
    if (s.id === id) return s;
    if (s.branches) {
      for (const branch of Object.values(s.branches)) {
        const found = findStep(branch, id);
        if (found) return found;
      }
    }
  }
  return undefined;
}

// ── graphToTree: linear sequence ───────────────────────────────────────────────

describe("graphToTree — linear sequence", () => {
  it("converts a simple start→action→end chain", () => {
    const nodes: StoredNode[] = [node("start", "start"), node("a1", "action"), node("end", "end")];
    const edges: StoredEdge[]  = [edge("e1", "start", "a1"), edge("e2", "a1", "end")];

    const tree = graphToTree(nodes, edges);

    expect(tree).toHaveLength(3);
    expect(tree[0].id).toBe("start");
    expect(tree[1].id).toBe("a1");
    expect(tree[2].id).toBe("end");
  });

  it("handles empty graph", () => {
    expect(graphToTree([], [])).toEqual([]);
  });

  it("handles a single node with no edges", () => {
    const nodes: StoredNode[] = [node("start", "start")];
    const tree = graphToTree(nodes, []);
    expect(tree).toHaveLength(1);
    expect(tree[0].id).toBe("start");
  });
});

// ── graphToTree: ForEach ───────────────────────────────────────────────────────

describe("graphToTree — ForEach", () => {
  it("builds foreach with body and continuation", () => {
    // start → foreach (body→body1, done→end)
    const nodes: StoredNode[] = [
      node("start", "start"), node("fe", "foreach"), node("body1", "action"), node("end", "action"),
    ];
    const edges: StoredEdge[] = [
      edge("e1", "start", "fe"),
      edge("e2", "fe",    "body1", "body"),
      edge("e3", "fe",    "end",   "done"),
    ];

    const tree = graphToTree(nodes, edges);

    expect(tree).toHaveLength(3); // start, foreach, end
    const feStep = tree[1];
    expect(feStep.nodeType).toBe("foreach");
    expect(feStep.branches?.["body"]).toHaveLength(1);
    expect(feStep.branches!["body"][0].id).toBe("body1");
    expect(tree[2].id).toBe("end");
  });

  it("round-trips foreach → treeToGraph → graphToTree", () => {
    const nodes: StoredNode[] = [
      node("start", "start"), node("fe", "foreach"), node("body1", "action"), node("end", "action"),
    ];
    const edges: StoredEdge[] = [
      edge("e1", "start", "fe"),
      edge("e2", "fe",    "body1", "body"),
      edge("e3", "fe",    "end",   "done"),
    ];
    const tree = graphToTree(nodes, edges);
    const rt   = roundTrip(tree);

    expect(rt).toHaveLength(3);
    expect(rt[1].nodeType).toBe("foreach");
    expect(rt[1].branches?.["body"]).toHaveLength(1);
    expect(rt[2].id).toBe("end");
  });
});

// ── graphToTree: If/Else ──────────────────────────────────────────────────────

describe("graphToTree — If/Else (condition)", () => {
  it("builds condition with yes/no branches and continuation", () => {
    // start → cond → (yes→yesA, no→noA) → yesA→cont, noA→cont → end
    const nodes: StoredNode[] = [
      node("start", "start"),
      node("cond",  "condition"),
      node("yesA",  "action"),
      node("noA",   "action"),
      node("cont",  "action"),
    ];
    const edges: StoredEdge[] = [
      edge("e1", "start", "cond"),
      edge("e2", "cond",  "yesA", "yes"),
      edge("e3", "cond",  "noA",  "no"),
      edge("e4", "yesA",  "cont"),
      edge("e5", "noA",   "cont"),
    ];

    const tree = graphToTree(nodes, edges);

    expect(tree).toHaveLength(3); // start, cond, cont
    const condStep = tree[1];
    expect(condStep.nodeType).toBe("condition");
    expect(condStep.branches?.["yes"]).toHaveLength(1);
    expect(condStep.branches!["yes"][0].id).toBe("yesA");
    expect(condStep.branches?.["no"]).toHaveLength(1);
    expect(condStep.branches!["no"][0].id).toBe("noA");
    expect(tree[2].id).toBe("cont");
  });

  it("round-trips condition → treeToGraph → graphToTree", () => {
    const nodes: StoredNode[] = [
      node("start", "start"),
      node("cond",  "condition"),
      node("yesA",  "action"),
      node("noA",   "action"),
      node("cont",  "action"),
    ];
    const edges: StoredEdge[] = [
      edge("e1", "start", "cond"),
      edge("e2", "cond",  "yesA", "yes"),
      edge("e3", "cond",  "noA",  "no"),
      edge("e4", "yesA",  "cont"),
      edge("e5", "noA",   "cont"),
    ];
    const tree = graphToTree(nodes, edges);
    const rt   = roundTrip(tree);

    expect(rt).toHaveLength(3);
    expect(rt[1].nodeType).toBe("condition");
    expect(rt[1].branches?.["yes"]).toHaveLength(1);
    expect(rt[1].branches?.["no"]).toHaveLength(1);
    expect(rt[2].id).toBe("cont");
  });

  it("handles empty yes/no branches (plain-edge fallback)", () => {
    const nodes: StoredNode[] = [node("cond", "condition"), node("cont", "action")];
    const edges: StoredEdge[] = [edge("e1", "cond", "cont")];
    const tree = graphToTree(nodes, edges);
    expect(tree[0].branches?.["yes"]).toEqual([]);
    expect(tree[0].branches?.["no"]).toEqual([]);
  });

  // ── Asymmetric condition tests (the regression) ──────────────────────────

  it("asymmetric: yes=[A], no=[] — A stays inside yes-branch, cont is top-level", () => {
    // Graph emitted by new treeToGraph for yes=[A], no=[]:
    //   cond→(yes)A, cond→(no)cont, A→cont
    // cont has inEdgeCount=2 so localCollect stops there.
    const nodes: StoredNode[] = [
      node("start", "start"),
      node("cond",  "condition"),
      node("yesA",  "action"),
      node("cont",  "action"),
    ];
    const edges: StoredEdge[] = [
      edge("e1", "start", "cond"),
      edge("e2", "cond",  "yesA", "yes"),
      edge("e3", "cond",  "cont", "no"),   // ← empty no-branch wired directly to cont
      edge("e4", "yesA",  "cont"),
    ];

    const tree = graphToTree(nodes, edges);

    expect(tree).toHaveLength(3); // start, cond, cont
    const condStep = tree[1];
    expect(condStep.nodeType).toBe("condition");
    expect(condStep.branches?.["yes"]).toHaveLength(1);
    expect(condStep.branches!["yes"][0].id).toBe("yesA");
    expect(condStep.branches?.["no"]).toHaveLength(0);
    expect(tree[2].id).toBe("cont");
  });

  it("asymmetric: yes=[], no=[B] — B stays inside no-branch, cont is top-level", () => {
    const nodes: StoredNode[] = [
      node("start", "start"),
      node("cond",  "condition"),
      node("noB",   "action"),
      node("cont",  "action"),
    ];
    const edges: StoredEdge[] = [
      edge("e1", "start", "cond"),
      edge("e2", "cond",  "cont", "yes"),  // empty yes wired to cont
      edge("e3", "cond",  "noB",  "no"),
      edge("e4", "noB",   "cont"),
    ];

    const tree = graphToTree(nodes, edges);

    expect(tree).toHaveLength(3);
    const condStep = tree[1];
    expect(condStep.branches?.["yes"]).toHaveLength(0);
    expect(condStep.branches?.["no"]).toHaveLength(1);
    expect(condStep.branches!["no"][0].id).toBe("noB");
    expect(tree[2].id).toBe("cont");
  });

  it("round-trip asymmetric condition yes=[A], no=[] with continuation", () => {
    // Build the tree directly and round-trip it through treeToGraph + graphToTree
    const initialTree: FlowStep[] = [
      { id: "start", nodeType: "start", data: { nodeType: "start", label: "start" } },
      {
        id: "cond",
        nodeType: "condition",
        data: { nodeType: "condition", label: "cond" },
        branches: {
          yes: [{ id: "yesA", nodeType: "action", data: { nodeType: "action", label: "yesA" } }],
          no:  [],
        },
      },
      { id: "cont", nodeType: "action", data: { nodeType: "action", label: "cont" } },
      { id: "end",  nodeType: "end",    data: { nodeType: "end",    label: "end"  } },
    ];

    const rt = roundTrip(initialTree);

    expect(rt).toHaveLength(4); // start, cond, cont, end
    expect(rt[0].id).toBe("start");
    expect(rt[1].id).toBe("cond");
    expect(rt[1].branches?.["yes"]).toHaveLength(1);
    expect(rt[1].branches!["yes"][0].id).toBe("yesA");
    expect(rt[1].branches?.["no"]).toHaveLength(0);
    expect(rt[2].id).toBe("cont");
    expect(rt[3].id).toBe("end");
  });

  it("round-trip asymmetric condition yes=[], no=[B] with continuation", () => {
    const initialTree: FlowStep[] = [
      { id: "start", nodeType: "start", data: { nodeType: "start", label: "start" } },
      {
        id: "cond",
        nodeType: "condition",
        data: { nodeType: "condition", label: "cond" },
        branches: {
          yes: [],
          no:  [{ id: "noB", nodeType: "action", data: { nodeType: "action", label: "noB" } }],
        },
      },
      { id: "cont", nodeType: "action", data: { nodeType: "action", label: "cont" } },
      { id: "end",  nodeType: "end",    data: { nodeType: "end",    label: "end"  } },
    ];

    const rt = roundTrip(initialTree);

    expect(rt).toHaveLength(4);
    expect(rt[1].id).toBe("cond");
    expect(rt[1].branches?.["yes"]).toHaveLength(0);
    expect(rt[1].branches?.["no"]).toHaveLength(1);
    expect(rt[1].branches!["no"][0].id).toBe("noB");
    expect(rt[2].id).toBe("cont");
    expect(rt[3].id).toBe("end");
  });

  it("round-trip both-empty condition with continuation", () => {
    const initialTree: FlowStep[] = [
      { id: "cond", nodeType: "condition", data: { nodeType: "condition", label: "cond" }, branches: { yes: [], no: [] } },
      { id: "cont", nodeType: "action",    data: { nodeType: "action",    label: "cont" } },
    ];

    const rt = roundTrip(initialTree);

    expect(rt).toHaveLength(2);
    expect(rt[0].id).toBe("cond");
    expect(rt[0].branches?.["yes"]).toHaveLength(0);
    expect(rt[0].branches?.["no"]).toHaveLength(0);
    expect(rt[1].id).toBe("cont");
  });
});

// ── graphToTree: Switch ────────────────────────────────────────────────────────

describe("graphToTree — Switch", () => {
  it("builds switch with case branches and continuation", () => {
    const cases = [{ id: "c1", label: "Case 1" }, { id: "c2", label: "Case 2" }];
    const nodes: StoredNode[] = [
      node("start", "start"),
      { ...node("sw", "switch_case"), data: { nodeType: "switch_case", label: "sw", cases } },
      node("step1", "action"),
      node("step2", "action"),
      node("def",   "action"),
      node("cont",  "action"),
    ];
    const edges: StoredEdge[] = [
      edge("e1", "start", "sw"),
      edge("e2", "sw",    "step1", "case-c1"),
      edge("e3", "sw",    "step2", "case-c2"),
      edge("e4", "sw",    "def",   "default"),
      edge("e5", "step1", "cont"),
      edge("e6", "step2", "cont"),
      edge("e7", "def",   "cont"),
    ];

    const tree = graphToTree(nodes, edges);

    expect(tree).toHaveLength(3); // start, switch, cont
    const sw = tree[1];
    expect(sw.nodeType).toBe("switch_case");
    expect(sw.branches?.["c1"]).toHaveLength(1);
    expect(sw.branches?.["c2"]).toHaveLength(1);
    expect(sw.branches?.["__default__"]).toHaveLength(1);
    expect(tree[2].id).toBe("cont");
  });
});

// ── Mutation: graphInsertStep ─────────────────────────────────────────────────

describe("graphInsertStep", () => {
  it("inserts between two existing nodes", () => {
    const nodes: StoredNode[] = [node("a", "action"), node("b", "action")];
    const edges: StoredEdge[] = [edge("e1", "a", "b")];
    const newN = node("x", "action");

    const { nodes: n2, edges: e2 } = graphInsertStep(nodes, edges, newN, "a");

    expect(n2).toHaveLength(3);
    expect(e2.find(e => e.source === "a" && e.target === "x")).toBeTruthy();
    expect(e2.find(e => e.source === "x" && e.target === "b")).toBeTruthy();
    expect(e2.find(e => e.source === "a" && e.target === "b")).toBeFalsy();
  });

  it("inserts at the end when no existing outgoing edge", () => {
    const nodes: StoredNode[] = [node("a", "action")];
    const edges: StoredEdge[] = [];
    const newN = node("x", "action");

    const { nodes: n2, edges: e2 } = graphInsertStep(nodes, edges, newN, "a");

    expect(n2).toHaveLength(2);
    expect(e2.find(e => e.source === "a" && e.target === "x")).toBeTruthy();
  });

  it("inserts into a branch using sourceHandle", () => {
    const nodes: StoredNode[] = [node("cond", "condition"), node("yesA", "action")];
    const edges: StoredEdge[] = [edge("e1", "cond", "yesA", "yes")];
    const newN = node("new", "action");

    const { edges: e2 } = graphInsertStep(nodes, edges, newN, "cond", "yes");

    expect(e2.find(e => e.source === "cond" && e.target === "new" && e.sourceHandle === "yes")).toBeTruthy();
    expect(e2.find(e => e.source === "new" && e.target === "yesA")).toBeTruthy();
  });
});

// ── Mutation: graphRemoveStep ─────────────────────────────────────────────────

describe("graphRemoveStep", () => {
  it("removes a node and reconnects predecessor to successor", () => {
    const nodes: StoredNode[] = [node("a", "action"), node("b", "action"), node("c", "action")];
    const edges: StoredEdge[] = [edge("e1", "a", "b"), edge("e2", "b", "c")];

    const { nodes: n2, edges: e2 } = graphRemoveStep(nodes, edges, "b");

    expect(n2.map(n => n.id)).not.toContain("b");
    expect(e2.find(e => e.source === "a" && e.target === "c")).toBeTruthy();
  });

  it("removes the first node without reconnecting (no predecessor)", () => {
    const nodes: StoredNode[] = [node("a", "action"), node("b", "action")];
    const edges: StoredEdge[] = [edge("e1", "a", "b")];

    const { nodes: n2, edges: e2 } = graphRemoveStep(nodes, edges, "a");

    expect(n2.map(n => n.id)).not.toContain("a");
    expect(e2).toHaveLength(0); // no reconnect because a had no predecessor
  });

  it("preserves branch sourceHandle when reconnecting", () => {
    const nodes: StoredNode[] = [node("cond", "condition"), node("mid", "action"), node("end", "action")];
    const edges: StoredEdge[] = [edge("e1", "cond", "mid", "yes"), edge("e2", "mid", "end")];

    const { edges: e2 } = graphRemoveStep(nodes, edges, "mid");

    const reconnect = e2.find(e => e.source === "cond" && e.target === "end");
    expect(reconnect).toBeTruthy();
    expect(reconnect?.sourceHandle).toBe("yes");
  });

  it("handles foreach done-handle continuation", () => {
    const nodes: StoredNode[] = [
      node("fe", "foreach"), node("body", "action"), node("cont", "action"),
    ];
    const edges: StoredEdge[] = [
      edge("e1", "fe", "body", "body"),
      edge("e2", "fe", "cont", "done"),
    ];
    // Removing foreach should not crash; cont becomes orphan (no predecessor)
    const { nodes: n2 } = graphRemoveStep(nodes, edges, "fe");
    expect(n2.map(n => n.id)).not.toContain("fe");
  });
});

// ── Mutation: graphMoveStepUp / Down ─────────────────────────────────────────

describe("graphMoveStepUp / graphMoveStepDown", () => {
  it("moves a node up in a linear sequence", () => {
    const ns: StoredNode[] = [node("a", "action"), node("b", "action"), node("c", "action")];
    const es: StoredEdge[]  = [edge("e1", "a", "b"), edge("e2", "b", "c")];

    const { edges: e2 } = graphMoveStepUp(ns, es, "c");

    // c should now be before b
    expect(e2.find(e => e.source === "a" && e.target === "c")).toBeTruthy();
    expect(e2.find(e => e.source === "c" && e.target === "b")).toBeTruthy();
  });

  it("does not move up when first in branch", () => {
    const ns: StoredNode[] = [node("cond", "condition"), node("yes1", "action")];
    const es: StoredEdge[]  = [edge("e1", "cond", "yes1", "yes")];

    const { edges: e2 } = graphMoveStepUp(ns, es, "yes1");

    // No change expected — yes1 is first in the yes branch
    expect(e2).toEqual(es);
  });

  it("swaps first branch node up, inheriting branch handle", () => {
    // cond →(yes)→ yes1 → yes2
    const ns: StoredNode[] = [node("cond", "condition"), node("yes1", "action"), node("yes2", "action")];
    const es: StoredEdge[]  = [edge("e1", "cond", "yes1", "yes"), edge("e2", "yes1", "yes2")];

    const { edges: e2 } = graphMoveStepUp(ns, es, "yes2");

    // yes2 should now be first: cond→(yes)→yes2→yes1
    expect(e2.find(e => e.source === "cond" && e.target === "yes2" && e.sourceHandle === "yes")).toBeTruthy();
    expect(e2.find(e => e.source === "yes2" && e.target === "yes1")).toBeTruthy();
  });

  it("moves a node down in a linear sequence", () => {
    const ns: StoredNode[] = [node("a", "action"), node("b", "action"), node("c", "action")];
    const es: StoredEdge[]  = [edge("e1", "a", "b"), edge("e2", "b", "c")];

    const { edges: e2 } = graphMoveStepDown(ns, es, "a");

    expect(e2.find(e => e.source === "b" && e.target === "a")).toBeTruthy();
    expect(e2.find(e => e.source === "a" && e.target === "c")).toBeTruthy();
  });

  it("does not move down when already last", () => {
    const ns: StoredNode[] = [node("a", "action"), node("b", "action")];
    const es: StoredEdge[]  = [edge("e1", "a", "b")];

    const { edges: e2 } = graphMoveStepDown(ns, es, "b");

    expect(e2).toEqual(es);
  });
});

// ── treeInsertStepAfter ───────────────────────────────────────────────────────

describe("treeInsertStepAfter", () => {
  const condNodes: StoredNode[] = [
    node("start", "start"),
    node("cond",  "condition"),
    node("yesA",  "action"),
    node("noA",   "action"),
    node("cont",  "action"),
  ];
  const condEdges: StoredEdge[] = [
    edge("e1", "start", "cond"),
    edge("e2", "cond",  "yesA", "yes"),
    edge("e3", "cond",  "noA",  "no"),
    edge("e4", "yesA",  "cont"),
    edge("e5", "noA",   "cont"),
  ];

  it("inserts a step after a top-level condition container", () => {
    const tree = graphToTree(condNodes, condEdges);
    // tree = [start, cond{yes:[yesA], no:[noA]}, cont]
    const newStep: FlowStep = { id: "new", nodeType: "action", data: {} };
    const updated = treeInsertStepAfter(tree, "cond", newStep);

    expect(updated).toHaveLength(4);
    expect(updated[0].id).toBe("start");
    expect(updated[1].id).toBe("cond");
    expect(updated[2].id).toBe("new");
    expect(updated[3].id).toBe("cont");
  });

  it("round-trips: tree-insert after condition → treeToGraph → graphToTree preserves order", () => {
    const tree = graphToTree(condNodes, condEdges);
    const newStep: FlowStep = { id: "inserted", nodeType: "action", data: { nodeType: "action", label: "inserted" } };
    const updated = treeInsertStepAfter(tree, "cond", newStep);
    const { nodes: n, edges: e } = treeToGraph(updated);
    const rt = graphToTree(n, e);

    expect(rt).toHaveLength(4);
    expect(rt[1].id).toBe("cond");
    expect(rt[2].id).toBe("inserted");
    expect(rt[3].id).toBe("cont");
  });

  it("inserts at end when afterId is last step", () => {
    const steps: FlowStep[] = [
      { id: "a", nodeType: "action", data: {} },
      { id: "b", nodeType: "action", data: {} },
    ];
    const newStep: FlowStep = { id: "c", nodeType: "action", data: {} };
    const updated = treeInsertStepAfter(steps, "b", newStep);
    expect(updated.map(s => s.id)).toEqual(["a", "b", "c"]);
  });

  it("returns same reference when afterId is not found", () => {
    const steps: FlowStep[] = [{ id: "a", nodeType: "action", data: {} }];
    const result = treeInsertStepAfter(steps, "missing", { id: "x", nodeType: "action", data: {} });
    expect(result).toBe(steps);
  });

  it("inserts after a step inside a branch", () => {
    const steps: FlowStep[] = [
      {
        id: "cond",
        nodeType: "condition",
        data: {},
        branches: {
          yes: [{ id: "y1", nodeType: "action", data: {} }],
          no: [],
        },
      },
    ];
    const newStep: FlowStep = { id: "y2", nodeType: "action", data: {} };
    const updated = treeInsertStepAfter(steps, "y1", newStep);
    expect(updated[0].branches?.["yes"].map(s => s.id)).toEqual(["y1", "y2"]);
  });
});

// ── treeReorderStep ───────────────────────────────────────────────────────────

describe("treeReorderStep", () => {
  function makeLinear(): FlowStep[] {
    return [
      { id: "a", nodeType: "action", data: {} },
      { id: "b", nodeType: "action", data: {} },
      { id: "c", nodeType: "action", data: {} },
    ];
  }

  it("moves b before a", () => {
    const result = treeReorderStep(makeLinear(), "b", "a", "before");
    expect(result.map(s => s.id)).toEqual(["b", "a", "c"]);
  });

  it("moves a after c", () => {
    const result = treeReorderStep(makeLinear(), "a", "c", "after");
    expect(result.map(s => s.id)).toEqual(["b", "c", "a"]);
  });

  it("returns same reference when dragged === target", () => {
    const steps = makeLinear();
    const result = treeReorderStep(steps, "a", "a", "before");
    expect(result).toBe(steps);
  });

  it("reorders within a branch", () => {
    const steps: FlowStep[] = [
      {
        id: "cond",
        nodeType: "condition",
        data: {},
        branches: {
          yes: [
            { id: "y1", nodeType: "action", data: {} },
            { id: "y2", nodeType: "action", data: {} },
          ],
          no: [],
        },
      },
    ];

    const result = treeReorderStep(steps, "y2", "y1", "before");
    const yesBranch = result[0].branches!["yes"];
    expect(yesBranch.map(s => s.id)).toEqual(["y2", "y1"]);
  });

  it("returns same reference when neither id is found", () => {
    const steps = makeLinear();
    const result = treeReorderStep(steps, "x", "y", "after");
    expect(result).toBe(steps);
  });
});

// ── Retry back-edge topology ───────────────────────────────────────────────────

describe("graphToTree — retry back-edge (SOW auto-retry pattern)", () => {
  /**
   * Canonical retry topology (two variants tested below):
   *
   * Variant A — simple retry (back-edge only, no shared continuation):
   *   start → retryPoint → cond(yes: yesStep → retryPoint [back-edge], no: noStep) → (no top-level cont)
   *
   *   retryPoint has inEdgeCount = 2 (from start and from yesStep back-edge).
   *   yesStep must stay inside the condition's yes-branch and NOT float to the
   *   top-level sequence or be treated as an orphan.
   *
   * Variant B — retry with shared continuation (both branches converge):
   *   start → retryPoint → cond(yes: yesStep → retryPoint [back-edge] AND yesStep → cont,
   *                              no: noStep → cont) → cont
   *
   *   cont has inEdgeCount = 2 (from yesStep and noStep).  retryPoint must NOT
   *   be misidentified as the post-condition continuation.
   */

  // Variant A: yesStep only has a back-edge; no shared continuation.
  function makeSimpleRetryGraph(): { nodes: StoredNode[]; edges: StoredEdge[] } {
    const nodes: StoredNode[] = [
      node("start",      "start"),
      node("retryPoint", "action"),
      node("cond",       "condition"),
      node("yesStep",    "action"),
      node("noStep",     "action"),
    ];
    const edges: StoredEdge[] = [
      edge("e1", "start",      "retryPoint"),
      edge("e2", "retryPoint", "cond"),
      edge("e3", "cond",       "yesStep",    "yes"),
      edge("e4", "cond",       "noStep",     "no"),
      // retry back-edge: yes-branch terminal → node before the condition
      edge("e5", "yesStep",    "retryPoint"),
    ];
    return { nodes, edges };
  }

  // Variant B: yesStep has a back-edge AND both branches share a continuation.
  function makeRetryWithContinuationGraph(): { nodes: StoredNode[]; edges: StoredEdge[] } {
    const nodes: StoredNode[] = [
      node("start",      "start"),
      node("retryPoint", "action"),
      node("cond",       "condition"),
      node("yesStep",    "action"),
      node("noStep",     "action"),
      node("cont",       "action"),
    ];
    const edges: StoredEdge[] = [
      edge("e1", "start",      "retryPoint"),
      edge("e2", "retryPoint", "cond"),
      edge("e3", "cond",       "yesStep",    "yes"),
      edge("e4", "cond",       "noStep",     "no"),
      // retry back-edge AND forward to shared continuation
      edge("e5", "yesStep",    "retryPoint"),
      edge("e6", "yesStep",    "cont"),
      edge("e7", "noStep",     "cont"),
    ];
    return { nodes, edges };
  }

  // ── Variant A tests ──────────────────────────────────────────────────────────

  it("[A] places yesStep inside the condition yes-branch", () => {
    const { nodes, edges } = makeSimpleRetryGraph();
    const tree = graphToTree(nodes, edges);

    const condStep = findStep(tree, "cond");
    expect(condStep).toBeDefined();
    expect(condStep!.branches?.["yes"].map(s => s.id)).toContain("yesStep");
  });

  it("[A] does NOT include yesStep in the top-level sequence", () => {
    const { nodes, edges } = makeSimpleRetryGraph();
    const tree = graphToTree(nodes, edges);

    const topLevelIds = tree.map(s => s.id);
    expect(topLevelIds).not.toContain("yesStep");
  });

  it("[A] does NOT misidentify retryPoint as a post-condition continuation", () => {
    const { nodes, edges } = makeSimpleRetryGraph();
    const tree = graphToTree(nodes, edges);

    // retryPoint is before the condition; it must not re-appear after it
    const topLevelIds = tree.map(s => s.id);
    const condIdx = topLevelIds.indexOf("cond");
    expect(condIdx).toBeGreaterThanOrEqual(0);
    // retryPoint is in the main sequence BEFORE cond
    expect(topLevelIds.indexOf("retryPoint")).toBeLessThan(condIdx);
    // retryPoint does not appear again after cond
    const afterCondIds = topLevelIds.slice(condIdx + 1);
    expect(afterCondIds).not.toContain("retryPoint");
  });

  // ── Variant B tests ──────────────────────────────────────────────────────────

  it("[B] places yesStep inside the condition yes-branch", () => {
    const { nodes, edges } = makeRetryWithContinuationGraph();
    const tree = graphToTree(nodes, edges);

    const condStep = findStep(tree, "cond");
    expect(condStep).toBeDefined();
    expect(condStep!.branches?.["yes"].map(s => s.id)).toContain("yesStep");
  });

  it("[B] does NOT include yesStep in the top-level sequence", () => {
    const { nodes, edges } = makeRetryWithContinuationGraph();
    const tree = graphToTree(nodes, edges);

    const topLevelIds = tree.map(s => s.id);
    expect(topLevelIds).not.toContain("yesStep");
  });

  it("[B] correctly identifies cont as the post-condition continuation", () => {
    const { nodes, edges } = makeRetryWithContinuationGraph();
    const tree = graphToTree(nodes, edges);

    const topLevelIds = tree.map(s => s.id);
    const condIdx = topLevelIds.indexOf("cond");
    expect(condIdx).toBeGreaterThanOrEqual(0);
    // cont comes after cond at the top level
    expect(topLevelIds.indexOf("cont")).toBeGreaterThan(condIdx);
    // retryPoint comes BEFORE cond in the main sequence
    expect(topLevelIds.indexOf("retryPoint")).toBeLessThan(condIdx);
  });

  it("[B] does NOT misidentify retryPoint as the post-condition continuation", () => {
    const { nodes, edges } = makeRetryWithContinuationGraph();
    const tree = graphToTree(nodes, edges);

    const topLevelIds = tree.map(s => s.id);
    const condIdx = topLevelIds.indexOf("cond");
    // retryPoint must not re-appear after the condition
    expect(topLevelIds.slice(condIdx + 1)).not.toContain("retryPoint");
  });

  // ── Round-trip tests (Fix 1: extra edges preserved across treeToGraph) ───────

  /**
   * Simulate the non-tree-edge preservation logic in FlowCanvas handleDrop /
   * handleDropIntoBranch.
   *
   * Step 1: identify non-tree edges by diffing `originalEdges` against the
   *         canonical edges that treeToGraph(currentTree) would produce.
   * Step 2: carry only those non-tree edges into the new graph (n, e),
   *         filtering to endpoints that still exist and triples not already present.
   */
  function preserveExtraEdges(
    originalEdges: StoredEdge[],
    currentTree: FlowStep[],
    n: StoredNode[],
    e: StoredEdge[],
  ): StoredEdge[] {
    // Step 1: non-tree edges = original - canonical(currentTree)
    const { edges: canonical } = treeToGraph(currentTree);
    const canonicalKeys = new Set(
      canonical.map(ed => `${ed.source}|${ed.target}|${ed.sourceHandle ?? ""}`)
    );
    const nonTree = originalEdges.filter(
      ed => !canonicalKeys.has(`${ed.source}|${ed.target}|${ed.sourceHandle ?? ""}`)
    );

    // Step 2: apply surviving non-tree edges to the new graph
    const newNodeIds = new Set(n.map(nd => nd.id));
    const newEdgeKeys = new Set(e.map(ed => `${ed.source}|${ed.target}|${ed.sourceHandle ?? ""}`));
    const extra = nonTree.filter(
      ed => newNodeIds.has(ed.source) &&
            newNodeIds.has(ed.target) &&
            !newEdgeKeys.has(`${ed.source}|${ed.target}|${ed.sourceHandle ?? ""}`)
    );
    return extra.length > 0 ? [...e, ...extra] : e;
  }

  it("[A] preserves the retry back-edge after treeToGraph round-trip", () => {
    const { nodes, edges } = makeSimpleRetryGraph();
    const tree = graphToTree(nodes, edges);

    const { nodes: n, edges: e } = treeToGraph(tree);
    const merged = preserveExtraEdges(edges, tree, n, e);

    const backEdge = merged.find(ed => ed.source === "yesStep" && ed.target === "retryPoint");
    expect(backEdge).toBeDefined();
  });

  it("[A] graphToTree still correct after treeToGraph + back-edge preservation", () => {
    const { nodes, edges } = makeSimpleRetryGraph();
    const tree = graphToTree(nodes, edges);

    const { nodes: n, edges: e } = treeToGraph(tree);
    const merged = preserveExtraEdges(edges, tree, n, e);
    const tree2 = graphToTree(n, merged);

    const condStep2 = findStep(tree2, "cond");
    expect(condStep2).toBeDefined();
    expect(condStep2!.branches?.["yes"].map(s => s.id)).toContain("yesStep");
    expect(tree2.map(s => s.id)).not.toContain("yesStep");
  });

  it("[B] preserves the retry back-edge after treeToGraph round-trip", () => {
    const { nodes, edges } = makeRetryWithContinuationGraph();
    const tree = graphToTree(nodes, edges);

    const { nodes: n, edges: e } = treeToGraph(tree);
    const merged = preserveExtraEdges(edges, tree, n, e);

    const backEdge = merged.find(ed => ed.source === "yesStep" && ed.target === "retryPoint");
    expect(backEdge).toBeDefined();
  });

  it("[B] graphToTree still correct after treeToGraph + back-edge preservation", () => {
    const { nodes, edges } = makeRetryWithContinuationGraph();
    const tree = graphToTree(nodes, edges);

    const { nodes: n, edges: e } = treeToGraph(tree);
    const merged = preserveExtraEdges(edges, tree, n, e);
    const tree2 = graphToTree(n, merged);

    const condStep2 = findStep(tree2, "cond");
    expect(condStep2).toBeDefined();
    expect(condStep2!.branches?.["yes"].map(s => s.id)).toContain("yesStep");

    const topLevelIds = tree2.map(s => s.id);
    expect(topLevelIds).not.toContain("yesStep");
    expect(topLevelIds.indexOf("cont")).toBeGreaterThan(topLevelIds.indexOf("cond"));
    expect(topLevelIds.slice(topLevelIds.indexOf("cond") + 1)).not.toContain("retryPoint");
  });
});
