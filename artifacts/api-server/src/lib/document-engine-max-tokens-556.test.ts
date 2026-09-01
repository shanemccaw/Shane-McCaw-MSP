/**
 * document-engine-max-tokens-556.test.ts — Git #556
 *
 * The one property this file exists to pin:
 *
 *   A response carrying `stop_reason: "max_tokens"` is NEVER treated as a
 *   complete document.
 *
 * Before #556, `document-engine.ts` read `content[0].text` off whatever came
 * back and wrote it to `html_content` with `status: "approved"`. A confirmed
 * live generation stopped mid-sentence at 47,235 characters and was served as
 * finished, because the string `"max_tokens"` appeared nowhere in the engine.
 * Raising the ceiling alone would not have fixed that — it would have moved the
 * cliff. So the assertions here are deliberately about BEHAVIOUR ON TRUNCATION,
 * not about the size of the ceiling:
 *
 *   1. The call rejects rather than resolving with a partial document.
 *   2. No write ever puts the truncated text into `html_content`, and no write
 *      ever sets `status: "approved"` — the truncated bytes do not reach the row
 *      at all, let alone reach a reader.
 *   3. The row is marked `failed` with an `errorMessage` an admin can act on.
 *   4. The remediation appendix is never built for a document that will not be
 *      saved (a doomed generation must not go on to buy more AI calls).
 *   5. The control cases still pass: `end_turn` saves normally, and an ABSENT
 *      `stop_reason` is not treated as truncated. Without (5) the suite could be
 *      satisfied by an engine that simply failed every generation.
 *
 * Plus direct unit coverage of `ai-output-ceiling.ts`, which is the shared
 * definition `document-engine-sow.ts` also calls — that engine has no
 * integration harness in this repo, so the guard's own tests are what bind its
 * behaviour there.
 *
 * Run: pnpm --filter @workspace/api-server run test -- document-engine-max-tokens-556
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  registerAiUsageSink,
  resetAiUsageBuffer,
  type AiUsagePersistResult,
} from "@workspace/integrations-anthropic-ai/metering";

// ── Test state ────────────────────────────────────────────────────────────────

let selectQueue: unknown[][] = [];
/** Every `db.update(...).set(...)` payload the engine wrote, in order. */
let updates: Record<string, unknown>[] = [];
/** The `stop_reason` the fake stream's final message carries this run. */
let stopReason: string | undefined;
let appendixCalls = 0;

/**
 * The model's raw output. Chosen to be recognizable in an assertion so a test
 * that claims "the truncated text never reached the row" is checking for the
 * actual bytes rather than for emptiness.
 */
const RAW_MODEL_TEXT =
  "<html><body><h1>Governance Snapshot</h1><p>TRUNCATED-MARKER content that must never be sav";

function generatedMessage(): Record<string, unknown> {
  return {
    model: "claude-sonnet-4-6",
    content: [{ type: "text", text: RAW_MODEL_TEXT }],
    usage: { input_tokens: 1200, output_tokens: 32000 },
    // Absent when `stopReason` is undefined — that is case (5), and it must be
    // spelled as a missing key rather than as an explicit `undefined` value so
    // it matches a real response shape that simply does not carry the field.
    ...(stopReason === undefined ? {} : { stop_reason: stopReason }),
  };
}

/** Minimal stand-in for the SDK's `MessageStream` — see document-engine-streaming.test.ts. */
function fakeMessageStream(message: unknown): Record<string, unknown> {
  const listeners: Record<string, Array<(arg: unknown) => void>> = {};
  const stream: Record<string, unknown> = {
    on(event: string, listener: (arg: unknown) => void) {
      (listeners[event] ??= []).push(listener);
      return stream;
    },
    async finalMessage() {
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
  // On, so assertion (4) binds: a truncated generation must not go on to buy
  // the appendix's own AI calls.
  remediationDetailAppendix: true,
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
    update: () => ({
      set: (payload: Record<string, unknown>) => {
        updates.push(payload);
        return { where: async () => undefined };
      },
    }),
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
        create: (async () => generatedMessage()) as never,
        stream: (() => fakeMessageStream(generatedMessage())) as never,
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
  findReusableDocument: async () => null,
  resolveDocumentOwnerUserId: async () => 11,
  namespacedProfileKey: (checkKey: string, propertyName: string) => `${checkKey}.${propertyName}`,
  NON_CHECK_PROFILE_NAMESPACE: "_profile",
}));

// #555's resolver reaches the scoring engine and the DB client; this suite is
// about the output ceiling, not about point values.
vi.mock("./finding-point-impact", () => ({
  computeFindingPointImpacts: async () => null,
}));

