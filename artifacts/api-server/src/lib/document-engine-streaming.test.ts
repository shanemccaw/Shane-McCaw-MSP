/**
 * document-engine-streaming.test.ts
 *
 * `generateDocument()` streams its narrative call (`anthropic.messages.stream`)
 * instead of awaiting a whole `messages.create`, so a watching operator sees the
 * document being written rather than a blank spinner.
 *
 * That is a TRANSPORT change and nothing else, which is precisely what is hard
 * to be sure of by reading the diff — hence this file. It pins the three things
 * that had to stay true:
 *
 *   1. The finished document is byte-identical to what the non-streaming path
 *      produced. Asserted against the real `extractAiHtml()` applied to the same
 *      Message — i.e. literally the expression the old code evaluated — and the
 *      relayed deltas are deliberately NOT equal to that result, so an engine
 *      that assembled the document out of the chunks it streamed would fail here.
 *   2. Cost capture still lands a real figure AFTER the stream completes, with
 *      real token counts read off the final message rather than an `unrecorded`
 *      slot or a `tokensUnknown` floor.
 *   3. The dry-run branch is untouched — still no model call on EITHER
 *      transport, still a real zero marked `no-ai-call`, and no delta relayed.
 *
 * The genuine metering module wraps a fake SDK (as in document-engine-cost.test.ts),
 * so cost comes through the real capture path rather than a stub that could
 * agree with the engine while both are wrong. `./sow-pricing` is deliberately
 * NOT mocked here: the whole point of assertion (1) is the real content path.
 *
 * Run: pnpm --filter @workspace/api-server run test -- document-engine-streaming
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  registerAiUsageSink,
  resetAiUsageBuffer,
  type AiUsageRecord,
  type AiUsagePersistResult,
} from "@workspace/integrations-anthropic-ai/metering";

// ── Test state ────────────────────────────────────────────────────────────────

let selectQueue: unknown[][] = [];
/** Params of every `messages.create` call — must stay empty; the engine streams. */
let createCalls: unknown[] = [];
/** Params of every `messages.stream` call. */
let streamCalls: unknown[] = [];
let reusable: { documentId: number; htmlContent: string; docTypeKey: string } | null = null;
/** When set, the fake stream rejects from `finalMessage()`. */
let streamFailure: Error | null = null;

/**
 * The model's raw output, chosen so the finished document is NOT the text that
 * was streamed: a markdown fence and a trailing "Document Summary" block, both
 * of which `extractAiHtml()` strips. The deltas therefore carry them and the
 * saved document does not — which is what makes assertion (1) bind.
 */
const RAW_MODEL_TEXT =
  "```html\n<html><body><h1>Governance Snapshot</h1><p>Real content.</p></body></html>\n```\n\nDocument Summary: three findings addressed.";

/** How that text arrives — split mid-tag, as a real token stream would. */
const CHUNKS = [
  "```html\n<html><bo",
  "dy><h1>Governance Snapsho",
  "t</h1><p>Real content.</p></bo",
  "dy></html>\n```\n\nDocument Summary: three findings addressed.",
];

function generatedMessage(): Record<string, unknown> {
  return {
    model: "claude-sonnet-4-6",
    content: [{ type: "text", text: RAW_MODEL_TEXT }],
    usage: { input_tokens: 1200, output_tokens: 800 },
  };
}

/**
 * Stand-in for the SDK's `MessageStream`. `on()` registers without consuming;
 * `finalMessage()` emits the text chunks, then 'finalMessage' (the metering
 * tap's usage source), then resolves to the complete Message.
 *
 * A function declaration so the hoisted `vi.mock` factory below can reach it.
 */
function fakeMessageStream(chunks: string[], message: unknown): Record<string, unknown> {
  const listeners: Record<string, Array<(arg: unknown) => void>> = {};
  const stream: Record<string, unknown> = {
    on(event: string, listener: (arg: unknown) => void) {
      (listeners[event] ??= []).push(listener);
      return stream;
    },
    async finalMessage() {
      for (const chunk of chunks) {
        // Across ticks, like a real stream — so a throwing listener throws
        // outside the caller's synchronous frame, as it would in production.
        await Promise.resolve();
        for (const listener of listeners["text"] ?? []) listener(chunk);
      }
      if (streamFailure) {
        for (const listener of listeners["error"] ?? []) listener(streamFailure);
        throw streamFailure;
      }
      for (const listener of listeners["finalMessage"] ?? []) listener(message);
      return message;
    },
  };
  return stream;
}

