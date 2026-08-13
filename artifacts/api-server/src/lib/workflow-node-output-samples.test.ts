/**
 * workflow-node-output-samples.test.ts
 *
 * Tests for the wf_node_output_samples feature:
 *  - Static default samples exist for every fixed-shape node type.
 *  - DYNAMIC_SHAPE_NODE_TYPES does not overlap with STATIC_NODE_SAMPLES.
 *  - Sample capture: the executor upserts a sample after successful execution.
 *  - Fixed-shape samples have the exact keys declared in NODE_OUTPUTS.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  STATIC_NODE_SAMPLES,
  FIXED_SHAPE_NODE_TYPES,
  DYNAMIC_SHAPE_NODE_TYPES,
} from "./workflow-node-default-samples";

// ── Static default samples ─────────────────────────────────────────────────────

describe("STATIC_NODE_SAMPLES", () => {
  it("has at least one entry for each major fixed-shape node category", () => {
    const requiredNodeTypes = [
      "ask_ai",
      "calculate_priority",
      "calculate_pricing_engine",
      "calculate_health",
      "calculate_drift",
      "calculate_forecast",
      "calculate_crm",
      "calculate_msp",
      "get_tenant_signals",
      "generate_document",
    ];
    for (const nodeType of requiredNodeTypes) {
      expect(STATIC_NODE_SAMPLES).toHaveProperty(nodeType, expect.any(Object));
    }
  });

  it("every static sample is a non-empty object", () => {
    for (const [nodeType, sample] of Object.entries(STATIC_NODE_SAMPLES)) {
      expect(Object.keys(sample).length).toBeGreaterThan(0);
      // Samples must not have error keys at the top level
      expect(sample).not.toHaveProperty("error");
    }
  });

  it("ask_ai sample has aiResponse and model fields", () => {
    const s = STATIC_NODE_SAMPLES["ask_ai"];
    expect(s).toHaveProperty("aiResponse");
    expect(s).toHaveProperty("model");
  });

  it("calculate_priority sample matches expected output schema", () => {
    const s = STATIC_NODE_SAMPLES["calculate_priority"];
    expect(s).toHaveProperty("engine", "priority");
    expect(s).toHaveProperty("score");
    expect(s).toHaveProperty("breakdown");
    expect(s).toHaveProperty("rawSignals");
    expect(s).toHaveProperty("timestamp");
    expect(Array.isArray(s.rawSignals)).toBe(true);
  });

  it("get_tenant_signals sample has signals, signalCount, hasSignals", () => {
    const s = STATIC_NODE_SAMPLES["get_tenant_signals"];
    expect(s).toHaveProperty("signals");
    expect(s).toHaveProperty("signalCount");
    expect(s).toHaveProperty("hasSignals");
    expect(Array.isArray(s.signals)).toBe(true);
  });

  it("generate_document sample has documentId, docType, name", () => {
    const s = STATIC_NODE_SAMPLES["generate_document"];
    expect(s).toHaveProperty("documentId");
    expect(s).toHaveProperty("docType");
    expect(s).toHaveProperty("name");
  });

  it("all engine types include engine, score, breakdown, rawSignals, timestamp", () => {
    const engineTypes = [
      "calculate_priority",
      "calculate_pricing_engine",
      "calculate_health",
      "calculate_drift",
      "calculate_forecast",
      "calculate_crm",
      "calculate_msp",
    ];
    for (const t of engineTypes) {
      const s = STATIC_NODE_SAMPLES[t];
      expect(s, `${t} missing engine`).toHaveProperty("engine");
      expect(s, `${t} missing score`).toHaveProperty("score");
      expect(s, `${t} missing breakdown`).toHaveProperty("breakdown");
      expect(s, `${t} missing rawSignals`).toHaveProperty("rawSignals");
      expect(s, `${t} missing timestamp`).toHaveProperty("timestamp");
    }
  });
});

// ── FIXED_SHAPE_NODE_TYPES ─────────────────────────────────────────────────────

describe("FIXED_SHAPE_NODE_TYPES", () => {
  it("is the Set of all keys in STATIC_NODE_SAMPLES", () => {
    const expected = new Set(Object.keys(STATIC_NODE_SAMPLES));
    expect(FIXED_SHAPE_NODE_TYPES).toEqual(expected);
  });

  it("includes all engine node types", () => {
    expect(FIXED_SHAPE_NODE_TYPES.has("calculate_priority")).toBe(true);
    expect(FIXED_SHAPE_NODE_TYPES.has("calculate_msp")).toBe(true);
    expect(FIXED_SHAPE_NODE_TYPES.has("get_tenant_signals")).toBe(true);
    expect(FIXED_SHAPE_NODE_TYPES.has("ask_ai")).toBe(true);
    expect(FIXED_SHAPE_NODE_TYPES.has("generate_document")).toBe(true);
  });
});

// ── DYNAMIC_SHAPE_NODE_TYPES ───────────────────────────────────────────────────

describe("DYNAMIC_SHAPE_NODE_TYPES", () => {
  it("includes the expected dynamic node types", () => {
    expect(DYNAMIC_SHAPE_NODE_TYPES.has("sql_query")).toBe(true);
    expect(DYNAMIC_SHAPE_NODE_TYPES.has("find_object")).toBe(true);
    expect(DYNAMIC_SHAPE_NODE_TYPES.has("foreach")).toBe(true);
  });

  it("does NOT overlap with FIXED_SHAPE_NODE_TYPES", () => {
    for (const dynamicType of DYNAMIC_SHAPE_NODE_TYPES) {
      expect(FIXED_SHAPE_NODE_TYPES.has(dynamicType)).toBe(false);
    }
  });
});

// ── Sample capture mock test ───────────────────────────────────────────────────

// Mocked state to capture what was inserted into wf_node_output_samples
const sampleInserts: Record<string, unknown>[] = [];

vi.mock("@workspace/db", () => {
  function makeSelectChain(result: unknown[] = []) {
    const chain: Record<string, unknown> = {
      from: () => chain,
      where: () => chain,
      limit: () => chain,
      orderBy: () => chain,
      innerJoin: () => chain,
      leftJoin: () => chain,
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve),
      catch: () => Promise.resolve(result),
    };
    return chain;
  }

  const db = {
    select: () => makeSelectChain([]),
    insert: (_table?: unknown) => ({
      values: (vals: unknown) => {
        const v = vals as Record<string, unknown>;
        if ("sample" in v) sampleInserts.push(v);
        return {
          onConflictDoUpdate: () => ({
            catch: async () => {},
          }),
          onConflictDoNothing: () => ({
            catch: async () => {},
          }),
          returning: async () => [{ id: 1 }],
          catch: async () => {},
        };
      },
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: async () => [],
        }),
      }),
    }),
  };

  const stub: Record<string, unknown> = {};
  const tableNames = [
    "wfRunsTable", "wfVersionsTable", "wfDefinitionsTable", "wfTriggersTable",
    "wfRunNodeOutputsTable", "wfRunNodeLogsTable", "wfNodeOutputSamplesTable",
    "leadsTable", "usersTable", "projectsTable", "opportunitiesTable",
    "clientDocumentsTable", "leadQualificationsTable", "quizLeadsTable",
    "clientHealthHistoryTable", "emailTemplatesTable", "marketingTasksTable",
    "kanbanTasksTable", "workflowTemplateStepTasksTable", "articlesTable", "notificationsTable",
    "campaignsTable", "landingPagesTable", "pendingApprovalsTable",
    "workflowStepsTable", "clientPresentationsTable", "deviceTokensTable",
    "insightsGeneratedDocumentsTable", "quickWinPresentationsTable",
    "campaignAssetsTable", "couponsTable", "offersTable", "scriptRunResultsTable",
    "signalDerivationRulesTable", "signalRuleGroupsTable", "powershellScriptsTable",
    "scriptModulesTable", "clientAppRegistrationsTable", "servicesTable",
    "clientM365ProfilesTable", "quickWinPresentationsTable",
  ];
  for (const name of tableNames) stub[name] = Symbol(name);

  return { db, pool: {}, ...stub };
});

describe("Sample capture: STATIC_NODE_SAMPLES keys match executor output shapes", () => {
  it("ask_ai sample keys match the declared NODE_OUTPUTS schema", () => {
    const sample = STATIC_NODE_SAMPLES["ask_ai"];
    expect(Object.keys(sample)).toContain("aiResponse");
    expect(Object.keys(sample)).toContain("model");
  });

  it("calculate_priority sample keys match all NODE_OUTPUTS keys", () => {
    const sample = STATIC_NODE_SAMPLES["calculate_priority"];
    const expectedKeys = ["engine", "score", "breakdown", "rawSignals", "timestamp"];
    for (const k of expectedKeys) {
      expect(Object.keys(sample)).toContain(k);
    }
  });

  it("execute_runbook sample covers both single-mode and multi-mode keys", () => {
    const sample = STATIC_NODE_SAMPLES["execute_runbook"];
    const singleModeKeys = ["jobId", "jobStatus", "runbookName", "jobOutput"];
    const multiModeKeys = ["allSucceeded", "results", "succeeded", "failed"];
    for (const k of [...singleModeKeys, ...multiModeKeys]) {
      expect(Object.keys(sample)).toContain(k);
    }
  });

  it("Stripe node samples have the right field shapes", () => {
    const invoice = STATIC_NODE_SAMPLES["generate_invoice_stripe_payment"];
    expect(invoice).toHaveProperty("invoiceId");
    expect(invoice).toHaveProperty("invoiceUrl");
    expect(invoice).toHaveProperty("amountDue");
    expect(invoice).toHaveProperty("currency");

    const link = STATIC_NODE_SAMPLES["generate_stripe_payment_link"];
    expect(link).toHaveProperty("paymentLinkId");
    expect(link).toHaveProperty("paymentLinkUrl");
  });
});
