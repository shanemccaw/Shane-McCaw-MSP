/**
 * pillar-report-narrative.test.ts
 *
 * #292 — the four pillar reports' AI-written sections: Governance Posture,
 * Compliance & Regulatory Alignment, Copilot Licensing Alignment, and
 * Operational Health & Service Integrity. Since extended by a fifth, Copilot
 * Adoption & Usage, which is exactly the "fifth report added to the table gets
 * the whole guarantee for free" case the header below anticipated — and the
 * most useful one to have it, because it is the only report whose pillar card
 * carries no measured stats at all.
 *
 * The point of this file is the same as its two predecessors': the
 * never-fabricate guarantee, tested as a GUARANTEE rather than as a prompt
 * instruction. A prompt asking a model not to invent numbers is a request; what
 * is asserted here is that the model is never HANDED one, that a section with
 * nothing real behind it results in no Anthropic call at all and no substitute
 * prose, and that a section is only ever given the pillars its own report says
 * it may reason from.
 *
 * ONE SUITE FOR FOUR REPORTS, AND WHY
 * -----------------------------------
 * The four share `pillar-report-narrative.ts` — the fact floor, the cache key,
 * the per-section error isolation, the sanitising — so testing that loop four
 * times over would be four copies of one assertion. What differs per report is
 * its `PillarReportSpec`, and that IS tested per report: every spec is run
 * through the same battery below, so a fifth report added to the table gets the
 * whole guarantee for free and a spec that names a pillar it should not see
 * fails here rather than in a customer's document.
 *
 * WHAT IS STUBBED AND WHY
 * -----------------------
 * Only the DB, the Anthropic SDK, and the sibling data modules.
 * `collectFactsForPillars`, the fact floor, the block formatting and the
 * sanitising are the REAL ones, so a test passing here means the real path
 * behaves this way.
 *
 * `war-room-pillar-stats.ts` is replaced wholesale rather than spread over the
 * original, because the real module imports `@workspace/db` at load and there is
 * no DATABASE_URL in a Claude Code session or in CI for this suite — the same
 * stub both sibling suites use, for the same reason.
 *
 * Run: pnpm --filter @workspace/api-server run test -- pillar-report-narrative
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

import type { WarRoomPillarCard, WarRoomPillarStatsPayload } from "./war-room-pillar-stats.ts";

let anthropicPrompts: string[] = [];
let anthropicText = "<p>Real reasoning about real numbers.</p>";
let anthropicShouldThrow = false;
let pillarPayload: WarRoomPillarStatsPayload;
let gateResult: { score: number | null; threshold: number; status: string | null; source: string };
/** Every `{feature, nodeType}` the metering layer was asked to attribute. */
let meteredCalls: { feature: string; nodeType: string; customerId: number | null }[] = [];

vi.mock("@workspace/integrations-anthropic-ai", () => ({
  anthropic: {
    messages: {
      create: async (params: { messages: { content: string }[] }) => {
        if (anthropicShouldThrow) throw new Error("upstream refused");
        anthropicPrompts.push(params.messages[0].content);
        return { stop_reason: "end_turn", content: [{ type: "text", text: anthropicText }] };
      },
    },
  },
}));

// The dev cache is a passthrough in this suite: NODE_ENV is "test", which would
// otherwise enable it and put a DB read in front of every call. The behaviour
// under test is what reaches the model, not whether it was cached — but the
// ATTRIBUTION passed through it is tested, because that is what a metered call
// is billed under.
vi.mock("./ai-dev-response-cache.ts", () => ({
  withAiDevResponseCache: async (
    _req: unknown,
    attribution: { feature: string; nodeType: string; customerId: number | null },
    fn: () => Promise<unknown>,
  ) => {
    meteredCalls.push({
      feature: attribution.feature,
      nodeType: attribution.nodeType,
      customerId: attribution.customerId,
    });
    return fn();
  },
}));

