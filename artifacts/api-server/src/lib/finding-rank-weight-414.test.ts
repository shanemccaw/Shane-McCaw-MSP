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
 * ── The 2026-08-06 correction these were extended for ──────────────────────
 * The original version of this file could not prove the one thing that turned
 * out to matter: whether the ranking COLUMN is populated on live data. It said
 * so, and hedged with a tie case. Shane then ran Query 1 against the real
 * database and found `copilot_impact` flat at 0 for every pillar except
 * `copilot` itself — so the shipped ranking was a no-op for six of seven cards,
 * Security included, and the reported bug was still live. Ranking is now
 * per-pillar (`FINDING_RANK_IMPACT_FIELD[enginePillar]`).
 *
 * The tests below are therefore written against the pillar-keyed lookup rather
 * than a single column, and the Security block is a genuine regression test for
 * the originally-reported bug rather than a demonstration of the mechanism.
 *
 * Still NOT proven here, and still a fact about database contents rather than
 * code: that each pillar's OWN column is populated. Query 1's live output says
 * it is (Security alone has 20 distinct weights across 56 rules) —
 * `docs/2026-08-06-finding-rank-per-pillar-verification-414.sql` re-checks it
 * per-pillar after this change. The flat-own-field case below is the hedge, and
 * it now pins exactly the failure mode that was actually hit once.
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
  WAR_ROOM_ENGINE_PILLAR,
  WAR_ROOM_PILLAR_KEYS,
  WAR_ROOM_FINDINGS_PER_PILLAR,
  type CheckRankWeights,
  type WarRoomPillarFinding,
  type WarRoomPillarKey,
} from "./war-room-pillar-stats.ts";
import { RADAR_PILLARS, type RadarPillar } from "./pillar-coverage.ts";
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

/** Every impact column zeroed — the starting point for a per-pillar fixture. */
function zeroImpact(signalKey: string): SignalHealthImpactConfig {
  return {
    signalKey,
    governanceImpact: 0,
    securityImpact: 0,
    complianceImpact: 0,
    adoptionImpact: 0,
    copilotImpact: 0,
    architectureImpact: 0,
    licensingImpact: 0,
  };
}

/**
 * A `getSignalHealthImpacts`-shaped map that puts each signal's weight on ONE
 * named pillar's own column, leaving the other six at zero.
 *
 * This shape is the whole point of the correction: it reproduces the live data
 * Query 1 found, where a security signal carries a real `securityImpact` and a
 * flat `copilot_impact` of 0. Written against `FINDING_RANK_IMPACT_FIELD[pillar]`
 * rather than naming a column literally, so these tests keep testing the RANKING
 * if the mapping is ever revisited instead of silently becoming assertions about
 * a column nothing reads.
 */
function impactsOn(
  pillar: RadarPillar,
  bySignal: Record<string, number>,
): Map<string, SignalHealthImpactConfig> {
  return new Map(
    Object.entries(bySignal).map(([signalKey, weight]) => {
      const impact = zeroImpact(signalKey);
      impact[FINDING_RANK_IMPACT_FIELD[pillar]] = weight;
      return [signalKey, impact] as const;
    }),
  );
}

/**
 * The real weights for the issue's own example, carried on `securityImpact`
 * because these are `identity:*` checks and `warRoomPillarForCheckKey` files
 * them under the Security card: CA-MFA coverage 20, break-glass health 18.
 * The whole point of the issue is that 20 must beat 18 rather than `b` beating
 * `c` — and the whole point of the correction is that it must do so while
 * `copilot_impact` on all three is 0, exactly as live data has it.
 */
const SECURITY_IMPACTS = impactsOn("security", {
  "signal.identity.ca-mfa-coverage": 20,
  "signal.identity.break-glass-health": 18,
  "signal.identity.ca-policy-count": 12,
});

const RANK_WEIGHTS = buildFindingRankWeights(RANK_RULES, SECURITY_IMPACTS, RANK_CHECK_DEFS);

/**
 * A finding as `fetchPillarFindings` builds it: the rank weight is already
 * narrowed to the ONE column belonging to the card this finding lands on.
 * Defaults to the Security card because that is where every `identity:*` check
 * in this file is filed.
 */
function finding(
  checkKey: string,
  severity: "critical" | "warning",
  title: string,
  pillar: WarRoomPillarKey = "security",
): WarRoomPillarFinding {
  return {
    severity,
    checkKey,
    title,
    rankWeight: RANK_WEIGHTS.get(checkKey)?.[WAR_ROOM_ENGINE_PILLAR[pillar]] ?? 0,
  };
}

