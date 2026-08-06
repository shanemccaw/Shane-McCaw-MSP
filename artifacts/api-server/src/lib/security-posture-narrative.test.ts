/**
 * security-posture-narrative.test.ts
 *
 * #343 — the Security Posture & Blast Radius report's three AI-written sections
 * and the one extra metric its route resolves.
 *
 * The point of this file is the same as its Copilot sibling's: the
 * never-fabricate guarantee, tested as a guarantee rather than as a prompt
 * instruction. A prompt asking a model not to invent numbers is a request; what
 * is asserted here is that the model is never HANDED one, that a section with
 * nothing real behind it results in no Anthropic call at all and no substitute
 * prose, and that an extra stat resolved outside the War Room payload goes
 * through exactly the same rule as every card stat rather than round the side.
 *
 * WHAT IS STUBBED AND WHY
 * -----------------------
 * Only the DB, the Anthropic SDK, the registry/resolver pair and the sibling
 * data modules. `collectFactsForPillars`, `withExtraStats`, the fact floor and
 * the block formatting are the REAL ones, so a test passing here means the real
 * path behaves this way.
 *
 * `war-room-pillar-stats.ts` is replaced wholesale rather than spread over the
 * original, because the real module imports `@workspace/db` at load and there is
 * no DATABASE_URL in a Claude Code session or in CI for this suite — the same
 * stub the Copilot suite uses, for the same reason. Its two pure helpers
 * (`statFromMetricResult`, `refineStatUnavailability`) are therefore stubbed
 * here as pass-throughs driven by the fixture; their own classification
 * behaviour is covered by `war-room-pillar-stats.test.ts`, and this suite
 * deliberately does not restate it. What it DOES test is everything this file
 * owns: that whatever those return is folded into the grounding under the
 * never-fabricate rule, and reaches the wire unchanged.
 *
 * Run: pnpm --filter @workspace/api-server run test -- security-posture-narrative
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

import type { WarRoomPillarCard, WarRoomPillarStatsPayload, WarRoomStat } from "./war-room-pillar-stats.ts";

let anthropicPrompts: string[] = [];
let anthropicText = "<p>Real reasoning about real numbers.</p>";
let pillarPayload: WarRoomPillarStatsPayload;
let gateResult: { score: number | null; threshold: number; status: string | null; source: string };
/** What the (stubbed) metric resolution yields for `security.secureScore`. */
let extraStat: WarRoomStat;

vi.mock("@workspace/integrations-anthropic-ai", () => ({
  anthropic: {
    messages: {
      create: async (params: { messages: { content: string }[] }) => {
        anthropicPrompts.push(params.messages[0].content);
        return { stop_reason: "end_turn", content: [{ type: "text", text: anthropicText }] };
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

vi.mock("./war-room-pillar-stats.ts", () => ({
  buildWarRoomPillarStats: async () => pillarPayload,
  statFromMetricResult: () => extraStat,
  refineStatUnavailability: (stat: WarRoomStat) => stat,
}));

vi.mock("./copilot-gate.ts", () => ({ computeCopilotGate: async () => gateResult }));

vi.mock("@workspace/dashboard-registry", () => ({
  getMetric: (key: string) =>
    key === "security.secureScore" ? { key, sourceKey: "security:secure-score" } : null,
}));

vi.mock("./dashboard-resolvers.ts", () => ({
  resolveMetric: async () => ({ status: "ok", data: { value: 38 } }),
}));

vi.mock("./pillar-coverage.ts", () => ({
  fetchScannedCheckKeys: async () => ({ checkKeys: new Set<string>(["security:secure-score"]) }),
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => [{ mspId: 1 }] }) }),
    }),
  },
  tenantsTable: { id: "id", mspId: "msp_id" },
}));

vi.mock("drizzle-orm", () => ({ eq: () => true }));

vi.mock("./logger.ts", () => ({
  logger: { child: () => ({ info: () => {}, warn: () => {}, error: () => {} }) },
}));

const { generateSecurityPostureNarrative, SECURITY_POSTURE_NARRATIVE_SECTIONS, __testables } =
  await import("./security-posture-narrative-generator.ts");

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

const REAL_SECURE_SCORE: WarRoomStat = {
  id: "security.secureScore",
  label: "Microsoft Secure Score",
  unit: "percent",
  value: 38,
  checkKey: "security:secure-score",
  source: "monitor_profile:security:secure-score",
  replaces: "",
};