vi.mock("./prompt-loader", () => ({
  getPrompt: async () => "Write {{sections}} using {{profileSample}} and {{findings}}",
  getDocumentStylePrefix: async () => "<style></style>",
}));

vi.mock("./omg-card-generator-v2", () => ({
  generateOmgCardsFromTelemetry: async () => undefined,
}));

vi.mock("./copilot-gate", () => ({
  computeCopilotGate: vi.fn(),
}));

vi.mock("./remediation-knowledge-base", () => ({
  buildRemediationAppendix: async () => {
    appendixCalls += 1;
    return {
      html: "<section>appendix</section>",
      verifiedCount: 0, aiGeneratedCount: 0, pendingCount: 0, failedCount: 0, truncatedCount: 0,
      coveredCheckKeys: [], uncoveredCheckKeys: [],
    };
  },
  REMEDIATION_APPENDIX_MAX_FINDINGS: 15,
  REMEDIATION_APPENDIX_PROMPT_SUFFIX: "",
}));

vi.mock("./logger", () => {
  const stub = { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() };
  return { logger: { ...stub, child: vi.fn(() => stub) } };
});

// NOT mocked: ./sow-pricing (the real content path) and ./ai-output-ceiling (the
// guard under test). Mocking either would let this suite agree with an engine
// that never checked anything.
import { generateDocument } from "./document-engine.ts";
import {
  assertOutputNotTruncated,
  isTruncatedByMaxTokens,
  DocumentOutputTruncatedError,
  MAX_TOKENS_STOP_REASON,
} from "./ai-output-ceiling.ts";

const PARAMS = { mspCustomerId: 42, projectId: 7, docTypeKey: "governance_snapshot" };

function queueHappyPath(): void {
  selectQueue = [
    [DOC_TYPE_ROW],
    [{ mspId: 1 }],
    [{ name: "Acme MSP", primaryColor: "#000" }],
  ];
}

beforeEach(() => {
  updates = [];
  appendixCalls = 0;
  stopReason = undefined;
  resetAiUsageBuffer();
  registerAiUsageSink((): AiUsagePersistResult => ({ costCents: 1337, eventId: "88" }));
  queueHappyPath();
});

afterEach(() => {
  registerAiUsageSink(null);
  resetAiUsageBuffer();
});

// ── 1. The defect: a max_tokens response served as a finished document ───────

describe("a max_tokens stop_reason is never silently treated as a complete document", () => {
  it("rejects instead of resolving with the partial document", async () => {
    stopReason = MAX_TOKENS_STOP_REASON;

    await expect(generateDocument(PARAMS)).rejects.toBeInstanceOf(DocumentOutputTruncatedError);
  });

  it("never writes the truncated text to html_content and never sets status approved", async () => {
    stopReason = MAX_TOKENS_STOP_REASON;

    await expect(generateDocument(PARAMS)).rejects.toThrow();

    // The bytes themselves, not merely "html_content was empty" — an engine that
    // saved the partial under a different key would still fail this.
    for (const payload of updates) {
      expect(JSON.stringify(payload)).not.toContain("TRUNCATED-MARKER");
      expect(payload.status).not.toBe("approved");
      expect(payload.status).not.toBe("draft");
    }
  });

  it("marks the row failed with an errorMessage that names the ceiling", async () => {
    stopReason = MAX_TOKENS_STOP_REASON;

    await expect(generateDocument(PARAMS)).rejects.toThrow();

    const failures = updates.filter((u) => u.status === "failed");
    expect(failures).toHaveLength(1);
    const errorMessage = String(failures[0]!.errorMessage);
    expect(errorMessage).toContain("max_tokens");
    expect(errorMessage).toContain("governance_snapshot");
    // 64,000 since #559: adaptive thinking shares `max_tokens` with the
    // response text, so the ceiling moved with it. The guard's behaviour is
    // unchanged — this assertion is about the message naming the REAL ceiling.
    expect(errorMessage).toContain("64000");
    // The column is varchar(500) — an admin-facing message that gets sliced
    // mid-sentence is the same class of defect this issue is about.
    expect(errorMessage.length).toBeLessThanOrEqual(500);
  });

  it("does not go on to buy the remediation appendix for a document it will not save", async () => {
    stopReason = MAX_TOKENS_STOP_REASON;

    await expect(generateDocument(PARAMS)).rejects.toThrow();

    expect(appendixCalls).toBe(0);
  });

  it("surfaces the real numbers on the error, not a generic failure", async () => {
    stopReason = MAX_TOKENS_STOP_REASON;

    const err = await generateDocument(PARAMS).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(DocumentOutputTruncatedError);
    const truncated = err as DocumentOutputTruncatedError;
    expect(truncated.docTypeKey).toBe("governance_snapshot");
    // The engine's ceiling (raised for thinking in #559) vs the fixture's own
    // reported usage — deliberately different numbers now, so a regression that
    // conflated the two would be caught rather than passing by coincidence.
    expect(truncated.maxTokens).toBe(64000);
    expect(truncated.outputTokens).toBe(32000);
    expect(truncated.charsProduced).toBe(RAW_MODEL_TEXT.length);
  });
});

