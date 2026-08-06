/**
 * finding-rank-weight-414.test.ts — Git #414.
 *
 * The bug: a pillar's headline finding was whichever of its criticals sorted
 * first ALPHABETICALLY by check key. `identity:break-glass-health` beats
 * `identity:ca-mfa-coverage` on `b` vs `c` and nothing else, which is how "No
 * enabled break-glass account" came to outrank "No Conditional Access policies
 * exist" as Security's headline on the real test tenant.
 *
 * These drive the REAL exported functions — `buildFindingRankWeights` and
 * `compareRankedFindings` from war-room-pillar-stats.ts, and
 * `resolveOwningCheckKey` from pillar-coverage.ts underneath the first — over
 * the REAL check keys of `core:security-baseline`. Nothing about the ordering
 * is reimplemented here.
 *
 * What they deliberately do NOT prove: that `copilot_impact` genuinely varies
 * across the live rules. That is a fact about database contents, not about this
 * code, and this environment has no database access — see
 * `docs/2026-08-05-finding-rank-weights-414.sql` for the query that settles it
 * against real data, and the `FINDING_RANK_IMPACT_FIELD` docstring for why it
 * matters. The tie case below is the honest hedge: it pins what happens if the
 * column turns out flat.
 *
 * Run: pnpm --filter @workspace/api-server exec vitest run src/lib/finding-rank-weight-414.test.ts
 */

import { describe, it, expect, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:5432/test";
});

import {
  buildFindingRankWeights,
  compareRankedFindings,
  FINDING_RANK_IMPACT_FIELD,
  WAR_ROOM_FINDINGS_PER_PILLAR,
  type WarRoomPillarFinding,
} from "./war-room-pillar-stats.ts";
import type { SignalHealthImpactConfig } from "./health-engine.ts";

/**
 * The real rule shapes behind the issue's own example, as
 * `signal_derivation_rules` holds them: `threshold` rules whose `source_key` IS
 * the check key — the form `2026-07-23-threshold-rule-direction-audit.sql`
 * audits for these two keys by name — plus one `profile_key_equals` rule that
 * reaches its check only through a real `mapping.targetField`, so the
 * non-trivial hop is covered rather than just the identity case.
 */
const RANK_RULES = [
  { ruleType: "threshold", sourceKey: "identity:ca-mfa-coverage", signalKey: "signal.identity.ca-mfa-coverage" },
  { ruleType: "threshold", sourceKey: "identity:break-glass-health", signalKey: "signal.identity.break-glass-health" },
  { ruleType: "profile_key_equals", sourceKey: "caPolicyCount", signalKey: "signal.identity.ca-policy-count" },
];

/** Real `monitor_checks` rows, reduced to the fields the resolution reads. */
const RANK_CHECK_DEFS = [
  { key: "identity:ca-mfa-coverage", mapping: null, properties: null },
  { key: "identity:break-glass-health", mapping: null, properties: null },
  {
    key: "identity:ca-policy-count",
    mapping: [{ sourceField: "value", targetField: "caPolicyCount" }],
    properties: null,
  },
];

/**
 * A `getSignalHealthImpacts`-shaped map carrying the given weight on whichever
 * column `FINDING_RANK_IMPACT_FIELD` names, and zero on every other. Written
 * against the constant rather than against `copilotImpact` by name so these
 * tests keep testing the RANKING if that decision is ever revisited, instead of
 * silently becoming assertions about a column nothing reads.
 */
function impactsFor(bySignal: Record<string, number>): Map<string, SignalHealthImpactConfig> {
  return new Map(
    Object.entries(bySignal).map(([signalKey, weight]) => {
      const impact: SignalHealthImpactConfig = {
        signalKey,
        governanceImpact: 0,
        securityImpact: 0,
        complianceImpact: 0,
        adoptionImpact: 0,
        copilotImpact: 0,
        architectureImpact: 0,
        licensingImpact: 0,
      };
      impact[FINDING_RANK_IMPACT_FIELD] = weight;
      return [signalKey, impact] as const;
    }),
  );
}

/**
 * The weights Shane authored for these signals: CA-MFA coverage 20, break-glass
 * health 18. The whole point of the issue is that 20 must beat 18 rather than
 * `b` beating `c`.
 */
const RANK_WEIGHTS = buildFindingRankWeights(
  RANK_RULES,
  impactsFor({
    "signal.identity.ca-mfa-coverage": 20,
    "signal.identity.break-glass-health": 18,
    "signal.identity.ca-policy-count": 12,
  }),
  RANK_CHECK_DEFS,
);

function finding(
  checkKey: string,
  severity: "critical" | "warning",
  title: string,
): WarRoomPillarFinding {
  return { severity, checkKey, title, rankWeight: RANK_WEIGHTS.get(checkKey) ?? 0 };
}

describe("#414 the weight join back to signal_derivation_rules", () => {
  it("resolves a threshold rule's check straight from its sourceKey", () => {
    expect(RANK_WEIGHTS.get("identity:ca-mfa-coverage")).toBe(20);
    expect(RANK_WEIGHTS.get("identity:break-glass-health")).toBe(18);
  });

  it("resolves a profile_key rule through the check's real mapping targetField", () => {
    // The hop a finding row cannot make on its own: the rule names
    // `caPolicyCount`, a merged-PROFILE key, and only the check's own mapping
    // says `identity:ca-policy-count` is what produces it.
    expect(RANK_WEIGHTS.get("identity:ca-policy-count")).toBe(12);
  });

  it("leaves a check no rule feeds unranked, read as 0 rather than dropped", () => {
    expect(RANK_WEIGHTS.get("identity:risky-users")).toBeUndefined();
    expect(finding("identity:risky-users", "critical", "x").rankWeight).toBe(0);
  });

  it("takes the strongest rule when several resolve to one check", () => {
    const weights = buildFindingRankWeights(
      [
        { ruleType: "threshold", sourceKey: "identity:ca-mfa-coverage", signalKey: "a" },
        { ruleType: "threshold", sourceKey: "identity:ca-mfa-coverage", signalKey: "b" },
      ],
      impactsFor({ a: 5, b: 31 }),
      RANK_CHECK_DEFS,
    );
    expect(weights.get("identity:ca-mfa-coverage")).toBe(31);
  });
});

