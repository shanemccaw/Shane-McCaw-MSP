/**
 * finding-point-impact-555.test.ts
 *
 * Git #555. Both `copilot_readiness` and `remediation_plan` were designed to
 * cite "the specific score increase each fix would produce", and the model
 * correctly refused to — nothing ever computed one. The whole correctness
 * question for the fix is the one the issue insisted on not assuming:
 *
 *   is a `signal_derivation_rules.copilot_impact` value directly presentable as
 *   "fixing this adds N points", or does it need normalizing first?
 *
 * It needs normalizing, and this file proves it against the REAL engine rather
 * than against a restatement of the formula. Only the module boundaries
 * `pillar-coverage.test.ts` already mocks are mocked (buildTenantProfile /
 * getDisabledSignalKeys / fetchSignalRulesAndGroups / db.select); signal firing,
 * `computeHealthEngine`, `computeSecurityEngine` and `evaluatePillarDisplay` all
 * run their real code, so the numbers asserted below are the numbers the live
 * scoring chain produces.
 *
 * The fixture is arithmetically hand-checkable on purpose:
 *
 *   signal                              copilot_impact   fires?
 *   signal.identity.ca-policy-count            10          yes
 *   signal.copilot.data-exposure-risk          30          yes
 *   signal.identity.mfa-registration           20          no
 *   signal.adoption.teams-activity             40          no
 *                                       theoreticalMax = 100, rawScore = 40
 *
 *   displayScore = 100 − 40/100 × 100 = 60          ← the real Copilot score
 *   ca-policy    = 10/100 × 100       = 10.0 points ← NOT "10 points" by accident:
 *   data-exposure= 30/100 × 100       = 30.0 points   the denominator here is 100
 *
 * A `theoreticalMax` of exactly 100 is chosen so the raw column and the real
 * point value COINCIDE, which would let a wrong implementation pass — so the
 * decisive test uses a second fixture whose denominator is deliberately not 100
 * and asserts the values move with it. That is the test that fails if anyone
 * ever "simplifies" this back to reading the raw column.
 *
 * Run: pnpm --filter @workspace/api-server run test -- finding-point-impact-555
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Same reason as pillar-coverage.test.ts: the @workspace/db mock keeps the REAL
// schema exports (table objects are dispatch sentinels below), so lib/db's index
// evaluates and hard-requires DATABASE_URL at module scope. vi.hoisted runs first.
vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:5432/test";
});

vi.mock("./tenant-signals.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./tenant-signals.ts")>();
  return { ...actual, buildTenantProfile: vi.fn(), getDisabledSignalKeys: vi.fn() };
});
vi.mock("./priority-engine.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./priority-engine.ts")>();
  return { ...actual, fetchSignalRulesAndGroups: vi.fn() };
});
vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return { ...actual, db: { select: vi.fn(), selectDistinct: vi.fn() } };
});

import {
  computeFindingPointImpacts,
  resolveFindingPointImpacts,
  buildFindingPointImpactPreamble,
  formatFindingPointImpactLine,
} from "./finding-point-impact.ts";
import { buildTenantProfile, getDisabledSignalKeys } from "./tenant-signals.ts";
import { fetchSignalRulesAndGroups } from "./priority-engine.ts";
import {
  db,
  monitorChecksTable,
  monitoringPackageChecksTable,
  mspDiagnosticRunsTable,
} from "@workspace/db";
import type { SignalDerivationRule } from "./tenant-signals.ts";

const BASE_DATE = new Date("2024-01-01T00:00:00Z");

const DEFAULT_INTELLIGENCE_FIELDS = {
  priority: 0,
  weight: 0,
  pricingImpact: 0,
  priorityScoreContribution: 0,
  pricingValueContribution: 0,
  governanceImpact: 0,
  securityImpact: 0,
  complianceImpact: 0,
  adoptionImpact: 0,
  copilotImpact: 0,
  architectureImpact: 0,
  licensingImpact: 0,
  trendValue: 0,
  trendDirection: "flat" as const,
  decayRate: 0,
  ttlDays: 0,
  confidence: 0,
  severity: "low" as const,
  category: "",
  pillar: "",
  crmFitContribution: 0,
  crmPainContribution: 0,
  crmMaturityContribution: 0,
  crmIntentContribution: 0,
  crmUrgencyContribution: 0,
};

let nextRuleId = 5000;
function makeRule(
  overrides: Partial<SignalDerivationRule> & Pick<SignalDerivationRule, "signalKey" | "ruleType" | "sourceKey">,
): SignalDerivationRule {
  return {
    id: nextRuleId++,
    groupId: null,
    compareValue: null,
    denominatorKey: null,
    description: null,
    sortOrder: 0,
    createdAt: BASE_DATE,
    updatedAt: BASE_DATE,
    ...DEFAULT_INTELLIGENCE_FIELDS,
    ...overrides,
  };
}

interface CheckDef {
  key: string;
  targetField: string;
}

/**
 * Wires every module boundary the resolver crosses. `db.select` dispatches by
 * table object, exactly like pillar-coverage.test.ts's; `db.selectDistinct` is
 * separate because `fetchScannedCheckKeys` uses it for the run/package lookups.
 */