vi.mock("./prompt-loader.ts", () => ({
  // The real fallback is used, exactly as `getPrompt` would with no DB row.
  getPrompt: async (_key: string, fallback: string) => fallback,
}));

vi.mock("./war-room-pillar-stats.ts", () => ({
  buildWarRoomPillarStats: async () => pillarPayload,
}));

vi.mock("./copilot-gate.ts", () => ({ computeCopilotGate: async () => gateResult }));

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ mspId: 1 }] }) }) }),
  },
  tenantsTable: { id: "id", mspId: "msp_id" },
}));

vi.mock("drizzle-orm", () => ({ eq: () => true }));

vi.mock("./logger.ts", () => ({
  logger: { child: () => ({ info: () => {}, warn: () => {}, error: () => {} }) },
}));

const { GOVERNANCE_POSTURE_SPEC, generateGovernancePostureNarrative, GOVERNANCE_POSTURE_NARRATIVE_SECTIONS } =
  await import("./governance-posture-narrative-generator.ts");
const { COMPLIANCE_ALIGNMENT_SPEC, generateComplianceAlignmentNarrative, COMPLIANCE_ALIGNMENT_NARRATIVE_SECTIONS } =
  await import("./compliance-alignment-narrative-generator.ts");
const { LICENSING_ALIGNMENT_SPEC, generateLicensingAlignmentNarrative, LICENSING_ALIGNMENT_NARRATIVE_SECTIONS } =
  await import("./licensing-alignment-narrative-generator.ts");
const { OPERATIONAL_HEALTH_SPEC, generateOperationalHealthNarrative, OPERATIONAL_HEALTH_NARRATIVE_SECTIONS } =
  await import("./operational-health-narrative-generator.ts");
const { ADOPTION_SPEC, generateAdoptionNarrative, ADOPTION_NARRATIVE_SECTIONS } =
  await import("./adoption-narrative-generator.ts");

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

function card(overrides: Partial<WarRoomPillarCard> & Pick<WarRoomPillarCard, "pillar">): WarRoomPillarCard {
  return {
    enginePillar: "security",
    score: null,
    rawRiskScore: 0,
    stats: [],
    findings: [],
    findingCounts: { critical: 0, warning: 0 },
    trend: null,
    ...overrides,
  } as WarRoomPillarCard;
}

function payload(pillars: WarRoomPillarCard[]): WarRoomPillarStatsPayload {
  return {
    pillars,
    // No licence gap: this fixture tests narrative grounding, not #489's
    // purchase tiering.
    licenseGapPurchase: null,
    findingsRunId: "run-1",
    findingsRunStatus: "completed",
    activeRunId: null,
    scannedPackageKeys: ["assess:copilot-readiness"],
    scannedCheckCount: 29,
    checkKeyPillars: {},
    generatedAt: "2026-08-06T00:00:00.000Z",
  };
}

const ALL_PILLARS = [
  "governance",
  "licensing",
  "adoption",
  "compliance",
  "health",
  "security",
  "copilot",
] as const;

const EMPTY_PILLARS = (): WarRoomPillarCard[] =>
  ALL_PILLARS.map((p) => card({ pillar: p as WarRoomPillarCard["pillar"] }));

const ATTRIBUTION = { mspId: 1, customerId: 42, triggerSource: "test" };

