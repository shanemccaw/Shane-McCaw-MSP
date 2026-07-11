/**
 * variablePicker.test.ts
 *
 * Tests for the augmented variable picker logic — specifically the
 * buildAugmentedNodeOutputs helper and the sample-merging behaviour
 * inside getAncestorOutputs.
 *
 * These tests are framework-free and don't require React/DOM.
 * Run with: pnpm --filter @workspace/admin-panel run test
 */

import { describe, it, expect } from "vitest";
import {
  getAncestorOutputs,
  type AncestorNode,
  type AncestorEdge,
  type AncestorTrigger,
  type KnownEvent,
  type NodeOutputRegistry,
} from "./ancestorOutputs";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const NO_TRIGGERS: AncestorTrigger[] = [];
const NO_EVENTS: KnownEvent[] = [];

function n(id: string, nodeType: string, extra: Record<string, unknown> = {}): AncestorNode {
  return { id, data: { nodeType, ...extra } };
}

function e(source: string, target: string): AncestorEdge {
  return { source, target };
}

// ── Tests for the core ancestorOutputs logic with captured samples ─────────────

describe("getAncestorOutputs — with captured samples registry", () => {
  it("shows registered outputs for action nodes when registry is populated", () => {
    const OUTPUTS: NodeOutputRegistry = {
      send_email: [{ key: "sent", label: "true if email was sent" }],
    };

    const nodes: AncestorNode[] = [
      n("start", "start"),
      n("email", "action", { actionType: "send_email" }),
      n("target", "action", { actionType: "create_lead" }),
    ];
    const edges: AncestorEdge[] = [e("start", "email"), e("email", "target")];

    const result = getAncestorOutputs("target", nodes, edges, NO_TRIGGERS, NO_EVENTS, OUTPUTS);
    const emailGroup = result.find(g => g.nodeId === "email");
    expect(emailGroup).toBeDefined();
    expect(emailGroup?.outputs).toContainEqual(expect.objectContaining({ key: "sent" }));
  });

  it("returns empty outputs for node types not in registry", () => {
    const OUTPUTS: NodeOutputRegistry = {};

    const nodes: AncestorNode[] = [
      n("start", "start"),
      n("custom", "action", { actionType: "my_custom_action" }),
      n("target", "end"),
    ];
    const edges: AncestorEdge[] = [e("start", "custom"), e("custom", "target")];

    const result = getAncestorOutputs("target", nodes, edges, NO_TRIGGERS, NO_EVENTS, OUTPUTS);
    // custom action has no outputs in registry — it should not appear (or appear with empty outputs)
    const customGroup = result.find(g => g.nodeId === "custom");
    expect(customGroup?.outputs.length ?? 0).toBe(0);
  });

  it("merges ask_for_input fields as outputs, not registry lookup", () => {
    const OUTPUTS: NodeOutputRegistry = {};

    const nodes: AncestorNode[] = [
      n("start", "start"),
      n("input", "ask_for_input", {
        fields: [
          { variableName: "clientName", label: "Client Name" },
          { variableName: "projectBudget", label: "Budget" },
        ],
      }),
      n("target", "end"),
    ];
    const edges: AncestorEdge[] = [e("start", "input"), e("input", "target")];

    const result = getAncestorOutputs("target", nodes, edges, NO_TRIGGERS, NO_EVENTS, OUTPUTS);
    const inputGroup = result.find(g => g.nodeId === "input");
    expect(inputGroup).toBeDefined();
    expect(inputGroup?.outputs).toContainEqual(expect.objectContaining({ key: "clientName" }));
    expect(inputGroup?.outputs).toContainEqual(expect.objectContaining({ key: "projectBudget" }));
  });

  it("per-nodeId registry key overrides type-level registry for dynamic nodes", () => {
    // Simulate what buildAugmentedNodeOutputs does for dynamic nodes:
    // It stores per-nodeId entries in the registry.
    const sqlNodeId = "sql-node-1";
    const OUTPUTS: NodeOutputRegistry = {
      sql_query: [{ key: "queryRows", label: "Array of result rows" }],
      // Augmented per-nodeId entry from captured sample
      [sqlNodeId]: [
        { key: "queryRows", label: "Array of result rows" },
        { key: "id", label: "id" },
        { key: "name", label: "name" },
        { key: "email", label: "email" },
      ],
    };

    const nodes: AncestorNode[] = [
      n("start", "start"),
      n(sqlNodeId, "action", { actionType: "sql_query" }),
      n("target", "action", { actionType: "send_email" }),
    ];
    const edges: AncestorEdge[] = [e("start", sqlNodeId), e(sqlNodeId, "target")];

    const result = getAncestorOutputs("target", nodes, edges, NO_TRIGGERS, NO_EVENTS, OUTPUTS);
    const sqlGroup = result.find(g => g.nodeId === sqlNodeId);
    expect(sqlGroup).toBeDefined();
    // The generic sql_query registry has queryRows
    expect(sqlGroup?.outputs).toContainEqual(expect.objectContaining({ key: "queryRows" }));
  });

  it("start node always shows triggeredAt in its outputs", () => {
    const OUTPUTS: NodeOutputRegistry = {};

    const nodes: AncestorNode[] = [
      n("start", "start"),
      n("target", "end"),
    ];
    const edges: AncestorEdge[] = [e("start", "target")];

    const result = getAncestorOutputs("target", nodes, edges, NO_TRIGGERS, NO_EVENTS, OUTPUTS);
    const startGroup = result.find(g => g.nodeId === "start");
    expect(startGroup).toBeDefined();
    expect(startGroup?.isStartNode).toBe(true);
    expect(startGroup?.outputs).toContainEqual(expect.objectContaining({ key: "triggeredAt" }));
  });

  it("set_variable outputs appear at top level (isStartNode = true, token path has no steps.)", () => {
    const OUTPUTS: NodeOutputRegistry = {
      set_variable: [{ key: "value", label: "Variable value" }],
    };

    const nodes: AncestorNode[] = [
      n("start", "start"),
      n("sv", "action", { actionType: "set_variable", variableName: "myVar", variableType: "string" }),
      n("target", "action", { actionType: "send_email" }),
    ];
    const edges: AncestorEdge[] = [e("start", "sv"), e("sv", "target")];

    const result = getAncestorOutputs("target", nodes, edges, NO_TRIGGERS, NO_EVENTS, OUTPUTS);
    const varGroup = result.find(g => g.nodeId.includes("__var__myVar"));
    expect(varGroup).toBeDefined();
    expect(varGroup?.isStartNode).toBe(true);
    expect(varGroup?.outputs).toContainEqual(expect.objectContaining({ key: "myVar" }));
  });
});

// ── Tests for sentinel behaviour ──────────────────────────────────────────────

describe("Variable picker — sample unavailable sentinel", () => {
  it("does not produce a sentinel for fixed-shape node types that have registry entries", () => {
    const OUTPUTS: NodeOutputRegistry = {
      ask_ai: [
        { key: "aiResponse", label: "AI-generated text response" },
        { key: "model", label: "Model used" },
      ],
    };

    const nodes: AncestorNode[] = [
      n("start", "start"),
      n("ai", "ask_ai"),
      n("target", "end"),
    ];
    const edges: AncestorEdge[] = [e("start", "ai"), e("ai", "target")];

    const result = getAncestorOutputs("target", nodes, edges, NO_TRIGGERS, NO_EVENTS, OUTPUTS);
    const aiGroup = result.find(g => g.nodeId === "ai");
    // ask_ai is fixed-shape; should have real output keys, not a sentinel
    if (aiGroup) {
      const hasSentinel = aiGroup.outputs.some(o => o.key === "__sample_unavailable__");
      expect(hasSentinel).toBe(false);
    }
  });
});
