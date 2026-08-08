/**
 * document-engine-secure-first-invest-last-550.test.ts
 *
 * Git #550. Confirmed live (2026-08-08) on a real copilot_readiness document:
 * "Path to clearance" listed a Microsoft license purchase suggestion as Step 1
 * and "0 Conditional Access policies" — a free, critical, immediately-actionable
 * fix — as Step 2. Findings were ranked by point-impact alone, with no regard
 * for whether a fix costs the customer a new Microsoft purchase first.
 *
 * Shane's decision: Secure-first, Invest-last. Every finding NOT classified
 * `license_gap` (Tier 1) before every `license_gap`-classified finding
 * (Tier 2), regardless of either finding's own point value. This must be a
 * real, deterministic sort in code — not a prompt instruction — applied
 * BEFORE {{findings}} is assembled.
 *
 * Two things are tested:
 *   1. `sortFindingsSecureFirstInvestLast()` itself (pure function) — the
 *      exact live scenario reproduced as fixture data: a license-purchase
 *      finding arriving BEFORE the free CA-policy-count finding in raw order,
 *      asserted to land after it once sorted, regardless of point value.
 *   2. The real `generateDocument()` dry-run branch, for both gated document
 *      types (copilot_readiness, remediation_plan) and one non-gated type, so
 *      the guarantee is proven at the point it actually matters: the text
 *      that reaches {{findings}} in the assembled prompt.
 *
 * Run: pnpm --filter @workspace/api-server run test -- document-engine-secure-first-invest-last-550
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

import type { CategorizedFinding } from "./tenant-signals.ts";

// ── Test state (mirrors document-engine-copilot-gate.test.ts's harness) ────────

let selectQueue: unknown[][] = [];
let tenantFindings: string[] = [];
let tenantCategorizedFindings: CategorizedFinding[] = [];

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

vi.mock("./copilot-gate", () => ({
  computeCopilotGate: async () => ({
    score: 74,
    threshold: 82,
    status: "no_go",
    source: "health_engine:copilot",
    evaluation: { status: "scored", evaluableSignalCount: 9, minRequiredSignals: 2, reason: "scored" },
  }),
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

import { generateDocument, sortFindingsSecureFirstInvestLast } from "./document-engine.ts";

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

// ─── Fixtures matching the live CA-policy-count-vs-license-suggestion case ─────
//
// The real shape reported live: a high-point-value license-purchase
// recommendation ordered ahead of a low-point-value but free, critical,
// available-today fix. Point value is deliberately INVERTED relative to
// classification here — the license-gapped finding is the highest-impact one
// — so a test that merely sorted by point value would still fail this.

const CA_POLICY_FINDING: CategorizedFinding = {
  text: "identity:conditional-access-policy-count: critical severity condition matched on latest monitoring scan (0 items)",
  categories: ["security"],
  checkKey: "identity:conditional-access-policy-count",
  severity: "critical",
  itemCount: 0,
  isLicenseGap: false,
};

const LICENSE_PURCHASE_FINDING: CategorizedFinding = {
  text: "licensing:copilot-seat-coverage: requires Microsoft 365 Copilot add-on licensing to evaluate (worth 15 points — the single highest-impact item)",
  categories: ["licensing"],
  checkKey: "licensing:copilot-seat-coverage",
  severity: "critical",
  itemCount: 15,
  isLicenseGap: true,
};

const MFA_FINDING: CategorizedFinding = {
  text: "identity:mfa-registration: warning severity condition matched on latest monitoring scan (62 items)",
  categories: ["security"],
  checkKey: "identity:mfa-registration",
  severity: "warning",
  itemCount: 62,
  isLicenseGap: false,
};

describe("sortFindingsSecureFirstInvestLast() — pure function (#550)", () => {
  it("moves a license_gap finding after every non-license_gap finding, even when it arrives first and carries the highest point value", () => {
    // Reproduces the exact live shape: license suggestion (Step 1, highest
    // point value) BEFORE the free CA-policy fix (Step 2) in raw order.
    const raw = [LICENSE_PURCHASE_FINDING.text, CA_POLICY_FINDING.text];
    const categorized = [LICENSE_PURCHASE_FINDING, CA_POLICY_FINDING];

    const sorted = sortFindingsSecureFirstInvestLast(raw, categorized);

    expect(sorted).toEqual([CA_POLICY_FINDING.text, LICENSE_PURCHASE_FINDING.text]);
    expect(sorted.indexOf(CA_POLICY_FINDING.text)).toBeLessThan(sorted.indexOf(LICENSE_PURCHASE_FINDING.text));
  });

  it("is a STABLE partition — preserves relative order within each tier, moving nothing else", () => {
    const raw = [MFA_FINDING.text, LICENSE_PURCHASE_FINDING.text, CA_POLICY_FINDING.text];
    const categorized = [MFA_FINDING, LICENSE_PURCHASE_FINDING, CA_POLICY_FINDING];

    const sorted = sortFindingsSecureFirstInvestLast(raw, categorized);

    // Tier 1 keeps its original relative order (MFA before CA-policy, exactly
    // as given — the sort never re-ranks within a tier).
    expect(sorted).toEqual([MFA_FINDING.text, CA_POLICY_FINDING.text, LICENSE_PURCHASE_FINDING.text]);
  });

  it("is a no-op (same order, same array reference behavior) when there is no license_gap finding at all", () => {
    const raw = [MFA_FINDING.text, CA_POLICY_FINDING.text];
    const categorized = [MFA_FINDING, CA_POLICY_FINDING];

    expect(sortFindingsSecureFirstInvestLast(raw, categorized)).toEqual(raw);
  });

  it("never promotes a license_gap finding even when every other finding is also license_gap-free and ranked below it by severity text", () => {
    // Multiple license_gap findings: they stay together, after Tier 1, in
    // their own given relative order.
    const secondLicenseFinding: CategorizedFinding = {
      ...LICENSE_PURCHASE_FINDING,
      text: "licensing:teams-premium-coverage: requires Microsoft Teams Premium add-on",
      checkKey: "licensing:teams-premium-coverage",
    };
    const raw = [LICENSE_PURCHASE_FINDING.text, secondLicenseFinding.text, CA_POLICY_FINDING.text];
    const categorized = [LICENSE_PURCHASE_FINDING, secondLicenseFinding, CA_POLICY_FINDING];

    const sorted = sortFindingsSecureFirstInvestLast(raw, categorized);

    expect(sorted).toEqual([CA_POLICY_FINDING.text, LICENSE_PURCHASE_FINDING.text, secondLicenseFinding.text]);
  });
});

describe("generateDocument() — Secure-first/Invest-last in the assembled findings block (#550)", () => {
  beforeEach(() => {
    tenantFindings = [LICENSE_PURCHASE_FINDING.text, CA_POLICY_FINDING.text];
    tenantCategorizedFindings = [LICENSE_PURCHASE_FINDING, CA_POLICY_FINDING];
  });

  it("copilot_readiness: the free CA-policy finding lands before the license-purchase finding in {{findings}}, regardless of raw order", async () => {
    const prompt = await assembleFor("copilot_readiness", "Copilot Go-Live Score Report");

    expect(prompt).toContain(CA_POLICY_FINDING.text);
    expect(prompt).toContain(LICENSE_PURCHASE_FINDING.text);
    expect(prompt.indexOf(CA_POLICY_FINDING.text)).toBeLessThan(prompt.indexOf(LICENSE_PURCHASE_FINDING.text));
  });

  it("remediation_plan: same guarantee applies", async () => {
    const prompt = await assembleFor("remediation_plan", "Remediation Plan");

    expect(prompt.indexOf(CA_POLICY_FINDING.text)).toBeLessThan(prompt.indexOf(LICENSE_PURCHASE_FINDING.text));
  });

  it("a document type outside the gated set keeps the RAW order — the sort is deliberately scoped, not global", async () => {
    const prompt = await assembleFor("governance_maturity_report", "Governance Maturity Report");

    // Raw order was license-first; an ungated type must reproduce it verbatim
    // rather than silently inheriting #550's ordering.
    expect(prompt.indexOf(LICENSE_PURCHASE_FINDING.text)).toBeLessThan(prompt.indexOf(CA_POLICY_FINDING.text));
  });
});