describe("#414 the weight join back to signal_derivation_rules", () => {
  it("resolves a threshold rule's check straight from its sourceKey", () => {
    expect(RANK_WEIGHTS.get("identity:ca-mfa-coverage")?.security).toBe(20);
    expect(RANK_WEIGHTS.get("identity:break-glass-health")?.security).toBe(18);
  });

  it("resolves a profile_key rule through the check's real mapping targetField", () => {
    // The hop a finding row cannot make on its own: the rule names
    // `caPolicyCount`, a merged-PROFILE key, and only the check's own mapping
    // says `identity:ca-policy-count` is what produces it.
    expect(RANK_WEIGHTS.get("identity:ca-policy-count")?.security).toBe(12);
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
      impactsOn("security", { a: 5, b: 31 }),
      RANK_CHECK_DEFS,
    );
    expect(weights.get("identity:ca-mfa-coverage")?.security).toBe(31);
  });

  it("carries a weight for every engine pillar, not just the one being read", () => {
    // The map is built once and read seven different ways, so a missing key
    // would surface as a silent 0 on one card rather than a type error.
    const weights = RANK_WEIGHTS.get("identity:ca-mfa-coverage") as CheckRankWeights;
    for (const pillar of RADAR_PILLARS) {
      expect(weights, `pillar ${pillar}`).toHaveProperty(pillar);
      expect(typeof weights[pillar], `pillar ${pillar}`).toBe("number");
    }
  });

  it("takes the per-pillar max independently, not one winner across all columns", () => {
    // One rule can be the heaviest contributor to a check's securityImpact
    // while a different rule on the same check is heaviest for governance.
    const heavySecurity = zeroImpact("a");
    heavySecurity.securityImpact = 40;
    heavySecurity.governanceImpact = 1;
    const heavyGovernance = zeroImpact("b");
    heavyGovernance.securityImpact = 2;
    heavyGovernance.governanceImpact = 33;

    const weights = buildFindingRankWeights(
      [
        { ruleType: "threshold", sourceKey: "identity:ca-mfa-coverage", signalKey: "a" },
        { ruleType: "threshold", sourceKey: "identity:ca-mfa-coverage", signalKey: "b" },
      ],
      new Map([
        ["a", heavySecurity],
        ["b", heavyGovernance],
      ]),
      RANK_CHECK_DEFS,
    );
    const w = weights.get("identity:ca-mfa-coverage") as CheckRankWeights;
    expect(w.security).toBe(40);
    expect(w.governance).toBe(33);
  });
});

describe("#414 the headline the issue reported, ranked by securityImpact", () => {
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

  /**
   * THE REGRESSION TEST FOR THE 2026-08-06 CORRECTION.
   *
   * The fixture above carries weight ONLY on `securityImpact`; `copilotImpact`
   * is 0 on all three signals, which is exactly what Query 1 found on live data.
   * Ranking Security by `copilotImpact` — what shipped in `6c648df4` — therefore
   * produces a three-way tie and falls through to the alphabetical tiebreak,
   * putting break-glass back on top. This asserts the ranking Security actually
   * uses is NOT that column.
   */
  it("does not rank Security by copilotImpact, which is flat 0 on live data", () => {
    const w = RANK_WEIGHTS.get("identity:ca-mfa-coverage") as CheckRankWeights;
    const b = RANK_WEIGHTS.get("identity:break-glass-health") as CheckRankWeights;

    // The live-data condition that made the first fix a no-op, reproduced.
    expect(w.copilot).toBe(0);
    expect(b.copilot).toBe(0);

    // Had the card read that column, the two would tie and the bug would stand.
    const asCopilotRanked = [...SECURITY_CRITICALS]
      .map((f) => ({ ...f, rankWeight: RANK_WEIGHTS.get(f.checkKey)?.copilot ?? 0 }))
      .sort(compareRankedFindings);
    expect(asCopilotRanked[0]!.title).toBe("No enabled break-glass account");

    // Reading Security's own column is what breaks the tie.
    expect(w.security).toBeGreaterThan(b.security);
    expect([...SECURITY_CRITICALS].sort(compareRankedFindings)[0]!.title).toBe(
      "No Conditional Access policies exist",
    );
  });

  it("routes an identity:* finding to the Security card's own column", () => {
    // The wiring the correction depends on: warRoomPillarForCheckKey files
    // identity checks under `security`, WAR_ROOM_ENGINE_PILLAR keeps that as the
    // engine's `security`, and FINDING_RANK_IMPACT_FIELD names securityImpact.
    expect(WAR_ROOM_ENGINE_PILLAR.security).toBe("security");
    expect(FINDING_RANK_IMPACT_FIELD.security).toBe("securityImpact");
    expect(finding("identity:ca-mfa-coverage", "critical", "x").rankWeight).toBe(20);
  });
});

