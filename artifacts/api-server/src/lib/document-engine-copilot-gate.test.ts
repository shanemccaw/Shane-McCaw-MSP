/**
 * document-engine-copilot-gate.test.ts
 *
 * Git #547. The Copilot Go-Live Score Report is the one document whose entire
 * premise is stating the tenant's real score, and `document-engine.ts` had zero
 * references to `copilot-gate.ts` — so the score the platform had already
 * computed never reached the model, and generated documents said "the readiness
 * score from the platform scan is pending" on tenants whose scan was complete.
 *
 * This file drives the REAL engine (`generateDocument()`'s dry-run branch, which
 * returns the fully assembled prompt) with only the DB, the tenant reads and the
 * gate computation stubbed, and asserts the thing the bug was about: that the
 * REAL value lands in the assembled prompt, in both of the two real cases.
 *
 *   1. `evaluation.status === "scored"`        → the real number, the real
 *      verdict against the real 82 threshold, and the real point gap — and NOT
 *      the word "pending".
 *   2. `evaluation.status === "not_evaluated"` → the engine's own real reason,
 *      verbatim, and an explicit instruction NOT to call it pending. A vague
 *      "pending" here is the original bug wearing a different hat: it tells the
 *      reader the scan has not finished when it has.
 *
 * Plus the two guards the injection itself turns on:
 *   3. Every OTHER document type is untouched — no gate call, no block. The
 *      other eight make no go-live claim (issue's explicit out-of-scope).
 *   4. A live prompt body with no `{{copilotGate}}` slot still gets the block,
 *      appended. The body is admin-editable and republished by a hand-run manual
 *      migration, so "the token is not there yet" must not mean "the score is
 *      silently dropped again".
 *
 * Run: pnpm --filter @workspace/api-server run test -- document-engine-copilot-gate
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

import type { CopilotGateResult } from "./copilot-gate.ts";

// ── Test state ────────────────────────────────────────────────────────────────

/** Row arrays handed to successive `db.select()` calls, in query order. */
let selectQueue: unknown[][] = [];
/** Customer ids `computeCopilotGate` was called with — empty on non-score docs. */
let gateCalls: number[] = [];
/** What the stubbed `computeCopilotGate` resolves to. */
let gateResult: CopilotGateResult = scoredGate(74);
/** The prompt body `getPrompt` returns; varied to exercise token vs. append. */
let promptBody = "Write {{sections}} using {{profileSample}} and {{findings}}.\n\nGATE:\n{{copilotGate}}";
/** The tenant's real findings, as `buildTenantProfile` returns them (Git #549 varies it to empty). */
let tenantFindings: string[] = ["A finding"];

/**
 * A real `scored` gate, shaped exactly as `computeCopilotGate` returns it —
 * including `evaluation.reason`, which is the engine's own sentence and is what
 * the block quotes rather than paraphrases.
 */
function scoredGate(score: number): CopilotGateResult {
  return {
    score,
    threshold: 82,
    status: score >= 82 ? "go" : "no_go",
    source: "health_engine:copilot",
    evaluation: {
      status: "scored",
      evaluableSignalCount: 9,
      minRequiredSignals: 2,
      reason: "scored from 9 evaluable copilot signals",
    },
  };
}