/** Every report, with the entry point a route actually calls. */
const REPORTS = [
  {
    name: "governance posture",
    spec: GOVERNANCE_POSTURE_SPEC,
    run: generateGovernancePostureNarrative,
    sections: GOVERNANCE_POSTURE_NARRATIVE_SECTIONS,
    /** The pillar whose card this report is about. */
    ownPillar: "governance" as const,
  },
  {
    name: "compliance alignment",
    spec: COMPLIANCE_ALIGNMENT_SPEC,
    run: generateComplianceAlignmentNarrative,
    sections: COMPLIANCE_ALIGNMENT_NARRATIVE_SECTIONS,
    ownPillar: "compliance" as const,
  },
  {
    name: "licensing alignment",
    spec: LICENSING_ALIGNMENT_SPEC,
    run: generateLicensingAlignmentNarrative,
    sections: LICENSING_ALIGNMENT_NARRATIVE_SECTIONS,
    ownPillar: "licensing" as const,
  },
  {
    name: "operational health",
    spec: OPERATIONAL_HEALTH_SPEC,
    run: generateOperationalHealthNarrative,
    sections: OPERATIONAL_HEALTH_NARRATIVE_SECTIONS,
    ownPillar: "health" as const,
  },
  {
    name: "copilot adoption & usage",
    spec: ADOPTION_SPEC,
    run: generateAdoptionNarrative,
    sections: ADOPTION_NARRATIVE_SECTIONS,
    ownPillar: "adoption" as const,
  },
];

function run(report: (typeof REPORTS)[number]) {
  return report.run({ customerId: 42, tenantName: "Contoso", attribution: ATTRIBUTION });
}

beforeEach(() => {
  anthropicPrompts = [];
  meteredCalls = [];
  anthropicText = "<p>Real reasoning about real numbers.</p>";
  anthropicShouldThrow = false;
  pillarPayload = payload(EMPTY_PILLARS());
  gateResult = { score: 41, threshold: 82, status: "no_go", source: "health_engine:copilot" };
});

/* ------------------------------------------------------------------ *
 * The specs themselves — each report's own grounding contract
 * ------------------------------------------------------------------ */

