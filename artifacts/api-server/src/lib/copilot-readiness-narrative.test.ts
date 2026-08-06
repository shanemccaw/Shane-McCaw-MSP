/**
 * copilot-readiness-narrative.test.ts
 *
 * #409 — the Copilot Readiness report's three AI-written sections.
 *
 * The point of this file is the never-fabricate guarantee, tested as a
 * guarantee rather than as a prompt instruction. A prompt asking a model not to
 * invent numbers is a request; what is asserted here is that the model is never
 * HANDED one, and that a section with nothing real behind it results in no
 * Anthropic call at all and no substitute prose.
 *
 * Only the DB, the Anthropic SDK and the two sibling data modules are stubbed —
 * `collectSectionFacts`, the fact floor and the block formatting are the real
 * ones, so a test passing here means the real path behaves this way.
 *
 * Run: pnpm --filter @workspace/api-server run test -- copilot-readiness-narrative
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

import type { WarRoomPillarCard, WarRoomPillarStatsPayload } from "./war-room-pillar-stats.ts";

let anthropicPrompts: string[] = [];
let pillarPayload: WarRoomPillarStatsPayload;
let gateResult: { score: number | null; threshold: number; status: string | null; source: string };

vi.mock("@workspace/integrations-anthropic-ai", () => ({
  anthropic: {
    messages: {
      create: async (params: { messages: { content: string }[] }) => {
        anthropicPrompts.push(params.messages[0].content);
        return {
          stop_reason: "end_turn",
          content: [{ type: "text", text: "<p>Real reasoning about real numbers.</p>" }],
        };
      },
    },
  },
}));

// The dev cache is a passthrough in this suite: NODE_ENV is "test", which would
// otherwise enable it and put a DB read in front of every call. The behaviour
// under test is what reaches the model, not whether it was cached.
vi.mock("./ai-dev-response-cache.ts", () => ({
  withAiDevResponseCache: async (_req: unknown, _attr: unknown, fn: () => Promise<unknown>) => fn(),
}));

vi.mock("./prompt-loader.ts", () => ({
  // The real fallback is used, exactly as `getPrompt` would with no DB row.
  getPrompt: async (_key: string, fallback: string) => fallback,
}));

// Fully replaced rather than spread over the original: the real module imports
// `@workspace/db` at load, which throws without a DATABASE_URL — and there is
// none in a Claude Code session or in CI for this suite. The generator uses
// exactly one value from it, so a full stub loses nothing.
vi.mock("./war-room-pillar-stats.ts", () => ({
  buildWarRoomPillarStats: async () => pillarPayload,
}));

vi.mock("./copilot-gate.ts", () => ({
  computeCopilotGate: async () => gateResult,
}));

vi.mock("./logger.ts", () => ({
  logger: { child: () => ({ info: () => {}, warn: () => {}, error: () => {} }) },
}));

const { generateCopilotReadinessNarrative, MIN_FACTS_FOR_NARRATIVE, __testables } = await import(
  "./copilot-readiness-narrative-generator.ts"
);

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
    // No licence gap: these fixtures test narrative grounding, not #489's
    // purchase tiering, and a recommendation here would be a fact about a
    // tenant none of them describes.
    licenseGapPurchase: null,
    findingsRunId: "run-1",
    findingsRunStatus: "completed",
    activeRunId: null,
    scannedPackageKeys: ["core:security-baseline"],
    scannedCheckCount: 29,
    generatedAt: "2026-08-05T00:00:00.000Z",
  };
}

const EMPTY_PILLARS: WarRoomPillarCard[] = [
  "governance",
  "licensing",
  "adoption",
  "compliance",
  "health",
  "security",
  "copilot",
].map((p) => card({ pillar: p as WarRoomPillarCard["pillar"] }));

const ATTRIBUTION = { mspId: 1, customerId: 42, triggerSource: "test" };

function run() {
  return generateCopilotReadinessNarrative({
    customerId: 42,
    tenantName: "Contoso",
    attribution: ATTRIBUTION,
  });
}

beforeEach(() => {
  anthropicPrompts = [];
  pillarPayload = payload(EMPTY_PILLARS);
  gateResult = { score: 41, threshold: 82, status: "no_go", source: "health_engine:copilot" };
});

/* ------------------------------------------------------------------ *
 * The floor
 * ------------------------------------------------------------------ */

