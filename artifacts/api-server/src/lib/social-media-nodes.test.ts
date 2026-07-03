/**
 * social-media-nodes.test.ts
 *
 * Unit-level tests for the post_linkedin, post_twitter, and post_facebook
 * workflow executor nodes. Covers:
 *   - Missing credentials → error surfaced in node output
 *   - Empty post body → error surfaced in node output
 *   - Successful mock API call → correct postId/postUrl injected into output
 *   - Non-2xx API response → error surfaced in node output
 *
 * Pattern mirrors kanban-workflow-e2e.test.ts: mock @workspace/db, stub fetch
 * globally, and call executeWorkflowRun with a single-node inline graph so
 * only the target node executes.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Shared mutable state ──────────────────────────────────────────────────────
const state = vi.hoisted(() => ({
  dbQueue: [] as unknown[][],
  nodeOutputInserts: [] as Record<string, unknown>[],
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
    const chain: Record<string, unknown> = {
      set:   () => ({ where: async () => [] }),
      where: async () => [],
    };
    return chain;
  }

  const db = {
    select: (_cols?: unknown) => makeSelectChain(state.dbQueue.shift() ?? []),
    insert: (table?: unknown) => ({
      values: (vals?: unknown) => {
        // Capture inserts into wfRunNodeOutputsTable (identified by its shape)
        if (vals && typeof vals === "object" && "output" in (vals as object)) {
          state.nodeOutputInserts.push(vals as Record<string, unknown>);
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
    "kanbanTasksTable", "articlesTable", "notificationsTable",
    "campaignsTable", "landingPagesTable",
  ];
  for (const name of tableNames) {
    stub[name] = {
      id: {}, definitionId: {}, status: {}, versionId: {}, branchPath: {},
      startedAt: {}, finishedAt: {}, errorMessage: {}, type: {}, enabled: {},
      config: {}, nextRunAt: {}, title: {}, createdAt: {},
    };
  }

  return { db, pool: { query: async () => ({ rows: [], rowCount: 0 }) }, ...stub };
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

// ── Mock anthropic ────────────────────────────────────────────────────────────
vi.mock("@workspace/integrations-anthropic-ai", () => ({
  anthropic: {
    messages: {
      create: async () => ({ content: [{ type: "text", text: '{"topic":"test","rationale":"test"}' }] }),
    },
  },
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

// ── Import after all mocks are registered ─────────────────────────────────────
import { executeWorkflowRun } from "./workflow-executor";

// ── Helpers ───────────────────────────────────────────────────────────────────

function resetState() {
  state.dbQueue = [];
  state.nodeOutputInserts = [];
}

/** Minimal run + version rows for a single-node graph executed via executeWorkflowRun(1). */
function seedDbForGraph(graph: object, payload: Record<string, unknown> = {}) {
  const version = { id: 1, definitionId: 10, status: "published", label: "v1", graph };
  state.dbQueue = [
    // 1. SELECT wf_runs WHERE id=1
    [{ id: 1, versionId: 1, payload, status: "pending", triggerType: "manual", triggerRef: "manual", branchPath: [] }],
    // 2. SELECT wf_versions WHERE id=1
    [version],
    // 3. cancellation check (one per node in BFS order)
    [{ status: "running" }],
  ];
}

/** A minimal one-node graph for the given node type + data. */
function singleNodeGraph(type: string, data: Record<string, unknown>) {
  return {
    nodes: [{ id: "sm", type, position: { x: 0, y: 0 }, data: { nodeType: type, label: type, ...data } }],
    edges: [],
  };
}

/** Stub globalThis.fetch and return the restored cleanup fn. */
function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const spy = vi.fn().mockImplementation(handler);
  vi.stubGlobal("fetch", spy);
  return spy;
}

/** Get the captured output for the "sm" node from the first node-output insert. */
function capturedOutput(): Record<string, unknown> {
  const insert = state.nodeOutputInserts[0];
  return (insert?.output ?? {}) as Record<string, unknown>;
}

// =============================================================================
// LinkedIn — post_linkedin
// =============================================================================

describe("post_linkedin — missing LINKEDIN_ACCESS_TOKEN", () => {
  beforeEach(async () => {
    delete process.env.LINKEDIN_ACCESS_TOKEN;
    delete process.env.LINKEDIN_ORG_ID;
    resetState();
    seedDbForGraph(singleNodeGraph("post_linkedin", { postBody: "Hello world", orgId: "123" }));
    await executeWorkflowRun(1);
  });

  afterEach(() => { vi.unstubAllGlobals(); });

  it("output contains error about missing access token", () => {
    expect(capturedOutput().error).toBe("post_linkedin: LINKEDIN_ACCESS_TOKEN secret is not set");
  });

  it("node insert status is 'error'", () => {
    expect(state.nodeOutputInserts[0]?.status).toBe("error");
  });
});

