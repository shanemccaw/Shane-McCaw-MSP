/**
 * ai-usage-metering.test.ts
 *
 * Phase 1 of the AI Cost Governance & Billing Rollup initiative (#49).
 *
 * Two things are under test here:
 *
 * 1. REGISTRY COMPLETENESS. `node-type-registry.ts` is a hand-maintained array,
 *    and `getNodeTypeMeta` falls back to "unknown → non-AI" for anything absent
 *    from it. That fallback is a safe default for gating but a silent hole for
 *    billing: a node type nobody registered is never gated and never billed.
 *    The two authoritative lists of node types live in other files (the
 *    `WfNode` union in lib/db, `PROMOTED_ACTION_TYPES` in the executor), so
 *    these tests parse those files and assert the registry covers them. This is
 *    the grep-verification the phase calls for, run as a test so a future node
 *    type cannot be added without either registering it or turning this red.
 *
 * 2. STRUCTURAL METERING. Every Anthropic call must produce a usage record even
 *    when the call site forgets to attribute it. These tests drive the metering
 *    wrapper with a fake client covering one call per AI node category, the
 *    unattributed case, the impersonation case, streaming, and failure.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ai-billing.ts reaches for @workspace/db at module scope; these tests only
// exercise its pure resolveBillingMspId helper, so stub the tables out rather
// than requiring a live Postgres.
vi.mock("@workspace/db", () => ({
  db: {},
  aiUsageEventsTable: {},
  aiBalanceLedgerTable: {},
  mspAiPurchasesTable: {},
  mspSubscriptionsTable: {},
  servicesTable: {},
}));

import {
  NODE_TYPE_REGISTRY,
  getNodeTypeMeta,
  isRegisteredNodeType,
  isAIDependent,
  getAiCostOwner,
  resolveNodeTypeMeta,
  resolveEffectiveNodeType,
} from "./node-type-registry";

import {
  meterAnthropicClient,
  withAiAttribution,
  registerAiUsageSink,
  resetAiUsageBuffer,
  getUnsunkUsageCount,
  type AiUsageRecord,
  // Imported from the ./metering subpath, not the package root: the root
  // re-exports ./client, whose module-level env-var checks throw when
  // AI_INTEGRATIONS_ANTHROPIC_* are unset.
} from "@workspace/integrations-anthropic-ai/metering";

import { resolveBillingMspId } from "./ai-billing.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../../..");

// ── 1. Registry completeness ──────────────────────────────────────────────────

/**
 * Extract the members of the `WfNode` union from lib/db's schema source.
 *
 * The union is a TypeScript type, so it has no runtime representation to
 * reflect over — parsing the source is the only way to compare it against a
 * runtime array. Slicing between the interface opening and the `position` field
 * keeps the match tight to the `type:` union and away from the rest of the file.
 */
function readWfNodeUnion(): string[] {
  const file = path.join(REPO_ROOT, "lib/db/src/schema/index.ts");
  const source = fs.readFileSync(file, "utf8");
  const start = source.indexOf("export interface WfNode {");
  expect(start, `WfNode interface not found in ${file}`).toBeGreaterThan(-1);
  const end = source.indexOf("position: { x: number; y: number };", start);
  expect(end, "WfNode union end marker not found — did the interface change?").toBeGreaterThan(start);
  const block = source.slice(start, end);
  return [...new Set([...block.matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1]!))];
}

/** Extract PROMOTED_ACTION_TYPES from the executor source. */
function readPromotedActionTypes(): string[] {
  const file = path.join(REPO_ROOT, "artifacts/api-server/src/lib/workflow-executor.ts");
  const source = fs.readFileSync(file, "utf8");
  const start = source.indexOf("const PROMOTED_ACTION_TYPES = new Set([");
  expect(start, `PROMOTED_ACTION_TYPES not found in ${file}`).toBeGreaterThan(-1);
  const end = source.indexOf("]);", start);
  const block = source.slice(start, end);
  return [...new Set([...block.matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1]!))];
}

