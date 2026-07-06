/**
 * ancestorOutputs.test.ts
 *
 * Unit tests for getAncestorOutputs — verifying that loop-scoped Set Variable
 * outputs are visible to ALL configured node types inside a foreach loop body,
 * including Condition and Switch-Case nodes.
 *
 * Run with: pnpm --filter @workspace/admin-panel run test
 */

import { describe, it, expect } from "vitest";
import {
  getAncestorOutputs,
  reachableForward,
  type AncestorNode,
  type AncestorEdge,
  type AncestorTrigger,
  type KnownEvent,
  type NodeOutputRegistry,
} from "./ancestorOutputs";

// ── Shared fixtures ───────────────────────────────────────────────────────────

const NO_TRIGGERS: AncestorTrigger[] = [];
const NO_EVENTS: KnownEvent[] = [];
const NO_OUTPUTS: NodeOutputRegistry = {};

function n(id: string, nodeType: string, extra: Record<string, unknown> = {}): AncestorNode {
  return { id, data: { nodeType, ...extra } };
}

function e(source: string, target: string, sourceHandle?: string): AncestorEdge {
  return { source, target, sourceHandle };
}

function setVar(id: string, varName: string, varType = "string"): AncestorNode {
  return n(id, "action", { actionType: "set_variable", variableName: varName, variableType: varType });
}

function updateVar(id: string, varName: string): AncestorNode {
  return n(id, "action", { actionType: "update_variable", variableName: varName });
}

// ── reachableForward ──────────────────────────────────────────────────────────

describe("reachableForward", () => {
  it("reaches all nodes from start via outgoing edges", () => {
    const edges: AncestorEdge[] = [e("a", "b"), e("b", "c"), e("c", "d")];
    const result = reachableForward(["a"], edges);
    expect(result).toContain("a");
    expect(result).toContain("b");
    expect(result).toContain("c");
    expect(result).toContain("d");
  });

  it("handles disconnected graph — only reachable nodes are included", () => {
    const edges: AncestorEdge[] = [e("a", "b")];
    const result = reachableForward(["a"], edges);
    expect(result.has("a")).toBe(true);
    expect(result.has("b")).toBe(true);
    expect(result.has("c")).toBe(false);
  });

  it("handles cycles without infinite loop", () => {
    const edges: AncestorEdge[] = [e("a", "b"), e("b", "a")];
    const result = reachableForward(["a"], edges);
    expect(result.size).toBe(2);
  });
});

// ── Action node inside foreach: baseline ─────────────────────────────────────

describe("getAncestorOutputs — Action node in foreach (baseline)", () => {
  it("injects sibling set_variable output for an Action node", () => {
    // foreach [body] → action [branch 1: sv, branch 2: configured action]
    const nodes: AncestorNode[] = [
      n("start",  "start"),
      n("fe",     "foreach"),
      n("action", "action", { actionType: "send_email" }),
      setVar("sv", "orderIndex"),
      n("target", "action", { actionType: "send_email" }), // configured
    ];
    const edges: AncestorEdge[] = [
      e("start",  "fe"),
      e("fe",     "action",  "body"),
      e("action", "sv"),
      e("action", "target"),
    ];

    const result = getAncestorOutputs("target", nodes, edges, NO_TRIGGERS, NO_EVENTS, NO_OUTPUTS);

    const injected = result.find(g => g.isStartNode && g.outputs.some(o => o.key === "orderIndex"));
    expect(injected).toBeTruthy();
    expect(injected!.outputs[0].key).toBe("orderIndex");
  });
});

// ── Condition node inside foreach ─────────────────────────────────────────────