describe("post_linkedin — missing orgId", () => {
  beforeEach(async () => {
    process.env.LINKEDIN_ACCESS_TOKEN = "fake-token";
    delete process.env.LINKEDIN_ORG_ID;
    resetState();
    seedDbForGraph(singleNodeGraph("post_linkedin", { postBody: "Hello world" /* orgId omitted */ }));
    await executeWorkflowRun(1);
  });

  afterEach(() => {
    delete process.env.LINKEDIN_ACCESS_TOKEN;
    vi.unstubAllGlobals();
  });

  it("output contains error about missing orgId", () => {
    expect(capturedOutput().error).toBe(
      "post_linkedin: orgId must be configured on the node or via the LINKEDIN_ORG_ID secret",
    );
  });

  it("node insert status is 'error'", () => {
    expect(state.nodeOutputInserts[0]?.status).toBe("error");
  });
});

describe("post_linkedin — empty postBody", () => {
  beforeEach(async () => {
    process.env.LINKEDIN_ACCESS_TOKEN = "fake-token";
    process.env.LINKEDIN_ORG_ID = "456";
    resetState();
    seedDbForGraph(singleNodeGraph("post_linkedin", { postBody: "   " }));
    await executeWorkflowRun(1);
  });

  afterEach(() => {
    delete process.env.LINKEDIN_ACCESS_TOKEN;
    delete process.env.LINKEDIN_ORG_ID;
    vi.unstubAllGlobals();
  });

  it("output contains error about empty postBody", () => {
    expect(capturedOutput().error).toBe(
      "post_linkedin: postBody is empty — configure the post body field on this node",
    );
  });

  it("node insert status is 'error'", () => {
    expect(state.nodeOutputInserts[0]?.status).toBe("error");
  });
});

describe("post_linkedin — LinkedIn API non-2xx response", () => {
  beforeEach(async () => {
    process.env.LINKEDIN_ACCESS_TOKEN = "fake-token";
    process.env.LINKEDIN_ORG_ID = "456";
    resetState();
    stubFetch(async () => new Response("Unauthorized", { status: 401 }));
    seedDbForGraph(singleNodeGraph("post_linkedin", { postBody: "Hello LinkedIn" }));
    await executeWorkflowRun(1);
  });

  afterEach(() => {
    delete process.env.LINKEDIN_ACCESS_TOKEN;
    delete process.env.LINKEDIN_ORG_ID;
    vi.unstubAllGlobals();
  });

  it("output contains LinkedIn API error with status code", () => {
    expect(capturedOutput().error).toBe("post_linkedin: LinkedIn API error 401");
  });

  it("node insert status is 'error'", () => {
    expect(state.nodeOutputInserts[0]?.status).toBe("error");
  });
});

describe("post_linkedin — successful post", () => {
  beforeEach(async () => {
    process.env.LINKEDIN_ACCESS_TOKEN = "fake-token";
    process.env.LINKEDIN_ORG_ID = "456";
    resetState();
    stubFetch(async () => {
      const headers = new Headers({ "x-restli-id": "urn:li:ugcPost:99999" });
      return new Response("{}", { status: 201, headers });
    });
    seedDbForGraph(singleNodeGraph("post_linkedin", { postBody: "Hello LinkedIn" }));
    await executeWorkflowRun(1);
  });

  afterEach(() => {
    delete process.env.LINKEDIN_ACCESS_TOKEN;
    delete process.env.LINKEDIN_ORG_ID;
    vi.unstubAllGlobals();
  });

  it("linkedinPostId is captured from the x-restli-id header", () => {
    expect(capturedOutput().linkedinPostId).toBe("urn:li:ugcPost:99999");
  });

  it("linkedinPostUrl is the LinkedIn feed update URL", () => {
    expect(capturedOutput().linkedinPostUrl).toBe(
      "https://www.linkedin.com/feed/update/urn:li:ugcPost:99999",
    );
  });

  it("node insert status is 'ok'", () => {
    expect(state.nodeOutputInserts[0]?.status).toBe("ok");
  });
});

// =============================================================================
// Twitter / X — post_twitter
// =============================================================================

describe("post_twitter — missing OAuth secrets", () => {
  beforeEach(async () => {
    delete process.env.TWITTER_API_KEY;
    delete process.env.TWITTER_API_SECRET;
    delete process.env.TWITTER_ACCESS_TOKEN;
    delete process.env.TWITTER_ACCESS_TOKEN_SECRET;
    resetState();
    seedDbForGraph(singleNodeGraph("post_twitter", { postBody: "Hello Twitter" }));
    await executeWorkflowRun(1);
  });

  afterEach(() => { vi.unstubAllGlobals(); });

  it("output contains error listing the missing secrets", () => {
    expect(capturedOutput().error).toBe(
      "post_twitter: one or more Twitter OAuth 1.0a secrets are missing (TWITTER_API_KEY, TWITTER_API_SECRET, TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_TOKEN_SECRET)",
    );
  });

  it("node insert status is 'error'", () => {
    expect(state.nodeOutputInserts[0]?.status).toBe("error");
  });
});

