/**
 * document-engine-point-impact-555.test.ts
 *
 * Git #555, the other half. `finding-point-impact-555.test.ts` proves the VALUE
 * is real (raw impact column normalized against the live score's own
 * denominator). This file proves it REACHES the model — through the real
 * `generateDocument()` dry-run branch, which returns the fully assembled prompt,
 * for exactly the document types that are supposed to get it and no others.
 *
 * The resolver is mocked here on purpose, and the split is deliberate: mixing
 * the two would mean asserting prompt text against numbers produced three
 * modules away, and a failure would not say which half broke.
 *
 * What the issue actually turns on, and what is therefore pinned:
 *   1. `copilot_readiness` and `remediation_plan` carry a real per-finding point
 *      value in `{{findings}}` — the exact regression the issue reports is the
 *      model saying "the platform did not supply individual point values".
 *   2. Every other document type does NOT. #550's own investigation established
 *      the other seven rank on different dimensions; a Copilot point value there
 *      is a number the document never asked for.
 *   3. A null resolver result (no score, clamped score, engine unreachable)
 *      produces the pre-#555 block byte-for-byte, so the prompts' "where no
 *      point value is supplied" wording stays true rather than vestigial.
 *   4. The value sits on its own sub-line, leaving the check key at the end of
 *      the finding's own line — the placement #554's identifier rule describes.
 *
 * Run: pnpm --filter @workspace/api-server run test -- document-engine-point-impact-555
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

import type { CategorizedFinding } from "./tenant-signals.ts";
import type { FindingPointImpactResult } from "./finding-point-impact-format.ts";

// ── Test state (same harness as document-engine-secure-first-invest-last-550) ──

let selectQueue: unknown[][] = [];
let tenantFindings: string[] = [];
let tenantCategorizedFindings: CategorizedFinding[] = [];
let pointImpactResult: FindingPointImpactResult | null = null;

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

vi.mock("@workspace/integrations-anthropic-ai", () => ({
  anthropic: { messages: { create: vi.fn(), stream: vi.fn() } },
  withAiUsageCapture: vi.fn(),
  totalCapturedCostCents: vi.fn(),
}));

const computeCopilotGateMock = vi.fn();
vi.mock("./copilot-gate", () => ({
  computeCopilotGate: (...args: unknown[]) => computeCopilotGateMock(...args),
  COPILOT_GATE_THRESHOLD: 82,
}));

// The resolver itself is covered by finding-point-impact-555.test.ts; here it is
// a boundary, so the real (DB-backed, engine-driven) module never loads. ONLY the
// computation is stubbed — the prompt wording comes from the real, engine-free
// `finding-point-impact-format.ts`, so every string asserted below is the exact
// string the model is handed rather than a restatement of it.
vi.mock("./finding-point-impact", () => ({
  computeFindingPointImpacts: async () => pointImpactResult,
}));

vi.mock("./tenant-signals", () => ({
  buildTenantProfile: async () => ({
    mergedProfile: {},
    mergedProfileByCheck: {},
    findings: tenantFindings,
    categorizedFindings: tenantCategorizedFindings,
  }),
  findReusableDocument: async () => null,
  resolveDocumentOwnerUserId: async () => 11,
  namespacedProfileKey: (checkKey: string, propertyName: string) => `${checkKey}.${propertyName}`,
  NON_CHECK_PROFILE_NAMESPACE: "_profile",
}));

vi.mock("./prompt-loader", () => ({
  getPrompt: async () => "Write {{sections}} using {{profileSample}} and {{findings}}.",
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

import { generateDocument } from "./document-engine.ts";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CA_FINDING: CategorizedFinding = {
  text: "0 Conditional Access policies are configured (identity:ca-policy-count)",
  categories: ["security"],
  checkKey: "identity:ca-policy-count",
  severity: "critical",
  itemCount: 0,
  isLicenseGap: false,
};

const EXPOSURE_FINDING: CategorizedFinding = {
  text: "5 SharePoint sites are exposed org-wide (copilot:data-exposure-risk)",
  categories: ["copilot"],
  checkKey: "copilot:data-exposure-risk",
  severity: "critical",
  itemCount: 5,
  isLicenseGap: false,
};

const SCRIPT_FINDING: CategorizedFinding = {
  text: "Legacy script reported an unstructured governance gap",
  categories: [],
  checkKey: null,
  severity: null,
  itemCount: null,
  isLicenseGap: false,
};

const REAL_RESULT: FindingPointImpactResult = {
  pillar: "copilot",
  evaluation: {
    status: "scored", score: 53, evaluableSignalCount: 9,
    minRequiredSignals: 2, theoreticalMax: 260, reason: "scored from 9 evaluable copilot signals",
  },
  score: 53,
  threshold: 82,
  totalRecoverablePoints: 47,
  perFinding: [
    { checkKey: "identity:ca-policy-count", status: "scored", points: 34.6, signalKeys: ["signal.identity.ca-policy-count"] },
    { checkKey: "copilot:data-exposure-risk", status: "scored", points: 11.9, signalKeys: ["signal.copilot.data-exposure-risk"] },
    { checkKey: null, status: "unattributed", points: 0, signalKeys: [] },
  ],
};


async function assembleFor(key: string, label: string): Promise<string> {
  selectQueue = [[docTypeRow(key, label)], [{ mspId: 1 }], [{ name: "Acme MSP", primaryColor: "#000" }]];
  const result = await generateDocument({
    mspCustomerId: 42,
    projectId: 7,
    docTypeKey: key,
    dryRun: true,
  });
  return result.assembledPrompt;
}

beforeEach(() => {
  vi.clearAllMocks();
  tenantCategorizedFindings = [CA_FINDING, EXPOSURE_FINDING, SCRIPT_FINDING];
  tenantFindings = tenantCategorizedFindings.map((f) => f.text);
  pointImpactResult = REAL_RESULT;
  computeCopilotGateMock.mockResolvedValue({
    score: 53,
    threshold: 82,
    status: "no_go",
    source: "health_engine:copilot",
    evaluation: { status: "scored", evaluableSignalCount: 9, minRequiredSignals: 2, reason: "scored" },
  });
});

describe("real per-finding point values reach {{findings}} (#555)", () => {
  it.each([
    ["copilot_readiness", "Copilot Go-Live Score Report"],
    ["remediation_plan", "Remediation Plan"],
  ])("%s carries the real value for every priced finding", async (key, label) => {
    const prompt = await assembleFor(key, label);

    expect(prompt).toContain("POINT IMPACT IF FIXED: 34.6 points");
    expect(prompt).toContain("POINT IMPACT IF FIXED: 11.9 points");
    // The exact statement #555 exists to make impossible.
    expect(prompt).not.toContain("did not supply individual point values");
  });

  it("hands over the reconciliation arithmetic instead of leaving the model to do it", async () => {
    const prompt = await assembleFor("copilot_readiness", "Copilot Go-Live Score Report");
    expect(prompt).toContain("Current readiness score: 53 out of 100");
    expect(prompt).toContain("points needed to clear it: 29");
    expect(prompt).toContain("Points recoverable across every finding currently costing this tenant points: 47.0");
    expect(prompt).toContain("Points shown in the list below: 46.5");
  });

  it("puts the value on its own sub-line, leaving the check key at the end of the finding's line (#554)", async () => {
    const prompt = await assembleFor("remediation_plan", "Remediation Plan");
    expect(prompt).toContain(
      "1. 0 Conditional Access policies are configured (identity:ca-policy-count)\n   POINT IMPACT IF FIXED: 34.6 points",
    );
  });

  it("says NOT ATTRIBUTABLE for a finding with no check key rather than pricing it at zero", async () => {
    const prompt = await assembleFor("copilot_readiness", "Copilot Go-Live Score Report");
    expect(prompt).toContain("3. Legacy script reported an unstructured governance gap\n   POINT IMPACT IF FIXED: NOT ATTRIBUTABLE");
  });

  it("leaves the other seven document types unpriced — they rank on other dimensions (#550)", async () => {
    const prompt = await assembleFor("security_posture_report", "Security Posture Report");
    expect(prompt).not.toContain("POINT IMPACT IF FIXED");
    expect(prompt).not.toContain("DO NOT RECALCULATE");
    // Still the plain numbered list it has always been.
    expect(prompt).toContain("1. 0 Conditional Access policies are configured (identity:ca-policy-count)");
  });

  it("falls back to the pre-#555 block when the platform has no score to price against", async () => {
    pointImpactResult = null;
    const prompt = await assembleFor("copilot_readiness", "Copilot Go-Live Score Report");
    expect(prompt).not.toContain("POINT IMPACT IF FIXED");
    expect(prompt).toContain("1. 0 Conditional Access policies are configured (identity:ca-policy-count)");
    // And the identifier rule every document type gets is still there.
    expect(prompt).toContain("IDENTIFIERS: Do NOT invent finding IDs");
  });

  it("computes the Copilot pillar ONCE per document — the gate reuses the resolver's evaluation", async () => {
    await assembleFor("copilot_readiness", "Copilot Go-Live Score Report");
    expect(computeCopilotGateMock).toHaveBeenCalledTimes(1);
    expect(computeCopilotGateMock).toHaveBeenCalledWith(42, { evaluation: REAL_RESULT.evaluation });
  });
});

describe("no findings at all (#555)", () => {
  it("still refuses to invent findings, and adds no point-value block", async () => {
    tenantCategorizedFindings = [];
    tenantFindings = [];
    pointImpactResult = { ...REAL_RESULT, perFinding: [] };

    const prompt = await assembleFor("copilot_readiness", "Copilot Go-Live Score Report");
    expect(prompt).toContain("No findings were recorded for this client. Do NOT invent findings.");
    expect(prompt).not.toContain("POINT IMPACT IF FIXED");
  });
});