describe("#414 the headline the issue reported", () => {
  /** Both are real criticals for the test tenant today. */
  const SECURITY_CRITICALS = [
    finding("identity:break-glass-health", "critical", "No enabled break-glass account"),
    finding("identity:ca-mfa-coverage", "critical", "No Conditional Access policies exist"),
  ];

  it("leads with the heavier CA finding, not the alphabetically-first one", () => {
    const ordered = [...SECURITY_CRITICALS].sort(compareRankedFindings);
    expect(ordered[0]!.title).toBe("No Conditional Access policies exist");
    expect(ordered[1]!.title).toBe("No enabled break-glass account");
  });

  it("is a genuine reversal — the old rule really did pick break-glass", () => {
    const oldOrder = [...SECURITY_CRITICALS].sort((a, b) => a.checkKey.localeCompare(b.checkKey));
    expect(oldOrder[0]!.title).toBe("No enabled break-glass account");
  });
});

describe("#414 severity tiers are completely unaffected", () => {
  it("never lets a heavier warning displace a lighter critical", () => {
    const ordered = [
      finding("identity:break-glass-health", "warning", "heavy warning"), // weight 18
      finding("identity:ca-policy-count", "critical", "light critical"), // weight 12
    ].sort(compareRankedFindings);
    expect(ordered.map((f) => f.severity)).toEqual(["critical", "warning"]);
    expect(ordered[0]!.title).toBe("light critical");
  });

  it("keeps every critical ahead of every warning across a mixed set", () => {
    const ordered = [
      finding("identity:break-glass-health", "warning", "w1"), // 18
      finding("identity:ca-mfa-coverage", "critical", "c1"), // 20
      finding("identity:ca-policy-count", "warning", "w2"), // 12
      finding("identity:risky-users", "critical", "c2"), // 0
    ].sort(compareRankedFindings);
    expect(ordered.map((f) => f.severity)).toEqual(["critical", "critical", "warning", "warning"]);
    // …and each tier is internally ranked by weight: 20 then 0, 18 then 12.
    expect(ordered.map((f) => f.title)).toEqual(["c1", "c2", "w1", "w2"]);
  });
});

describe("#414 degrades honestly rather than arbitrarily", () => {
  it("falls back to the pre-existing check-key order when weights tie", () => {
    // The live-data risk stated on FINDING_RANK_IMPACT_FIELD: if the ranking
    // column does not vary, behaviour must be exactly today's, not random.
    const flat = buildFindingRankWeights(
      RANK_RULES,
      impactsFor({
        "signal.identity.ca-mfa-coverage": 1,
        "signal.identity.break-glass-health": 1,
        "signal.identity.ca-policy-count": 1,
      }),
      RANK_CHECK_DEFS,
    );
    const tied: WarRoomPillarFinding[] = [
      "identity:ca-policy-count",
      "identity:break-glass-health",
      "identity:ca-mfa-coverage",
    ].map((k) => ({ severity: "critical", checkKey: k, title: k, rankWeight: flat.get(k) ?? 0 }));

    expect([...tied].sort(compareRankedFindings).map((f) => f.checkKey)).toEqual([
      "identity:break-glass-health",
      "identity:ca-mfa-coverage",
      "identity:ca-policy-count",
    ]);
  });

  it("does not reorder a pillar with a single critical finding", () => {
    const one = [finding("identity:ca-policy-count", "critical", "the only one")];
    expect([...one].sort(compareRankedFindings)).toEqual(one);
  });

  it("leaves an empty pillar empty", () => {
    expect(([] as WarRoomPillarFinding[]).sort(compareRankedFindings)).toEqual([]);
  });

  it("ranks AHEAD of the per-pillar cap, so the cap keeps the heaviest", () => {
    // Why this had to be server-side: the wire only ever carries
    // WAR_ROOM_FINDINGS_PER_PILLAR findings per pillar, so any ranking applied
    // after the slice can only reorder an already-wrongly-chosen set.
    const four = [
      finding("identity:break-glass-health", "critical", "18"),
      finding("identity:ca-mfa-coverage", "critical", "20"),
      finding("identity:ca-policy-count", "critical", "12"),
      finding("identity:risky-users", "critical", "0"),
    ];
    const kept = [...four].sort(compareRankedFindings).slice(0, WAR_ROOM_FINDINGS_PER_PILLAR);
    expect(kept.map((f) => f.title)).toEqual(["20", "18", "12"]);

    // The old alphabetical order kept the same three here but in the wrong
    // order; the cap's real hazard is that it is blind to weight at all.
    const oldKept = [...four]
      .sort((a, b) => a.checkKey.localeCompare(b.checkKey))
      .slice(0, WAR_ROOM_FINDINGS_PER_PILLAR);
    expect(oldKept.map((f) => f.title)).toEqual(["18", "20", "12"]);
  });
});