function wireScenario(opts: {
  checks: CheckDef[];
  rules: SignalDerivationRule[];
  profile: Record<string, unknown>;
}) {
  const defs = opts.checks.map((c) => ({
    key: c.key,
    mapping: [{ sourceField: "value", targetField: c.targetField }],
    properties: [],
    requiresCustomerScript: false,
  }));

  vi.mocked(db.select).mockImplementation((() => ({
    from: (table: unknown) => {
      if (table === monitorChecksTable) {
        // Both the where-restricted (package-scoped) and unrestricted (catalog)
        // reads land here; the fixture's catalog IS the package, so one answer.
        const rows = { where: async () => defs, then: (r: (v: unknown) => unknown) => Promise.resolve(defs).then(r) };
        return rows;
      }
      throw new Error(`finding-point-impact-555.test: unexpected table in db.select`);
    },
  })) as unknown as typeof db.select);

  vi.mocked(db.selectDistinct).mockImplementation((() => ({
    from: (table: unknown) => {
      if (table === mspDiagnosticRunsTable) {
        return { where: async () => [{ packageKey: "test:package" }] };
      }
      if (table === monitoringPackageChecksTable) {
        return { where: async () => opts.checks.map((c) => ({ checkKey: c.key })) };
      }
      throw new Error(`finding-point-impact-555.test: unexpected table in db.selectDistinct`);
    },
  })) as unknown as typeof db.selectDistinct);

  vi.mocked(fetchSignalRulesAndGroups).mockResolvedValue({ rules: opts.rules, groups: [] });
  vi.mocked(buildTenantProfile).mockResolvedValue({
    mergedProfile: opts.profile,
    findings: [] as string[],
    customerId: 1,
    mspId: null,
    tenantId: null,
  } as Awaited<ReturnType<typeof buildTenantProfile>>);
  vi.mocked(getDisabledSignalKeys).mockResolvedValue(new Set());
}

const CHECKS: CheckDef[] = [
  { key: "identity:ca-policy-count", targetField: "caPolicyCount" },
  { key: "copilot:data-exposure-risk", targetField: "copilotExposedSiteCount" },
  { key: "identity:mfa-registration", targetField: "mfaRegistrationGapCount" },
  { key: "adoption:teams-activity", targetField: "teamsActiveUserCount" },
];

/** copilotImpact totals 100 across the four, of which 40 fires. */
function rulesWithImpacts(impacts: { ca: number; exposure: number; mfa: number; teams: number }): SignalDerivationRule[] {
  return [
    makeRule({
      signalKey: "signal.identity.ca-policy-count", ruleType: "profile_key_lt",
      sourceKey: "caPolicyCount", compareValue: "1", copilotImpact: impacts.ca,
    }),
    makeRule({
      signalKey: "signal.copilot.data-exposure-risk", ruleType: "profile_key_gt",
      sourceKey: "copilotExposedSiteCount", compareValue: "0", copilotImpact: impacts.exposure,
    }),
    makeRule({
      signalKey: "signal.identity.mfa-registration", ruleType: "profile_key_gt",
      sourceKey: "mfaRegistrationGapCount", compareValue: "0", copilotImpact: impacts.mfa,
    }),
    makeRule({
      signalKey: "signal.adoption.teams-activity", ruleType: "profile_key_lt",
      sourceKey: "teamsActiveUserCount", compareValue: "10", copilotImpact: impacts.teams,
    }),
  ];
}

/** ca fires (0 < 1), exposure fires (5 > 0), mfa does not (0 > 0), teams does not (50 < 10). */
const PROFILE = {
  caPolicyCount: 0,
  copilotExposedSiteCount: 5,
  mfaRegistrationGapCount: 0,
  teamsActiveUserCount: 50,
};

