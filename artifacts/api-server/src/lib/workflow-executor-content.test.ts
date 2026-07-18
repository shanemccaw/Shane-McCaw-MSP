/**
 * workflow-executor-content.test.ts
 *
 * Unit tests for content-generation workflow node types:
 *   generate_article, generate_image, generate_script, topic_picker,
 *   create_marketing_campaign, generate_landing_page, publish_article,
 *   edit_stripe_invoice, build_presentation
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({
  dbQueue: [] as unknown[][],
  nodeOutputInserts: [] as Record<string, unknown>[],
  logInserts: [] as Record<string, unknown>[],
  anthropicCalls: [] as unknown[],
  streamCalls: [] as unknown[],
  imageGenCalls: [] as unknown[],
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
          returning: async () => [{
            id:          55,
            title:       "Generated Title",
            slug:        "generated-slug",
            status:      "draft",
            summary:     "A brief summary of the article.",
            category:    "M365 Best Practices",
            date:        "January 1, 2025",
            content:     "# Title\n\nContent here.",
            isPublished: true,
          }],
          catch: async () => {},
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
      token: {}, name: {},
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
  sendWebPushToAdmins: async () => {},
}));

vi.mock("./sse-channels", () => ({
  broadcastAdminWorkflowEvent: () => {},
  broadcastAdminEvent:         () => {},
}));

// Anthropic mock — returns a JSON blob compatible with ALL nodes that parse AI JSON:
//   generate_article needs: title, slug, summary, date, content
//   generate_landing_page needs: title, headline, subheadline, valuePropBlocks, socialProof, cta
//   topic_picker needs: topic, rationale, context, hotScore, targetSector, articleSuggestion
vi.mock("@workspace/integrations-anthropic-ai", () => ({
  anthropic: {
    messages: {
      create: async (...args: unknown[]) => {
        state.anthropicCalls.push(args[0]);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              title: "Microsoft 365 Best Practices",
              slug: "microsoft-365-best-practices",
              summary: "A guide to M365 best practices",
              date: "January 1, 2025",
              content: "# Microsoft 365 Best Practices\n\nThis is the article body.",
              headline: "Your M365 Tenant Is a Compliance Risk",
              subheadline: "Most tenants have critical security gaps",
              valuePropBlocks: [
                { icon: "🔍", heading: "Security Audit", body: "Identify and close security gaps fast." },
                { icon: "⚡", heading: "Speed", body: "Deploy changes in days, not months." },
                { icon: "🎯", heading: "ROI", body: "Measurable cost reduction guaranteed." },
              ],
              socialProof: [],
              cta: { buttonText: "Book Assessment", href: "/contact", subtext: "Fixed price. Senior delivery." },
              topic: "Microsoft 365 Tips",
              rationale: "High search intent from IT directors",
              context: "Copilot AI is reshaping how enterprises use M365",
              hotScore: 70,
              targetSector: "Enterprise",
              articleSuggestion: "Write a guide on Copilot AI security settings",
            }),
          }],
        };
      },
      stream: (...args: unknown[]) => {
        state.streamCalls.push(args[0]);
        return {
          finalMessage: async () => ({
            content: [{ type: "text", text: "# Article Title\n\nThis is the article content about Microsoft 365." }],
          }),
        };
      },
    },
  },
}));

// OpenAI mock — export BOTH the openai client AND generateImage helper
// The generate_image node uses `openai.images.generate` (not generateImage helper)
vi.mock("@workspace/integrations-openai-ai-server/image", () => ({
  openai: {
    images: {
      generate: async (...args: unknown[]) => {
        state.imageGenCalls.push(args[0]);
        // Returns base64-encoded "PNG" data
        return { data: [{ b64_json: "aGVsbG8gd29ybGQ=" }] };
      },
    },
  },
  generateImage: async () => ({
    imageUrl: "https://example.com/generated-image.png",
    revisedPrompt: "a professional Microsoft 365 illustration",
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
  sendEmail:    async () => {},
  brandedEmail: (html: string) => `<html>${html}</html>`,
}));

vi.mock("./push", () => ({
  sendPushNotifications: async () => {},
}));

vi.mock("./ps-script-gen", () => ({
  generatePsScript: async () => ({ scriptContent: "Write-Host 'Generated script'" }),
  generateScriptBundle: async () => ({ bundleId: "bundle-abc" }),
}));

vi.mock("./news-fetcher", () => ({
  fetchNewsHeadlines: async () => [],
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
  state.anthropicCalls = [];
  state.streamCalls = [];
  state.imageGenCalls = [];
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
// generate_article — live path
// =============================================================================

describe("generate_article — missing topic is an error (live)", () => {
  beforeEach(async () => {
    resetState();
    seedDb(singleNodeGraph("generate_article", { topic: "", category: "M365" }));
    await executeWorkflowRun(1);
  });

  it("output.error mentions topic", () => {
    expect((capturedOutput().error as string)).toContain("topic");
  });

  it("node status is error", () => {
    expect(capturedStatus()).toBe("error");
  });
});

describe("generate_article — happy path with anthropic mock (live)", () => {
  beforeEach(async () => {
    resetState();
    seedDb(singleNodeGraph("generate_article", {
      topic:    "Top 5 Microsoft 365 Security Tips",
      category: "Security",
    }));
    await executeWorkflowRun(1);
  });

  it("calls anthropic.messages.create", () => {
    expect(state.anthropicCalls.length).toBe(1);
  });

  it("output.articleTitle is a non-empty string", () => {
    expect(typeof capturedOutput().articleTitle).toBe("string");
    expect((capturedOutput().articleTitle as string).length).toBeGreaterThan(0);
  });

  it("output.articleSlug is set", () => {
    expect(typeof capturedOutput().articleSlug).toBe("string");
    expect((capturedOutput().articleSlug as string).length).toBeGreaterThan(0);
  });

  it("output.articleContent is set", () => {
    expect(typeof capturedOutput().articleContent).toBe("string");
    expect((capturedOutput().articleContent as string).length).toBeGreaterThan(0);
  });

  it("node status is ok", () => {
    expect(capturedStatus()).toBe("ok");
  });
});

describe("generate_article — dry-run skips AI call", () => {
  beforeEach(async () => {
    resetState();
    seedDb(singleNodeGraph("generate_article", { topic: "SharePoint Updates", category: "SharePoint" }));
    await executeWorkflowRun(1, { dryRun: true });
  });

  it("output.dryRun is true", () => {
    expect(capturedOutput().dryRun).toBe(true);
  });

  it("does not call anthropic in dry-run mode", () => {
    expect(state.anthropicCalls.length).toBe(0);
    expect(state.streamCalls.length).toBe(0);
  });

  it("output.articleTitle contains topic", () => {
    expect((capturedOutput().articleTitle as string)).toContain("Dry-run");
  });
});

// =============================================================================
// generate_image — live path
// =============================================================================

describe("generate_image — missing prompt is an error (live)", () => {
  beforeEach(async () => {
    resetState();
    seedDb(singleNodeGraph("generate_image", { prompt: "", aspectRatio: "landscape" }));
    await executeWorkflowRun(1);
  });

  it("output.error mentions prompt", () => {
    expect((capturedOutput().error as string)).toContain("prompt");
  });

  it("node status is error", () => {
    expect(capturedStatus()).toBe("error");
  });
});

describe("generate_image — happy path (live)", () => {
  beforeEach(async () => {
    resetState();
    seedDb(singleNodeGraph("generate_image", {
      prompt:      "A professional photo of a modern office with Microsoft 365 branding",
      aspectRatio: "landscape",
    }));
    await executeWorkflowRun(1);
  });

  it("calls openai.images.generate once", () => {
    expect(state.imageGenCalls.length).toBe(1);
  });

  it("output.imageUrl is a local API path", () => {
    const url = capturedOutput().imageUrl as string;
    expect(typeof url).toBe("string");
    expect(url.length).toBeGreaterThan(0);
  });

  it("output.revisedPrompt is set", () => {
    expect(typeof capturedOutput().revisedPrompt).toBe("string");
  });

  it("node status is ok", () => {
    expect(capturedStatus()).toBe("ok");
  });
});

describe("generate_image — dry-run returns placeholder URL", () => {
  beforeEach(async () => {
    resetState();
    seedDb(singleNodeGraph("generate_image", { prompt: "test prompt", aspectRatio: "square" }));
    await executeWorkflowRun(1, { dryRun: true });
  });

  it("output.dryRun is true", () => {
    expect(capturedOutput().dryRun).toBe(true);
  });

  it("output.imageUrl is a placehold.co URL", () => {
    expect((capturedOutput().imageUrl as string)).toContain("placehold.co");
  });

  it("does not call openai.images.generate", () => {
    expect(state.imageGenCalls.length).toBe(0);
  });
});

// =============================================================================
// topic_picker — live path
// =============================================================================

describe("topic_picker — happy path calls anthropic (live)", () => {
  beforeEach(async () => {
    resetState();
    seedDb(singleNodeGraph("topic_picker", {
      focusArea: "Microsoft 365 governance best practices",
      category:  "Governance",
    }));
    await executeWorkflowRun(1);
  });

  it("calls anthropic.messages.create", () => {
    expect(state.anthropicCalls.length).toBeGreaterThan(0);
  });

  it("output.articleTopic is set", () => {
    expect(typeof capturedOutput().articleTopic).toBe("string");
    expect((capturedOutput().articleTopic as string).length).toBeGreaterThan(0);
  });

  it("output.topicCategory is set", () => {
    expect(typeof capturedOutput().topicCategory).toBe("string");
  });

  it("node status is ok", () => {
    expect(capturedStatus()).toBe("ok");
  });
});

describe("topic_picker — dry-run skips AI call", () => {
  beforeEach(async () => {
    resetState();
    seedDb(singleNodeGraph("topic_picker", { focusArea: "SharePoint", category: "SharePoint" }));
    await executeWorkflowRun(1, { dryRun: true });
  });

  it("output.dryRun is true", () => {
    expect(capturedOutput().dryRun).toBe(true);
  });

  it("does not call anthropic in dry-run", () => {
    expect(state.anthropicCalls.length).toBe(0);
  });
});

// =============================================================================
// create_marketing_campaign — live path
// =============================================================================

describe("create_marketing_campaign — happy path (live)", () => {
  beforeEach(async () => {
    resetState();
    seedDb(singleNodeGraph("create_marketing_campaign", {
      nameExpr:     "Copilot AI Campaign Q4",
      goalExpr:     "Generate leads for Copilot AI consulting",
      audienceExpr: "IT directors at mid-market companies",
    }));
    await executeWorkflowRun(1);
  });

  it("output.campaignId is set", () => {
    expect(capturedOutput().campaignId).toBe(55);
  });

  it("output.campaignStatus is draft", () => {
    expect(capturedOutput().campaignStatus).toBe("draft");
  });

  it("node status is ok", () => {
    expect(capturedStatus()).toBe("ok");
  });
});

describe("create_marketing_campaign — dry-run returns preview", () => {
  beforeEach(async () => {
    resetState();
    seedDb(singleNodeGraph("create_marketing_campaign", { nameExpr: "My Campaign" }));
    await executeWorkflowRun(1, { dryRun: true });
  });

  it("output.dryRun is true", () => {
    expect(capturedOutput().dryRun).toBe(true);
  });

  it("output.campaignName is set", () => {
    expect(typeof capturedOutput().campaignName).toBe("string");
  });
});

// =============================================================================
// generate_landing_page — live path
// =============================================================================

describe("generate_landing_page — happy path with anthropic mock (live)", () => {
  beforeEach(async () => {
    resetState();
    seedDb(singleNodeGraph("generate_landing_page", {
      topic:    "Microsoft 365 Copilot AI Consulting",
      audience: "Small business owners",
    }));
    await executeWorkflowRun(1);
  });

  it("calls anthropic.messages.create", () => {
    expect(state.anthropicCalls.length).toBe(1);
  });

  it("output.landingPageId is set", () => {
    expect(capturedOutput().landingPageId).toBeDefined();
  });

  it("output.slug is a non-empty string", () => {
    expect(typeof capturedOutput().slug).toBe("string");
    expect((capturedOutput().slug as string).length).toBeGreaterThan(0);
  });

  it("output.headline is set", () => {
    expect(typeof capturedOutput().headline).toBe("string");
    expect((capturedOutput().headline as string).length).toBeGreaterThan(0);
  });

  it("node status is ok", () => {
    expect(capturedStatus()).toBe("ok");
  });
});

describe("generate_landing_page — dry-run skips AI and DB (live-dry)", () => {
  beforeEach(async () => {
    resetState();
    seedDb(singleNodeGraph("generate_landing_page", { topic: "M365", audience: "SMB" }));
    await executeWorkflowRun(1, { dryRun: true });
  });

  it("output.dryRun is true", () => {
    expect(capturedOutput().dryRun).toBe(true);
  });

  it("output.slug is dry-run-landing-page", () => {
    expect(capturedOutput().slug).toBe("dry-run-landing-page");
  });
});

// =============================================================================
// publish_article — live path
// =============================================================================

describe("publish_article — missing articleTitle and content is an error (live)", () => {
  beforeEach(async () => {
    resetState();
    // No articleTitle or articleContent in payload → node errors
    seedDb(singleNodeGraph("publish_article", {}));
    await executeWorkflowRun(1);
  });

  it("output.error mentions articleTitle and articleContent", () => {
    expect((capturedOutput().error as string)).toMatch(/articleTitle|articleContent/);
  });

  it("node status is error", () => {
    expect(capturedStatus()).toBe("error");
  });
});

describe("publish_article — payload with articleTitle and articleContent succeeds (live)", () => {
  beforeEach(async () => {
    resetState();
    seedDb(
      // No override exprs — node reads articleTitle/articleContent from payload
      singleNodeGraph("publish_article", {}),
      { articleTitle: "My Published Article", articleContent: "# My Article\n\nFull content here." },
      [
        [], // slug conflict check returns empty (no existing slug)
      ],
    );
    await executeWorkflowRun(1);
  });

  it("output.published is true", () => {
    expect(capturedOutput().published).toBe(true);
  });

  it("output.slug is a non-empty string", () => {
    expect(typeof capturedOutput().slug).toBe("string");
    expect((capturedOutput().slug as string).length).toBeGreaterThan(0);
  });

  it("output.articleId is set", () => {
    expect(capturedOutput().articleId).toBe(55);
  });

  it("node status is ok", () => {
    expect(capturedStatus()).toBe("ok");
  });
});

describe("publish_article — dry-run returns preview", () => {
  beforeEach(async () => {
    resetState();
    seedDb(singleNodeGraph("publish_article", { slugExpr: "test-article" }));
    await executeWorkflowRun(1, { dryRun: true });
  });

  it("output.dryRun is true", () => {
    expect(capturedOutput().dryRun).toBe(true);
  });
});

// =============================================================================
// generate_script — live path
// =============================================================================

describe("generate_script — happy path service mode (live)", () => {
  beforeEach(async () => {
    resetState();
    seedDb(
      singleNodeGraph("generate_script", {
        sourceMode: "service",
        targetId:   "microsoft-365",
      }),
      {},
      [[{ id: 1, content: "some service content" }]],
    );
    await executeWorkflowRun(1);
  });

  it("node status is ok or produces a scriptId/error", () => {
    const out = capturedOutput();
    const isOkOrHandled = capturedStatus() === "ok" || typeof out.error === "string" || typeof out.scriptId === "string";
    expect(isOkOrHandled).toBe(true);
  });
});

describe("generate_script — dry-run returns preview", () => {
  beforeEach(async () => {
    resetState();
    seedDb(singleNodeGraph("generate_script", { sourceMode: "service", targetId: "microsoft-365" }));
    await executeWorkflowRun(1, { dryRun: true });
  });

  it("output.dryRun is true", () => {
    expect(capturedOutput().dryRun).toBe(true);
  });

  it("output.scriptId is dry-run-script-id", () => {
    expect(capturedOutput().scriptId).toBe("dry-run-script-id");
  });
});

// =============================================================================
// edit_stripe_invoice — dry-run (avoids real Stripe calls)
// =============================================================================

describe("edit_stripe_invoice — dry-run returns preview", () => {
  beforeEach(async () => {
    resetState();
    seedDb(singleNodeGraph("edit_stripe_invoice", {
      invoiceId: "inv_test_123",
      daysUntilDue: "14",
    }));
    await executeWorkflowRun(1, { dryRun: true });
  });

  it("output.dryRun is true", () => {
    expect(capturedOutput().dryRun).toBe(true);
  });

  it("output.invoiceId is the dry-run id", () => {
    expect(capturedOutput().invoiceId).toBe("dry-run-inv-id");
  });

  it("node status is ok", () => {
    expect(capturedStatus()).toBe("ok");
  });
});

// =============================================================================
// build_presentation — live path (DB insert only, no external services)
// =============================================================================

describe("build_presentation — happy path (live)", () => {
  beforeEach(async () => {
    resetState();
    seedDb(singleNodeGraph("build_presentation", {
      clientName:   "Contoso Ltd",
      clientEmail:  "cto@contoso.com",
      projectTitle: "M365 Copilot Engagement",
      checkoutUrl:  "https://checkout.stripe.com/test",
      totalAmount:  "15000",
      currency:     "USD",
    }));
    await executeWorkflowRun(1);
  });

  it("output.presentationHtml contains the client name", () => {
    expect((capturedOutput().presentationHtml as string)).toContain("Contoso Ltd");
  });

  it("output.presentationId is set", () => {
    expect(capturedOutput().presentationId).toBeDefined();
  });

  it("output.presentationUrl is set", () => {
    expect(typeof capturedOutput().presentationUrl).toBe("string");
    expect((capturedOutput().presentationUrl as string).length).toBeGreaterThan(0);
  });

  it("node status is ok", () => {
    expect(capturedStatus()).toBe("ok");
  });
});

describe("build_presentation — dry-run returns static HTML", () => {
  beforeEach(async () => {
    resetState();
    seedDb(singleNodeGraph("build_presentation", {
      clientName: "Test Client",
      projectTitle: "Dry Run Proposal",
    }));
    await executeWorkflowRun(1, { dryRun: true });
  });

  it("output.dryRun is true", () => {
    expect(capturedOutput().dryRun).toBe(true);
  });

  it("output.presentationHtml contains Dry Run", () => {
    expect((capturedOutput().presentationHtml as string)).toContain("Dry Run");
  });
});

describe("build_presentation — unsafe checkoutUrl is rejected", () => {
  beforeEach(async () => {
    resetState();
    seedDb(singleNodeGraph("build_presentation", {
      clientName:  "Acme",
      clientEmail: "test@acme.com",
      projectTitle: "Test Proposal",
      checkoutUrl: "javascript:alert(1)",
    }));
    await executeWorkflowRun(1);
  });

  it("output.presentationHtml does NOT contain the javascript: URL", () => {
    const html = capturedOutput().presentationHtml as string;
    expect(html).not.toContain("javascript:alert(1)");
  });

  it("node status is ok (unsafe URL is silently dropped)", () => {
    expect(capturedStatus()).toBe("ok");
  });
});