describe("post_twitter — empty postBody", () => {
  beforeEach(async () => {
    process.env.TWITTER_API_KEY           = "k";
    process.env.TWITTER_API_SECRET        = "s";
    process.env.TWITTER_ACCESS_TOKEN      = "t";
    process.env.TWITTER_ACCESS_TOKEN_SECRET = "ts";
    resetState();
    seedDbForGraph(singleNodeGraph("post_twitter", { postBody: "" }));
    await executeWorkflowRun(1);
  });

  afterEach(() => {
    delete process.env.TWITTER_API_KEY;
    delete process.env.TWITTER_API_SECRET;
    delete process.env.TWITTER_ACCESS_TOKEN;
    delete process.env.TWITTER_ACCESS_TOKEN_SECRET;
    vi.unstubAllGlobals();
  });

  it("output contains error about empty postBody", () => {
    expect(capturedOutput().error).toBe(
      "post_twitter: postBody is empty — configure the tweet text on this node",
    );
  });

  it("node insert status is 'error'", () => {
    expect(state.nodeOutputInserts[0]?.status).toBe("error");
  });
});

describe("post_twitter — Twitter API non-2xx response", () => {
  beforeEach(async () => {
    process.env.TWITTER_API_KEY           = "k";
    process.env.TWITTER_API_SECRET        = "s";
    process.env.TWITTER_ACCESS_TOKEN      = "t";
    process.env.TWITTER_ACCESS_TOKEN_SECRET = "ts";
    resetState();
    stubFetch(async () => new Response("Forbidden", { status: 403 }));
    seedDbForGraph(singleNodeGraph("post_twitter", { postBody: "Hello Twitter" }));
    await executeWorkflowRun(1);
  });

  afterEach(() => {
    delete process.env.TWITTER_API_KEY;
    delete process.env.TWITTER_API_SECRET;
    delete process.env.TWITTER_ACCESS_TOKEN;
    delete process.env.TWITTER_ACCESS_TOKEN_SECRET;
    vi.unstubAllGlobals();
  });

  it("output contains Twitter API error with status code", () => {
    expect(capturedOutput().error).toBe("post_twitter: Twitter API error 403");
  });

  it("node insert status is 'error'", () => {
    expect(state.nodeOutputInserts[0]?.status).toBe("error");
  });
});

describe("post_twitter — successful tweet", () => {
  beforeEach(async () => {
    process.env.TWITTER_API_KEY           = "k";
    process.env.TWITTER_API_SECRET        = "s";
    process.env.TWITTER_ACCESS_TOKEN      = "t";
    process.env.TWITTER_ACCESS_TOKEN_SECRET = "ts";
    resetState();
    stubFetch(async () =>
      new Response(JSON.stringify({ data: { id: "1234567890" } }), { status: 201 }),
    );
    seedDbForGraph(singleNodeGraph("post_twitter", { postBody: "Hello Twitter" }));
    await executeWorkflowRun(1);
  });

  afterEach(() => {
    delete process.env.TWITTER_API_KEY;
    delete process.env.TWITTER_API_SECRET;
    delete process.env.TWITTER_ACCESS_TOKEN;
    delete process.env.TWITTER_ACCESS_TOKEN_SECRET;
    vi.unstubAllGlobals();
  });

  it("twitterTweetId is extracted from the response", () => {
    expect(capturedOutput().twitterTweetId).toBe("1234567890");
  });

  it("twitterTweetUrl points to the correct status URL", () => {
    expect(capturedOutput().twitterTweetUrl).toBe(
      "https://twitter.com/i/web/status/1234567890",
    );
  });

  it("node insert status is 'ok'", () => {
    expect(state.nodeOutputInserts[0]?.status).toBe("ok");
  });
});

// =============================================================================
// Facebook — post_facebook
// =============================================================================

describe("post_facebook — missing FACEBOOK_PAGE_ACCESS_TOKEN", () => {
  beforeEach(async () => {
    delete process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
    delete process.env.FACEBOOK_PAGE_ID;
    resetState();
    seedDbForGraph(singleNodeGraph("post_facebook", { postBody: "Hello Facebook", pageId: "pg1" }));
    await executeWorkflowRun(1);
  });

  afterEach(() => { vi.unstubAllGlobals(); });

  it("output contains error about missing page access token", () => {
    expect(capturedOutput().error).toBe("post_facebook: FACEBOOK_PAGE_ACCESS_TOKEN secret is not set");
  });

  it("node insert status is 'error'", () => {
    expect(state.nodeOutputInserts[0]?.status).toBe("error");
  });
});