describe("getAncestorOutputs — Condition node in foreach", () => {
  it("injects sibling set_variable output when configured node is Condition", () => {
    // Graph: foreach body → action → set_variable (sv)
    //                              ↘ condition (configured)
    const nodes: AncestorNode[] = [
      n("fe",     "foreach"),
      n("act",    "action", { actionType: "send_email" }),
      setVar("sv", "myVar"),
      n("cond",   "condition"),           // ← configured
    ];
    const edges: AncestorEdge[] = [
      e("fe",  "act",  "body"),
      e("act", "sv"),
      e("act", "cond"),
    ];

    const result = getAncestorOutputs("cond", nodes, edges, NO_TRIGGERS, NO_EVENTS, NO_OUTPUTS);

    const injected = result.find(g => g.isStartNode && g.outputs.some(o => o.key === "myVar"));
    expect(injected).toBeTruthy();
    expect(injected!.isStartNode).toBe(true);
    expect(injected!.outputs[0].key).toBe("myVar");
  });

  it("resolves {{myVar}} in mock payload (validator would show valid, not Unknown variable)", () => {
    const nodes: AncestorNode[] = [
      n("fe",   "foreach"),
      n("act",  "action", { actionType: "send_email" }),
      setVar("sv", "loopCount", "number"),
      n("cond", "condition"),
    ];
    const edges: AncestorEdge[] = [
      e("fe",  "act",  "body"),
      e("act", "sv"),
      e("act", "cond"),
    ];

    const result = getAncestorOutputs("cond", nodes, edges, NO_TRIGGERS, NO_EVENTS, NO_OUTPUTS);

    // Simulate buildMockPayload: isStartNode groups write to top-level payload
    const payload: Record<string, unknown> = {};
    for (const group of result) {
      if (group.isStartNode) {
        for (const o of group.outputs) payload[o.key] = `mock_${o.key}`;
      }
    }

    // {{loopCount}} must be resolvable (non-undefined)
    expect(payload["loopCount"]).toBeDefined();
    expect(payload["loopCount"]).not.toBe(undefined);
  });

  it("condition directly wired from foreach body handle sees sibling set_variable", () => {
    // foreach [body] → condition (configured)  AND  foreach [body] → set_variable
    const nodes: AncestorNode[] = [
      n("fe",   "foreach"),
      n("cond", "condition"),  // ← configured
      setVar("sv", "phase"),
    ];
    const edges: AncestorEdge[] = [
      e("fe", "cond", "body"),
      e("fe", "sv",   "body"),
    ];

    const result = getAncestorOutputs("cond", nodes, edges, NO_TRIGGERS, NO_EVENTS, NO_OUTPUTS);

    const injected = result.find(g => g.isStartNode && g.outputs.some(o => o.key === "phase"));
    expect(injected).toBeTruthy();
  });

  it("condition sees update_variable sibling as well as set_variable", () => {
    const nodes: AncestorNode[] = [
      n("fe",   "foreach"),
      n("act",  "action", { actionType: "send_email" }),
      updateVar("uv", "counter"),
      n("cond", "condition"),
    ];
    const edges: AncestorEdge[] = [
      e("fe",  "act",  "body"),
      e("act", "uv"),
      e("act", "cond"),
    ];

    const result = getAncestorOutputs("cond", nodes, edges, NO_TRIGGERS, NO_EVENTS, NO_OUTPUTS);

    const injected = result.find(g => g.isStartNode && g.outputs.some(o => o.key === "counter"));
    expect(injected).toBeTruthy();
  });

  it("does NOT inject set_variable from outside the foreach loop body", () => {
    // set_variable is BEFORE the foreach — it is a direct ancestor, not a loop sibling
    // It should appear via normal BFS traversal, not via loop injection
    const nodes: AncestorNode[] = [
      n("start", "start"),
      setVar("sv_outside", "outerVar"),
      n("fe",   "foreach"),
      n("cond", "condition"),
    ];
    const edges: AncestorEdge[] = [
      e("start",      "sv_outside"),
      e("sv_outside", "fe"),
      e("fe",         "cond", "body"),
    ];

    const result = getAncestorOutputs("cond", nodes, edges, NO_TRIGGERS, NO_EVENTS, NO_OUTPUTS);

    // outerVar should still be present (via direct ancestor traversal, not loop injection)
    const found = result.find(g => g.isStartNode && g.outputs.some(o => o.key === "outerVar"));
    expect(found).toBeTruthy();
  });
});