const DOC_TYPE_ROW = {
  key: "governance_snapshot",
  label: "Governance Snapshot",
  category: "governance",
  pipelineCategory: "standalone",
  aiPromptId: null,
  sections: [],
  sectionHints: "Overview",
  includedProfileKeyPatterns: [],
  includedSignalCategories: [],
};

function chainStub(rows: unknown[]): Record<string, unknown> {
  const obj: Record<string, unknown> = {
    from: () => obj,
    innerJoin: () => obj,
    where: () => obj,
    orderBy: () => obj,
    limit: () => obj,
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject),
  };
  return obj;
}

vi.mock("drizzle-orm", () => ({
  eq: (...args: unknown[]) => ({ type: "eq", args }),
  and: (...args: unknown[]) => ({ type: "and", args }),
  desc: (...args: unknown[]) => ({ type: "desc", args }),
  inArray: (...args: unknown[]) => ({ type: "inArray", args }),
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: () => chainStub(selectQueue.shift() ?? []),
    insert: () => ({ values: () => ({ returning: async () => [{ id: 4242 }] }) }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  },
  aiPromptsTable: {},
  documentTypesTable: { key: "key" },
  insightsGeneratedDocumentsTable: { id: "id" },
  tenantsTable: { id: "id", mspId: "mspId" },
  mspsTable: { id: "id", name: "name", primaryColor: "primaryColor" },
}));

vi.mock("@workspace/integrations-anthropic-ai", async () => {
  const metering = await import("@workspace/integrations-anthropic-ai/metering");
  return {
    withAiUsageCapture: metering.withAiUsageCapture,
    totalCapturedCostCents: metering.totalCapturedCostCents,
    anthropic: metering.meterAnthropicClient({
      messages: {
        // Recorded, never expected to fire — the engine streams now. A test
        // that only counted `stream` calls could not tell "switched to stream"
        // apart from "calls both".
        create: (async (params: unknown) => {
          createCalls.push(params);
          return generatedMessage();
        }) as never,
        stream: ((params: unknown) => {
          streamCalls.push(params);
          return fakeMessageStream(CHUNKS, generatedMessage());
        }) as never,
      },
    }),
  };
});

vi.mock("./tenant-signals", () => ({
  buildTenantProfile: async () => ({
    mergedProfile: { mfaEnabled: true },
    mergedProfileByCheck: { "identity:mfa-state": { mfaEnabled: true } },
    findings: ["A finding"],
    categorizedFindings: [{ text: "A finding", categories: ["identity"] }],
  }),
  findReusableDocument: async () => reusable,
  resolveDocumentOwnerUserId: async () => 11,
  namespacedProfileKey: (checkKey: string, propertyName: string) => `${checkKey}.${propertyName}`,
  NON_CHECK_PROFILE_NAMESPACE: "_profile",
}));

// Git #555 — document-engine.ts now resolves real per-finding point values, and
// that resolver reaches the scoring engine (health-engine -> priority-engine ->
// the DB client). Stubbed to null here, which is its own honest "no values
// available" path: this suite's assertions predate #555 and must keep seeing the
// findings block exactly as it was. Point values have their own two suites.
vi.mock("./finding-point-impact", () => ({
  computeFindingPointImpacts: async () => null,
}));

vi.mock("./prompt-loader", () => ({
  getPrompt: async () => "Write {{sections}} using {{profileSample}} and {{findings}}",
  getDocumentStylePrefix: async () => "<style></style>",
}));

// NOT mocked: ./sow-pricing. `extractAiHtml` is the content path under test.

vi.mock("./omg-card-generator-v2", () => ({
  generateOmgCardsFromTelemetry: async () => undefined,
}));

// Git #547's Copilot Gate. This file's document type is not the score report,
// so the engine never calls it — but the import is real, and copilot-gate.ts
// pulls the whole health-engine → priority-engine chain in at module load,
// which this file (a transport test) has no business loading. The gate's own
// wiring is asserted in `document-engine-copilot-gate.test.ts`.
vi.mock("./copilot-gate", () => ({
  computeCopilotGate: vi.fn(),
}));

vi.mock("./remediation-knowledge-base", () => ({
  buildRemediationAppendix: vi.fn(),
  REMEDIATION_APPENDIX_MAX_FINDINGS: 15,
  REMEDIATION_APPENDIX_PROMPT_SUFFIX: "",
}));