// ── 2. The controls — without these, "fail everything" would pass above ──────

describe("healthy responses still generate", () => {
  it("saves the document when stop_reason is end_turn", async () => {
    stopReason = "end_turn";

    const result = await generateDocument(PARAMS);

    expect(result.reused).toBe(false);
    expect(result.htmlContent).toContain("TRUNCATED-MARKER");
    const saved = updates.filter((u) => u.status === "approved");
    expect(saved).toHaveLength(1);
    expect(appendixCalls).toBe(1);
  });

  it("does not treat an ABSENT stop_reason as truncated", async () => {
    stopReason = undefined;

    const result = await generateDocument(PARAMS);

    expect(result.htmlContent).toContain("TRUNCATED-MARKER");
    expect(updates.some((u) => u.status === "failed")).toBe(false);
  });
});

// ── 3. The shared guard itself (also the definition document-engine-sow uses) ─

describe("ai-output-ceiling guard", () => {
  const CTX = { docTypeKey: "sow_consolidated", maxTokens: 16000, documentId: 9, mspCustomerId: 3, source: "unit" };

  function stubLogger() {
    return { info: vi.fn(), error: vi.fn() };
  }

  it("recognises only an exact max_tokens stop reason", () => {
    expect(isTruncatedByMaxTokens({ stop_reason: "max_tokens" })).toBe(true);
    expect(isTruncatedByMaxTokens({ stop_reason: "end_turn" })).toBe(false);
    expect(isTruncatedByMaxTokens({ stop_reason: "refusal" })).toBe(false);
    expect(isTruncatedByMaxTokens({ stop_reason: "MAX_TOKENS" })).toBe(false);
    expect(isTruncatedByMaxTokens({})).toBe(false);
    expect(isTruncatedByMaxTokens({ stop_reason: null })).toBe(false);
  });

  it("logs headroom at info and does not throw on a healthy response", () => {
    const log = stubLogger();

    assertOutputNotTruncated(
      { stop_reason: "end_turn", usage: { output_tokens: 4000 }, content: [{ text: "x".repeat(120) }] },
      CTX,
      log,
    );

    expect(log.error).not.toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledTimes(1);
    const bindings = log.info.mock.calls[0]![0] as Record<string, unknown>;
    expect(bindings.outputTokens).toBe(4000);
    expect(bindings.maxTokens).toBe(16000);
    // 4000/16000 — the headroom figure is what makes the derived ceiling
    // checkable against production instead of against one remembered incident.
    expect(bindings.outputTokensUsedPct).toBe(25);
    expect(bindings.charsProduced).toBe(120);
  });

  it("reports an unknown token count as null rather than inventing a percentage", () => {
    const log = stubLogger();

    assertOutputNotTruncated({ stop_reason: "end_turn", content: [{ text: "abc" }] }, CTX, log);

    const bindings = log.info.mock.calls[0]![0] as Record<string, unknown>;
    expect(bindings.outputTokens).toBeNull();
    expect(bindings.outputTokensUsedPct).toBeNull();
  });

  it("logs at error and throws on max_tokens", () => {
    const log = stubLogger();

    expect(() =>
      assertOutputNotTruncated(
        { stop_reason: "max_tokens", usage: { output_tokens: 16000 }, content: [{ text: "abc" }] },
        CTX,
        log,
      ),
    ).toThrow(DocumentOutputTruncatedError);

    expect(log.info).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalledTimes(1);
    const bindings = log.error.mock.calls[0]![0] as Record<string, unknown>;
    expect(bindings.stopReason).toBe("max_tokens");
    expect(bindings.docTypeKey).toBe("sow_consolidated");
    expect(bindings.source).toBe("unit");
  });

  it("does not itself throw while measuring an odd content shape", () => {
    const log = stubLogger();

    expect(() => assertOutputNotTruncated({ stop_reason: "end_turn" }, CTX, log)).not.toThrow();
    expect(() => assertOutputNotTruncated({ stop_reason: "end_turn", content: [] }, CTX, log)).not.toThrow();
    expect(() =>
      assertOutputNotTruncated({ stop_reason: "end_turn", content: [{ type: "thinking" }] }, CTX, log),
    ).not.toThrow();

    // A guard that failed on the way to reporting a failure would be worse than
    // no guard: it would turn every odd-shaped healthy response into an outage.
    expect(log.error).not.toHaveBeenCalled();
  });
});