describe("a section with no real facts is not generated at all", () => {
  it("makes ZERO Anthropic calls for a tenant whose scan produced nothing", async () => {
    const result = await run();
    expect(anthropicPrompts).toHaveLength(0);
    expect(result.sections).toHaveLength(3);
    for (const section of result.sections) {
      expect(section.html).toBeNull();
      expect(section.omittedReason).toBe("no_real_data");
      expect(section.factCount).toBe(0);
    }
  });

  it("returns no substitute prose anywhere — html is null, never boilerplate", async () => {
    const result = await run();
    const serialised = JSON.stringify(result);
    // Nothing that could read as written-in-advance copy about Copilot.
    expect(serialised).not.toMatch(/Copilot inherits/i);
    expect(serialised).not.toMatch(/typically|generally|most organizations/i);
    expect(result.sections.every((s) => s.html === null)).toBe(true);
  });

  it("counts an UNAVAILABLE stat as a missing check, never as a fact", async () => {
    pillarPayload = payload(
      EMPTY_PILLARS.map((c) =>
        c.pillar === "security"
          ? card({
              pillar: "security",
              stats: [
                {
                  id: "security.legacyAuth",
                  label: "legacy auth sign-ins",
                  unit: "count",
                  value: null,
                  unavailableReason: "not_in_scan_package",
                  checkKey: "identity:legacy-auth-usage",
                  source: "monitor_profile:identity:legacy-auth-usage",
                  replaces: "",
                },
              ],
            })
          : c,
      ),
    );
    const result = await run();
    const safety = result.sections.find((s) => s.key === "safety")!;
    expect(safety.factCount).toBe(0);
    expect(safety.omittedReason).toBe("no_real_data");
    expect(anthropicPrompts).toHaveLength(0);
    // The gap is named rather than silently dropped.
    expect(safety.missingChecks).toEqual([
      { checkKey: "identity:legacy-auth-usage", reason: "not_in_scan_package" },
    ]);
  });

  it("generates from a SINGLE real fact — thin is short, not suppressed", async () => {
    expect(MIN_FACTS_FOR_NARRATIVE).toBe(1);
    pillarPayload = payload(
      EMPTY_PILLARS.map((c) =>
        c.pillar === "security"
          ? card({
              pillar: "security",
              findings: [{ severity: "critical", checkKey: "identity:mfa-registration", title: "14 accounts have no MFA", rankWeight: 0 }],
              findingCounts: { critical: 1, warning: 0 },
            })
          : c,
      ),
    );
    const result = await run();
    const safety = result.sections.find((s) => s.key === "safety")!;
    expect(safety.factCount).toBe(1);
    expect(safety.html).toBe("<p>Real reasoning about real numbers.</p>");
    // The prompt says how thin it is, so length can scale to it.
    expect(anthropicPrompts[0]).toContain("You have been given 1 real facts");
    // The other two sections still have nothing and are still omitted.
    expect(result.sections.find((s) => s.key === "enablement")!.omittedReason).toBe("no_real_data");
  });
});

/* ------------------------------------------------------------------ *
 * What actually reaches the model
 * ------------------------------------------------------------------ */

describe("the model is never handed a number the platform does not hold", () => {
  beforeEach(() => {
    pillarPayload = payload(
      EMPTY_PILLARS.map((c) =>
        c.pillar === "governance"
          ? card({
              pillar: "governance",
              score: 19,
              findingCounts: { critical: 2, warning: 1 },
              stats: [
                {
                  id: "governance.overshared",
                  label: "overshared sites",
                  unit: "count",
                  value: 212,
                  checkKey: "compliance:overshared-sites",
                  source: "monitor_profile:compliance:overshared-sites",
                  replaces: "",
                },
                {
                  id: "governance.exposure",
                  label: "items over-exposed",
                  unit: "count",
                  value: null,
                  unavailableReason: "no_data",
                  checkKey: "copilot:overshare-exposure",
                  source: "monitor_profile:copilot:overshare-exposure",
                  replaces: "",
                },
              ],
            })
          : c,
      ),
    );
  });

  it("puts real values in the figures block and absent ones only in NOT COLLECTED", async () => {
    await run();
    const prompt = anthropicPrompts[0];
    expect(prompt).toContain("governance · overshared sites: 212");
    // The absent one appears ONLY under the not-collected heading, by check key.
    expect(prompt).toContain("- copilot:overshare-exposure (no_data)");
    expect(prompt).not.toMatch(/items over-exposed: \d/);
  });

  it("marks an unscored pillar as NO SCORE rather than as a zero", async () => {
    await run();
    const prompt = anthropicPrompts[0];
    expect(prompt).toContain("- security: NO SCORE");
    expect(prompt).not.toContain("security: score 0/100");
  });

  it("states the real Gate gap exactly, and forbids any other", async () => {
    await run();
    const blockersPrompt = anthropicPrompts.find((p) => p.includes("Gate Blockers"))!;
    expect(blockersPrompt).toContain("Score 41/100 against a Gate of 82");
    expect(blockersPrompt).toContain("The gap is exactly 41 points");
  });

  it("forbids a verdict outright when the Gate has no score", async () => {
    gateResult = { score: null, threshold: 82, status: null, source: "health_engine:copilot" };
    const block = __testables.gateBlock({ score: null, threshold: 82, status: null });
    expect(block).toContain("NO SCORE");
    expect(block).toContain("Do not state a score, a gap or a Go/No-Go verdict");
    await run();
    const blockersPrompt = anthropicPrompts.find((p) => p.includes("Gate Blockers"))!;
    expect(blockersPrompt).toContain("NO SCORE");
    expect(blockersPrompt).not.toMatch(/The gap is exactly/);
  });

  it("says plainly when a block has nothing, rather than leaving the token blank", async () => {
    const facts = __testables.collectSectionFacts("enablement", EMPTY_PILLARS);
    expect(facts.statBlock).toContain("Do not cite any number here");
    expect(facts.findingBlock).toContain("Do not describe any finding");
    expect(facts.missingBlock).toContain("None — every check in scope");
  });
});

