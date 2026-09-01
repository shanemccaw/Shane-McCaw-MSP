/**
 * document-engine-cost.test.ts
 *
 * Phase 5 of the AI Cost Governance & Billing Rollup initiative (#53), at the
 * engine boundary: what `generateDocument()` itself returns as `costCents`.
 *
 * `ai-cost-capture.test.ts` covers the capture plumbing in isolation. This file
 * drives the REAL engine — through the real metered client and the real capture
 * scope, with only the database and the tenant-data reads stubbed — so the
 * three branches are asserted as a caller actually experiences them:
 *
 *   - real generation   → `costCents` is the sink's persisted figure, "recorded"
 *   - dry-run preview   → `0` + "no-ai-call", and provably no model call
 *   - drift-gate reuse  → `0` + "no-ai-call", likewise no model call
 *   - recording failed  → `null` + "unknown", never `0`
 *
 * Run: pnpm --filter @workspace/api-server run test -- document-engine-cost
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  registerAiUsageSink,
  resetAiUsageBuffer,
  type AiUsagePersistResult,
} from "@workspace/integrations-anthropic-ai/metering";

// ── Test state ────────────────────────────────────────────────────────────────

/** Row arrays handed to successive `db.select()` calls, in query order. */
let selectQueue: unknown[][] = [];
/** Every Anthropic call the engine made — asserted to be empty on no-AI paths. */
let anthropicCalls: unknown[] = [];
/** What `findReusableDocument()` returns; non-null exercises the drift gate. */
let reusable: { documentId: number; htmlContent: string; docTypeKey: string } | null = null;

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

/** The complete Message the fake SDK resolves to, on either transport. */
function generatedMessage(): Record<string, unknown> {
  return {
    model: "claude-sonnet-4-6",
    content: [{ type: "text", text: "<html>generated</html>" }],
    usage: { input_tokens: 1200, output_tokens: 800 },
  };
}

/**
 * Minimal stand-in for the SDK's `MessageStream`, covering the two surfaces
 * that matter here: `on()` registers listeners without consuming, and
 * `finalMessage()` emits the text chunks, then 'finalMessage' — which is what
 * `meterAnthropicClient` reads real token counts off — then resolves to the
 * complete Message.
 *
 * Declared as a function so the hoisted `vi.mock` factory below can reach it.
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
        // A real stream delivers across ticks; awaiting here means a listener
        // that throws does so out of the caller's synchronous frame, exactly
        // as it would in production.
        await Promise.resolve();
        for (const listener of listeners["text"] ?? []) listener(chunk);
      }
      for (const listener of listeners["finalMessage"] ?? []) listener(message);
      return message;
    },
  };
  return stream;
}

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
    insert: () => ({
      values: () => ({ returning: async () => [{ id: 4242 }] }),
    }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  },
  aiPromptsTable: {},
  documentTypesTable: { key: "key" },
  insightsGeneratedDocumentsTable: { id: "id" },
  tenantsTable: { id: "id", mspId: "mspId" },
  mspsTable: { id: "id", name: "name", primaryColor: "primaryColor" },
}));

// The genuine metering module, wrapping a fake SDK — so the engine's cost comes
// through the real capture path rather than a stub that could agree with the
// engine while both are wrong.
vi.mock("@workspace/integrations-anthropic-ai", async () => {
  const metering = await import("@workspace/integrations-anthropic-ai/metering");
  return {
    withAiUsageCapture: metering.withAiUsageCapture,
    totalCapturedCostCents: metering.totalCapturedCostCents,
    anthropic: metering.meterAnthropicClient({
      messages: {
        create: (async (params: unknown) => {
          anthropicCalls.push(params);
          return generatedMessage();
        }) as never,
        // The engine streams its narrative call. The fake mirrors the SDK's
        // `MessageStream` where the metering tap and the engine touch it: `on`
        // registers non-consuming listeners, and `finalMessage()` both emits
        // 'finalMessage' (the tap's usage source) and resolves to the same
        // complete Message shape `create` returns.
        stream: ((params: unknown) => {
          anthropicCalls.push(params);
          return fakeMessageStream(["<html>gen", "erated</html>"], generatedMessage());
        }) as never,
      },
    }),
  };
});

vi.mock("./tenant-signals", () => ({
  buildTenantProfile: async () => ({
    mergedProfile: { mfaEnabled: true },
    // Namespaced companion (#544) — what {{profileSample}} now reads.
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

vi.mock("./sow-pricing", () => ({
  extractAiHtml: () => "<html>generated</html>",
}));

vi.mock("./omg-card-generator-v2", () => ({
  generateOmgCardsFromTelemetry: async () => undefined,
}));

// Git #547's Copilot Gate. `DOC_TYPE_ROW` is `governance_snapshot`, so the
// engine never calls this — but the import is real, and copilot-gate.ts pulls
// the whole health-engine → priority-engine chain in at module load. Stubbed at
// the boundary for the same reason the appendix below is. `document-engine-
// copilot-gate.test.ts` is where the gate's own wiring is asserted.
vi.mock("./copilot-gate", () => ({
  computeCopilotGate: vi.fn(),
}));

// Git #493's remediation appendix. DOC_TYPE_ROW below leaves
// `remediationDetailAppendix` unset, so the engine never calls this — but the
// import is real, and the module reaches the AI generator plus two more tables.
// Stubbed at the boundary so this file keeps measuring only what it is about:
// the cost figure `generateDocument()` hands back for its own narrative call.
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

/** Rows for the queries a full generation issues, in the order it issues them. */
function queueHappyPath(): void {
  selectQueue = [
    [DOC_TYPE_ROW],           // document type lookup
    [{ mspId: 1 }],           // resolveMspBranding: customer → mspId
    [{ name: "Acme MSP", primaryColor: "#000" }], // resolveMspBranding: the MSP
  ];
}