vi.mock("./logger", () => {
  const stub = { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() };
  return { logger: { ...stub, child: vi.fn(() => stub) } };
});

import { generateDocument } from "./document-engine.ts";
import { extractAiHtml } from "./sow-pricing.ts";

function queueHappyPath(): void {
  selectQueue = [
    [DOC_TYPE_ROW],
    [{ mspId: 1 }],
    [{ name: "Acme MSP", primaryColor: "#000" }],
  ];
}

const PARAMS = { mspCustomerId: 42, projectId: 7, docTypeKey: "governance_snapshot" };

beforeEach(() => {
  createCalls = [];
  streamCalls = [];
  reusable = null;
  streamFailure = null;
  resetAiUsageBuffer();
  queueHappyPath();
});

afterEach(() => {
  registerAiUsageSink(null);
  resetAiUsageBuffer();
});

// ── 1. Same output as the non-streaming path ─────────────────────────────────

describe("streaming transport produces the same document the non-streaming path did", () => {
  it("saves exactly extractAiHtml(finalMessage) — the expression the old create() path evaluated", async () => {
    registerAiUsageSink((): AiUsagePersistResult => ({ costCents: 1337, eventId: "88" }));

    const result = await generateDocument(PARAMS);

    // The old code was `extractAiHtml(await anthropic.messages.create(...))`.
    // The fake resolves the identical Message on both transports, so this is a
    // direct comparison against what the previous implementation produced.
    expect(result.htmlContent).toBe(extractAiHtml(generatedMessage() as { content: readonly unknown[] }));
    expect(result.htmlContent).toBe("<html><body><h1>Governance Snapshot</h1><p>Real content.</p></body></html>");
  });

  it("does not assemble the document out of the chunks it streamed", async () => {
    registerAiUsageSink((): AiUsagePersistResult => ({ costCents: 1337, eventId: "88" }));
    const relayed: string[] = [];

    const result = await generateDocument({ ...PARAMS, onTextDelta: (t) => relayed.push(t) });

    // Every chunk arrived, in order, and reconstructs the model's RAW output…
    expect(relayed).toEqual(CHUNKS);
    expect(relayed.join("")).toBe(RAW_MODEL_TEXT);
    // …which is deliberately not the saved document: the fence and the trailing
    // summary are still in the deltas and gone from the artifact. An engine that
    // built the document from what it streamed would fail this.
    expect(relayed.join("")).not.toBe(result.htmlContent);
    expect(relayed.join("")).toContain("Document Summary");
    expect(result.htmlContent).not.toContain("Document Summary");
    expect(result.htmlContent).not.toContain("```");
  });

  it("streams instead of awaiting a whole message — and does not do both", async () => {
    registerAiUsageSink((): AiUsagePersistResult => ({ costCents: 1337, eventId: "88" }));

    await generateDocument(PARAMS);

    // The NARRATIVE is streamed exactly once and is never also fetched whole —
    // the property this test was written for, unchanged.
    expect(streamCalls).toHaveLength(1);

    // Since #559 there is one non-streamed call, and it is the claim-binding
    // audit, not a second narrative fetch. Identified by its prompt rather than
    // by counting, so a future regression that re-fetched the document through
    // `create()` could not hide inside the same count.
    expect(createCalls).toHaveLength(1);
    const auditParams = createCalls[0] as { messages: { content: string }[] };
    expect(auditParams.messages[0]!.content).toContain("BINDINGS, not values");
  });

  it("sends the same request params streaming that it sent non-streaming", async () => {
    registerAiUsageSink((): AiUsagePersistResult => ({ costCents: 1337, eventId: "88" }));

    await generateDocument(PARAMS);

    // Transport changed; the request did not. Guards against a streaming
    // rewrite quietly altering the model, budget, or assembled prompt.
    const params = streamCalls[0] as { model: string; max_tokens: number; messages: { role: string; content: string }[] };
    expect(params.model).toBe("claude-sonnet-4-6");
    // Git #556 raised this from 16000 on a derived basis, and #559 raised it
    // again to 64000 because adaptive thinking now shares the same budget with
    // the response text (see NARRATIVE_MAX_OUTPUT_TOKENS in
    // document-engine.ts). This assertion still guards what it was written to
    // guard — that a transport rewrite cannot quietly alter the budget — it
    // just guards the current number.
    expect(params.max_tokens).toBe(64000);
    // #559 — thinking is ON for the narrative, and `temperature` is NOT set
    // beside it: the two are mutually exclusive on this model, so a well-meant
    // "let's also pin temperature" edit would 400 every generation.
    expect((params as unknown as { thinking?: unknown }).thinking).toEqual({ type: "adaptive" });
    expect(params).not.toHaveProperty("temperature");
    expect(params.messages).toHaveLength(1);
    expect(params.messages[0]!.role).toBe("user");
    expect(params.messages[0]!.content).toContain("<style></style>");
    expect(params.messages[0]!.content).toContain("A finding");
  });

  it("generates identically when no relay callback is supplied", async () => {
    registerAiUsageSink((): AiUsagePersistResult => ({ costCents: 1337, eventId: "88" }));

    const withRelay = await generateDocument({ ...PARAMS, onTextDelta: () => {} });
    queueHappyPath();
    const without = await generateDocument(PARAMS);

    expect(without.htmlContent).toBe(withRelay.htmlContent);
    expect(without.costCents).toBe(withRelay.costCents);
  });

  it("a throwing relay callback cannot destroy a document the model already wrote", async () => {
    registerAiUsageSink((): AiUsagePersistResult => ({ costCents: 1337, eventId: "88" }));

    // e.g. the operator closed the tab and the SSE write blew up mid-stream.
    const result = await generateDocument({
      ...PARAMS,
      onTextDelta: () => { throw new Error("client hung up"); },
    });

    expect(result.documentId).toBe(4242);
    expect(result.htmlContent).toBe("<html><body><h1>Governance Snapshot</h1><p>Real content.</p></body></html>");
    expect(result.costStatus).toBe("recorded");
  });
});

