/**
 * workflow-executor-comms.test.ts
 *
 * Unit tests for communication / notification / CRM workflow node types:
 *   send_browser_notification, create_notification, send_mobile_push, play_sound,
 *   send_campaign_email, create_kanban_task, create_phase, ask_ai,
 *   fetch_news_headlines, find_object (lead / project)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const state = vi.hoisted(() => ({
  dbQueue: [] as unknown[][],
  nodeOutputInserts: [] as Record<string, unknown>[],
  logInserts: [] as Record<string, unknown>[],
  webPushCalls: [] as unknown[],
  sendEmailCalls: [] as unknown[],
  pushNotifCalls: [] as unknown[],
  broadcastCalls: [] as unknown[],
  anthropicCalls: [] as unknown[],
  newsFetcherResult: [] as unknown[],
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

  const db = {
    select: (_cols?: unknown) => makeSelectChain(state.dbQueue.shift() ?? []),
    insert: (_table?: unknown) => ({
      values: (vals?: unknown) => {
        if (vals && typeof vals === "object") {
          const v = vals as Record<string, unknown>;
          if ("output" in v) state.nodeOutputInserts.push(v);
          else state.logInserts.push(v);
        }
        return {
          returning: async () => [{ id: 99, title: "New Task" }],
          catch:     async () => {},
        };
      },
    }),
    update: () => ({
      set: () => ({ where: async () => [] }),
      where: async () => [],
    }),
  };

  const stub: Record<string, unknown> = {};
  const tableNames = [
    "wfRunsTable", "wfVersionsTable", "wfDefinitionsTable", "wfTriggersTable",
    "wfRunNodeOutputsTable", "wfRunNodeLogsTable",
    "leadsTable", "usersTable", "projectsTable", "opportunitiesTable",
    "clientDocumentsTable", "leadQualificationsTable", "quizLeadsTable",
    "clientHealthHistoryTable", "emailTemplatesTable", "marketingTasksTable",
    "kanbanTasksTable", "articlesTable", "notificationsTable",
    "campaignsTable", "landingPagesTable", "pendingApprovalsTable",
    "workflowStepsTable", "clientPresentationsTable", "deviceTokensTable",
    "insightsGeneratedDocumentsTable", "quickWinPresentationsTable",
    "campaignAssetsTable", "couponsTable",
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

vi.mock("./logger", () => {
  const n = () => {};
  const log = { info: n, warn: n, error: n, debug: n, fatal: n, trace: n, child: () => log };
  return { logger: log };
});

vi.mock("./azure-automation", () => ({
  createRunbookJob:  async () => "fake-job-id",
  isAzureConfigured: () => false,
  getJobStatus:      async () => "Completed",
  getJobOutput:      async () => "",
  isTerminalStatus:  () => true,
}));

vi.mock("./web-push", () => ({
  sendWebPushToAdmins: async (...args: unknown[]) => {
    state.webPushCalls.push(args[0]);
  },
}));

vi.mock("./sse-channels", () => ({
  broadcastAdminWorkflowEvent: (...args: unknown[]) => {
    state.broadcastCalls.push(args[0]);
  },
  broadcastAdminEvent: () => {},
}));

vi.mock("@workspace/integrations-anthropic-ai", () => ({
  anthropic: {
    messages: {
      create: async (...args: unknown[]) => {
        state.anthropicCalls.push(args[0]);
        return {
          content: [{ type: "text", text: '{"topic":"AI in M365","rationale":"test","context":"test","hotScore":80,"targetSector":"Enterprise","articleSuggestion":"test article"}' }],
        };
      },
      stream: () => ({
        finalMessage: async () => ({
          content: [{ type: "text", text: "generated article content" }],
        }),
      }),
    },
  },
}));

vi.mock("@workspace/integrations-openai-ai-server/image", () => ({
  generateImage: async () => ({
    imageUrl: "https://example.com/image.png",
    revisedPrompt: "a beautiful image",
  }),
}));

vi.mock("./kanban-auto-fire", () => ({
  autoFireFirstBacklogScript: async () => {},
  autoFireDocumentCard:       async () => {},
  reconcileOrphanedRuns:      async () => {},
  reconcileStalledPhases:     async () => {},
}));

vi.mock("../routes/admin-insights", () => ({
  executeAutomation: async () => {},
  nextRunFromCron:   () => new Date(),
}));

vi.mock("./manual-script-escalation", () => ({
  checkManualScriptEscalations: async () => ({ alerted: 0, checked: 0, cardIds: [] }),
}));

vi.mock("./mailer", () => ({
  sendEmail: async (...args: unknown[]) => {
    state.sendEmailCalls.push(args);
  },
  brandedEmail: (html: string) => `<html>${html}</html>`,
}));

vi.mock("./push", () => ({
  sendPushNotifications: async (...args: unknown[]) => {
    state.pushNotifCalls.push(args);
  },
}));

vi.mock("./ps-script-gen", () => ({
  generatePsScript:     async () => ({ scriptContent: "Write-Host 'hello'" }),
  generateScriptBundle: async () => ({ bundleId: "bundle-1" }),
}));

vi.mock("./news-fetcher", () => ({
  fetchNewsHeadlines: async () => state.newsFetcherResult,
}));

vi.mock("./stripe", () => ({
  getStripeKey: () => "sk_test_fake",
}));

vi.mock("./graph", () => ({
  getAccessToken:          async () => "fake-graph-token",
  graphCredentialsPresent: () => false,
}));

vi.mock("fs/promises", () => {
  const fsMock = {
    writeFile: async () => {},
    mkdir:     async () => {},
    readFile:  async () => Buffer.from(""),
  };
  return { default: fsMock, ...fsMock };
});

import { executeWorkflowRun } from "./workflow-executor";

// ── Helpers ───────────────────────────────────────────────────────────────────

function resetState() {
  state.dbQueue = [];
  state.nodeOutputInserts = [];
  state.logInserts = [];
  state.webPushCalls = [];
  state.sendEmailCalls = [];
  state.pushNotifCalls = [];
  state.broadcastCalls = [];
  state.anthropicCalls = [];
  state.newsFetcherResult = [];
}

function seedDb(graph: object, payload: Record<string, unknown> = {}, extraRows: unknown[][] = []) {
  const version = { id: 1, definitionId: 10, status: "published", label: "v1", graph };
  state.dbQueue = [
    [{ id: 1, versionId: 1, payload, status: "pending", triggerType: "manual", triggerRef: "manual", branchPath: [] }],
    [version],
    [{ status: "running" }],
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
// send_browser_notification — live path
// =============================================================================

describe("send_browser_notification — happy path (live)", () => {
  beforeEach(async () => {
    resetState();
    seedDb(singleNodeGraph("send_browser_notification", {
      title: "New Lead",
      body:  "You have a new lead from {{name}}",
      linkPath: "/admin/leads",
    }), { name: "Acme Corp" });
    await executeWorkflowRun(1);
  });

  it("calls sendWebPushToAdmins once", () => {
    expect(state.webPushCalls.length).toBe(1);
  });

  it("output.notificationSent is true", () => {
    expect(capturedOutput().notificationSent).toBe(true);
  });

  it("node status is ok", () => {
    expect(capturedStatus()).toBe("ok");
  });
});

describe("send_browser_notification — empty title skips push (live)", () => {
  beforeEach(async () => {
    resetState();
    seedDb(singleNodeGraph("send_browser_notification", { title: "", body: "no title provided" }));
    await executeWorkflowRun(1);
  });

  it("does not call sendWebPushToAdmins", () => {
    expect(state.webPushCalls.length).toBe(0);
  });

  it("output.notificationSent is false", () => {
    expect(capturedOutput().notificationSent).toBe(false);
  });

  it("output.skipped is true", () => {
    expect(capturedOutput().skipped).toBe(true);
  });

  it("node status is ok (non-fatal)", () => {
    expect(capturedStatus()).toBe("ok");
  });
});

// =============================================================================
// create_notification — live path
// =============================================================================

describe("create_notification — with admin users found (live)", () => {
  beforeEach(async () => {
    resetState();
    seedDb(
      singleNodeGraph("create_notification", {
        title: "Pipeline Update",
        body:  "Stage changed to Qualified",
        type:  "project_update",
      }),
      {},
      [
        // admin users SELECT
        [{ id: 1 }, { id: 2 }],
      ],
    );
    await executeWorkflowRun(1);
  });

  it("output.notificationCount matches admin user count", () => {
    expect(capturedOutput().notificationCount).toBe(2);
  });

  it("node status is ok", () => {
    expect(capturedStatus()).toBe("ok");
  });
});

describe("create_notification — empty title skips insert (live)", () => {
  beforeEach(async () => {
    resetState();
    seedDb(singleNodeGraph("create_notification", { title: "   ", body: "body text" }));
    await executeWorkflowRun(1);
  });

  it("output.skipped is true", () => {
    expect(capturedOutput().skipped).toBe(true);
  });

  it("output.notificationCount is 0", () => {
    expect(capturedOutput().notificationCount).toBe(0);
  });
});

describe("create_notification — no admin users found (live)", () => {
  beforeEach(async () => {
    resetState();
    seedDb(
      singleNodeGraph("create_notification", { title: "Alert", body: "something happened" }),
      {},
      [[]], // empty admin users
    );
    await executeWorkflowRun(1);
  });

  it("output.skipped is true when no admins exist", () => {
    expect(capturedOutput().skipped).toBe(true);
  });

  it("output.reason mentions no admin users", () => {
    expect((capturedOutput().reason as string)).toContain("no admin users");
  });
});

// =============================================================================
// send_mobile_push — live path
// =============================================================================

describe("send_mobile_push — with device tokens (live)", () => {
  beforeEach(async () => {
    resetState();
    seedDb(
      singleNodeGraph("send_mobile_push", { title: "New alert", body: "Something happened" }),
      {},
      [
        // device tokens SELECT
        [{ token: "token-abc" }, { token: "token-def" }],
      ],
    );
    await executeWorkflowRun(1);
  });

  it("calls sendPushNotifications", () => {
    expect(state.pushNotifCalls.length).toBe(1);
  });

  it("output.sent is true", () => {
    expect(capturedOutput().sent).toBe(true);
  });

  it("output.sentCount matches token count", () => {
    expect(capturedOutput().sentCount).toBe(2);
  });

  it("node status is ok", () => {
    expect(capturedStatus()).toBe("ok");
  });
});

describe("send_mobile_push — no device tokens registered (live)", () => {
  beforeEach(async () => {
    resetState();
    seedDb(
      singleNodeGraph("send_mobile_push", { title: "Alert", body: "body" }),
      {},
      [[]],
    );
    await executeWorkflowRun(1);
  });

  it("does not call sendPushNotifications", () => {
    expect(state.pushNotifCalls.length).toBe(0);
  });

  it("output.sent is false", () => {
    expect(capturedOutput().sent).toBe(false);
  });

  it("output.sentCount is 0", () => {
    expect(capturedOutput().sentCount).toBe(0);
  });
});

// =============================================================================
// play_sound — live path (browser target, SSE broadcast)
// =============================================================================

describe("play_sound — browser target broadcasts SSE (live)", () => {
  beforeEach(async () => {
    resetState();
    seedDb(singleNodeGraph("play_sound", { target: "browser", sound: "success" }));
    await executeWorkflowRun(1);
  });

  it("broadcastAdminWorkflowEvent is called", () => {
    expect(state.broadcastCalls.length).toBe(1);
  });

  it("output.soundPlayed is true", () => {
    expect(capturedOutput().soundPlayed).toBe(true);
  });

  it("output.soundTarget is browser", () => {
    expect(capturedOutput().soundTarget).toBe("browser");
  });

  it("node status is ok", () => {
    expect(capturedStatus()).toBe("ok");
  });
});

describe("play_sound — desktop target sends web push (live)", () => {
  beforeEach(async () => {
    resetState();
    seedDb(singleNodeGraph("play_sound", { target: "desktop", sound: "ping" }));
    await executeWorkflowRun(1);
  });

  it("sendWebPushToAdmins is called", () => {
    expect(state.webPushCalls.length).toBe(1);
  });

  it("output.soundTarget is desktop", () => {
    expect(capturedOutput().soundTarget).toBe("desktop");
  });
});

// =============================================================================
// send_campaign_email — live path
// =============================================================================

describe("send_campaign_email — missing recipient is an error (live)", () => {
  beforeEach(async () => {
    resetState();
    seedDb(singleNodeGraph("send_campaign_email", {
      recipientExpr: "",
      templateSlug: "welcome-email",
    }));
    await executeWorkflowRun(1);
  });

  it("output.error mentions recipient", () => {
    expect((capturedOutput().error as string)).toContain("recipient");
  });

  it("node status is error", () => {
    expect(capturedStatus()).toBe("error");
  });
});

describe("send_campaign_email — neither assetId nor templateSlug is an error (live)", () => {
  beforeEach(async () => {
    resetState();
    seedDb(singleNodeGraph("send_campaign_email", {
      recipientExpr: "client@example.com",
      // no assetId, no templateSlug
    }));
    await executeWorkflowRun(1);
  });

  it("output.error mentions assetId or templateSlug", () => {
    expect((capturedOutput().error as string).toLowerCase()).toMatch(/assetid|templateslug/i);
  });

  it("node status is error", () => {
    expect(capturedStatus()).toBe("error");
  });
});

describe("send_campaign_email — template not found is an error (live)", () => {
  beforeEach(async () => {
    resetState();
    seedDb(
      singleNodeGraph("send_campaign_email", {
        recipientExpr: "client@example.com",
        templateSlug: "missing-template",
      }),
      {},
      [[]], // DB returns empty array for template lookup
    );
    await executeWorkflowRun(1);
  });

  it("output.error mentions template not found", () => {
    expect((capturedOutput().error as string)).toContain("not found");
  });

  it("node status is error", () => {
    expect(capturedStatus()).toBe("error");
  });
});

describe("send_campaign_email — templateSlug found, email sent (live)", () => {
  beforeEach(async () => {
    resetState();
    seedDb(
      singleNodeGraph("send_campaign_email", {
        recipientExpr: "client@example.com",
        templateSlug: "welcome-email",
      }),
      {},
      [[{ id: 1, slug: "welcome-email", subject: "Welcome!", bodyHtml: "<p>Hello</p>" }]],
    );
    await executeWorkflowRun(1);
  });

  it("calls sendEmail once", () => {
    expect(state.sendEmailCalls.length).toBe(1);
  });

  it("output.sent is true", () => {
    expect(capturedOutput().sent).toBe(true);
  });

  it("output.recipient matches", () => {
    expect(capturedOutput().recipient).toBe("client@example.com");
  });

  it("node status is ok", () => {
    expect(capturedStatus()).toBe("ok");
  });
});

// =============================================================================
// create_kanban_task — live path
// =============================================================================

describe("create_kanban_task — missing title is an error (live)", () => {
  beforeEach(async () => {
    resetState();
    seedDb(singleNodeGraph("create_kanban_task", {
      boardId: "marketing",
      columnId: "ideas",
      titleExpr: "",
    }));
    await executeWorkflowRun(1);
  });

  it("output.error mentions title", () => {
    expect((capturedOutput().error as string)).toContain("title");
  });

  it("node status is error", () => {
    expect(capturedStatus()).toBe("error");
  });
});

describe("create_kanban_task — marketing board happy path (live)", () => {
  beforeEach(async () => {
    resetState();
    seedDb(singleNodeGraph("create_kanban_task", {
      boardId: "marketing",
      columnId: "in_progress",
      titleExpr: "Write blog post about {{topic}}",
    }), { topic: "Copilot AI" });
    await executeWorkflowRun(1);
  });

  it("output.boardId is marketing", () => {
    expect(capturedOutput().boardId).toBe("marketing");
  });

  it("output.taskId is assigned", () => {
    expect(capturedOutput().taskId).toBeDefined();
  });

  it("node status is ok", () => {
    expect(capturedStatus()).toBe("ok");
  });
});

describe("create_kanban_task — invalid boardId is an error (live)", () => {
  beforeEach(async () => {
    resetState();
    seedDb(singleNodeGraph("create_kanban_task", {
      boardId: "not-a-number",
      columnId: "backlog",
      titleExpr: "Task title",
    }));
    await executeWorkflowRun(1);
  });

  it("output.error mentions invalid boardId", () => {
    expect((capturedOutput().error as string)).toContain("invalid boardId");
  });

  it("node status is error", () => {
    expect(capturedStatus()).toBe("error");
  });
});

// =============================================================================
// create_phase — live path
// =============================================================================

describe("create_phase — missing projectId is an error (live)", () => {
  beforeEach(async () => {
    resetState();
    seedDb(singleNodeGraph("create_phase", {
      title: "Discovery Phase",
      // projectId omitted
    }));
    await executeWorkflowRun(1);
  });

  it("output.error mentions projectId", () => {
    expect((capturedOutput().error as string)).toContain("projectId");
  });

  it("node status is error", () => {
    expect(capturedStatus()).toBe("error");
  });
});

describe("create_phase — happy path (live)", () => {
  beforeEach(async () => {
    resetState();
    seedDb(singleNodeGraph("create_phase", {
      projectId: "42",
      title:     "Phase 1 — Discovery",
      description: "Initial assessment",
      order: "1",
    }));
    await executeWorkflowRun(1);
  });

  it("output.phaseId is assigned (from DB returning id: 99)", () => {
    expect(capturedOutput().phaseId).toBe(99);
  });

  it("output.phaseTitle is set", () => {
    expect(capturedOutput().phaseTitle).toBeDefined();
  });

  it("node status is ok", () => {
    expect(capturedStatus()).toBe("ok");
  });
});

// =============================================================================
// ask_ai — live path
// =============================================================================

describe("ask_ai — missing prompt is an error (live)", () => {
  beforeEach(async () => {
    resetState();
    seedDb(singleNodeGraph("ask_ai", { promptExpr: "" }));
    await executeWorkflowRun(1);
  });

  it("output.error mentions prompt", () => {
    expect((capturedOutput().error as string)).toContain("prompt");
  });

  it("node status is error", () => {
    expect(capturedStatus()).toBe("error");
  });
});

describe("ask_ai — happy path calls anthropic and returns aiResponse (live)", () => {
  beforeEach(async () => {
    resetState();
    seedDb(singleNodeGraph("ask_ai", {
      promptExpr: "Summarise Microsoft 365 security best practices in 3 bullet points.",
      model: "claude-haiku-4-5",
    }));
    await executeWorkflowRun(1);
  });

  it("calls anthropic.messages.create once", () => {
    expect(state.anthropicCalls.length).toBe(1);
  });

  it("output.aiResponse is a non-empty string", () => {
    expect(typeof capturedOutput().aiResponse).toBe("string");
    expect((capturedOutput().aiResponse as string).length).toBeGreaterThan(0);
  });

  it("output.model matches the configured model", () => {
    expect(capturedOutput().model).toBe("claude-haiku-4-5");
  });

  it("node status is ok", () => {
    expect(capturedStatus()).toBe("ok");
  });
});

describe("ask_ai — dry-run returns dryRun flag", () => {
  beforeEach(async () => {
    resetState();
    seedDb(singleNodeGraph("ask_ai", {
      promptExpr: "Tell me about SharePoint.",
    }));
    await executeWorkflowRun(1, { dryRun: true });
  });

  it("output.dryRun is true", () => {
    expect(capturedOutput().dryRun).toBe(true);
  });

  it("does not call anthropic in dry-run mode", () => {
    expect(state.anthropicCalls.length).toBe(0);
  });
});

// =============================================================================
// fetch_news_headlines — live path
// =============================================================================

describe("fetch_news_headlines — no headlines returned (live)", () => {
  beforeEach(async () => {
    resetState();
    state.newsFetcherResult = [];
    seedDb(singleNodeGraph("fetch_news_headlines", {
      topics: "Microsoft 365, Copilot AI",
      maxResults: "5",
    }));
    await executeWorkflowRun(1);
  });

  it("output.newsHeadlines is empty array", () => {
    expect(capturedOutput().newsHeadlines).toEqual([]);
  });

  it("output.hotScore is 0", () => {
    expect(capturedOutput().hotScore).toBe(0);
  });

  it("output.isHot is false", () => {
    expect(capturedOutput().isHot).toBe(false);
  });

  it("node status is ok", () => {
    expect(capturedStatus()).toBe("ok");
  });
});

// Note: fetch_news_headlines live path with real headlines is complex (requires
// two AI calls with specific JSON keys). We cover that branch via dry-run.
// The "no headlines" live path above confirms the mock integration works end-to-end.

describe("fetch_news_headlines — dry-run returns static preview", () => {
  beforeEach(async () => {
    resetState();
    seedDb(singleNodeGraph("fetch_news_headlines", { topics: "Azure" }));
    await executeWorkflowRun(1, { dryRun: true });
  });

  it("output.dryRun is true", () => {
    expect(capturedOutput().dryRun).toBe(true);
  });

  it("output.newsHeadlines has items", () => {
    expect(Array.isArray(capturedOutput().newsHeadlines)).toBe(true);
    expect((capturedOutput().newsHeadlines as unknown[]).length).toBeGreaterThan(0);
  });
});

// =============================================================================
// find_object — live path (lead)
// =============================================================================

// find_object uses `fieldName` and `fieldValueExpr` node data keys (not lookupField/lookupValue)
describe("find_object — lead found by email (live)", () => {
  beforeEach(async () => {
    resetState();
    seedDb(
      singleNodeGraph("find_object", {
        objectType:     "lead",
        fieldName:      "email",
        fieldValueExpr: "john@example.com",
      }),
      {},
      [
        [{ id: 7, email: "john@example.com", name: "John Doe", status: "new" }],
      ],
    );
    await executeWorkflowRun(1);
  });

  it("output.found is true", () => {
    expect(capturedOutput().found).toBe(true);
  });

  it("output.objectType is lead", () => {
    expect(capturedOutput().objectType).toBe("lead");
  });

  it("output.objectId is the lead id", () => {
    expect(capturedOutput().objectId).toBe(7);
  });

  it("node status is ok", () => {
    expect(capturedStatus()).toBe("ok");
  });
});

describe("find_object — lead not found returns found=false (live)", () => {
  beforeEach(async () => {
    resetState();
    seedDb(
      singleNodeGraph("find_object", {
        objectType:     "lead",
        fieldName:      "email",
        fieldValueExpr: "nobody@example.com",
      }),
      {},
      [[]], // empty result
    );
    await executeWorkflowRun(1);
  });

  it("output.found is false", () => {
    expect(capturedOutput().found).toBe(false);
  });

  it("node status is ok (not finding is not an error)", () => {
    expect(capturedStatus()).toBe("ok");
  });
});

describe("find_object — empty fieldValueExpr returns found=false without DB query (live)", () => {
  beforeEach(async () => {
    resetState();
    seedDb(singleNodeGraph("find_object", {
      objectType:     "lead",
      fieldName:      "email",
      fieldValueExpr: "", // empty → node returns early
    }));
    await executeWorkflowRun(1);
  });

  it("output.found is false", () => {
    expect(capturedOutput().found).toBe(false);
  });

  it("node status is ok", () => {
    expect(capturedStatus()).toBe("ok");
  });
});

describe("find_object — dry-run returns synthetic object", () => {
  beforeEach(async () => {
    resetState();
    seedDb(singleNodeGraph("find_object", {
      objectType:     "lead",
      fieldName:      "email",
      fieldValueExpr: "test@example.com",
    }));
    await executeWorkflowRun(1, { dryRun: true });
  });

  it("output.dryRun is true", () => {
    expect(capturedOutput().dryRun).toBe(true);
  });

  it("output.found is true", () => {
    expect(capturedOutput().found).toBe(true);
  });
});