describe("#414 per-pillar ranking is the general rule, copilot just one case", () => {
  it("maps every War Room card to its own engine pillar's impact column", () => {
    const expected: Record<WarRoomPillarKey, string> = {
      governance: "governanceImpact",
      licensing: "licensingImpact",
      adoption: "adoptionImpact",
      compliance: "complianceImpact",
      health: "architectureImpact", // the one War Room -> engine rename
      security: "securityImpact",
      copilot: "copilotImpact",
    };
    for (const pillar of WAR_ROOM_PILLAR_KEYS) {
      expect(FINDING_RANK_IMPACT_FIELD[WAR_ROOM_ENGINE_PILLAR[pillar]], `pillar ${pillar}`).toBe(
        expected[pillar],
      );
    }
  });

  it("still ranks the Copilot card by copilotImpact — unchanged by the correction", () => {
    // The one pillar where old and new behaviour coincide. Asserted rather than
    // assumed, since "copilot is special" is exactly the wrong reading: it is
    // one instance of the general per-pillar rule.
    const weights = buildFindingRankWeights(
      [
        { ruleType: "threshold", sourceKey: "copilot:overshare-exposure", signalKey: "hi" },
        { ruleType: "threshold", sourceKey: "copilot:license-assignment", signalKey: "lo" },
      ],
      impactsOn("copilot", { hi: 20, lo: 4 }),
      [
        { key: "copilot:overshare-exposure", mapping: null, properties: null },
        { key: "copilot:license-assignment", mapping: null, properties: null },
      ],
    );
    const cards: WarRoomPillarFinding[] = [
      {
        severity: "critical",
        checkKey: "copilot:license-assignment",
        title: "lighter",
        rankWeight: weights.get("copilot:license-assignment")?.copilot ?? 0,
      },
      {
        severity: "critical",
        checkKey: "copilot:overshare-exposure",
        title: "heavier",
        rankWeight: weights.get("copilot:overshare-exposure")?.copilot ?? 0,
      },
    ];

    expect(cards.sort(compareRankedFindings).map((f) => f.title)).toEqual(["heavier", "lighter"]);
  });

  it("ranks a licensing finding by licensingImpact, blind to its security weight", () => {
    // Cross-pillar signals are real (the correction's own rationale), so a
    // finding must not inherit a rank from a column its card does not display.
    const mixed = zeroImpact("s");
    mixed.securityImpact = 99;
    mixed.licensingImpact = 3;

    const weights = buildFindingRankWeights(
      [{ ruleType: "threshold", sourceKey: "cost:unused-licenses", signalKey: "s" }],
      new Map([["s", mixed]]),
      [{ key: "cost:unused-licenses", mapping: null, properties: null }],
    );
    const w = weights.get("cost:unused-licenses") as CheckRankWeights;
    expect(w.licensing).toBe(3);
    expect(w.security).toBe(99);
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
      impactsOn("security", {
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
    ].map((k) => ({
      severity: "critical",
      checkKey: k,
      title: k,
      rankWeight: flat.get(k)?.security ?? 0,
    }));

    expect([...tied].sort(compareRankedFindings).map((f) => f.checkKey)).toEqual([
      "identity:break-glass-health",
      "identity:ca-mfa-coverage",
      "identity:ca-policy-count",
    ]);
  });

  it("degrades to the check-key order when a pillar's OWN field is flat too", () => {
    // The per-pillar lookup is not a guarantee of variance — it moves the bet
    // from one column to seven. If Security's own column is ever as empty as
    // copilot_impact turned out to be, the failure must be the honest one
    // (today's alphabetical order), not an arbitrary reshuffle. This is the
    // same shape of hedge the original file carried, now pointed at the column
    // that is actually read.
    const flatOwn = buildFindingRankWeights(
      RANK_RULES,
      impactsOn("security", {
        "signal.identity.ca-mfa-coverage": 0,
        "signal.identity.break-glass-health": 0,
        "signal.identity.ca-policy-count": 0,
      }),
      RANK_CHECK_DEFS,
    );
    for (const key of ["identity:ca-mfa-coverage", "identity:break-glass-health"]) {
      expect(flatOwn.get(key)?.security, `check ${key}`).toBe(0);
    }

    const tied: WarRoomPillarFinding[] = [
      "identity:ca-policy-count",
      "identity:ca-mfa-coverage",
      "identity:break-glass-health",
    ].map((k) => ({
      severity: "critical",
      checkKey: k,
      title: k,
      rankWeight: flatOwn.get(k)?.security ?? 0,
    }));

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