// ── 2. Cost capture still lands, post-stream ─────────────────────────────────

describe("cost capture after the stream completes", () => {
  it("records the ledger's real figure, not an unsettled slot", async () => {
    // Not derivable from the token counts by any pricing formula, so this
    // passes only by reading the persisted rows back.
    //
    // Two DIFFERENT figures since #559, and deliberately co-prime-ish: the
    // narrative's 1337 and the claim-binding audit's 42. Returning the same
    // number for both would let a total of 1337 pass whether the audit's cost
    // had been added, dropped, or double-counted. 1379 can only be the sum.
    let call = 0;
    registerAiUsageSink((): AiUsagePersistResult => {
      call += 1;
      return { costCents: call === 1 ? 1337 : 42, eventId: String(87 + call) };
    });

    const result = await generateDocument(PARAMS);

    expect(result.costCents).toBe(1379);
    expect(result.costStatus).toBe("recorded");
    // "unknown" here would mean the capture slot never settled — the exact
    // failure mode of returning the stream instead of awaiting finalMessage()
    // inside the capture scope.
    expect(result.costStatus).not.toBe("unknown");
  });

  it("reads real token counts off the final message rather than a floor", async () => {
    let record: AiUsageRecord | null = null;
    registerAiUsageSink((r): AiUsagePersistResult => {
      record = r;
      return { costCents: 1337, eventId: "88" };
    });

    await generateDocument(PARAMS);

    const captured = record as unknown as AiUsageRecord;
    expect(captured.promptTokens).toBe(1200);
    expect(captured.completionTokens).toBe(800);
    expect(captured.totalTokens).toBe(2000);
    // A raw streaming response the tap could not read would be flagged here and
    // the cost would be a floor, not a total.
    expect(captured.tokensUnknown).not.toBe(true);
    expect(captured.failed).not.toBe(true);
  });

  it("still attributes the streamed call to the customer and artifact", async () => {
    // Every record, not just the last one: since #559 the last record belongs
    // to the claim-binding audit, and a test that read `record` after the fact
    // would silently start asserting about the wrong call.
    const records: AiUsageRecord[] = [];
    registerAiUsageSink((r): AiUsagePersistResult => {
      records.push(r);
      return { costCents: 100, eventId: "1" };
    });

    await generateDocument(PARAMS);

    const captured = records.find((r) => r.triggerSource === "document-engine");
    expect(captured).toBeDefined();
    expect(captured!.customerId).toBe(42);
    expect(captured!.generatedArtifactType).toBe("governance_snapshot");
    expect(captured!.generatedArtifactId).toBe("4242");
  });

  it("attributes the #559 audit to the same customer and artifact as the document it gated", async () => {
    const records: AiUsageRecord[] = [];
    registerAiUsageSink((r): AiUsagePersistResult => {
      records.push(r);
      return { costCents: 100, eventId: "1" };
    });

    await generateDocument(PARAMS);

    // The audit is real spend for this customer. A second call that landed on
    // the ledger unattached to the document would make "what did this document
    // cost?" unanswerable after the fact — the question the cost plumbing
    // exists to answer.
    const audit = records.find((r) => r.triggerSource === "document-engine:claim-binding-audit");
    const narrative = records.find((r) => r.triggerSource === "document-engine");
    expect(audit).toBeDefined();
    expect(narrative).toBeDefined();
    expect(audit!.customerId).toBe(42);
    expect(audit!.generatedArtifactType).toBe("governance_snapshot");
    expect(audit!.generatedArtifactId).toBe("4242");
    // Same customer, same artifact, same cost owner as the call it gated —
    // only `triggerSource` distinguishes the two rows.
    expect(audit!.customerId).toBe(narrative!.customerId);
    expect(audit!.generatedArtifactId).toBe(narrative!.generatedArtifactId);
    expect(audit!.costOwner).toBe(narrative!.costOwner);
  });

  it("reports unknown, never zero, when the streamed call's row could not be recorded", async () => {
    registerAiUsageSink(() => undefined);

    const result = await generateDocument(PARAMS);

    expect(result.documentId).toBe(4242);
    expect(result.costStatus).toBe("unknown");
    expect(result.costCents).toBeNull();
    expect(result.costCents).not.toBe(0);
  });

  it("a failed stream still records the attempt and surfaces the error", async () => {
    let record: AiUsageRecord | null = null;
    registerAiUsageSink((r): AiUsagePersistResult => {
      record = r;
      return { costCents: 5, eventId: "2" };
    });
    streamFailure = new Error("overloaded_error");

    await expect(generateDocument(PARAMS)).rejects.toThrow("overloaded_error");

    // Spend that happened is still visible; tokens are unknown, not zero.
    const captured = record as unknown as AiUsageRecord;
    expect(captured.failed).toBe(true);
    expect(captured.tokensUnknown).toBe(true);
  });
});