/* ------------------------------------------------------------------ *
 * Isolation between sections
 * ------------------------------------------------------------------ */

describe("one section's failure never costs the reader the others", () => {
  it("omits only the failed section, with its own machine reason", async () => {
    pillarPayload = payload(
      EMPTY_PILLARS.map((c) =>
        card({
          ...c,
          pillar: c.pillar,
          score: 40,
          findings: [{ severity: "warning", checkKey: `${c.pillar}:x`, title: "A real finding", rankWeight: 0 }],
          findingCounts: { critical: 0, warning: 1 },
        }),
      ),
    );

    let call = 0;
    const anthropicModule = await import("@workspace/integrations-anthropic-ai");
    vi.spyOn(anthropicModule.anthropic.messages, "create").mockImplementation((async () => {
      call += 1;
      if (call === 2) throw new Error("model unavailable");
      return { stop_reason: "end_turn", content: [{ type: "text", text: "<p>Real prose.</p>" }] };
    }) as never);

    const result = await run();
    const omitted = result.sections.filter((s) => s.html === null);
    expect(omitted).toHaveLength(1);
    expect(omitted[0].omittedReason).toBe("generation_failed");
    expect(result.sections.filter((s) => s.html !== null)).toHaveLength(2);
    vi.restoreAllMocks();
  });

  it("treats an empty model response as omitted, not as a section", async () => {
    pillarPayload = payload(
      EMPTY_PILLARS.map((c) => card({ ...c, pillar: c.pillar, score: 40 })),
    );
    const anthropicModule = await import("@workspace/integrations-anthropic-ai");
    vi.spyOn(anthropicModule.anthropic.messages, "create").mockImplementation((async () => ({
      stop_reason: "end_turn",
      content: [{ type: "text", text: "   " }],
    })) as never);

    const result = await run();
    expect(result.sections.every((s) => s.omittedReason === "empty_response")).toBe(true);
    vi.restoreAllMocks();
  });
});

/* ------------------------------------------------------------------ *
 * Formatting
 * ------------------------------------------------------------------ */

describe("stat formatting matches what the reader sees beside the prose", () => {
  const base = { id: "x", checkKey: "c", source: "s", replaces: "" };

  it("renders each unit as the wire means it", () => {
    expect(__testables.formatStatValue({ ...base, label: "l", unit: "count", value: 214806 } as never)).toBe("214,806");
    expect(__testables.formatStatValue({ ...base, label: "l", unit: "percent", value: 31 } as never)).toBe("31%");
    expect(__testables.formatStatValue({ ...base, label: "l", unit: "currency", value: 18400 } as never)).toBe("$18,400");
  });

  it("accepts a real zero and rejects every kind of non-number", () => {
    expect(__testables.isRealStat({ ...base, label: "l", unit: "count", value: 0 } as never)).toBe(true);
    expect(__testables.isRealStat({ ...base, label: "l", unit: "count", value: null } as never)).toBe(false);
    expect(__testables.isRealStat({ ...base, label: "l", unit: "count", value: Number.NaN } as never)).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * Provenance carried back to the client
 * ------------------------------------------------------------------ */

describe("the result carries the real grounding it was built from", () => {
  it("reports the real gate, check count and packages", async () => {
    const result = await run();
    expect(result.gate).toEqual({ score: 41, threshold: 82, status: "no_go" });
    expect(result.scannedCheckCount).toBe(29);
    expect(result.scannedPackageKeys).toEqual(["core:security-baseline"]);
  });
});