const PARAMS = { mspCustomerId: 42, projectId: 7, docTypeKey: "governance_snapshot" };

beforeEach(() => {
  anthropicCalls = [];
  reusable = null;
  resetAiUsageBuffer();
  queueHappyPath();
});

afterEach(() => {
  registerAiUsageSink(null);
  resetAiUsageBuffer();
});

describe("generateDocument() — real generation", () => {
  it("returns the costCents the ledger recorded for its own calls", async () => {
    // Not derivable from the token counts by any pricing formula — so this
    // passes only if the engine read the persisted rows back rather than
    // recomputing a cost of its own.
    //
    // Since #559 a generation makes TWO calls: the narrative, and the
    // claim-binding audit that gates it. Both are real spend for this customer,
    // so both belong in the figure this document reports. Distinct amounts, so
    // a total of 1379 can only be the sum — the same number twice would pass
    // whether the audit's cost was added, dropped, or counted twice.
    let call = 0;
    registerAiUsageSink((): AiUsagePersistResult => {
      call += 1;
      return { costCents: call === 1 ? 1337 : 42, eventId: String(87 + call) };
    });

    const result = await generateDocument(PARAMS);

    expect(result.documentId).toBe(4242);
    expect(result.htmlContent).toBe("<html>generated</html>");
    expect(result.docTypeKey).toBe("governance_snapshot");
    expect(result.costCents).toBe(1379);
    expect(result.costStatus).toBe("recorded");
    expect(anthropicCalls).toHaveLength(2);
  });

  it("attributes the call to the customer and artifact it is generating", async () => {
    let attributed: { customerId?: number | null; generatedArtifactType?: string; generatedArtifactId?: string } | null = null;
    registerAiUsageSink((record): AiUsagePersistResult => {
      attributed = record;
      return { costCents: 100, eventId: "1" };
    });

    await generateDocument(PARAMS);

    // The cost that comes back is the cost of THIS document's row — same
    // customer, same artifact id — which is what makes it safe to report.
    expect(attributed!.customerId).toBe(42);
    expect(attributed!.generatedArtifactType).toBe("governance_snapshot");
    expect(attributed!.generatedArtifactId).toBe("4242");
  });

  it("reports unknown, not zero, when the usage row could not be recorded", async () => {
    // recordAiUsage() is deliberately non-fatal and returns null on failure;
    // the sink relays that as "nothing persisted".
    registerAiUsageSink(() => undefined);

    const result = await generateDocument(PARAMS);

    // The document still generated — billing faults never break generation.
    expect(result.documentId).toBe(4242);
    expect(result.costStatus).toBe("unknown");
    expect(result.costCents).toBeNull();
    expect(result.costCents).not.toBe(0);
  });
});

describe("generateDocument() — paths that make no AI call", () => {
  it("a dry-run preview reports a real zero marked no-ai-call", async () => {
    registerAiUsageSink((): AiUsagePersistResult => ({ costCents: 999, eventId: "1" }));

    const result = await generateDocument({ ...PARAMS, dryRun: true });

    expect(result.dryRun).toBe(true);
    expect(result.costCents).toBe(0);
    expect(result.costStatus).toBe("no-ai-call");
    // The zero is honest because nothing was called — asserted, not assumed.
    expect(anthropicCalls).toHaveLength(0);
  });

  it("a drift-gate reuse reports zero for this request, not the original's cost", async () => {
    registerAiUsageSink((): AiUsagePersistResult => ({ costCents: 999, eventId: "1" }));
    reusable = { documentId: 77, htmlContent: "<html>old</html>", docTypeKey: "governance_snapshot" };
    selectQueue = [[DOC_TYPE_ROW]];

    const result = await generateDocument(PARAMS);

    expect(result.documentId).toBe(77);
    expect(result.costCents).toBe(0);
    expect(result.costStatus).toBe("no-ai-call");
    expect(anthropicCalls).toHaveLength(0);
  });
});