const CHECK_KEYS_IN_ORDER = [
  "identity:ca-policy-count",
  "copilot:data-exposure-risk",
  "identity:mfa-registration",
  null, // a script-run finding — no check key at all
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("computeFindingPointImpacts — the raw impact column is NOT the point value (#555)", () => {
  it("normalizes each finding's impact against the SAME theoreticalMax the real score used", async () => {
    wireScenario({ checks: CHECKS, rules: rulesWithImpacts({ ca: 10, exposure: 30, mfa: 20, teams: 40 }), profile: PROFILE });

    const result = await computeFindingPointImpacts(1, CHECK_KEYS_IN_ORDER);
    expect(result).not.toBeNull();

    // The real engine's own number, not a restatement: 100 − 40/100 × 100.
    expect(result!.score).toBe(60);
    expect(result!.evaluation.status).toBe("scored");
    expect(result!.evaluation.theoreticalMax).toBe(100);

    expect(result!.perFinding[0]).toMatchObject({ status: "scored", points: 10 });
    expect(result!.perFinding[1]).toMatchObject({ status: "scored", points: 30 });
  });

  it("DECISIVE: the same raw impacts against a different denominator produce different points", async () => {
    // Identical firing set, identical raw columns for the two firing signals
    // (10 and 30) — only the NON-firing weights change, which moves nothing in
    // the numerator and everything in the denominator. An implementation that
    // presented the raw column would report 10.0/30.0 again here; the real
    // normalization reports 5.0/15.0 against a theoreticalMax of 200.
    wireScenario({ checks: CHECKS, rules: rulesWithImpacts({ ca: 10, exposure: 30, mfa: 60, teams: 100 }), profile: PROFILE });

    const result = await computeFindingPointImpacts(1, CHECK_KEYS_IN_ORDER);
    expect(result!.evaluation.theoreticalMax).toBe(200);
    expect(result!.score).toBe(80); // 100 − 40/200 × 100
    expect(result!.perFinding[0].points).toBe(5);
    expect(result!.perFinding[1].points).toBe(15);
  });

  it("reconciles: the cited values sum to exactly the distance from the score to 100", async () => {
    // This is the property the issue's live verification asks for — the gap the
    // customer is shown has to be spendable on the findings they are shown.
    wireScenario({ checks: CHECKS, rules: rulesWithImpacts({ ca: 10, exposure: 30, mfa: 20, teams: 40 }), profile: PROFILE });

    const result = await computeFindingPointImpacts(1, CHECK_KEYS_IN_ORDER);
    const sum = result!.perFinding.reduce((s, f) => s + f.points, 0);
    expect(sum).toBe(result!.totalRecoverablePoints);
    expect(result!.totalRecoverablePoints).toBe(100 - result!.score);
  });

  it("distinguishes a real measured zero from an unattributable finding", async () => {
    wireScenario({ checks: CHECKS, rules: rulesWithImpacts({ ca: 10, exposure: 30, mfa: 20, teams: 40 }), profile: PROFILE });

    const result = await computeFindingPointImpacts(1, CHECK_KEYS_IN_ORDER);
    // mfa's signal exists and is evaluable but is NOT firing — fixing it recovers
    // nothing, and that is a measurement, not a missing value.
    expect(result!.perFinding[2]).toMatchObject({ status: "no_points", points: 0 });
    // A script-run finding has no check key to resolve through at all.
    expect(result!.perFinding[3]).toMatchObject({ status: "unattributed", points: 0 });
  });

  it("withholds every value rather than quoting points against a score the platform did not issue", async () => {
    // One evaluable Copilot-impacting signal — below MIN_EVALUABLE_SIGNALS_PER_PILLAR,
    // so #517's guard nulls the score. There is nothing for points to be points OF.
    wireScenario({
      checks: [CHECKS[0]],
      rules: [rulesWithImpacts({ ca: 10, exposure: 30, mfa: 20, teams: 40 })[0]],
      profile: PROFILE,
    });

    expect(await computeFindingPointImpacts(1, ["identity:ca-policy-count"])).toBeNull();
  });

  it("never throws when the engine is unreachable — the document goes out unpriced", async () => {
    vi.mocked(fetchSignalRulesAndGroups).mockRejectedValue(new Error("db down"));
    vi.mocked(buildTenantProfile).mockRejectedValue(new Error("db down"));
    vi.mocked(getDisabledSignalKeys).mockRejectedValue(new Error("db down"));

    await expect(computeFindingPointImpacts(1, CHECK_KEYS_IN_ORDER)).resolves.toBeNull();
  });
});

describe("resolveFindingPointImpacts — pure attribution (#555)", () => {
  const rules = [
    { id: 1, signalKey: "signal.a" },
    { id: 2, signalKey: "signal.a" }, // same signal, reachable from a SECOND check
    { id: 3, signalKey: "signal.b" },
  ];
  const checkKeyByRuleId = new Map<number, string | null>([
    [1, "check:one"],
    [2, "check:two"],
    [3, "check:one"],
  ]);

  it("claims a shared signal for the FIRST finding only — the values must not sum past the real gap", () => {
    const impacts = resolveFindingPointImpacts({
      checkKeysInOrder: ["check:one", "check:two"],
      checkKeyByRuleId,
      rules,
      firedSignalKeys: new Set(["signal.a", "signal.b"]),
      copilotImpactBySignalKey: new Map([["signal.a", 20], ["signal.b", 30]]),
      theoreticalMax: 100,
    });

    // check:one reaches BOTH signals (rules 1 and 3) and claims both: 50 points.
    expect(impacts[0]).toMatchObject({ status: "scored", points: 50 });
    // check:two reaches signal.a only, which is already spoken for — a second
    // 20 points here would make the document's own arithmetic wrong.
    expect(impacts[1]).toMatchObject({ status: "no_points", points: 0 });
  });

  it("reports a check no rule resolves to as unattributable, never as zero", () => {
    const impacts = resolveFindingPointImpacts({
      checkKeysInOrder: ["check:nothing-reads-this"],
      checkKeyByRuleId,
      rules,
      firedSignalKeys: new Set(["signal.a"]),
      copilotImpactBySignalKey: new Map([["signal.a", 20]]),
      theoreticalMax: 100,
    });
    expect(impacts[0].status).toBe("unattributed");
  });

  it("keeps sub-point weights visible at one decimal instead of rounding them to nothing", () => {
    // The live corpus's baseline weight is 1 against a ~260 denominator. Reported
    // as an integer that is 0 — "this costs you nothing" — which is false.
    const impacts = resolveFindingPointImpacts({
      checkKeysInOrder: ["check:one"],
      checkKeyByRuleId: new Map([[1, "check:one"]]),
      rules: [{ id: 1, signalKey: "signal.a" }],
      firedSignalKeys: new Set(["signal.a"]),
      copilotImpactBySignalKey: new Map([["signal.a", 1]]),
      theoreticalMax: 260,
    });
    expect(impacts[0].points).toBe(0.4);
  });
});

describe("prompt-facing rendering (#555)", () => {
  it("states the gap and the total recoverable so the model never has to do arithmetic", () => {
    const preamble = buildFindingPointImpactPreamble({
      pillar: "copilot",
      evaluation: {
        status: "scored", score: 53, evaluableSignalCount: 9,
        minRequiredSignals: 2, theoreticalMax: 260, reason: "scored",
      },
      score: 53,
      threshold: 82,
      totalRecoverablePoints: 47,
      perFinding: [
        { checkKey: "a", status: "scored", points: 34.6, signalKeys: ["s"] },
        { checkKey: "b", status: "no_points", points: 0, signalKeys: [] },
      ],
    });
    expect(preamble).toContain("Current readiness score: 53 out of 100");
    expect(preamble).toContain("points needed to clear it: 29");
    expect(preamble).toContain("Points recoverable across every finding currently costing this tenant points: 47.0");
    expect(preamble).toContain("Points shown in the list below: 34.6");
    expect(preamble).toContain("DO NOT RECALCULATE");
  });

  it("renders each of the three per-finding states distinguishably", () => {
    expect(formatFindingPointImpactLine({ checkKey: "a", status: "scored", points: 34.6, signalKeys: ["s"] }))
      .toBe("   POINT IMPACT IF FIXED: 34.6 points");
    expect(formatFindingPointImpactLine({ checkKey: "b", status: "no_points", points: 0, signalKeys: [] }))
      .toContain("0.0 points — this finding is not currently costing");
    expect(formatFindingPointImpactLine({ checkKey: null, status: "unattributed", points: 0, signalKeys: [] }))
      .toContain("NOT ATTRIBUTABLE");
    // A findings list longer than the resolved array must not silently render a
    // number belonging to a different finding.
    expect(formatFindingPointImpactLine(undefined)).toContain("NOT ATTRIBUTABLE");
  });
});
