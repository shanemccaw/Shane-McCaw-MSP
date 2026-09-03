import { describe, expect, it } from "vitest";
import {
  buildSopWorkflowGraph,
  extractPlaceholders,
  parseGraphEndpointShape,
  parseLooseObjectBody,
  sopStepNodeId,
  toInterpTemplate,
} from "./sop-workflow-graph";
import type { StoredSopStep } from "./portal-sops";

describe("parseGraphEndpointShape", () => {
  it("parses a bare write endpoint with no body", () => {
    expect(parseGraphEndpointShape("POST /v1.0/users/{upn}/revokeSignInSessions")).toEqual({
      method: "POST",
      path: "/v1.0/users/{upn}/revokeSignInSessions",
      rawBody: null,
    });
  });

  it("parses a write endpoint with a trailing loose-object body", () => {
    expect(parseGraphEndpointShape("PATCH /v1.0/users/{id} { accountEnabled: false }")).toEqual({
      method: "PATCH",
      path: "/v1.0/users/{id}",
      rawBody: "{ accountEnabled: false }",
    });
  });

  it("uppercases the method", () => {
    expect(parseGraphEndpointShape("post /v1.0/x")?.method).toBe("POST");
  });

  it("returns null for a GET whose query string contains a bare space", () => {
    expect(parseGraphEndpointShape("GET /v1.0/auditLogs/signIns?$filter=clientAppUsed eq 'IMAP4'")).toBeNull();
  });
});

describe("parseLooseObjectBody", () => {
  it("parses a boolean value", () => {
    expect(parseLooseObjectBody("{ accountEnabled: false }")).toEqual({ accountEnabled: false });
  });

  it("parses a single-quoted string value", () => {
    expect(parseLooseObjectBody("{ destinationId: 'deleteditems' }")).toEqual({ destinationId: "deleteditems" });
  });

  it("parses a bare identifier as a string", () => {
    expect(parseLooseObjectBody("{ state: enabled }")).toEqual({ state: "enabled" });
  });

  it("parses an empty object", () => {
    expect(parseLooseObjectBody("{}")).toEqual({});
  });

  it("parses multiple keys", () => {
    expect(parseLooseObjectBody("{ a: 1, b: 'x', c: true }")).toEqual({ a: 1, b: "x", c: true });
  });

  it("returns null for something it can't confidently read", () => {
    expect(parseLooseObjectBody("{ a: [1,2] }")).toBeNull();
  });
});

describe("extractPlaceholders / toInterpTemplate", () => {
  it("extracts single-brace placeholders in order, deduped", () => {
    expect(extractPlaceholders("/v1.0/users/{id}/messages/{messageId}/move")).toEqual(["id", "messageId"]);
    expect(extractPlaceholders("/v1.0/users/{id}/{id}")).toEqual(["id"]);
  });

  it("rewrites single-brace to the engine's double-brace interp() syntax", () => {
    expect(toInterpTemplate("/v1.0/users/{id}/messages/{messageId}/move")).toBe(
      "/v1.0/users/{{id}}/messages/{{messageId}}/move",
    );
  });

  it("finds nothing in a plain path", () => {
    expect(extractPlaceholders("/v1.0/security/tiIndicators")).toEqual([]);
  });
});

const step = (overrides: Partial<StoredSopStep> & { stepNumber: number }): StoredSopStep => ({
  title: `Step ${overrides.stepNumber}`,
  ...overrides,
});

