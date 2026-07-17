/**
 * msp-reports.test.ts
 *
 * Tests for the MSP Report Generation workflow path.
 *
 * Coverage:
 *   1. handleGenerateReport — success path: pre-created runId, generates PDF, marks "delivered"
 *   2. handleGenerateReport — failure path: AI error → marks run "failed" + re-throws
 *   3. handleGenerateReport — early failure: missing definition with pre-created run marks run "failed"
 *   4. executeRun failure path — when generate_report exhausts retries the engine writes a real
 *      DLQ entry (mspDlqStoreTable) AND a real operator task (portalWfOperatorTasksTable)
 *   5. REPORT_GENERATION_GRAPH — graph invariants
 *   6. REPORT_GENERATION_WORKFLOW_KEY — constant value
 *
 * Strategy:
 *   - Mock all external I/O (DB, Anthropic, pdf-lib, Graph mail, ai-billing)
 *   - Test the generate_report node handler directly (exported for testing)
 *   - Test DLQ + operator task writes via a real executeRun() call with a deliberately
 *     failing registered handler and fully mocked DB — this verifies the ENGINE writes
 *     the artifacts, not just that the objects have the right shape.
 *
 * Run:
 *   pnpm --filter @workspace/api-server run test -- msp-reports
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// ── Mocks (hoisted before imports) ────────────────────────────────────────────

vi.mock("@workspace/db", () => {
  return {
    db: {
      select: vi.fn(),
      insert: vi.fn(),
      update: vi.fn(),
      execute: vi.fn(() => Promise.resolve({ rows: [] })),
    },
    mspReportDefinitionsTable: { definitionId: "definitionId", mspId: "mspId", docType: "docType", deliveryMethod: "deliveryMethod", deliveryEmail: "deliveryEmail", fieldMappings: "fieldMappings", description: "description", customerId: "customerId", isActive: "isActive" },
    mspReportRunsTable: { runId: "runId", definitionId: "definitionId", mspId: "mspId", customerId: "customerId", title: "title", docType: "docType", status: "status", errorMessage: "errorMessage", pdfBase64: "pdfBase64", pdfSizeBytes: "pdfSizeBytes", htmlContent: "htmlContent", generatedAt: "generatedAt", deliveredAt: "deliveredAt", deliveryEmail: "deliveryEmail", updatedAt: "updatedAt", triggeredByUserId: "triggeredByUserId" },
    mspCustomersTable: { id: "id", name: "name", domain: "domain", mspId: "mspId" },
    mspsTable: { id: "id", name: "name" },
    portalWfWorkflowsTable: { workflowKey: "workflowKey", isActive: "isActive", updatedAt: "updatedAt", label: "label", description: "description", graph: "graph", retryPolicy: "retryPolicy" },
    portalWfRunsTable: { runId: "runId", workflowKey: "workflowKey", status: "status", mspId: "mspId", customerId: "customerId", startedAt: "startedAt", completedAt: "completedAt", errorMessage: "errorMessage", tenantContext: "tenantContext", aiAdmitted: "aiAdmitted", inputPayload: "inputPayload", triggerEventId: "triggerEventId", triggerEventType: "triggerEventType", output: "output" },
    portalWfNodeOutputsTable: { runId: "runId", nodeId: "nodeId", nodeType: "nodeType", status: "status", attemptCount: "attemptCount", inputPayload: "inputPayload", outputPayload: "outputPayload", errorMessage: "errorMessage", errorStack: "errorStack", startedAt: "startedAt", completedAt: "completedAt" },
    portalWfIdempotencyTable: { sideEffectKey: "sideEffectKey", runId: "runId", nodeId: "nodeId", result: "result" },
    portalWfOperatorTasksTable: { runId: "runId", workflowKey: "workflowKey", nodeId: "nodeId", severity: "severity", title: "title", description: "description", deepLink: "deepLink", status: "status", mspId: "mspId", customerId: "customerId" },
    mspDlqStoreTable: { dlqId: "dlqId", eventType: "eventType", payload: "payload", errorMessage: "errorMessage", errorStack: "errorStack", attemptCount: "attemptCount", mspId: "mspId", customerId: "customerId", resolvedAt: "resolvedAt", sourceEventId: "sourceEventId" },
    mspEventStoreTable: {},
    pool: { query: vi.fn() },
    portalWfStartMappingsTable: { eventPattern: "eventPattern", workflowKey: "workflowKey", isActive: "isActive" },
    mspReportCanvasesTable: { id: "id", mspId: "mspId", name: "name", description: "description", canvasLayout: "canvasLayout", deliveryConfig: "deliveryConfig" },
    mspReportSchedulesTable: { id: "id", mspId: "mspId", canvasId: "canvasId", cadence: "cadence", recipientEmails: "recipientEmails", enabled: "enabled" },
  };
});

vi.mock("../lib/event-bus", () => ({
  dispatchEvent: vi.fn(() => Promise.resolve({ eventId: "evt-test" })),
  systemActor: vi.fn(() => ({ id: "system", role: "system", type: "system" })),
  addEventListener: vi.fn(),
}));

vi.mock("../lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../lib/graph", () => ({
  sendMailViaGraph: vi.fn(() => Promise.resolve()),
  getAccessToken: vi.fn(() => Promise.resolve("test-token")),
  graphCredentialsPresent: vi.fn(() => false),
}));

vi.mock("../lib/compileReportToHtml", () => ({
  compileReportToHtml: vi.fn(() => Promise.resolve("<html>Test Compiled HTML</html>")),
}));

vi.mock("@workspace/integrations-anthropic-ai", () => ({
  anthropic: {
    messages: {
      create: vi.fn(),
    },
  },
}));

vi.mock("../lib/ai-billing", () => ({
  checkAiAdmission: vi.fn(() => Promise.resolve({ admitted: true, balanceCents: 100_000 })),
  recordAiUsage: vi.fn(() => Promise.resolve()),
}));

vi.mock("../lib/node-type-registry", () => ({
  isAIDependent: vi.fn(() => false),
  getAiCostOwner: vi.fn(() => "msp"),
}));

// ── Shared test fixtures ──────────────────────────────────────────────────────

const MOCK_DEF = {
  definitionId: "def-uuid-001",
  mspId: 1,
  customerId: null,
  docType: "executive_summary",
  deliveryMethod: "in_app",
  deliveryEmail: null,
  fieldMappings: {},
  description: null,
  isActive: true,
  name: "Test Report",
};

const MOCK_RUN_ID = "report-run-uuid-001";
const MOCK_WF_RUN_ID = "wf-run-uuid-001";

// ── Helper: build a chainable DB select mock that resolves to `data` ──────────

function makeSelectChain(data: unknown[]) {
  const chain: Record<string, unknown> = {};
  chain["from"] = vi.fn(() => chain);
  chain["where"] = vi.fn(() => chain);
  chain["orderBy"] = vi.fn(() => chain);
  chain["limit"] = vi.fn(() => chain);
  chain["then"] = vi.fn((resolve: (v: unknown) => unknown) => resolve(data));
  return chain;
}

// ── Helper: build a chainable DB insert mock, capturing all `.values()` calls ─

function makeInsertChain(captureInto: unknown[]) {
  const chain: Record<string, unknown> = {};
  chain["values"] = vi.fn((v) => {
    captureInto.push(v as unknown);
    chain["_lastValues"] = v;
    return chain;
  });
  chain["returning"] = vi.fn(() => Promise.resolve([{ runId: MOCK_WF_RUN_ID, dlqId: "dlq-001", taskId: "task-001" }]));
  chain["onConflictDoUpdate"] = vi.fn(() => chain);
  chain["onConflictDoNothing"] = vi.fn(() => chain);
  chain["then"] = vi.fn((resolve: (v: unknown) => unknown) => resolve([]));
  return chain;
}

// ── handleGenerateReport — success path ───────────────────────────────────────

describe("handleGenerateReport — success path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns runId, title, status=delivered, pdfSizeBytes on success", async () => {
    const { db } = await import("@workspace/db");
    const { anthropic } = await import("@workspace/integrations-anthropic-ai");

    let selectCallCount = 0;
    vi.mocked(db.select).mockImplementation(() => {
      selectCallCount++;
      const data = selectCallCount === 1 ? [MOCK_DEF] : [];
      return makeSelectChain(data) as unknown as ReturnType<typeof db.select>;
    });

    const updateChain = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
    };
    vi.mocked(db.update).mockReturnValue(updateChain as unknown as ReturnType<typeof db.update>);

    vi.mocked(anthropic.messages.create).mockResolvedValue({
      id: "msg-001",
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: "<h1>Executive Summary</h1><p>M365 environment is healthy.</p>" }],
      model: "claude-haiku-4-5",
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 100, output_tokens: 200 },
    } as never);

    const { handleGenerateReport } = await import("../lib/report-nodes");

    const ctx = {
      runId: MOCK_WF_RUN_ID,
      nodeId: "generate",
      nodeType: "generate_report",
      config: { definitionId: MOCK_DEF.definitionId },
      input: { reportRunId: MOCK_RUN_ID, definitionId: MOCK_DEF.definitionId, triggeredByUserId: 1 },
      tenantContext: { mspId: 1, customerId: null },
      attemptNumber: 1,
    };

    const result = await handleGenerateReport(ctx);

    expect(result).toMatchObject({
      runId: MOCK_RUN_ID,
      status: "delivered",
      docType: "executive_summary",
    });
    expect(typeof result["pdfSizeBytes"]).toBe("number");
    expect((result["pdfSizeBytes"] as number)).toBeGreaterThan(0);
    expect(anthropic.messages.create).toHaveBeenCalledOnce();
  });

  it("does NOT INSERT a new run row when reportRunId is pre-supplied", async () => {
    const { db } = await import("@workspace/db");
    const { anthropic } = await import("@workspace/integrations-anthropic-ai");

    vi.mocked(db.select).mockImplementation(() =>
      makeSelectChain([MOCK_DEF]) as unknown as ReturnType<typeof db.select>,
    );

    const updateChain = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
    };
    vi.mocked(db.update).mockReturnValue(updateChain as unknown as ReturnType<typeof db.update>);

    vi.mocked(anthropic.messages.create).mockResolvedValue({
      id: "msg-002",
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: "<p>Report content here.</p>" }],
      model: "claude-haiku-4-5",
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 50, output_tokens: 100 },
    } as never);

    const { handleGenerateReport } = await import("../lib/report-nodes");

    const ctx = {
      runId: MOCK_WF_RUN_ID,
      nodeId: "generate",
      nodeType: "generate_report",
      config: { definitionId: MOCK_DEF.definitionId },
      input: { reportRunId: MOCK_RUN_ID, definitionId: MOCK_DEF.definitionId },
      tenantContext: { mspId: 1, customerId: null },
      attemptNumber: 1,
    };

    await handleGenerateReport(ctx);

    // No INSERT for the run row — the pre-created run already exists
    expect(vi.mocked(db.insert)).not.toHaveBeenCalled();
    // UPDATE should have been called to transition statuses
    expect(vi.mocked(db.update)).toHaveBeenCalled();
  });
});

// ── handleGenerateReport — failure path ───────────────────────────────────────

describe("handleGenerateReport — failure path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("marks run 'failed' with errorMessage and re-throws when Anthropic throws", async () => {
    const { db } = await import("@workspace/db");
    const { anthropic } = await import("@workspace/integrations-anthropic-ai");

    vi.mocked(db.select).mockImplementation(() =>
      makeSelectChain([MOCK_DEF]) as unknown as ReturnType<typeof db.select>,
    );

    const updateSets: Record<string, unknown>[] = [];
    vi.mocked(db.update).mockReturnValue({
      set: vi.fn((vals) => {
        updateSets.push(vals as Record<string, unknown>);
        return { where: vi.fn().mockResolvedValue([]) };
      }),
    } as unknown as ReturnType<typeof db.update>);

    vi.mocked(anthropic.messages.create).mockRejectedValue(
      new Error("Anthropic API error: invalid_request_error"),
    );

    const { handleGenerateReport } = await import("../lib/report-nodes");

    const ctx = {
      runId: MOCK_WF_RUN_ID,
      nodeId: "generate",
      nodeType: "generate_report",
      config: { definitionId: MOCK_DEF.definitionId },
      input: { reportRunId: MOCK_RUN_ID, definitionId: MOCK_DEF.definitionId },
      tenantContext: { mspId: 1, customerId: null },
      attemptNumber: 1,
    };

    // Re-throws so the engine can retry and route to DLQ + operator task
    await expect(handleGenerateReport(ctx)).rejects.toThrow("Anthropic API error");

    // The run must have been marked "failed" with the error message
    const failedUpdate = updateSets.find((s) => s["status"] === "failed");
    expect(failedUpdate).toBeDefined();
    expect(String(failedUpdate?.["errorMessage"])).toContain("Anthropic API error");
  });

  it("marks pre-created run 'failed' when definition is not found (error before try block in old code)", async () => {
    const { db } = await import("@workspace/db");

    // Definition lookup returns empty — simulates bad definitionId
    vi.mocked(db.select).mockImplementation(() =>
      makeSelectChain([]) as unknown as ReturnType<typeof db.select>,
    );

    const updateSets: Record<string, unknown>[] = [];
    vi.mocked(db.update).mockReturnValue({
      set: vi.fn((vals) => {
        updateSets.push(vals as Record<string, unknown>);
        return { where: vi.fn().mockResolvedValue([]) };
      }),
    } as unknown as ReturnType<typeof db.update>);

    const { handleGenerateReport } = await import("../lib/report-nodes");

    const ctx = {
      runId: MOCK_WF_RUN_ID,
      nodeId: "generate",
      nodeType: "generate_report",
      config: { definitionId: "nonexistent-def-uuid" },
      input: { reportRunId: MOCK_RUN_ID, definitionId: "nonexistent-def-uuid" },
      tenantContext: { mspId: 1, customerId: null },
      attemptNumber: 1,
    };

    // Should throw with a clear message
    await expect(handleGenerateReport(ctx)).rejects.toThrow(/definition.*not found/i);

    // The pre-created run MUST be marked "failed" even though the error happened
    // before the run row transition — because the outer try/catch now wraps everything.
    const failedUpdate = updateSets.find((s) => s["status"] === "failed");
    expect(failedUpdate).toBeDefined();
  });

  it("throws 'definitionId is required' when input has no definitionId", async () => {
    const { handleGenerateReport } = await import("../lib/report-nodes");

    const ctx = {
      runId: MOCK_WF_RUN_ID,
      nodeId: "generate",
      nodeType: "generate_report",
      config: {},
      input: {},
      tenantContext: { mspId: 1, customerId: null },
      attemptNumber: 1,
    };

    await expect(handleGenerateReport(ctx)).rejects.toThrow(/definitionId is required/);
  });
});

// ── executeRun failure path — DLQ + operator task writes ──────────────────────
//
// These tests call the real executeRun() with a mocked DB so we verify that the
// *engine's* DLQ + operator-task logic fires — not just that the payloads have
// the right shape.

describe("executeRun failure path — DLQ + operator task writes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("engine inserts an operator task when a generate_report node exhausts retries", async () => {
    const { db } = await import("@workspace/db");
    const { registerNodeHandler, executeRun } = await import("../lib/portal-workflow-engine");
    const { REPORT_GENERATION_WORKFLOW_KEY, REPORT_GENERATION_GRAPH } = await import("../lib/report-nodes");

    const WF_RUN_ID = "wf-run-failure-001";

    // Register a handler that always throws — simulates generate_report AI failure
    registerNodeHandler("generate_report", async () => {
      throw new Error("Simulated Anthropic timeout: read ECONNRESET");
    });

    const mockRun = {
      runId: WF_RUN_ID,
      workflowKey: REPORT_GENERATION_WORKFLOW_KEY,
      status: "pending",
      tenantContext: { mspId: 1, customerId: null },
      inputPayload: { reportRunId: "report-run-001", definitionId: "def-001" },
      aiAdmitted: null,
      triggerEventId: null,
      triggerEventType: "msp.report.trigger",
    };

    const mockWorkflow = {
      workflowKey: REPORT_GENERATION_WORKFLOW_KEY,
      isActive: true,
      graph: REPORT_GENERATION_GRAPH,
      // maxAttempts: 1 avoids sleeping between retries in tests
      retryPolicy: { maxAttempts: 1, backoffBaseSeconds: 0, backoffMultiplier: 1 },
    };

    const capturedInserts: unknown[] = [];
    let selectCallCount = 0;

    vi.mocked(db.select).mockImplementation(() => {
      selectCallCount++;
      // Call 1 → run row, call 2 → workflow row, subsequent → [] (idempotency checks)
      const data = selectCallCount === 1 ? [mockRun]
                 : selectCallCount === 2 ? [mockWorkflow]
                 : [];
      return makeSelectChain(data) as unknown as ReturnType<typeof db.select>;
    });

    vi.mocked(db.update).mockReturnValue({
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
    } as unknown as ReturnType<typeof db.update>);

    vi.mocked(db.insert).mockImplementation(
      () => makeInsertChain(capturedInserts) as unknown as ReturnType<typeof db.insert>,
    );

    await executeRun(WF_RUN_ID);

    // The engine MUST have inserted an operator task
    const operatorTask = capturedInserts.find(
      (v) =>
        (v as Record<string, unknown>)?.["workflowKey"] === REPORT_GENERATION_WORKFLOW_KEY &&
        (v as Record<string, unknown>)?.["severity"] === "error",
    );
    expect(operatorTask).toBeDefined();
    expect(operatorTask).toMatchObject({
      runId: WF_RUN_ID,
      workflowKey: REPORT_GENERATION_WORKFLOW_KEY,
      severity: "error",
      status: "open",
    });
    expect(String((operatorTask as Record<string, unknown>)?.["deepLink"])).toContain(WF_RUN_ID);
  });

  it("engine inserts a DLQ entry when a generate_report node exhausts retries", async () => {
    const { db } = await import("@workspace/db");
    const { registerNodeHandler, executeRun } = await import("../lib/portal-workflow-engine");
    const { REPORT_GENERATION_WORKFLOW_KEY, REPORT_GENERATION_GRAPH } = await import("../lib/report-nodes");

    const WF_RUN_ID = "wf-run-failure-002";

    registerNodeHandler("generate_report", async () => {
      throw new Error("Simulated PDF generation OOM");
    });

    const mockRun = {
      runId: WF_RUN_ID,
      workflowKey: REPORT_GENERATION_WORKFLOW_KEY,
      status: "pending",
      tenantContext: { mspId: 2, customerId: 99 },
      inputPayload: { reportRunId: "report-run-002", definitionId: "def-002" },
      aiAdmitted: null,
      triggerEventId: "evt-trigger-001",
      triggerEventType: "msp.report.trigger",
    };

    const mockWorkflow = {
      workflowKey: REPORT_GENERATION_WORKFLOW_KEY,
      isActive: true,
      graph: REPORT_GENERATION_GRAPH,
      retryPolicy: { maxAttempts: 1, backoffBaseSeconds: 0, backoffMultiplier: 1 },
    };

    const capturedInserts: unknown[] = [];
    let selectCallCount = 0;

    vi.mocked(db.select).mockImplementation(() => {
      selectCallCount++;
      const data = selectCallCount === 1 ? [mockRun]
                 : selectCallCount === 2 ? [mockWorkflow]
                 : [];
      return makeSelectChain(data) as unknown as ReturnType<typeof db.select>;
    });

    vi.mocked(db.update).mockReturnValue({
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
    } as unknown as ReturnType<typeof db.update>);

    vi.mocked(db.insert).mockImplementation(
      () => makeInsertChain(capturedInserts) as unknown as ReturnType<typeof db.insert>,
    );

    await executeRun(WF_RUN_ID);

    // The engine MUST have inserted a DLQ entry
    const dlqEntry = capturedInserts.find(
      (v) =>
        typeof (v as Record<string, unknown>)?.["eventType"] === "string" &&
        (v as Record<string, unknown>)?.["eventType"]?.toString().startsWith("portal_wf.run.failed:"),
    );
    expect(dlqEntry).toBeDefined();
    expect(dlqEntry).toMatchObject({
      eventType: `portal_wf.run.failed:${REPORT_GENERATION_WORKFLOW_KEY}`,
      mspId: 2,
      customerId: 99,
    });
    expect(String((dlqEntry as Record<string, unknown>)?.["errorMessage"])).toContain("Simulated PDF generation OOM");

    // The DLQ payload must include the runId and workflowKey
    const payload = (dlqEntry as Record<string, unknown>)?.["payload"] as Record<string, unknown>;
    expect(payload).toMatchObject({
      runId: WF_RUN_ID,
      workflowKey: REPORT_GENERATION_WORKFLOW_KEY,
    });
  });
});

// ── REPORT_GENERATION_GRAPH invariants ────────────────────────────────────────

import { REPORT_GENERATION_GRAPH, REPORT_GENERATION_WORKFLOW_KEY } from "../lib/report-nodes";

describe("REPORT_GENERATION_GRAPH", () => {
  it("has a start node", () => {
    const startNode = REPORT_GENERATION_GRAPH.nodes.find((n) => n.type === "start");
    expect(startNode).toBeDefined();
    expect(startNode?.id).toBe("start");
  });

  it("has a generate_report node", () => {
    const genNode = REPORT_GENERATION_GRAPH.nodes.find((n) => n.type === "generate_report");
    expect(genNode).toBeDefined();
    expect(genNode?.id).toBe("generate");
  });

  it("start node has no incoming edges", () => {
    const incomingToStart = REPORT_GENERATION_GRAPH.edges.filter((e) => e.to === "start");
    expect(incomingToStart).toHaveLength(0);
  });

  it("has no cycles (Kahn topological sort completes)", () => {
    const { nodes, edges } = REPORT_GENERATION_GRAPH;
    const inDegree = new Map<string, number>();
    const adjacency = new Map<string, string[]>();
    for (const n of nodes) { inDegree.set(n.id, 0); adjacency.set(n.id, []); }
    for (const e of edges) {
      inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1);
      adjacency.get(e.from)?.push(e.to);
    }
    const queue = [...inDegree.entries()].filter(([, d]) => d === 0).map(([id]) => id);
    const order: string[] = [];
    while (queue.length > 0) {
      const id = queue.shift()!;
      order.push(id);
      for (const next of adjacency.get(id) ?? []) {
        const deg = (inDegree.get(next) ?? 1) - 1;
        inDegree.set(next, deg);
        if (deg === 0) queue.push(next);
      }
    }
    expect(order).toHaveLength(nodes.length);
  });

  it("all edges reference node IDs that exist in the graph", () => {
    const nodeIds = new Set(REPORT_GENERATION_GRAPH.nodes.map((n) => n.id));
    for (const edge of REPORT_GENERATION_GRAPH.edges) {
      expect(nodeIds.has(edge.from)).toBe(true);
      expect(nodeIds.has(edge.to)).toBe(true);
    }
  });
});

// ── REPORT_GENERATION_WORKFLOW_KEY ────────────────────────────────────────────

describe("REPORT_GENERATION_WORKFLOW_KEY", () => {
  it("has the expected value", () => {
    expect(REPORT_GENERATION_WORKFLOW_KEY).toBe("msp.report.generation");
  });

  it("is a non-empty string", () => {
    expect(typeof REPORT_GENERATION_WORKFLOW_KEY).toBe("string");
    expect(REPORT_GENERATION_WORKFLOW_KEY.length).toBeGreaterThan(0);
  });
});

// ── GET/POST router endpoints tests ──────────────────────────────────────────
describe("POST /api/msp/reports/canvases/:id/send-test", () => {
  let app: any;
  const JWT_SECRET = "test-secret";
  process.env.JWT_SECRET = JWT_SECRET;
  process.env.GRAPH_MAIL_USER_ID = "sender@msp.com";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const makeToken = (overrides = {}) => {
    const jwt = require("jsonwebtoken");
    return jwt.sign(
      { id: 5, email: "op@msp.com", role: "client", mspRole: "MSPOperator", mspId: 1, ...overrides },
      JWT_SECRET,
      { expiresIn: "1h" }
    );
  };

  const getApp = async () => {
    const express = require("express");
    const mspReportsRouter = (await import("../routes/msp-reports")).default;
    const a = express();
    a.use(express.json());
    a.use("/api", mspReportsRouter);
    return a;
  };

  it("sends test email successfully when authorized and parameters are correct", async () => {
    const { db } = await import("@workspace/db");
    const { sendMailViaGraph } = await import("../lib/graph");
    const { compileReportToHtml } = await import("../lib/compileReportToHtml");

    const mockCanvas = {
      id: "canvas-uuid-001",
      mspId: 1,
      name: "Mock Canvas Report",
      canvasLayout: { layout: [], widgets: {} },
    };

    const mockCustomer = { id: 101, name: "Customer Org", mspId: 1, status: "active" };

    let selectCallCount = 0;
    vi.mocked(db.select).mockImplementation(() => {
      selectCallCount++;
      const data = selectCallCount === 1 ? [mockCanvas] : [mockCustomer];
      return makeSelectChain(data) as any;
    });

    vi.mocked(compileReportToHtml).mockResolvedValue("<html>Test Compiled HTML</html>");
    vi.mocked(sendMailViaGraph).mockResolvedValue(undefined);

    app = await getApp();

    const response = await request(app)
      .post("/api/msp/reports/canvases/canvas-uuid-001/send-test")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ recipientEmail: "recipient@customer.com", customerId: 101 });

    console.log("DEBUG SEND TEST RESPONSE:", response.status, response.body);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      recipient: "recipient@customer.com",
      customerId: 101,
    });
    expect(sendMailViaGraph).toHaveBeenCalledWith(expect.objectContaining({
      fromUserId: "sender@msp.com",
      to: "recipient@customer.com",
      subject: "Test Report: Mock Canvas Report",
      htmlBody: "<html>Test Compiled HTML</html>",
    }));
  });

  it("returns 404 if canvas does not exist", async () => {
    const { db } = await import("@workspace/db");
    vi.mocked(db.select).mockImplementation(() => makeSelectChain([]) as any);

    app = await getApp();

    const response = await request(app)
      .post("/api/msp/reports/canvases/non-existent/send-test")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ recipientEmail: "recipient@customer.com" });

    expect(response.status).toBe(404);
    expect(response.body.error).toContain("Canvas not found");
  });

  it("returns 400 if recipientEmail is not provided and not in JWT", async () => {
    const { db } = await import("@workspace/db");
    const mockCanvas = {
      id: "canvas-uuid-001",
      mspId: 1,
      name: "Mock Canvas Report",
      canvasLayout: {},
    };
    vi.mocked(db.select).mockImplementation(() => makeSelectChain([mockCanvas]) as any);

    app = await getApp();

    const response = await request(app)
      .post("/api/msp/reports/canvases/canvas-uuid-001/send-test")
      .set("Authorization", `Bearer ${makeToken({ email: null })}`)
      .send({ customerId: 101 });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("recipientEmail is required");
  });
});