const ATTRIBUTION = { mspId: 1, customerId: 42, triggerSource: "test" };

function run() {
  return generateSecurityPostureNarrative({
    customerId: 42,
    tenantName: "Contoso",
    attribution: ATTRIBUTION,
  });
}

beforeEach(() => {
  anthropicPrompts = [];
  anthropicText = "<p>Real reasoning about real numbers.</p>";
  pillarPayload = payload(EMPTY_PILLARS);
  gateResult = { score: 41, threshold: 82, status: "no_go", source: "health_engine:copilot" };
  extraStat = { ...REAL_SECURE_SCORE, value: null, unavailableReason: "no_data" };
});

/* ------------------------------------------------------------------ *
 * The three sections
 * ------------------------------------------------------------------ */

describe("the report's three prose sections", () => {
  it("declares exactly the three the design's prose needs, in render order", () => {
    expect([...SECURITY_POSTURE_NARRATIVE_SECTIONS]).toEqual(["summary", "blastRadius", "copilotImpact"]);
  });

  it("grounds blast radius across security, governance and compliance", () => {
    // `security.blastRadius` and `governance.exposure` are the same metric on
    // two cards, and the site counts that give it scale are governance's — a
    // section grounded in security alone could not explain the number.
    expect(__testables.SECTION_PILLARS.blastRadius).toEqual(["security", "governance", "compliance"]);
  });
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
    const serialised = JSON.stringify(await run());
    expect(serialised).not.toMatch(/typically|generally|most organizations|best practice/i);
    expect(serialised).not.toMatch(/attacker|breach|intrusion/i);
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
    const summary = result.sections.find((s) => s.key === "summary")!;
    expect(summary.factCount).toBe(0);
    expect(summary.omittedReason).toBe("no_real_data");
    expect(anthropicPrompts).toHaveLength(0);
    // Both gaps are named — the card stat and the Secure Score this route
    // resolves itself — rather than either being silently dropped.
    expect(summary.missingChecks).toEqual([
      { checkKey: "identity:legacy-auth-usage", reason: "not_in_scan_package" },
      { checkKey: "security:secure-score", reason: "no_data" },
    ]);
  });

  it("generates from a SINGLE real fact — thin is short, not suppressed", async () => {
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
    const summary = result.sections.find((s) => s.key === "summary")!;
    expect(summary.factCount).toBe(1);
    expect(summary.html).toBe("<p>Real reasoning about real numbers.</p>");
    expect(anthropicPrompts[0]).toContain("You have been given 1 real facts");
  });
});

/* ------------------------------------------------------------------ *
 * Secure Score — the extra stat goes through the SAME rule
 * ------------------------------------------------------------------ */