describe("each report declares three prose sections and grounds them honestly", () => {
  it.each(REPORTS)("$name declares exactly the sections its builder renders", ({ spec, sections }) => {
    expect(spec.sections.map((s) => s.key)).toEqual([...sections]);
    expect(spec.sections).toHaveLength(3);
  });

  it.each(REPORTS)("$name always grounds every section in its OWN pillar", ({ spec, ownPillar }) => {
    for (const section of spec.sections) {
      expect(section.pillars).toContain(ownPillar);
    }
  });

  it.each(REPORTS)("$name gives the Gate to the Copilot Impact section and to nothing else", ({ spec }) => {
    const withGate = spec.sections.filter((s) => s.withGate);
    expect(withGate.map((s) => s.key)).toEqual(["copilotImpact"]);
    // And that section's body must actually carry the token, or the Gate would
    // be resolved and silently dropped on the floor.
    expect(withGate[0].promptBody).toContain("{{gateBlock}}");
    for (const other of spec.sections.filter((s) => !s.withGate)) {
      expect(other.promptBody).not.toContain("{{gateBlock}}");
    }
  });

  it.each(REPORTS)("$name's copilotImpact is the ONLY section that may see the copilot card", ({ spec }) => {
    for (const section of spec.sections) {
      if (section.key === "copilotImpact") expect(section.pillars).toContain("copilot");
      else expect(section.pillars).not.toContain("copilot");
    }
  });

  it("gives every report and every section a distinct metering feature name", () => {
    const features = REPORTS.flatMap((r) => r.spec.sections.map((s) => `${r.spec.feature}_narrative_${s.key}`));
    expect(new Set(features).size).toBe(features.length);
  });

  it("gives every section a distinct ai_prompts key", () => {
    const keys = REPORTS.flatMap((r) => r.spec.sections.map((s) => s.promptKey));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("scopes the licensing report's data sections to licensing alone (#451)", () => {
    // Widening either would let the prose connect a licensing figure to a
    // governance one and produce a purchase recommendation the data does not
    // support. Only copilotImpact reasons across pillars, and only to the Gate.
    const bySection = Object.fromEntries(LICENSING_ALIGNMENT_SPEC.sections.map((s) => [s.key, s.pillars]));
    expect(bySection.summary).toEqual(["licensing"]);
    expect(bySection.cost).toEqual(["licensing"]);
  });

  it("scopes the adoption report's data sections to adoption alone", () => {
    // Same reasoning as licensing's, with a sharper edge: the adoption card
    // carries NO stats (`WAR_ROOM_PILLAR_STAT_SPECS.adoption` is an empty array
    // by decision), so a borrowed pillar would put the ONLY number in a report
    // whose whole argument is that it has none — and the report's own tables
    // could not show it.
    const bySection = Object.fromEntries(ADOPTION_SPEC.sections.map((s) => [s.key, s.pillars]));
    expect(bySection.summary).toEqual(["adoption"]);
    expect(bySection.activity).toEqual(["adoption"]);
  });

  it("forbids a usage count and a direction of travel in every adoption section", () => {
    // The two claims that report exists to prevent, asserted as prompt text
    // because that is where they are enforced — the code cannot stop a model
    // inferring a percentage from a finding title, only from being handed one.
    for (const section of ADOPTION_SPEC.sections) {
      expect(section.promptBody).toContain("NEVER state a usage count");
      expect(section.promptBody).toContain("NEVER state a direction of travel");
      expect(section.promptBody).toContain("NEVER name or imply a persona");
    }
  });
});

/* ------------------------------------------------------------------ *
 * The floor
 * ------------------------------------------------------------------ */

describe("a section with no real facts is not generated at all", () => {
  it.each(REPORTS)("$name makes ZERO Anthropic calls for a tenant whose scan produced nothing", async (report) => {
    const result = await run(report);
    expect(anthropicPrompts).toHaveLength(0);
    expect(meteredCalls).toHaveLength(0);
    expect(result.sections).toHaveLength(3);
    for (const section of result.sections) {
      expect(section.html).toBeNull();
      expect(section.omittedReason).toBe("no_real_data");
      expect(section.factCount).toBe(0);
    }
  });

  it.each(REPORTS)("$name returns no substitute prose anywhere — html is null, never boilerplate", async (report) => {
    const serialised = JSON.stringify(await run(report));
    expect(serialised).not.toMatch(/typically|generally|most organizations|best practice/i);
  });

  it.each(REPORTS)("$name counts an UNAVAILABLE stat as a missing check, never as a fact", async (report) => {
    pillarPayload = payload(
      EMPTY_PILLARS().map((c) =>
        c.pillar === report.ownPillar
          ? card({
              pillar: c.pillar,
              stats: [
                {
                  id: `${report.ownPillar}.something`,
                  label: "a real label",
                  unit: "count",
                  value: null,
                  unavailableReason: "not_in_scan_package",
                  checkKey: "some:check",
                  source: "monitor_profile:some:check",
                  replaces: "",
                },
              ],
            })
          : c,
      ),
    );
    const result = await run(report);
    const summary = result.sections.find((s) => s.key === "summary")!;
    expect(summary.factCount).toBe(0);
    expect(summary.omittedReason).toBe("no_real_data");
    expect(anthropicPrompts).toHaveLength(0);
    // Named rather than dropped, so the client's Upgrade Opportunity sweep and
    // its unavailable block can both find it.
    expect(summary.missingChecks).toEqual([{ checkKey: "some:check", reason: "not_in_scan_package" }]);
  });

  it.each(REPORTS)("$name generates from a SINGLE real fact — thin is short, not suppressed", async (report) => {
    pillarPayload = payload(
      EMPTY_PILLARS().map((c) =>
        c.pillar === report.ownPillar
          ? card({
              pillar: c.pillar,
              findings: [{ severity: "critical", checkKey: "some:check", title: "A real finding", rankWeight: 0 }],
              findingCounts: { critical: 1, warning: 0 },
            })
          : c,
      ),
    );
    const result = await run(report);
    const summary = result.sections.find((s) => s.key === "summary")!;
    expect(summary.factCount).toBe(1);
    expect(summary.html).toBe("<p>Real reasoning about real numbers.</p>");
    expect(anthropicPrompts[0]).toContain("You have been given 1 real facts");
  });
});

/* ------------------------------------------------------------------ *
 * What actually reaches the model
 * ------------------------------------------------------------------ */

describe("the model is never handed a number the platform does not hold", () => {
  beforeEach(() => {
    pillarPayload = payload(
      EMPTY_PILLARS().map((c) =>
        card({
          ...c,
          pillar: c.pillar,
          score: 19,
          findingCounts: { critical: 2, warning: 1 },
          stats: [
            {
              id: `${c.pillar}.real`,
              label: "a measured thing",
              unit: "count",
              value: 212,
              checkKey: "real:check",
              source: "monitor_profile:real:check",
              replaces: "",
            },
            {
              id: `${c.pillar}.absent`,
              label: "an unmeasured thing",
              unit: "count",
              value: null,
              unavailableReason: "no_data",
              checkKey: "absent:check",
              source: "monitor_profile:absent:check",
              replaces: "",
            },
          ],
        }),
      ),
    );
  });

  it.each(REPORTS)("$name puts real values in the figures block and absent ones only in NOT COLLECTED", async (report) => {
    await run(report);
    for (const prompt of anthropicPrompts) {
      expect(prompt).toContain("a measured thing: 212");
      expect(prompt).toContain("- absent:check (no_data)");
      expect(prompt).not.toMatch(/an unmeasured thing: \d/);
    }
  });

  it.each(REPORTS)("$name marks an unscored pillar as NO SCORE rather than as a zero", async (report) => {
    pillarPayload = payload(EMPTY_PILLARS());
    // One real finding somewhere in scope, so the section clears the floor and
    // the pillar block is actually rendered for the model.
    pillarPayload = payload(
      EMPTY_PILLARS().map((c) =>
        c.pillar === report.ownPillar
          ? card({
              pillar: c.pillar,
              findings: [{ severity: "warning", checkKey: "real:check", title: "A real finding", rankWeight: 0 }],
              findingCounts: { critical: 0, warning: 1 },
            })
          : c,
      ),
    );
    await run(report);
    expect(anthropicPrompts[0]).toContain("NO SCORE");
    expect(anthropicPrompts[0]).not.toMatch(/score 0\/100/);
  });

  it.each(REPORTS)("$name states the real Gate gap exactly, and only in the Copilot Impact section", async (report) => {
    await run(report);
    const impact = anthropicPrompts.find((p) => p.includes("Copilot Readiness Impact"))!;
    expect(impact).toContain("Score 41/100 against a Gate of 82");
    expect(impact).toContain("The gap is exactly 41 points");
    for (const other of anthropicPrompts.filter((p) => p !== impact)) {
      expect(other).not.toContain("The gap is exactly");
      expect(other).not.toContain("THE REAL COPILOT GATE");
    }
  });

  it.each(REPORTS)("$name forbids a verdict outright when the Gate has no score", async (report) => {
    gateResult = { score: null, threshold: 82, status: null, source: "health_engine:copilot" };
    await run(report);
    const impact = anthropicPrompts.find((p) => p.includes("Copilot Readiness Impact"))!;
    expect(impact).toContain("Do not state a score, a gap or a Go/No-Go verdict");
    expect(impact).not.toMatch(/The gap is exactly/);
  });

  it.each(REPORTS)("$name carries the shared honesty rules into every one of its sections", async (report) => {
    await run(report);
    expect(anthropicPrompts).toHaveLength(3);
    for (const prompt of anthropicPrompts) {
      expect(prompt).toContain("NEVER invent, estimate, extrapolate or infer");
      expect(prompt).toContain("Never rank this pillar against the others");
      expect(prompt).toContain("Never quote a remediation duration, a timeline, a projected score or a cost");
      expect(prompt).toContain("A pillar marked NO SCORE was not evaluated");
    }
  });

  it("forbids the compliance report from naming a regulation, in every section", async () => {
    await run(REPORTS[1]);
    for (const prompt of anthropicPrompts) {
      expect(prompt).toContain("NEVER name a regulation, standard or framework");
      expect(prompt).toContain("NEVER classify content");
    }
  });

  it("forbids the licensing report from recommending a SKU, in every section", async () => {
    await run(REPORTS[2]);
    for (const prompt of anthropicPrompts) {
      expect(prompt).toContain("NEVER recommend, name or imply a licence SKU or tier");
      expect(prompt).toContain("Never propose a purchase");
    }
  });

  it("forbids the health report from claiming availability, in every section", async () => {
    await run(REPORTS[3]);
    for (const prompt of anthropicPrompts) {
      expect(prompt).toContain("NEVER state, imply or hedge an availability claim");
      expect(prompt).toContain("Never describe the services as stable, healthy or reliable");
    }
  });

  it("leaves no unfilled template token in any prompt of any report", async () => {
    for (const report of REPORTS) {
      anthropicPrompts = [];
      await run(report);
      for (const prompt of anthropicPrompts) {
        expect(prompt, `${report.name} shipped a raw token`).not.toMatch(/\{\{\w+\}\}/);
      }
    }
  });
});

/* ------------------------------------------------------------------ *
 * Attribution — a metered call has to be billable to someone
 * ------------------------------------------------------------------ */

describe("every Anthropic call is attributed", () => {
  beforeEach(() => {
    pillarPayload = payload(
      EMPTY_PILLARS().map((c) =>
        card({ ...c, pillar: c.pillar, score: 40, findingCounts: { critical: 0, warning: 0 } }),
      ),
    );
  });

  it.each(REPORTS)("$name meters each section under its own feature name", async (report) => {
    await run(report);
    expect(meteredCalls).toHaveLength(3);
    expect(meteredCalls.map((c) => c.feature).sort()).toEqual(
      report.spec.sections.map((s) => `${report.spec.feature}_narrative_${s.key}`).sort(),
    );
    for (const call of meteredCalls) {
      expect(call.nodeType).toBe(`${report.spec.feature}_narrative`);
      expect(call.customerId).toBe(42);
    }
  });
});

/* ------------------------------------------------------------------ *
 * Isolation and sanitising
 * ------------------------------------------------------------------ */

describe("one section's failure never costs the reader the others", () => {
  beforeEach(() => {
    pillarPayload = payload(
      EMPTY_PILLARS().map((c) =>
        card({
          ...c,
          pillar: c.pillar,
          score: 40,
          findings: [{ severity: "warning", checkKey: `${c.pillar}:x`, title: "A real finding", rankWeight: 0 }],
          findingCounts: { critical: 0, warning: 1 },
        }),
      ),
    );
  });

  it.each(REPORTS)("$name omits an empty model response with its own machine reason", async (report) => {
    anthropicText = "   ";
    const result = await run(report);
    for (const section of result.sections) {
      expect(section.html).toBeNull();
      expect(section.omittedReason).toBe("empty_response");
    }
  });

  it.each(REPORTS)("$name omits a THROWN call rather than substituting prose", async (report) => {
    anthropicShouldThrow = true;
    const result = await run(report);
    for (const section of result.sections) {
      expect(section.html).toBeNull();
      expect(section.omittedReason).toBe("generation_failed");
    }
    // And it does not reject: a failed section is a real state with an honest
    // rendering, not a 500 over a report the customer is reading.
    expect(result.gate).toEqual({ score: 41, threshold: 82, status: "no_go" });
  });

  it.each(REPORTS)("$name strips script/style/handlers before the fragment is ever returned", async (report) => {
    anthropicText = '```html\n<p onclick="steal()">Real</p><script>bad()</script>\n```';
    const result = await run(report);
    for (const section of result.sections) {
      expect(section.html).toBe("<p>Real</p>");
    }
  });

  it.each(REPORTS)("$name passes the real scan provenance through untouched", async (report) => {
    const result = await run(report);
    expect(result.scannedCheckCount).toBe(29);
    expect(result.scannedPackageKeys).toEqual(["assess:copilot-readiness"]);
    expect(result.generatedAt).toBe("2026-08-06T00:00:00.000Z");
  });
});