/** The #517 honest-withholding case: a real reason, and no number at all. */
function notEvaluatedGate(reason: string): CopilotGateResult {
  return {
    score: null,
    threshold: 82,
    status: null,
    source: "health_engine:copilot",
    evaluation: {
      status: "not_evaluated",
      evaluableSignalCount: 1,
      minRequiredSignals: 2,
      reason,
    },
  };
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

function docTypeRow(key: string, label: string): Record<string, unknown> {
  return {
    key,
    label,
    category: "consulting",
    pipelineCategory: "standalone",
    aiPromptId: null,
    sections: [],
    sectionHints: "Verdict",
    includedProfileKeyPatterns: [],
    includedSignalCategories: [],
  };
}

// ── Module boundaries ─────────────────────────────────────────────────────────

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

// No model call happens on the dry-run branch; these exist because a mock
// missing a name the module under test imports is an import-time error.
vi.mock("@workspace/integrations-anthropic-ai", () => ({
  anthropic: { messages: { create: vi.fn(), stream: vi.fn() } },
  withAiUsageCapture: vi.fn(),
  totalCapturedCostCents: vi.fn(),
}));

/**
 * `copilot-gate.ts` itself is explicitly out of scope for #547 and has its own
 * suite (`copilot-gate.test.ts`) — it is correct and complete, and this issue is
 * purely the wiring gap. Stubbing it here keeps this file measuring exactly the
 * gap: whether the engine calls it, and whether what it returns reaches the
 * prompt intact. The fixtures above are its real return shape, typed against the
 * real `CopilotGateResult`, so a change to that shape fails this file at tsc.
 */
vi.mock("./copilot-gate", () => ({
  computeCopilotGate: async (customerId: number) => {
    gateCalls.push(customerId);
    return gateResult;
  },
}));

vi.mock("./tenant-signals", () => ({
  buildTenantProfile: async () => ({
    mergedProfile: { mfaEnabled: true },
    mergedProfileByCheck: { "identity:mfa-state": { mfaEnabled: true } },
    findings: tenantFindings,
    categorizedFindings: tenantFindings.map((text) => ({ text, categories: ["security"] })),
  }),
  findReusableDocument: async () => null,
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
  getPrompt: async () => promptBody,
  getDocumentStylePrefix: async () => "<style></style>",
}));

vi.mock("./sow-pricing", () => ({ extractAiHtml: () => "<html>generated</html>" }));

vi.mock("./omg-card-generator-v2", () => ({
  generateOmgCardsFromTelemetry: async () => undefined,
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

import { generateDocument, buildCopilotGateBlock, injectCopilotGateBlock } from "./document-engine.ts";

/** Rows the dry-run branch reads, in the order it reads them. */
function queueDryRun(key: string, label: string): void {
  selectQueue = [
    [docTypeRow(key, label)],
    [{ mspId: 1 }],
    [{ name: "Acme MSP", primaryColor: "#000" }],
  ];
}

async function assembleFor(key: string, label: string): Promise<string> {
  queueDryRun(key, label);
  const result = await generateDocument({
    mspCustomerId: 42,
    projectId: 7,
    docTypeKey: key,
    dryRun: true,
  });
  return result.assembledPrompt;
}

beforeEach(() => {
  gateCalls = [];
  gateResult = scoredGate(74);
  promptBody = "Write {{sections}} using {{profileSample}} and {{findings}}.\n\nGATE:\n{{copilotGate}}";
  tenantFindings = ["A finding"];
});

describe("generateDocument() — copilot_readiness gate injection (#547)", () => {
  it("puts the REAL score, threshold and NO-GO verdict in the assembled prompt", async () => {
    gateResult = scoredGate(74);

    const prompt = await assembleFor("copilot_readiness", "Copilot Go-Live Score Report");

    expect(gateCalls).toEqual([42]);
    // The number itself — the single thing the document turns on.
    expect(prompt).toContain("Readiness score: 74 out of 100");
    expect(prompt).toContain("Copilot Gate threshold: 82");
    expect(prompt).toContain("NO-GO");
    // Stated, not left as arithmetic for the model to do.
    expect(prompt).toContain("Points needed to clear the Gate: 8");
    // The engine's own sentence, quoted rather than paraphrased.
    expect(prompt).toContain("scored from 9 evaluable copilot signals");
    // The bug itself: a scored tenant must never be told its score is pending.
    expect(prompt).toContain("Never write that the score is pending");
    expect(prompt).not.toContain("Score pending from the platform scan");
  });

  it("states a GO verdict and the real margin at and above the Gate", async () => {
    // 82 itself is a pass (#359, asserted explicitly in copilot-gate.ts).
    gateResult = scoredGate(82);

    const prompt = await assembleFor("copilot_readiness", "Copilot Go-Live Score Report");

    expect(prompt).toContain("Readiness score: 82 out of 100");
    expect(prompt).toContain("GO — this tenant IS cleared");
    expect(prompt).toContain("Margin above the Gate: 0 point(s).");
    expect(prompt).not.toContain("NO-GO");
  });

  it("states the REAL not-evaluated reason, never a placeholder 'pending'", async () => {
    const reason =
      "only 1 evaluable copilot signal was measured for this tenant — below the floor of 2 required to score";
    gateResult = notEvaluatedGate(reason);

    const prompt = await assembleFor("copilot_readiness", "Copilot Go-Live Score Report");

    expect(gateCalls).toEqual([42]);
    // The real reason, verbatim — this is the whole point of the branch.
    expect(prompt).toContain(reason);
    expect(prompt).toContain("Readiness score: NOT SCORED");
    expect(prompt).toContain("Copilot Gate threshold: 82");
    expect(prompt).toContain("Evaluable Copilot-impacting signals found for this tenant: 1");
    expect(prompt).toContain("minimum required to score: 2");
    // Not scored is NOT a verdict — a withheld number must not become a red one.
    expect(prompt).toContain("NO VERDICT ISSUED");
    // And it is explicitly not the "pending" that started this issue.
    expect(prompt).toContain("the scan is not the blocker");
    // No number stands in for the withheld score anywhere in the block.
    expect(buildCopilotGateBlock(gateResult)).not.toContain("out of 100");
  });

  it("leaves every other document type completely untouched", async () => {
    // The other eight make no go-live claim — the issue puts them out of scope
    // explicitly, so the engine must not even reach for the gate.
    const prompt = await assembleFor("governance_snapshot", "Governance Snapshot");

    expect(gateCalls).toEqual([]);
    expect(prompt).not.toContain("COPILOT GO-LIVE SCORE");
    expect(prompt).not.toContain("Readiness score:");
    // An unsubstituted token is left exactly as it always was for other types.
    expect(prompt).toContain("{{copilotGate}}");
  });

  it("appends the block when the live prompt body carries no {{copilotGate}} slot", async () => {
    // The 2026-08-06 body has no such token, and the row is republished by a
    // hand-run migration — so between deploy and that run, the token is absent.
    // The score must still reach the model rather than being silently dropped.
    promptBody = "Write {{sections}} using {{profileSample}} and {{findings}}.";
    gateResult = scoredGate(74);

    const prompt = await assembleFor("copilot_readiness", "Copilot Go-Live Score Report");

    expect(prompt).toContain("COPILOT GO-LIVE SCORE — PLATFORM GROUND TRUTH");
    expect(prompt).toContain("Readiness score: 74 out of 100");
  });

  it("substitutes the token in place rather than appending when it is present", async () => {
    promptBody = "HEAD\n{{copilotGate}}\nTAIL";
    gateResult = scoredGate(74);

    const prompt = await assembleFor("copilot_readiness", "Copilot Go-Live Score Report");

    expect(prompt).not.toContain("{{copilotGate}}");
    expect(prompt.endsWith("TAIL")).toBe(true);
    expect(prompt.indexOf("Readiness score: 74 out of 100")).toBeLessThan(prompt.indexOf("TAIL"));
  });
});

// ─── Git #549 — no invented finding identifiers ───────────────────────────────
//
// Observed live on a real copilot_readiness document: the model cited a finding
// as "COP-006", a code that exists nowhere in this platform's data. The prompt
// had nothing telling it not to, and the findings block hands it an ordinal
// list that reads like an ID scheme. Reuses this file's existing real-engine
// harness (assembleFor returns the fully assembled prompt) rather than a second
// one — this is the same question, asked of the same string.

describe("generateDocument() — finding identifier honesty (#549)", () => {
  it("carries the no-invented-identifiers rule into the assembled prompt", async () => {
    const prompt = await assembleFor("copilot_readiness", "Copilot Go-Live Score Report");

    expect(prompt).toContain("Do NOT invent finding IDs");
    // The literal shape that was actually observed, named so the rule cannot be
    // reworded into something that no longer forbids it.
    expect(prompt).toContain("COP-006");
    // The ordinals are the near-miss: without this the model reads "1." as an ID.
    expect(prompt).toContain("are presentation order only");
  });

  it("applies to every document type, not just copilot_readiness", async () => {
    // #547's gate injection is deliberately one-key-only; this rule is the
    // opposite — every type renders {{findings}}, so every type can fabricate.
    const prompt = await assembleFor("remediation_plan", "Remediation Plan");
    expect(prompt).toContain("Do NOT invent finding IDs");
  });

  it("still states the rule when the tenant has no findings at all", async () => {
    // The empty-findings branch is a different string; a zero-finding document
    // is if anything MORE likely to reach for invented structure.
    tenantFindings = [];

    const prompt = await assembleFor("copilot_readiness", "Copilot Go-Live Score Report");

    expect(prompt).toContain("No findings were recorded for this client");
    expect(prompt).toContain("Do NOT invent finding IDs");
  });
});

// ─── Git #554 — check key must not be used as a heading ───────────────────────
//
// Confirmed live: {{findings}} already carries "<label> (<checkKey>)" per
// #549's WORDING CONTRACT (label leads, check key trails) — this was never a
// findings-assembly bug. #549's own rule told the model to refer to a finding
// "by the real check key ... nothing else", which is what the model then used
// as heading/title text (e.g. rendering "appgov:cert-secret-expiration" as a
// document header instead of the authored sentence in front of it). The rule
// now explicitly forbids that specific misuse.

describe("generateDocument() — finding check key must not become a heading (#554)", () => {
  it("carries an explicit instruction against using the check key as a heading/title", async () => {
    const prompt = await assembleFor("copilot_readiness", "Copilot Go-Live Score Report");

    expect(prompt).toContain("Do NOT use a finding's check key");
    expect(prompt).toContain("as a heading, title, or subheading");
    expect(prompt).toContain("appgov:cert-secret-expiration");
  });

  it("applies to every document type, not just copilot_readiness", async () => {
    const prompt = await assembleFor("remediation_plan", "Remediation Plan");
    expect(prompt).toContain("Do NOT use a finding's check key");
  });
});

describe("injectCopilotGateBlock()", () => {
  it("is stable across repeated calls (the /g token regex must not carry state)", () => {
    // The token regex is module-level and /g, so `test()` advances its
    // lastIndex. Without a reset, the SECOND generation in a process misses the
    // token and appends instead — the block would still be present, so only a
    // same-input-same-output assertion catches it.
    const template = "HEAD\n{{copilotGate}}\nTAIL";
    const first = injectCopilotGateBlock(template, scoredGate(74));
    const second = injectCopilotGateBlock(template, scoredGate(74));
    expect(second).toBe(first);
    expect(first.endsWith("TAIL")).toBe(true);
    expect(first).toContain(buildCopilotGateBlock(scoredGate(74)));
  });
});