// ── Switch-Case node inside foreach ──────────────────────────────────────────

describe("getAncestorOutputs — Switch-Case node in foreach", () => {
  it("injects sibling set_variable output when configured node is Switch-Case", () => {
    const nodes: AncestorNode[] = [
      n("fe",  "foreach"),
      n("act", "action", { actionType: "send_email" }),
      setVar("sv", "status"),
      n("sw",  "switch_case"),            // ← configured
    ];
    const edges: AncestorEdge[] = [
      e("fe",  "act", "body"),
      e("act", "sv"),
      e("act", "sw"),
    ];

    const result = getAncestorOutputs("sw", nodes, edges, NO_TRIGGERS, NO_EVENTS, NO_OUTPUTS);

    const injected = result.find(g => g.isStartNode && g.outputs.some(o => o.key === "status"));
    expect(injected).toBeTruthy();
    expect(injected!.outputs[0].key).toBe("status");
  });

  it("switch-case mock payload has injected variable at top-level", () => {
    const nodes: AncestorNode[] = [
      n("fe",  "foreach"),
      n("act", "action", { actionType: "send_email" }),
      setVar("sv", "tier"),
      n("sw",  "switch_case"),
    ];
    const edges: AncestorEdge[] = [
      e("fe",  "act", "body"),
      e("act", "sv"),
      e("act", "sw"),
    ];

    const result = getAncestorOutputs("sw", nodes, edges, NO_TRIGGERS, NO_EVENTS, NO_OUTPUTS);

    const payload: Record<string, unknown> = {};
    for (const group of result) {
      if (group.isStartNode) {
        for (const o of group.outputs) payload[o.key] = `mock_${o.key}`;
      }
    }

    expect(payload["tier"]).toBeDefined();
  });
});

// ── Multiple variables in the same loop body ──────────────────────────────────

describe("getAncestorOutputs — multiple loop variables", () => {
  it("injects all sibling set_variable nodes in the same loop body", () => {
    const nodes: AncestorNode[] = [
      n("fe",   "foreach"),
      n("act",  "action", { actionType: "send_email" }),
      setVar("sv1", "varA"),
      setVar("sv2", "varB"),
      n("cond", "condition"),
    ];
    const edges: AncestorEdge[] = [
      e("fe",  "act",  "body"),
      e("act", "sv1"),
      e("act", "sv2"),
      e("act", "cond"),
    ];

    const result = getAncestorOutputs("cond", nodes, edges, NO_TRIGGERS, NO_EVENTS, NO_OUTPUTS);

    const injectedA = result.find(g => g.isStartNode && g.outputs.some(o => o.key === "varA"));
    const injectedB = result.find(g => g.isStartNode && g.outputs.some(o => o.key === "varB"));
    expect(injectedA).toBeTruthy();
    expect(injectedB).toBeTruthy();
  });

  it("does not inject the same variable twice (dedup guard)", () => {
    const nodes: AncestorNode[] = [
      n("fe",   "foreach"),
      setVar("sv", "deduped"),
      n("cond", "condition"),
    ];
    const edges: AncestorEdge[] = [
      e("fe",   "sv",   "body"),
      e("sv",   "cond"),
    ];

    const result = getAncestorOutputs("cond", nodes, edges, NO_TRIGGERS, NO_EVENTS, NO_OUTPUTS);

    const all = result.filter(g => g.isStartNode && g.outputs.some(o => o.key === "deduped"));
    // Should appear at most once
    expect(all.length).toBeLessThanOrEqual(1);
  });
});

// ── Nested foreach scope isolation ────────────────────────────────────────────

