/**
 * workflow-executor-core.test.ts
 *
 * Unit tests for the core/computational workflow node types:
 *   set_variable, update_variable, compose, condition, switch_case,
 *   parallel, foreach (dry-run), cancel_workflow, comment,
 *   report_progress, ask_for_input, unknown node type
 *
 * Strategy:
 *   - DRY RUN (dryRun: true) for happy-path tests — avoids external-service mocks
 *   - LIVE path for nodes with no external deps (compose, set_variable, condition)
 *   - LIVE path validation failures for nodes that need them
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Shared mutable state ──────────────────────────────────────────────────────
const state = vi.hoisted(() => ({
  dbQueue: [] as unknown[][],
  updateQueue: [] as unknown[][],
  nodeOutputInserts: [] as Record<string, unknown>[],
  logInserts: [] as Record<string, unknown>[],
}));

// ── Mock @workspace/db ────────────────────────────────────────────────────────
vi.mock("@workspace/db", () => {
  function makeSelectChain(result: unknown[]): Record<string, unknown> {
    const chain: Record<string, unknown> = {
      from:      () => chain,
      where:     () => chain,
      limit:     () => chain,
      innerJoin: () => chain,
      leftJoin:  () => chain,
      orderBy:   () => chain,
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(result).then(resolve, reject),
      catch: () => Promise.resolve(result),
    };
    return chain;
  }

  function makeUpdateChain(): Record<string, unknown> {
    const whereChain = { returning: async () => state.updateQueue.shift() ?? [] };
    const chain: Record<string, unknown> = {
      set:   () => ({ where: () => whereChain }),
      where: async () => [],
    };
    return chain;
  }

  const db = {
    select: (_cols?: unknown) => makeSelectChain(state.dbQueue.shift() ?? []),
    insert: (_table?: unknown) => ({
      values: (vals?: unknown) => {
        if (vals && typeof vals === "object") {
          const v = vals as Record<string, unknown>;
          if ("output" in v) state.nodeOutputInserts.push(v);
          else if ("message" in v) state.logInserts.push(v);
        }
        return {
          returning: async () => [{ id: 99 }],
          catch:     async () => {},
        };
      },
    }),
    update: () => makeUpdateChain(),
  };

  const stub: Record<string, unknown> = {};
  const tableNames = [
    "wfRunsTable", "wfVersionsTable", "wfDefinitionsTable", "wfTriggersTable",
    "wfRunNodeOutputsTable", "wfRunNodeLogsTable",
    "leadsTable", "usersTable", "projectsTable", "opportunitiesTable",
    "clientDocumentsTable", "leadQualificationsTable", "quizLeadsTable",
    "clientHealthHistoryTable", "emailTemplatesTable", "marketingTasksTable",
    "kanbanTasksTable", "workflowTemplateStepTasksTable", "articlesTable", "notificationsTable",
    "campaignsTable", "landingPagesTable", "pendingApprovalsTable",
    "workflowStepsTable", "clientPresentationsTable", "deviceTokensTable",
    "insightsGeneratedDocumentsTable", "quickWinPresentationsTable",
    "campaignAssetsTable", "couponsTable",
    "mspSubscriptionsTable", "mspsTable", "mspEventStoreTable", "mspCustomersTable",
    "servicesTable",
  ];
  for (const name of tableNames) {
    stub[name] = {
      id: {}, definitionId: {}, status: {}, versionId: {}, branchPath: {},
      startedAt: {}, finishedAt: {}, errorMessage: {}, type: {}, enabled: {},
      config: {}, nextRunAt: {}, title: {}, createdAt: {}, role: {}, slug: {},
      token: {},
    };
  }

  return { db, pool: { query: async () => ({ rows: [], rowCount: 0 }) }, ...stub, eq: () => {}, and: () => {}, or: () => {}, count: () => {} };
});

// ── Mock logger ───────────────────────────────────────────────────────────────
vi.mock("./logger", () => {
  const n = () => {};
  const log = { info: n, warn: n, error: n, debug: n, fatal: n, trace: n, child: () => log };
  return { logger: log };
});

// ── Mock azure-automation ─────────────────────────────────────────────────────
vi.mock("./azure-automation", () => ({
  createRunbookJob:  async () => "fake-job-id",
  isAzureConfigured: () => false,
  getJobStatus:      async () => "Completed",
  getJobOutput:      async () => "",
  isTerminalStatus:  () => true,
}));

// ── Mock web-push ─────────────────────────────────────────────────────────────
vi.mock("./web-push", () => ({
  sendWebPushToAdmins: async () => {},
}));

// ── Mock sse-broadcast ────────────────────────────────────────────────────────
vi.mock("./sse-broadcast", () => ({
  broadcastAdminWorkflowEvent: () => {},
  broadcastAdminEvent:         () => {},
}));

// ── Mock anthropic ────────────────────────────────────────────────────────────
vi.mock("@workspace/integrations-anthropic-ai", () => ({
  anthropic: {
    messages: {
      create: vi.fn(async () => ({
        content: [{ type: "text", text: '{"topic":"test","rationale":"test"}' }],
      })),
      stream: vi.fn(() => ({
        finalMessage: async () => ({
          content: [{ type: "text", text: "generated content" }],
        }),
      })),
    },
  },
}));

// ── Mock OpenAI image generation ──────────────────────────────────────────────
vi.mock("@workspace/integrations-openai-ai-server/image", () => ({
  generateImage: async () => ({
    imageUrl: "https://example.com/image.png",
    revisedPrompt: "generated image",
  }),
}));

// ── Mock kanban-auto-fire ─────────────────────────────────────────────────────
vi.mock("./kanban-auto-fire", () => ({
  autoFireFirstBacklogScript: async () => {},
  autoFireDocumentCard:       async () => {},
  reconcileOrphanedRuns:      async () => {},
  reconcileStalledPhases:     async () => {},
}));

// ── Mock system-action-handlers dependencies ──────────────────────────────────
vi.mock("../routes/admin-insights", () => ({
  executeAutomation: async () => {},
  nextRunFromCron:   () => new Date(),
}));

vi.mock("./manual-script-escalation", () => ({
  checkManualScriptEscalations: async () => ({ alerted: 0, checked: 0, cardIds: [] }),
}));

// ── Mock mailer ───────────────────────────────────────────────────────────────
vi.mock("./mailer", () => ({
  sendEmail:    async () => {},
  brandedEmail: (html: string) => `<html>${html}</html>`,
}));

// ── Mock push ─────────────────────────────────────────────────────────────────
vi.mock("./push", () => ({
  sendPushNotifications: async () => {},
}));

// ── Mock ps-script-gen ────────────────────────────────────────────────────────
vi.mock("./ps-script-gen", () => ({
  generatePsScript:     async () => ({ scriptContent: "Write-Host 'hello'" }),
  generateScriptBundle: async () => ({ bundleId: "bundle-1" }),
}));

// ── Mock news-fetcher ─────────────────────────────────────────────────────────
vi.mock("./news-fetcher", () => ({
  fetchNewsHeadlines: async () => [],
}));

// ── Mock stripe ───────────────────────────────────────────────────────────────
vi.mock("./stripe", () => ({
  getStripeKey: () => "sk_test_fake",
}));

// ── Mock graph (Exchange / SharePoint) ────────────────────────────────────────
vi.mock("./graph", () => ({
  getAccessToken:          async () => "fake-graph-token",
  graphCredentialsPresent: () => false,
}));

// ── Mock fs/promises ──────────────────────────────────────────────────────────
vi.mock("fs/promises", () => {
  const fsMock = {
    writeFile: async () => {},
    mkdir:     async () => {},
    readFile:  async () => Buffer.from(""),
  };
  return { default: fsMock, ...fsMock };
});

// ── Import after all mocks ─────────────────────────────────────────────────────
import { executeWorkflowRun } from "./workflow-executor";
import { anthropic } from "@workspace/integrations-anthropic-ai";

// ── Helpers ───────────────────────────────────────────────────────────────────

function resetState() {
  state.dbQueue = [];
  state.updateQueue = [];
  state.nodeOutputInserts = [];
  state.logInserts = [];
}

function seedDb(graph: object, payload: Record<string, unknown> = {}, extraRows: unknown[][] = []) {
  const version = { id: 1, definitionId: 10, status: "published", label: "v1", graph };
  state.dbQueue = [
    [{ id: 1, versionId: 1, payload, status: "pending", triggerType: "manual", triggerRef: "manual", branchPath: [] }],
    [version],
    [{ status: "running" }], // cancellation check for first node
    ...extraRows,
  ];
}

function singleNodeGraph(type: string, data: Record<string, unknown>) {
  return {
    nodes: [{ id: "n1", type, position: { x: 0, y: 0 }, data: { nodeType: type, label: type, ...data } }],
    edges: [],
  };
}

function capturedOutput(): Record<string, unknown> {
  return (state.nodeOutputInserts[0]?.output ?? {}) as Record<string, unknown>;
}

function capturedStatus(): string {
  return state.nodeOutputInserts[0]?.status as string ?? "unknown";
}

// =============================================================================
// set_variable — live path
// =============================================================================

describe("set_variable — string value happy path (live)", () => {
  beforeEach(async () => {
    resetState();
    seedDb(singleNodeGraph("set_variable", {
      variableName: "greeting",
      variableType: "string",
      variableValue: "hello world",
    }));
    await executeWorkflowRun(1);
  });

  it("output.value is the resolved string", () => {
    expect(capturedOutput().value).toBe("hello world");
  });

  it("output exports the variable by name", () => {
    expect(capturedOutput().greeting).toBe("hello world");
  });

  it("node status is ok", () => {
    expect(capturedStatus()).toBe("ok");
  });
});

describe("set_variable — integer coercion (live)", () => {
  beforeEach(async () => {
    resetState();
    seedDb(singleNodeGraph("set_variable", {
      variableName: "count",
      variableType: "int",
      variableValue: "42",
    }));
    await executeWorkflowRun(1);
  });

  it("output.value is a number", () => {
    expect(capturedOutput().value).toBe(42);
  });

  it("node status is ok", () => {
    expect(capturedStatus()).toBe("ok");
  });
});

describe("set_variable — invalid int coercion fails (live)", () => {
  beforeEach(async () => {
    resetState();
    seedDb(singleNodeGraph("set_variable", {
      variableName: "count",
      variableType: "int",
      variableValue: "not-a-number",
    }));
    await executeWorkflowRun(1);
  });

  it("output.error describes the coercion failure", () => {
    expect(typeof capturedOutput().error).toBe("string");
    expect((capturedOutput().error as string).length).toBeGreaterThan(0);
  });

  it("node status is error", () => {
    expect(capturedStatus()).toBe("error");
  });
});

// =============================================================================
// update_variable — dry-run
// =============================================================================

describe("update_variable — dry-run happy path", () => {
  beforeEach(async () => {
    resetState();
    seedDb(singleNodeGraph("update_variable", {
      variableName: "myVar",
      variableType: "boolean",
      variableValue: "true",
    }));
    await executeWorkflowRun(1, { dryRun: true });
  });

  it("output.dryRun is true", () => {
    expect(capturedOutput().dryRun).toBe(true);
  });

  it("output.value is boolean placeholder", () => {
    expect(capturedOutput().value).toBe(false);
  });

  it("node status is ok", () => {
    expect(capturedStatus()).toBe("ok");
  });
});

// =============================================================================
// compose — string value (live)
// =============================================================================

describe("compose — plain string (live)", () => {
  beforeEach(async () => {
    resetState();
    seedDb(singleNodeGraph("compose", {
      inputs: "Hello {{name}}",
    }), { name: "Shane" });
    await executeWorkflowRun(1);
  });

  it("output.value interpolates the payload", () => {
    expect(capturedOutput().value).toBe("Hello Shane");
  });

  it("node status is ok", () => {
    expect(capturedStatus()).toBe("ok");
  });
});

describe("compose — parseAsJson valid JSON (live)", () => {
  beforeEach(async () => {
    resetState();
    seedDb(singleNodeGraph("compose", {
      inputs: '{"foo":"bar"}',
      parseAsJson: true,
    }));
    await executeWorkflowRun(1);
  });

  it("output.value is a parsed object", () => {
    expect(capturedOutput().value).toEqual({ foo: "bar" });
  });

  it("node status is ok", () => {
    expect(capturedStatus()).toBe("ok");
  });
});

describe("compose — parseAsJson invalid JSON returns parseError (live)", () => {
  beforeEach(async () => {
    resetState();
    seedDb(singleNodeGraph("compose", {
      inputs: "not-valid-json",
      parseAsJson: true,
    }));
    await executeWorkflowRun(1);
  });

  it("output.parseError is set", () => {
    expect(capturedOutput().parseError).toBe(true);
  });

  it("node status is ok (non-fatal parse failure)", () => {
    expect(capturedStatus()).toBe("ok");
  });
});

describe("compose — JSON Schema validation failure (live)", () => {
  beforeEach(async () => {
    resetState();
    seedDb(singleNodeGraph("compose", {
      inputs: '{"name":123}',
      parseAsJson: true,
      jsonSchema: '{"type":"object","properties":{"name":{"type":"string"}},"required":["name"]}',
    }));
    await executeWorkflowRun(1);
  });

  it("output.error mentions schema validation failure", () => {
    expect(capturedOutput().error).toMatch(/schema validation failed/i);
  });

  it("node status is error", () => {
    expect(capturedStatus()).toBe("error");
  });
});

// =============================================================================
// condition — live path
// =============================================================================

describe("condition — expression evaluates true (live)", () => {
  beforeEach(async () => {
    resetState();
    // evalCondition takes a full expression string: "{{lhs}} OP rhs"
    seedDb(singleNodeGraph("condition", {
      expression: "{{score}} > 50",
    }), { score: 80 });
    await executeWorkflowRun(1);
  });

  it("output.result is true", () => {
    expect(capturedOutput().result).toBe(true);
  });

  it("node status is ok", () => {
    expect(capturedStatus()).toBe("ok");
  });
});

describe("condition — expression evaluates false (live)", () => {
  beforeEach(async () => {
    resetState();
    seedDb(singleNodeGraph("condition", {
      expression: "{{score}} > 50",
    }), { score: 10 });
    await executeWorkflowRun(1);
  });

  it("output.result is false", () => {
    expect(capturedOutput().result).toBe(false);
  });

  it("node status is ok", () => {
    expect(capturedStatus()).toBe("ok");
  });
});

// =============================================================================
// switch_case — dry-run
// =============================================================================

describe("switch_case — dry-run happy path", () => {
  beforeEach(async () => {
    resetState();
    seedDb(singleNodeGraph("switch_case", {
      switchExpr: "{{tier}}",
      cases: [
        { id: "c1", matchValue: "gold", label: "Gold Tier" },
        { id: "c2", matchValue: "silver", label: "Silver Tier" },
      ],
    }), { tier: "gold" });
    await executeWorkflowRun(1, { dryRun: true });
  });

  it("output.dryRun is true", () => {
    expect(capturedOutput().dryRun).toBe(true);
  });

  it("output.chosenBranch is the first case label", () => {
    expect(capturedOutput().chosenBranch).toBe("Gold Tier");
  });
});

describe("switch_case — live: matched case id is returned", () => {
  beforeEach(async () => {
    resetState();
    seedDb(singleNodeGraph("switch_case", {
      switchExpr: "{{tier}}",
      cases: [
        { id: "c1", matchValue: "gold", label: "Gold Tier" },
        { id: "c2", matchValue: "silver", label: "Silver Tier" },
      ],
    }), { tier: "silver" });
    await executeWorkflowRun(1);
  });

  it("output.matchedCaseId is c2", () => {
    expect(capturedOutput().matchedCaseId).toBe("c2");
  });

  it("node status is ok", () => {
    expect(capturedStatus()).toBe("ok");
  });
});

// =============================================================================
// foreach — dry-run
// =============================================================================

describe("foreach — dry-run happy path", () => {
  beforeEach(async () => {
    resetState();
    seedDb(singleNodeGraph("foreach", {
      arrayPath: "items",
      itemAlias: "item",
    }), { items: [1, 2, 3] });
    await executeWorkflowRun(1, { dryRun: true });
  });

  it("output.dryRun is true", () => {
    expect(capturedOutput().dryRun).toBe(true);
  });

  it("output.foreachItems has two dry-run elements", () => {
    expect(Array.isArray(capturedOutput().foreachItems)).toBe(true);
    expect((capturedOutput().foreachItems as unknown[]).length).toBe(2);
  });

  it("node status is ok", () => {
    expect(capturedStatus()).toBe("ok");
  });
});

// =============================================================================
// parallel — dry-run
// =============================================================================

describe("parallel — dry-run happy path", () => {
  beforeEach(async () => {
    resetState();
    seedDb(singleNodeGraph("parallel", {
      branchCount: 3,
      branchLabels: ["Email", "SMS", "Push"],
    }));
    await executeWorkflowRun(1, { dryRun: true });
  });

  it("output.dryRun is true", () => {
    expect(capturedOutput().dryRun).toBe(true);
  });

  it("output has branch_1 through branch_3", () => {
    expect(capturedOutput().branch_1).toBeDefined();
    expect(capturedOutput().branch_2).toBeDefined();
    expect(capturedOutput().branch_3).toBeDefined();
  });

  it("node status is ok", () => {
    expect(capturedStatus()).toBe("ok");
  });
});

// =============================================================================
// comment — live path (no-op)
// =============================================================================

describe("comment — live path", () => {
  beforeEach(async () => {
    resetState();
    seedDb(singleNodeGraph("comment", { text: "This is just a comment node." }));
    await executeWorkflowRun(1);
  });

  it("output is an empty object", () => {
    expect(capturedOutput()).toEqual({});
  });

  it("node status is ok", () => {
    expect(capturedStatus()).toBe("ok");
  });
});

// =============================================================================
// report_progress — live path
// =============================================================================

describe("report_progress — live path", () => {
  beforeEach(async () => {
    resetState();
    seedDb(singleNodeGraph("report_progress", {
      message: "Processing {{count}} of {{total}}",
      step: "{{count}}",
      total: "{{total}}",
    }), { count: 3, total: 10 });
    await executeWorkflowRun(1);
  });

  it("output is an empty object", () => {
    expect(capturedOutput()).toEqual({});
  });

  it("node status is ok", () => {
    expect(capturedStatus()).toBe("ok");
  });
});

// =============================================================================
// ask_for_input — live path
// =============================================================================

describe("ask_for_input — live path with inputValues provided", () => {
  beforeEach(async () => {
    resetState();
    seedDb(singleNodeGraph("ask_for_input", {
      fields: [
        { variableName: "clientName", label: "Client Name", type: "string" },
        { variableName: "budget", label: "Budget", type: "number" },
      ],
    }));
    await executeWorkflowRun(1, { inputValues: { clientName: "Acme Corp", budget: "50000" } });
  });

  it("output.clientName is injected from inputValues", () => {
    expect(capturedOutput().clientName).toBe("Acme Corp");
  });

  it("output.budget is coerced to number", () => {
    expect(capturedOutput().budget).toBe(50000);
  });

  it("node status is ok", () => {
    expect(capturedStatus()).toBe("ok");
  });
});

describe("ask_for_input — missing inputValues yields null fields", () => {
  beforeEach(async () => {
    resetState();
    seedDb(singleNodeGraph("ask_for_input", {
      fields: [
        { variableName: "clientName", label: "Client Name", type: "string" },
      ],
    }));
    await executeWorkflowRun(1);
  });

  it("output.clientName is null when not provided", () => {
    expect(capturedOutput().clientName).toBeNull();
  });

  it("node status is ok", () => {
    expect(capturedStatus()).toBe("ok");
  });
});

// =============================================================================
// Unknown node type — live path
// =============================================================================

describe("unknown node type — live path", () => {
  beforeEach(async () => {
    resetState();
    seedDb(singleNodeGraph("totally_unknown_node_xyz", {}));
    await executeWorkflowRun(1);
  });

  it("output.error is true", () => {
    expect(capturedOutput().error).toBe(true);
  });

  it("output.reason mentions unknown node type", () => {
    expect((capturedOutput().reason as string)).toContain("unknown node type");
  });

  it("node status is error", () => {
    expect(capturedStatus()).toBe("error");
  });
});

// =============================================================================
// msp_dunning_advance — live path (no overdue subscriptions)
// =============================================================================

describe("msp_dunning_advance — live (no overdue subscriptions)", () => {
  beforeEach(async () => {
    resetState();
    seedDb(singleNodeGraph("msp_dunning_advance", {
      dayReminder: 3, daySuspend: 7, dayRevoke: 14, dayArchive: 30,
    }));
    await executeWorkflowRun(1);
  });

  it("output.checked is 0", () => {
    expect(capturedOutput().checked).toBe(0);
  });

  it("output.advanced is 0", () => {
    expect(capturedOutput().advanced).toBe(0);
  });

  it("node status is ok", () => {
    expect(capturedStatus()).toBe("ok");
  });
});

// =============================================================================
// msp_overage_meter — dry-run
// =============================================================================

describe("msp_overage_meter — dry-run skips execution", () => {
  beforeEach(async () => {
    resetState();
    seedDb(singleNodeGraph("msp_overage_meter", {}));
    await executeWorkflowRun(1, { dryRun: true });
  });

  it("output.dryRun is true", () => {
    expect(capturedOutput().dryRun).toBe(true);
  });

  it("output.subscriptionsChecked is 0", () => {
    expect(capturedOutput().subscriptionsChecked).toBe(0);
  });
});

// =============================================================================
// delay — dry-run (avoids actual sleep)
// =============================================================================

describe("delay — dry-run happy path", () => {
  beforeEach(async () => {
    resetState();
    seedDb(singleNodeGraph("delay", { durationMs: 5000 }));
    await executeWorkflowRun(1, { dryRun: true });
  });

  it("node output is captured", () => {
    expect(state.nodeOutputInserts.length).toBeGreaterThan(0);
  });

  it("node status is ok", () => {
    expect(capturedStatus()).toBe("ok");
  });
});

// =============================================================================
// check_script_output — live path (AI says passed)
// =============================================================================

describe("check_script_output — output accepted (no errors)", () => {
  beforeEach(async () => {
    vi.mocked(anthropic.messages.create).mockResolvedValueOnce({
      content: [{ type: "text", text: '{"passed":true,"outcome":"Script completed successfully with no errors."}' }],
    } as never);

    resetState();
    seedDb(singleNodeGraph("check_script_output", {
      scriptOutput: "Operation completed successfully. 5 users updated.",
      sensitivity: "balanced",
    }));
    await executeWorkflowRun(1);
  });

  it("output.passed is true", () => {
    expect(capturedOutput().passed).toBe(true);
  });

  it("output.outcome is the AI sentence", () => {
    expect(capturedOutput().outcome).toBe("Script completed successfully with no errors.");
  });

  it("node status is ok", () => {
    expect(capturedStatus()).toBe("ok");
  });
});

// =============================================================================
// check_script_output — live path (AI says failed)
// =============================================================================

describe("check_script_output — output rejected (many errors)", () => {
  beforeEach(async () => {
    vi.mocked(anthropic.messages.create).mockResolvedValueOnce({
      content: [{ type: "text", text: '{"passed":false,"outcome":"Script terminated with critical error: access denied."}' }],
    } as never);

    resetState();
    seedDb(singleNodeGraph("check_script_output", {
      scriptOutput: "ERROR: Access denied. Script aborted.",
      sensitivity: "strict",
    }));
    await executeWorkflowRun(1);
  });

  it("output.passed is false", () => {
    expect(capturedOutput().passed).toBe(false);
  });

  it("output.outcome describes the failure", () => {
    expect(capturedOutput().outcome).toContain("critical error");
  });

  it("node status is ok", () => {
    expect(capturedStatus()).toBe("ok");
  });
});

// =============================================================================
// check_script_output — empty output (lenient → passed)
// =============================================================================

describe("check_script_output — empty output (lenient sensitivity)", () => {
  beforeEach(async () => {
    vi.mocked(anthropic.messages.create).mockResolvedValueOnce({
      content: [{ type: "text", text: '{"passed":true,"outcome":"No output produced; no explicit errors detected."}' }],
    } as never);

    resetState();
    seedDb(singleNodeGraph("check_script_output", {
      scriptOutput: "",
      sensitivity: "lenient",
    }));
    await executeWorkflowRun(1);
  });

  it("output.passed is true", () => {
    expect(capturedOutput().passed).toBe(true);
  });

  it("node status is ok", () => {
    expect(capturedStatus()).toBe("ok");
  });
});

// =============================================================================
// check_script_output — dry-run
// =============================================================================

describe("check_script_output — dry-run", () => {
  beforeEach(async () => {
    resetState();
    seedDb(singleNodeGraph("check_script_output", {
      scriptOutput: "{{scriptOutput}}",
      sensitivity: "balanced",
    }));
    await executeWorkflowRun(1, { dryRun: true });
  });

  it("output.dryRun is true", () => {
    expect(capturedOutput().dryRun).toBe(true);
  });

  it("output.passed is true in dry run", () => {
    expect(capturedOutput().passed).toBe(true);
  });

  it("node status is ok", () => {
    expect(capturedStatus()).toBe("ok");
  });
});

// =============================================================================
// get_project_tasks — happy path (live)
// =============================================================================

describe("get_project_tasks — happy path (live)", () => {
  beforeEach(async () => {
    resetState();
    seedDb(
      singleNodeGraph("get_project_tasks", { projectId: "42" }),
      {},
      [
        // Query 1: kanban_tasks left-joined to workflow_steps
        [
          {
            taskId: 1, title: "Write docs", column: "backlog", priority: "medium",
            assignedTo: null, dueDate: null, groupName: null, taskType: null,
            taskMetadata: null, taskOrder: 0, workflowStepId: 10,
            phaseId: 10, phaseTitle: "Discovery", phaseStatus: "in_progress", phaseOrder: 0,
            workflowTemplateStepId: 5,
          },
          {
            taskId: 2, title: "Review findings", column: "in_progress", priority: "high",
            assignedTo: "Shane", dueDate: null, groupName: null, taskType: null,
            taskMetadata: null, taskOrder: 1, workflowStepId: 10,
            phaseId: 10, phaseTitle: "Discovery", phaseStatus: "in_progress", phaseOrder: 0,
            workflowTemplateStepId: 5,
          },
        ],
        // Query 2: workflow_template_step_tasks for templateStepId=5
        [
          {
            workflowTemplateStepId: 5, order: 0,
            isCustomerTask: false, runbookId: null,
            customerDownloadScriptId: null, triggersHealthScore: false,
          },
          {
            workflowTemplateStepId: 5, order: 1,
            isCustomerTask: true, runbookId: "run-uuid-1",
            customerDownloadScriptId: "dl-uuid-1", triggersHealthScore: true,
          },
        ],
      ],
    );
    await executeWorkflowRun(1);
  });

  it("output.projectId is the queried project", () => {
    expect(capturedOutput().projectId).toBe(42);
  });

  it("output.taskCount equals total tasks", () => {
    expect(capturedOutput().taskCount).toBe(2);
  });

  it("output.phases groups tasks under phases", () => {
    const phases = capturedOutput().phases as Array<{ phaseId: number; phaseTitle: string; tasks: unknown[] }>;
    expect(phases).toHaveLength(1);
    expect(phases[0]!.phaseTitle).toBe("Discovery");
    expect(phases[0]!.tasks).toHaveLength(2);
  });

  it("task metadata sourced from workflow_template_step_tasks join (not taskMetadata JSONB)", () => {
    const phases = capturedOutput().phases as Array<{ tasks: Array<{
      isCustomerTask: boolean | null;
      linkedRunbookId: string | null;
      customerDownloadScriptId: string | null;
      triggersHealthScore: boolean | null;
    }> }>;
    // task at index 0: template says isCustomerTask=false
    expect(phases[0]!.tasks[0]!.isCustomerTask).toBe(false);
    // task at index 1: template says isCustomerTask=true, runbookId set
    expect(phases[0]!.tasks[1]!.isCustomerTask).toBe(true);
    expect(phases[0]!.tasks[1]!.linkedRunbookId).toBe("run-uuid-1");
    expect(phases[0]!.tasks[1]!.customerDownloadScriptId).toBe("dl-uuid-1");
    expect(phases[0]!.tasks[1]!.triggersHealthScore).toBe(true);
  });

  it("node status is ok", () => {
    expect(capturedStatus()).toBe("ok");
  });
});

// =============================================================================
// get_project_tasks — missing projectId (live)
// =============================================================================

describe("get_project_tasks — missing projectId (live)", () => {
  beforeEach(async () => {
    resetState();
    seedDb(singleNodeGraph("get_project_tasks", { projectId: "" }));
    await executeWorkflowRun(1);
  });

  it("output.error is set", () => {
    expect(typeof capturedOutput().error).toBe("string");
    expect((capturedOutput().error as string).length).toBeGreaterThan(0);
  });

  it("node status is error", () => {
    expect(capturedStatus()).toBe("error");
  });
});

// =============================================================================
// update_project_task — happy path (live)
// =============================================================================

describe("update_project_task — happy path (live)", () => {
  beforeEach(async () => {
    resetState();
    state.updateQueue = [[{ id: 7, column: "in_progress", title: "Deploy phase 1" }]];
    seedDb(singleNodeGraph("update_project_task", {
      taskId: "7",
      column: "in_progress",
    }));
    await executeWorkflowRun(1);
  });

  it("output.updated is true", () => {
    expect(capturedOutput().updated).toBe(true);
  });

  it("output.taskId matches the updated task", () => {
    expect(capturedOutput().taskId).toBe(7);
  });

  it("output.column reflects the new column", () => {
    expect(capturedOutput().column).toBe("in_progress");
  });

  it("node status is ok", () => {
    expect(capturedStatus()).toBe("ok");
  });
});

// =============================================================================
// update_project_task — missing taskId (live)
// =============================================================================

describe("update_project_task — missing taskId (live)", () => {
  beforeEach(async () => {
    resetState();
    seedDb(singleNodeGraph("update_project_task", { taskId: "" }));
    await executeWorkflowRun(1);
  });

  it("output.error is set", () => {
    expect(typeof capturedOutput().error).toBe("string");
    expect((capturedOutput().error as string).length).toBeGreaterThan(0);
  });

  it("node status is error", () => {
    expect(capturedStatus()).toBe("error");
  });
});

// =============================================================================
// update_project_task — task not found (live)
// =============================================================================

describe("update_project_task — task not found (live)", () => {
  beforeEach(async () => {
    resetState();
    state.updateQueue = [[]]; // empty returning() — no task matched
    seedDb(singleNodeGraph("update_project_task", { taskId: "999", column: "completed" }));
    await executeWorkflowRun(1);
  });

  it("output.error mentions the task id", () => {
    expect((capturedOutput().error as string)).toContain("999");
  });

  it("node status is error", () => {
    expect(capturedStatus()).toBe("error");
  });
});