// ── 3. The no-model-call branches are untouched ──────────────────────────────

describe("paths that make no model call are unaffected by streaming", () => {
  it("a dry-run preview calls NEITHER transport and stays a real zero", async () => {
    registerAiUsageSink((): AiUsagePersistResult => ({ costCents: 999, eventId: "1" }));
    const relayed: string[] = [];

    const result = await generateDocument({ ...PARAMS, dryRun: true, onTextDelta: (t) => relayed.push(t) });

    expect(result.dryRun).toBe(true);
    expect(result.costCents).toBe(0);
    expect(result.costStatus).toBe("no-ai-call");
    // The zero is honest because nothing was called — asserted on BOTH
    // transports, so adding streaming cannot have opened a second way to spend.
    expect(streamCalls).toHaveLength(0);
    expect(createCalls).toHaveLength(0);
    // And nothing was relayed, because there was nothing to relay.
    expect(relayed).toEqual([]);
  });

  it("a dry-run still assembles the prompt it would have sent", async () => {
    registerAiUsageSink((): AiUsagePersistResult => ({ costCents: 999, eventId: "1" }));

    const result = await generateDocument({ ...PARAMS, dryRun: true });

    // Preview content is unchanged by the transport switch — the branch returns
    // before reaching the model call at all.
    expect(result.assembledPrompt).toContain("A finding");
    expect(result.stylePrefix).toBe("<style></style>");
    expect(result.scopedFindings).toEqual(["A finding"]);
  });

  it("a drift-gate reuse calls neither transport and relays nothing", async () => {
    registerAiUsageSink((): AiUsagePersistResult => ({ costCents: 999, eventId: "1" }));
    reusable = { documentId: 77, htmlContent: "<html>old</html>", docTypeKey: "governance_snapshot" };
    selectQueue = [[DOC_TYPE_ROW]];
    const relayed: string[] = [];

    const result = await generateDocument({ ...PARAMS, onTextDelta: (t) => relayed.push(t) });

    expect(result.documentId).toBe(77);
    expect(result.costCents).toBe(0);
    expect(result.costStatus).toBe("no-ai-call");
    expect(streamCalls).toHaveLength(0);
    expect(createCalls).toHaveLength(0);
    expect(relayed).toEqual([]);
  });
});