describe("the extra metric this route resolves is held to the same rule", () => {
  beforeEach(() => {
    extraStat = { ...REAL_SECURE_SCORE };
  });

  it("counts a real Secure Score as a fact and puts it in the figures block", async () => {
    const result = await run();
    const summary = result.sections.find((s) => s.key === "summary")!;
    expect(summary.factCount).toBe(1);
    expect(anthropicPrompts[0]).toContain("security · Microsoft Secure Score: 38%");
  });

  it("replaces the 'no measured figure' placeholder rather than sitting under it", async () => {
    await run();
    expect(anthropicPrompts[0]).not.toContain("Do not cite any number here");
  });

  it("grounds ONLY the Summary with it — the other two never see a figure they do not own", async () => {
    pillarPayload = payload(
      EMPTY_PILLARS.map((c) =>
        c.pillar === "governance" ? card({ pillar: "governance", score: 46 }) : c,
      ),
    );
    await run();
    const blastPrompt = anthropicPrompts.find((p) => p.includes("Data Exposure & Blast Radius"))!;
    expect(blastPrompt).toBeDefined();
    expect(blastPrompt).not.toContain("Microsoft Secure Score");
  });

  it("reaches the wire in the pillar-stat shape, so the client uses one set of helpers", async () => {
    const result = await run();
    expect(result.stats).toEqual([
      {
        id: "security.secureScore",
        label: "Microsoft Secure Score",
        unit: "percent",
        value: 38,
        checkKey: "security:secure-score",
      },
    ]);
  });

  it("carries a licence gap's real feature name through untouched (#451)", async () => {
    extraStat = {
      ...REAL_SECURE_SCORE,
      value: null,
      unavailableReason: "license_gap",
      licenseFeature: "Microsoft Defender for Office 365 P2",
    };
    const result = await run();
    expect(result.stats[0]).toMatchObject({
      value: null,
      unavailableReason: "license_gap",
      licenseFeature: "Microsoft Defender for Office 365 P2",
    });
    // And it is named as a missing check on the section it grounds, so the
    // client's Upgrade Opportunity sweep can find it.
    const summary = result.sections.find((s) => s.key === "summary")!;
    expect(summary.missingChecks).toContainEqual({
      checkKey: "security:secure-score",
      reason: "license_gap",
      licenseFeature: "Microsoft Defender for Office 365 P2",
    });
  });

  it("never invents a licenseFeature for a gap that named none", async () => {
    extraStat = { ...REAL_SECURE_SCORE, value: null, unavailableReason: "license_gap" };
    const result = await run();
    expect(result.stats[0]).not.toHaveProperty("licenseFeature");
    const summary = result.sections.find((s) => s.key === "summary")!;
    expect(summary.missingChecks).toEqual([{ checkKey: "security:secure-score", reason: "license_gap" }]);
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
    const prompt = anthropicPrompts.find((p) => p.includes("Data Exposure & Blast Radius"))!;
    expect(prompt).toContain("governance · overshared sites: 212");
    expect(prompt).toContain("- copilot:overshare-exposure (no_data)");
    expect(prompt).not.toMatch(/items over-exposed: \d/);
  });

  it("marks an unscored pillar as NO SCORE rather than as a zero", async () => {
    await run();
    const prompt = anthropicPrompts.find((p) => p.includes("Data Exposure & Blast Radius"))!;
    expect(prompt).toContain("- security: NO SCORE");
    expect(prompt).not.toContain("security: score 0/100");
  });

  it("states the real Gate gap exactly in the Copilot Impact section, and forbids any other", async () => {
    pillarPayload = payload(EMPTY_PILLARS.map((c) => card({ ...c, pillar: c.pillar, score: 40 })));
    await run();
    const prompt = anthropicPrompts.find((p) => p.includes("Copilot Readiness Impact"))!;
    expect(prompt).toContain("Score 41/100 against a Gate of 82");
    expect(prompt).toContain("The gap is exactly 41 points");
  });

  it("forbids a verdict outright when the Gate has no score", async () => {
    gateResult = { score: null, threshold: 82, status: null, source: "health_engine:copilot" };
    pillarPayload = payload(EMPTY_PILLARS.map((c) => card({ ...c, pillar: c.pillar, score: 40 })));
    await run();
    const prompt = anthropicPrompts.find((p) => p.includes("Copilot Readiness Impact"))!;
    expect(prompt).toContain("NO SCORE");
    expect(prompt).not.toMatch(/The gap is exactly/);
  });

  it("forbids the claims a security report specifically tempts a model into", async () => {
    await run();
    const prompt = anthropicPrompts[0];
    expect(prompt).toContain("Never describe a breach, an intrusion, an attacker or an incident as having happened");
    expect(prompt).toContain("NEVER invent, estimate, extrapolate or infer");
  });
});

/* ------------------------------------------------------------------ *
 * Isolation and sanitising
 * ------------------------------------------------------------------ */

describe("one section's failure never costs the reader the others", () => {
  beforeEach(() => {
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
  });

  it("omits an empty model response with its own machine reason, and keeps the rest", async () => {
    anthropicText = "   ";
    const result = await run();
    for (const section of result.sections) {
      expect(section.html).toBeNull();
      expect(section.omittedReason).toBe("empty_response");
    }
  });

  it("strips script/style/handlers from the model's fragment before it is ever returned", async () => {
    anthropicText = '```html\n<p onclick="steal()">Real</p><script>bad()</script>\n```';
    const result = await run();
    const html = result.sections.find((s) => s.key === "summary")!.html!;
    expect(html).toBe("<p>Real</p>");
  });

  it("passes the real scan provenance through untouched", async () => {
    const result = await run();
    expect(result.scannedCheckCount).toBe(29);
    expect(result.scannedPackageKeys).toEqual(["core:security-baseline"]);
    expect(result.gate).toEqual({ score: 41, threshold: 82, status: "no_go" });
  });
});