describe("post_facebook — missing pageId", () => {
  beforeEach(async () => {
    process.env.FACEBOOK_PAGE_ACCESS_TOKEN = "fake-page-token";
    delete process.env.FACEBOOK_PAGE_ID;
    resetState();
    // Neither node data pageId nor env secret
    seedDbForGraph(singleNodeGraph("post_facebook", { postBody: "Hello Facebook" }));
    await executeWorkflowRun(1);
  });

  afterEach(() => {
    delete process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
    vi.unstubAllGlobals();
  });

  it("output contains error about missing pageId", () => {
    expect(capturedOutput().error).toBe(
      "post_facebook: pageId must be configured on the node or via the FACEBOOK_PAGE_ID secret",
    );
  });

  it("node insert status is 'error'", () => {
    expect(state.nodeOutputInserts[0]?.status).toBe("error");
  });
});

describe("post_facebook — empty postBody", () => {
  beforeEach(async () => {
    process.env.FACEBOOK_PAGE_ACCESS_TOKEN = "fake-page-token";
    process.env.FACEBOOK_PAGE_ID = "pg1";
    resetState();
    seedDbForGraph(singleNodeGraph("post_facebook", { postBody: "  " }));
    await executeWorkflowRun(1);
  });

  afterEach(() => {
    delete process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
    delete process.env.FACEBOOK_PAGE_ID;
    vi.unstubAllGlobals();
  });

  it("output contains error about empty postBody", () => {
    expect(capturedOutput().error).toBe(
      "post_facebook: postBody is empty — configure the post body field on this node",
    );
  });

  it("node insert status is 'error'", () => {
    expect(state.nodeOutputInserts[0]?.status).toBe("error");
  });
});

describe("post_facebook — Graph API non-2xx response (text post)", () => {
  beforeEach(async () => {
    process.env.FACEBOOK_PAGE_ACCESS_TOKEN = "fake-page-token";
    process.env.FACEBOOK_PAGE_ID = "pg1";
    resetState();
    stubFetch(async () => new Response("Bad Request", { status: 400 }));
    seedDbForGraph(singleNodeGraph("post_facebook", { postBody: "Hello Facebook" }));
    await executeWorkflowRun(1);
  });

  afterEach(() => {
    delete process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
    delete process.env.FACEBOOK_PAGE_ID;
    vi.unstubAllGlobals();
  });

  it("output contains Facebook Graph API error with status code", () => {
    expect(capturedOutput().error).toBe("post_facebook: Facebook Graph API error 400");
  });

  it("node insert status is 'error'", () => {
    expect(state.nodeOutputInserts[0]?.status).toBe("error");
  });
});

describe("post_facebook — successful text post", () => {
  beforeEach(async () => {
    process.env.FACEBOOK_PAGE_ACCESS_TOKEN = "fake-page-token";
    process.env.FACEBOOK_PAGE_ID = "pg1";
    resetState();
    stubFetch(async () =>
      new Response(JSON.stringify({ id: "pg1_98765" }), { status: 200 }),
    );
    seedDbForGraph(singleNodeGraph("post_facebook", { postBody: "Hello Facebook" }));
    await executeWorkflowRun(1);
  });

  afterEach(() => {
    delete process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
    delete process.env.FACEBOOK_PAGE_ID;
    vi.unstubAllGlobals();
  });

  it("facebookPostId is extracted from the response", () => {
    expect(capturedOutput().facebookPostId).toBe("pg1_98765");
  });

  it("facebookPostUrl points to the correct page post URL", () => {
    expect(capturedOutput().facebookPostUrl).toBe(
      "https://www.facebook.com/pg1/posts/98765",
    );
  });

  it("node insert status is 'ok'", () => {
    expect(state.nodeOutputInserts[0]?.status).toBe("ok");
  });
});

describe("post_facebook — Graph API non-2xx response (photo post)", () => {
  beforeEach(async () => {
    process.env.FACEBOOK_PAGE_ACCESS_TOKEN = "fake-page-token";
    process.env.FACEBOOK_PAGE_ID = "pg1";
    resetState();
    stubFetch(async () => new Response("Unauthorized", { status: 401 }));
    seedDbForGraph(singleNodeGraph("post_facebook", { postBody: "Hello with image", imageUrl: "https://example.com/img.jpg" }));
    await executeWorkflowRun(1);
  });

  afterEach(() => {
    delete process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
    delete process.env.FACEBOOK_PAGE_ID;
    vi.unstubAllGlobals();
  });

  it("output contains Facebook Graph API error with status code", () => {
    expect(capturedOutput().error).toBe("post_facebook: Facebook Graph API error 401");
  });

  it("node insert status is 'error'", () => {
    expect(state.nodeOutputInserts[0]?.status).toBe("error");
  });
});
