/**
 * priority-engine.test.ts
 *
 * Unit tests for the pure core of the priority scoring engine:
 *   rankFiredSignals()  — sorts fired signal keys by configured priorityScoreContribution
 *   sumPriorityScore()  — sums priorityScoreContribution across ranked signals
 *
 * These are the only two functions that decide the engine's output — no DB
 * access, no hand-coded formulas. The tests prove:
 *   1. Determinism — same inputs produce the same score every run.
 *   2. Delta correctness — changing one signal's contribution changes the
 *      score by exactly that delta, nothing more.
 *   3. Ranking order matches contribution order (descending).
 *   4. The engine is a pure sum/sort — no signal is weighted, multiplied, or
 *      conditionally included/excluded beyond "is it in firedSignalKeys".
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test
 */

import { describe, it, expect } from "vitest";
import { rankFiredSignals, sumPriorityScore, type SignalWeightConfig, type RankedSignal } from "./priority-engine.ts";

function weight(signalKey: string, priorityScoreContribution: number, overrides: Partial<SignalWeightConfig> = {}): SignalWeightConfig {
  return { signalKey, weight: 0, priority: 0, priorityScoreContribution, ...overrides };
}

describe("rankFiredSignals", () => {
  it("assigns each fired signal its configured priorityScoreContribution", () => {
    const weights = [weight("hasSecurityGaps", 40), weight("hasCopilotLicenses", 25)];
    const ranked = rankFiredSignals(["hasSecurityGaps", "hasCopilotLicenses"], weights);

    expect(ranked).toEqual([
      { signalKey: "hasSecurityGaps", priorityScoreContribution: 40 },
      { signalKey: "hasCopilotLicenses", priorityScoreContribution: 25 },
    ]);
  });

  it("sorts fired signals descending by priorityScoreContribution", () => {
    const weights = [
      weight("hasCopilotLicenses", 10),
      weight("hasSecurityGaps", 50),
      weight("hasGovernanceGaps", 30),
    ];
    const ranked = rankFiredSignals(["hasCopilotLicenses", "hasSecurityGaps", "hasGovernanceGaps"], weights);

    expect(ranked.map(r => r.signalKey)).toEqual(["hasSecurityGaps", "hasGovernanceGaps", "hasCopilotLicenses"]);
  });

  it("treats a fired signal with no configured weight as contributing 0 (e.g. alwaysInclude)", () => {
    const weights = [weight("hasSecurityGaps", 40)];
    const ranked = rankFiredSignals(["alwaysInclude", "hasSecurityGaps"], weights);

    const always = ranked.find(r => r.signalKey === "alwaysInclude");
    expect(always?.priorityScoreContribution).toBe(0);
    // 0-contribution signal sorts last
    expect(ranked[ranked.length - 1].signalKey).toBe("alwaysInclude");
  });

  it("ignores weight config for signals that did not fire", () => {
    const weights = [weight("hasSecurityGaps", 40), weight("hasCopilotLicenses", 999)];
    const ranked = rankFiredSignals(["hasSecurityGaps"], weights);

    expect(ranked).toEqual([{ signalKey: "hasSecurityGaps", priorityScoreContribution: 40 }]);
  });

  it("returns an empty array when no signals fired", () => {
    expect(rankFiredSignals([], [weight("hasSecurityGaps", 40)])).toEqual([]);
  });
});

describe("sumPriorityScore", () => {
  const ranked: RankedSignal[] = [
    { signalKey: "hasSecurityGaps", priorityScoreContribution: 40 },
    { signalKey: "hasCopilotLicenses", priorityScoreContribution: 25 },
    { signalKey: "alwaysInclude", priorityScoreContribution: 0 },
  ];

  it("is exactly the sum of priorityScoreContribution across the fired signals — nothing else", () => {
    const { score } = sumPriorityScore(ranked);
    expect(score).toBe(65); // 40 + 25 + 0, no multiplier, no bonus
  });

  it("produces a breakdown entry per signal with the raw contribution value", () => {
    const { breakdown } = sumPriorityScore(ranked);
    expect(breakdown).toEqual([
      { signalKey: "hasSecurityGaps", contribution: 40 },
      { signalKey: "hasCopilotLicenses", contribution: 25 },
      { signalKey: "alwaysInclude", contribution: 0 },
    ]);
  });

  it("is deterministic — same input produces the same score every run", () => {
    const first = sumPriorityScore(ranked).score;
    const second = sumPriorityScore([...ranked]).score;
    const third = sumPriorityScore(ranked).score;
    expect(first).toBe(second);
    expect(second).toBe(third);
  });

  it("returns 0 for an empty signal set", () => {
    expect(sumPriorityScore([]).score).toBe(0);
  });

  it("changing one signal's contribution changes the score by exactly that delta", () => {
    const before = sumPriorityScore(ranked).score;

    const bumped = ranked.map(r =>
      r.signalKey === "hasCopilotLicenses" ? { ...r, priorityScoreContribution: r.priorityScoreContribution + 15 } : r,
    );
    const after = sumPriorityScore(bumped).score;

    expect(after - before).toBe(15);
  });

  it("removing a fired signal reduces the score by exactly its contribution", () => {
    const before = sumPriorityScore(ranked).score;
    const withoutCopilot = ranked.filter(r => r.signalKey !== "hasCopilotLicenses");
    const after = sumPriorityScore(withoutCopilot).score;

    expect(before - after).toBe(25);
  });
});

describe("rankFiredSignals + sumPriorityScore integration — full pure pipeline", () => {
  it("ranking order matches contribution order, and score is the sum regardless of order", () => {
    const weights = [
      weight("hasSecurityGaps", 40),
      weight("hasGovernanceGaps", 30),
      weight("hasCopilotLicenses", 25),
      weight("hasDLPGaps", 15),
    ];
    // Fire them in a scrambled order — engine must sort deterministically.
    const firedSignalKeys = ["hasDLPGaps", "hasSecurityGaps", "hasCopilotLicenses", "hasGovernanceGaps"];

    const ranked = rankFiredSignals(firedSignalKeys, weights);
    expect(ranked.map(r => r.signalKey)).toEqual([
      "hasSecurityGaps",
      "hasGovernanceGaps",
      "hasCopilotLicenses",
      "hasDLPGaps",
    ]);

    const { score, breakdown } = sumPriorityScore(ranked);
    expect(score).toBe(40 + 30 + 25 + 15);
    expect(breakdown).toHaveLength(4);
  });

  it("has no hidden business logic — contribution comes only from configured weight, unconditionally", () => {
    // A signal considered "high severity" or "critical" in name only, with a
    // deliberately small configured contribution, must not be boosted.
    const weights = [weight("hasSecurityGaps", 5), weight("alwaysInclude", 1000)];
    const ranked = rankFiredSignals(["hasSecurityGaps"], weights);

    expect(ranked).toEqual([{ signalKey: "hasSecurityGaps", priorityScoreContribution: 5 }]);
    expect(sumPriorityScore(ranked).score).toBe(5);
  });
});