describe("buildSopWorkflowGraph", () => {
  it("materializes only write-verb steps, in a linear start->...->end chain", () => {
    // The real IAM-01 shape: 3 automated writes, then 2 manual steps.
    const steps: StoredSopStep[] = [
      step({ stepNumber: 1, title: "Revoke all sign-in sessions", type: "automated", graphEndpoint: "POST /v1.0/users/{id}/revokeSignInSessions" }),
      step({ stepNumber: 2, title: "Disable the account", type: "automated", graphEndpoint: "PATCH /v1.0/users/{id} { accountEnabled: false }" }),
      step({ stepNumber: 3, title: "Remove assigned licences", type: "automated", graphEndpoint: "POST /v1.0/users/{id}/assignLicense" }),
      step({ stepNumber: 4, title: "Convert mailbox to shared", type: "manual" }),
      step({ stepNumber: 5, title: "Collect and wipe devices", type: "manual" }),
    ];

    const { graph, materialized, requiredVariables } = buildSopWorkflowGraph(steps);

    expect(materialized).toEqual([
      { nodeId: sopStepNodeId(1), stepIndex: 0, stepNumber: 1, label: "Revoke all sign-in sessions", kind: "write" },
      { nodeId: sopStepNodeId(2), stepIndex: 1, stepNumber: 2, label: "Disable the account", kind: "write" },
      { nodeId: sopStepNodeId(3), stepIndex: 2, stepNumber: 3, label: "Remove assigned licences", kind: "write" },
    ]);
    expect(requiredVariables).toEqual(["id"]);

    // start -> step1 -> step2 -> step3 -> end : 5 nodes, 4 edges.
    expect(graph.nodes.map((n) => n.id)).toEqual(["start", "sop-step-1", "sop-step-2", "sop-step-3", "end"]);
    expect(graph.edges).toHaveLength(4);

    const writeNodes = graph.nodes.filter((n) => n.type === "graph_write_operation");
    expect(writeNodes).toHaveLength(3);
    for (const n of writeNodes) {
      expect(n.data.customerId).toBe("{{customerId}}");
    }
    expect(graph.nodes.find((n) => n.id === "sop-step-2")?.data).toMatchObject({
      endpoint: "/v1.0/users/{{id}}",
      method: "PATCH",
      body: { accountEnabled: false },
    });

    // Every edge leaving a graph_write_operation node carries the "success"
    // handle — the switchChosenHandle contract graph_write_operation requires.
    const stepEdges = graph.edges.filter((e) => e.source.startsWith("sop-step-"));
    for (const e of stepEdges) expect(e.sourceHandle).toBe("success");
  });

  it("materializes a GET step as a graph_read_operation node (#1939)", () => {
    const steps: StoredSopStep[] = [
      step({ stepNumber: 1, graphEndpoint: "GET /v1.0/auditLogs/signIns?$filter=clientAppUsed eq 'IMAP4'" }),
      step({ stepNumber: 2, graphEndpoint: "POST /v1.0/identity/conditionalAccess/policies" }),
    ];
    const { materialized, graph } = buildSopWorkflowGraph(steps);
    expect(materialized).toEqual([
      { nodeId: sopStepNodeId(1), stepIndex: 0, stepNumber: 1, label: "Step 1", kind: "read" },
      { nodeId: sopStepNodeId(2), stepIndex: 1, stepNumber: 2, label: "Step 2", kind: "write" },
    ]);

    const readNode = graph.nodes.find((n) => n.id === sopStepNodeId(1));
    expect(readNode?.type).toBe("graph_read_operation");
    expect(readNode?.data).toMatchObject({
      endpoint: "/v1.0/auditLogs/signIns?$filter=clientAppUsed eq 'IMAP4'",
      customerId: "{{customerId}}",
    });
    // No trailing {body} field on a read node — a GET never has one.
    expect(readNode?.data).not.toHaveProperty("body");
    expect(readNode?.data).not.toHaveProperty("method");

    // Both step nodes' outgoing edges carry the "success" handle.
    const stepEdges = graph.edges.filter((e) => e.source.startsWith("sop-step-"));
    for (const e of stepEdges) expect(e.sourceHandle).toBe("success");
  });

  it("leaves a bare 'GET' with nothing after it unmaterialized", () => {
    const steps: StoredSopStep[] = [step({ stepNumber: 1, graphEndpoint: "GET" })];
    const { materialized } = buildSopWorkflowGraph(steps);
    expect(materialized).toEqual([]);
  });

  it("leaves a step with no graphEndpoint unmaterialized", () => {
    const steps: StoredSopStep[] = [step({ stepNumber: 1, type: "manual" })];
    const { materialized, graph } = buildSopWorkflowGraph(steps);
    expect(materialized).toEqual([]);
    expect(graph.nodes.map((n) => n.id)).toEqual(["start", "end"]);
  });

  it("leaves a step whose body it can't safely parse unmaterialized rather than guessing", () => {
    const steps: StoredSopStep[] = [step({ stepNumber: 1, graphEndpoint: "POST /v1.0/x { arr: [1,2] }" })];
    const { materialized } = buildSopWorkflowGraph(steps);
    expect(materialized).toEqual([]);
  });

  it("collects placeholders across multiple materialized steps in first-appearance order", () => {
    const steps: StoredSopStep[] = [
      step({ stepNumber: 1, graphEndpoint: "POST /v1.0/users/{id}/revokeSignInSessions" }),
      step({ stepNumber: 2, graphEndpoint: "POST /v1.0/users/{id}/messages/{messageId}/move { destinationId: 'deleteditems' }" }),
    ];
    const { requiredVariables } = buildSopWorkflowGraph(steps);
    expect(requiredVariables).toEqual(["id", "messageId"]);
  });

  it("returns an empty-but-valid graph for zero steps", () => {
    const { graph, materialized, requiredVariables } = buildSopWorkflowGraph([]);
    expect(materialized).toEqual([]);
    expect(requiredVariables).toEqual([]);
    expect(graph.nodes.map((n) => n.id)).toEqual(["start", "end"]);
    expect(graph.edges).toHaveLength(1);
  });
});