describe("node-type-registry completeness", () => {
  it("sanity: the parsers actually found the source lists", () => {
    // Guards against a silent pass if the source files move or are refactored —
    // an empty list would make every completeness assertion below vacuous.
    expect(readWfNodeUnion().length).toBeGreaterThan(100);
    expect(readPromotedActionTypes().length).toBeGreaterThan(10);
  });

  it("every WfNode union member has a registry entry", () => {
    const missing = readWfNodeUnion().filter((t) => !isRegisteredNodeType(t));
    expect(
      missing,
      `WfNode types absent from NODE_TYPE_REGISTRY — each would silently fall through to the ` +
        `"unknown → non-AI" default and be neither gated nor billed: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("every PROMOTED_ACTION_TYPES member has a registry entry", () => {
    const missing = readPromotedActionTypes().filter((t) => !isRegisteredNodeType(t));
    expect(
      missing,
      `actionTypes absent from NODE_TYPE_REGISTRY: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("no duplicate node types in the registry", () => {
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const entry of NODE_TYPE_REGISTRY) {
      if (seen.has(entry.nodeType)) dupes.push(entry.nodeType);
      seen.add(entry.nodeType);
    }
    expect(dupes, `duplicate registry entries: ${dupes.join(", ")}`).toEqual([]);
  });
});

describe("action meta-node dispatch", () => {
  it("a bare action node is non-AI so non-AI actions are never gated", () => {
    expect(isAIDependent("action")).toBe(false);
    expect(getNodeTypeMeta("action").dispatchesOn).toBe("actionType");
  });

  it("action + actionType generate_document resolves to the AI document node", () => {
    // This is the gap the audit found: the executor rewrites first-class node
    // types onto data.actionType, so classifying node.type alone reported this
    // real streaming Anthropic call as non-AI — never gated, never billed.
    expect(resolveEffectiveNodeType("action", "generate_document")).toBe("generate_document");
    expect(isAIDependent("action", "generate_document")).toBe(true);
    expect(getAiCostOwner("action", "generate_document")).toBe("msp");
  });

  it("action + a non-AI actionType stays non-AI", () => {
    expect(isAIDependent("action", "create_client")).toBe(false);
    expect(isAIDependent("action", "http_request")).toBe(false);
  });

  it("a promoted type still classifies correctly when it arrives un-rewritten", () => {
    expect(isAIDependent("generate_document")).toBe(true);
    expect(getAiCostOwner("generate_document")).toBe("msp");
  });

  it("getAiCostOwner throws on a non-AI node rather than guessing an owner", () => {
    expect(() => getAiCostOwner("action", "create_client")).toThrow(/not AI-dependent/);
  });
});

describe("AI classification corrections found by the audit", () => {
  it("fetch_news_headlines is AI-dependent — it makes two Anthropic calls", () => {
    const meta = resolveNodeTypeMeta("fetch_news_headlines");
    expect(meta.isAIDependent).toBe(true);
    if (meta.isAIDependent) expect(meta.aiCostOwner).toBe("msp");
  });

  it("chat_message (AI Support Assistant) is billed to the MSP", () => {
    expect(getAiCostOwner("chat_message")).toBe("msp");
  });

  it("data-collection nodes stay non-AI so monitoring never gates on balance", () => {
    for (const t of [
      "check_script_output",
      "collect_diagnostics",
      "monitor_execute_package",
      "execute_monitor_check",
      "graph_write_operation",
      "evaluate_signal_policies",
    ]) {
      expect(isAIDependent(t), `${t} must remain non-AI`).toBe(false);
    }
  });
});

// ── 2. Structural metering ────────────────────────────────────────────────────

interface FakeStream {
  on(event: string, listener: (arg: unknown) => void): FakeStream;
  emit(event: string, arg?: unknown): void;
}

function makeFakeStream(): FakeStream {
  const listeners: Record<string, Array<(arg: unknown) => void>> = {};
  return {
    on(event, listener) {
      (listeners[event] ??= []).push(listener);
      return this;
    },
    emit(event, arg) {
      for (const l of listeners[event] ?? []) l(arg);
    },
  };
}

function makeFakeClient(opts: {
  createResult?: unknown;
  createError?: Error;
  stream?: FakeStream;
} = {}) {
  const create = vi.fn(async () => {
    if (opts.createError) throw opts.createError;
    return (
      opts.createResult ?? {
        model: "claude-haiku-4-5",
        usage: { input_tokens: 1000, output_tokens: 500 },
        content: [{ type: "text", text: "ok" }],
      }
    );
  });
  const stream = vi.fn(() => opts.stream ?? makeFakeStream());
  return { messages: { create, stream } } as unknown as {
    messages: { create: (...a: never[]) => unknown; stream: (...a: never[]) => unknown };
  };
}

/** Metering taps run on a derived promise — let the microtask queue drain. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("metered Anthropic client", () => {
  let records: AiUsageRecord[];

  beforeEach(() => {
    records = [];
    resetAiUsageBuffer();
    registerAiUsageSink((r) => { records.push(r); });
  });

  afterEach(() => {
    registerAiUsageSink(null);
    resetAiUsageBuffer();
  });

  it("records a usage event for a call that supplies no attribution at all", async () => {
    // The whole point of metering at the client: a call site that never heard
    // of withAiAttribution still cannot spend money invisibly.
    const client = meterAnthropicClient(makeFakeClient());
    await (client.messages.create as (a: unknown) => Promise<unknown>)({ model: "claude-haiku-4-5" });
    await flush();

    expect(records).toHaveLength(1);
    expect(records[0]!.attributed).toBe(false);
    expect(records[0]!.mspId).toBeNull();
    // Unattributed must never debit an MSP — platform is the fail-safe owner.
    expect(records[0]!.costOwner).toBe("platform");
    expect(records[0]!.promptTokens).toBe(1000);
    expect(records[0]!.completionTokens).toBe(500);
    expect(records[0]!.totalTokens).toBe(1500);
  });

  it("returns the caller's value unchanged — metering is a passive tap", async () => {
    const payload = { model: "m", usage: { input_tokens: 1, output_tokens: 2 }, content: [] };
    const client = meterAnthropicClient(makeFakeClient({ createResult: payload }));
    const result = await (client.messages.create as (a: unknown) => Promise<unknown>)({});
    expect(result).toBe(payload);
  });

  it.each([
    ["document generation", "generate_document", "msp"],
    ["content generation", "generate_article", "msp"],
    ["support chat", "chat_message", "msp"],
    ["script analysis", "analyze_script_output", "msp"],
    ["news + campaign brief", "fetch_news_headlines", "msp"],
    // "lead scoring" / score_lead removed here with the node type itself in #135
    // (Decommission Legacy CRM Phase A) — generate_upsell_recommendation is the
    // other platform-owned AI node and keeps this row's coverage of that owner.
    ["upsell recommendation", "generate_upsell_recommendation", "platform"],
    ["dashboard insight", "generate_insight", "platform"],
  ])(
    "one AI-dependent call per category produces an attributed usage event (%s)",
    async (_label, nodeType, expectedOwner) => {
      const client = meterAnthropicClient(makeFakeClient());
      const costOwner = getAiCostOwner(nodeType);
      expect(costOwner).toBe(expectedOwner);

      await withAiAttribution(
        { mspId: 42, costOwner, nodeType, feature: `workflow:${nodeType}`, runId: "77" },
        () => (client.messages.create as (a: unknown) => Promise<unknown>)({ model: "claude-haiku-4-5" }),
      );
      await flush();

      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        attributed: true,
        mspId: 42,
        costOwner: expectedOwner,
        nodeType,
        runId: "77",
        totalTokens: 1500,
      });
    },
  );

  it("attributes calls made deeper in the async stack, not just the direct call", async () => {
    const client = meterAnthropicClient(makeFakeClient());
    const deep = async () => {
      await Promise.resolve();
      return (client.messages.create as (a: unknown) => Promise<unknown>)({});
    };
    await withAiAttribution({ mspId: 7, costOwner: "msp", nodeType: "generate_sow" }, deep);
    await flush();
    expect(records[0]).toMatchObject({ mspId: 7, nodeType: "generate_sow", attributed: true });
  });

  it("nested attribution refines without discarding the outer mspId", async () => {
    const client = meterAnthropicClient(makeFakeClient());
    await withAiAttribution({ mspId: 5, costOwner: "msp", nodeType: "generate_document" }, () =>
      withAiAttribution({ feature: "inner-step" }, () =>
        (client.messages.create as (a: unknown) => Promise<unknown>)({}),
      ),
    );
    await flush();
    expect(records[0]).toMatchObject({ mspId: 5, feature: "inner-step", nodeType: "generate_document" });
  });

  it("records a streaming call from its finalMessage without consuming the stream", async () => {
    const fake = makeFakeStream();
    const client = meterAnthropicClient(makeFakeClient({ stream: fake }));
    const returned = withAiAttribution(
      { mspId: 9, costOwner: "msp", nodeType: "generate_document" },
      () => (client.messages.stream as (a: unknown) => unknown)({ model: "claude-haiku-4-5" }),
    );
    expect(returned).toBe(fake);
    expect(records).toHaveLength(0);

    fake.emit("finalMessage", {
      model: "claude-haiku-4-5",
      usage: { input_tokens: 800, output_tokens: 200 },
    });

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ mspId: 9, nodeType: "generate_document", totalTokens: 1000 });
  });

  it("records a failed call as failed with tokens unknown, not as a free call", async () => {
    const client = meterAnthropicClient(makeFakeClient({ createError: new Error("upstream 529") }));
    await expect(
      withAiAttribution({ mspId: 3, costOwner: "msp", nodeType: "ask_ai" }, () =>
        (client.messages.create as (a: unknown) => Promise<unknown>)({}),
      ),
    ).rejects.toThrow("upstream 529");
    await flush();

    expect(records).toHaveLength(1);
    expect(records[0]!.failed).toBe(true);
    expect(records[0]!.tokensUnknown).toBe(true);
  });

  it("flags a response with no usage block as tokensUnknown rather than zero-cost", async () => {
    const client = meterAnthropicClient(makeFakeClient({ createResult: { model: "m" } }));
    await (client.messages.create as (a: unknown) => Promise<unknown>)({});
    await flush();
    expect(records[0]!.tokensUnknown).toBe(true);
    expect(records[0]!.totalTokens).toBe(0);
  });

  it("a throwing sink never breaks the model call", async () => {
    registerAiUsageSink(() => {
      throw new Error("ledger down");
    });
    const client = meterAnthropicClient(makeFakeClient());
    await expect(
      (client.messages.create as (a: unknown) => Promise<unknown>)({}),
    ).resolves.toBeDefined();
  });

  it("buffers records emitted before a sink exists and flushes them on registration", async () => {
    registerAiUsageSink(null);
    resetAiUsageBuffer();
    const client = meterAnthropicClient(makeFakeClient());
    await (client.messages.create as (a: unknown) => Promise<unknown>)({});
    await flush();
    expect(getUnsunkUsageCount()).toBe(1);

    const late: AiUsageRecord[] = [];
    registerAiUsageSink((r) => { late.push(r); });
    expect(late).toHaveLength(1);
    expect(getUnsunkUsageCount()).toBe(0);
  });

  it("threads customerId/artifact/triggerSource fields from attribution into the usage record", async () => {
    // Phase 2 (#50): document-generating calls attribute the artifact they
    // produce so ai_usage_events rows are traceable back to a real document.
    const client = meterAnthropicClient(makeFakeClient());
    await withAiAttribution(
      {
        mspId: 42,
        costOwner: "msp",
        nodeType: "generate_document",
        customerId: 501,
        generatedArtifactType: "sow",
        generatedArtifactName: "SOW - Acme Corp",
        generatedArtifactId: "9001",
        triggerSource: "document-engine",
      },
      () => (client.messages.create as (a: unknown) => Promise<unknown>)({ model: "claude-haiku-4-5" }),
    );
    await flush();

    expect(records[0]).toMatchObject({
      customerId: 501,
      generatedArtifactType: "sow",
      generatedArtifactName: "SOW - Acme Corp",
      generatedArtifactId: "9001",
      triggerSource: "document-engine",
    });
  });

  it("leaves customerId/artifact fields absent for a platform-level call with no artifact", async () => {
    const client = meterAnthropicClient(makeFakeClient());
    await withAiAttribution(
      { mspId: null, costOwner: "platform", nodeType: "generate_insight", feature: "campaign_brief" },
      () => (client.messages.create as (a: unknown) => Promise<unknown>)({ model: "claude-haiku-4-5" }),
    );
    await flush();

    expect(records[0]!.customerId).toBeUndefined();
    expect(records[0]!.generatedArtifactType).toBeUndefined();
    expect(records[0]!.generatedArtifactName).toBeUndefined();
    expect(records[0]!.generatedArtifactId).toBeUndefined();
    expect(records[0]!.triggerSource).toBeUndefined();
  });

  it("passes through non-messages client members untouched", () => {
    const raw = makeFakeClient() as unknown as Record<string, unknown>;
    raw.apiKey = "sk-test";
    const client = meterAnthropicClient(raw as never) as unknown as Record<string, unknown>;
    expect(client.apiKey).toBe("sk-test");
  });
});

// ── 3. Impersonation attribution (GAP-09) ─────────────────────────────────────

describe("impersonation AI attribution (GAP-09)", () => {
  let records: AiUsageRecord[];

  beforeEach(() => {
    records = [];
    resetAiUsageBuffer();
    registerAiUsageSink((r) => { records.push(r); });
  });

  afterEach(() => {
    registerAiUsageSink(null);
    resetAiUsageBuffer();
  });

  it("bills the impersonated MSP, not the acting PlatformAdmin", async () => {
    // A PlatformAdmin has no mspId of their own, so reading req.user.mspId
    // directly left impersonated AI spend unattributed. resolveBillingMspId is
    // the choke point that fixes it.
    const platformAdminSession = { mspId: undefined, impersonatedMspId: 88 };
    const billingMspId = resolveBillingMspId(platformAdminSession);
    expect(billingMspId).toBe(88);

    const client = meterAnthropicClient(makeFakeClient());
    await withAiAttribution(
      { mspId: billingMspId, costOwner: "msp", nodeType: "chat_message", feature: "support_chat" },
      () => (client.messages.create as (a: unknown) => Promise<unknown>)({}),
    );
    await flush();

    expect(records[0]).toMatchObject({ mspId: 88, costOwner: "msp", attributed: true });
  });

  it("the impersonated MSP wins over the actor's own MSP", () => {
    expect(resolveBillingMspId({ mspId: 10, impersonatedMspId: 20 })).toBe(20);
  });

  it("a non-impersonating MSP user still bills their own MSP", async () => {
    const billingMspId = resolveBillingMspId({ mspId: 11 });
    expect(billingMspId).toBe(11);

    const client = meterAnthropicClient(makeFakeClient());
    await withAiAttribution(
      { mspId: billingMspId, costOwner: "msp", nodeType: "chat_message", feature: "support_chat" },
      () => (client.messages.create as (a: unknown) => Promise<unknown>)({}),
    );
    await flush();
    expect(records[0]).toMatchObject({ mspId: 11, costOwner: "msp" });
  });

  it("a session with no MSP context records unattributed rather than guessing", async () => {
    const billingMspId = resolveBillingMspId({});
    expect(billingMspId).toBeNull();

    const client = meterAnthropicClient(makeFakeClient());
    await withAiAttribution(
      { mspId: billingMspId, costOwner: "msp", nodeType: "chat_message", feature: "support_chat" },
      () => (client.messages.create as (a: unknown) => Promise<unknown>)({}),
    );
    await flush();

    expect(records[0]!.attributed).toBe(false);
    expect(records[0]!.costOwner).toBe("platform");
  });
});