describe("getAncestorOutputs — nested foreach scope isolation", () => {
  /**
   * Graph layout:
   *
   *  outerFe [body] → outerAct → outerSv (set_variable "outerVar")
   *                            ↘ innerFe [body] → innerSv (set_variable "innerVar")
   *                                             ↘ innerTarget (the configured node inside inner loop)
   */
  function buildNestedGraph() {
    const nodes: AncestorNode[] = [
      n("outerFe",     "foreach"),
      n("outerAct",    "action", { actionType: "send_email" }),
      setVar("outerSv", "outerVar"),
      n("innerFe",     "foreach"),
      setVar("innerSv", "innerVar"),
      n("innerTarget", "action", { actionType: "send_email" }),
      n("outerTarget", "condition"),
    ];
    const edges: AncestorEdge[] = [
      e("outerFe",  "outerAct",    "body"),
      e("outerAct", "outerSv"),
      e("outerAct", "innerFe"),
      e("innerFe",  "innerSv",     "body"),
      e("innerFe",  "innerTarget", "body"),
      e("outerAct", "outerTarget"),
    ];
    return { nodes, edges };
  }

  it("inner-loop set_variable is NOT visible in the outer loop's picker", () => {
    const { nodes, edges } = buildNestedGraph();

    // outerTarget is a direct sibling in the outer body — should NOT see innerVar
    const result = getAncestorOutputs("outerTarget", nodes, edges, NO_TRIGGERS, NO_EVENTS, NO_OUTPUTS);

    const leaked = result.find(g => g.isStartNode && g.outputs.some(o => o.key === "innerVar"));
    expect(leaked).toBeUndefined();
  });

  it("outer-loop set_variable IS visible in the outer loop's picker", () => {
    const { nodes, edges } = buildNestedGraph();

    const result = getAncestorOutputs("outerTarget", nodes, edges, NO_TRIGGERS, NO_EVENTS, NO_OUTPUTS);

    const outerVar = result.find(g => g.isStartNode && g.outputs.some(o => o.key === "outerVar"));
    expect(outerVar).toBeTruthy();
  });

  it("inner-loop set_variable IS visible inside the inner loop", () => {
    const { nodes, edges } = buildNestedGraph();

    const result = getAncestorOutputs("innerTarget", nodes, edges, NO_TRIGGERS, NO_EVENTS, NO_OUTPUTS);

    const innerVar = result.find(g => g.isStartNode && g.outputs.some(o => o.key === "innerVar"));
    expect(innerVar).toBeTruthy();
  });

  it("outer-loop set_variable is also visible inside the inner loop (via ancestor BFS)", () => {
    const { nodes, edges } = buildNestedGraph();

    const result = getAncestorOutputs("innerTarget", nodes, edges, NO_TRIGGERS, NO_EVENTS, NO_OUTPUTS);

    const outerVar = result.find(g => g.isStartNode && g.outputs.some(o => o.key === "outerVar"));
    expect(outerVar).toBeTruthy();
  });
});

// ── Nodes NOT inside any foreach loop ────────────────────────────────────────

describe("getAncestorOutputs — no foreach ancestor", () => {
  it("returns empty array when there are no ancestors", () => {
    const nodes: AncestorNode[] = [n("cond", "condition")];
    const result = getAncestorOutputs("cond", nodes, [], NO_TRIGGERS, NO_EVENTS, NO_OUTPUTS);
    expect(result).toEqual([]);
  });

  it("returns direct set_variable ancestor without loop injection", () => {
    const nodes: AncestorNode[] = [
      setVar("sv", "plainVar"),
      n("cond", "condition"),
    ];
    const edges: AncestorEdge[] = [e("sv", "cond")];

    const result = getAncestorOutputs("cond", nodes, edges, NO_TRIGGERS, NO_EVENTS, NO_OUTPUTS);

    const found = result.find(g => g.isStartNode && g.outputs.some(o => o.key === "plainVar"));
    expect(found).toBeTruthy();
  });
});
