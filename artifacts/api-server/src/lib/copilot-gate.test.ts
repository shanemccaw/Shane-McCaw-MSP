/**
 * copilot-gate.test.ts — #358 / #359.
 *
 * Two claims are worth a test here, and they are the two the issues actually
 * make:
 *
 *   1. The Gate boundary is exactly where Shane said it is. 82 is a Go, 81 is a
 *      No-Go, and no score has no verdict. This is the assertion #359 asks for
 *      by name.
 *   2. The Gate's score is the SAME number `buildWarRoomPillarStats` puts on its
 *      copilot card — not a parallel computation that happens to look similar.
 *      Driven through the real `computePillarDisplayScore` / `buildPillarViews`
 *      with one real engine output, so a future divergence in either path turns
 *      this red instead of quietly re-creating the two-systems bug #358 exists
 *      to close.
 */

import { describe, it, expect, vi } from "vitest";

// Everything asserted below is pure, but the import graph reaches health-engine
// → tenant-signals → lib/db's index.ts, which hard-requires DATABASE_URL at
// module scope. Same `vi.hoisted` stand-in pillar-coverage.test.ts uses: it runs
// before the module graph evaluates, and pg.Pool is lazy so nothing connects.
vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:5432/test";
});

import {
  COPILOT_GATE_THRESHOLD,
  copilotGate,
  copilotGateNotEvaluated,
  copilotGateStatus,
} from "./copilot-gate.ts";
import {
  computePillarDisplayScore,
  evaluatePillarDisplay,
  MIN_EVALUABLE_SIGNALS_PER_PILLAR,
} from "./health-display.ts";
import { buildPillarViews } from "./telemetry-comparison.ts";
import type { HealthEngineOutput, SignalHealthImpactConfig } from "./health-engine.ts";

describe("the Copilot Gate threshold", () => {
  it("is 82 — the real number Shane confirmed, not a placeholder", () => {
    expect(COPILOT_GATE_THRESHOLD).toBe(82);
  });

  it("treats 82 itself as a Go and 81 as a No-Go", () => {
    // The boundary case was explicitly raised on #358 ("< 82 no-go, > 82 go"
    // leaves 82 ambiguous) and explicitly answered: >= 82 = Go.
    expect(copilotGateStatus(82)).toBe("go");
    expect(copilotGateStatus(81)).toBe("no_go");
  });

  it("gates the extremes the same way", () => {
    expect(copilotGateStatus(100)).toBe("go");
    expect(copilotGateStatus(83)).toBe("go");
    expect(copilotGateStatus(0)).toBe("no_go");
    expect(copilotGateStatus(41)).toBe("no_go");
  });

  it("returns no verdict for no score, rather than defaulting to No-Go", () => {
    // A tenant with no evaluable Copilot-impacting rule has not been measured.
    // Calling that "No-Go" would state a finding the platform never made.
    expect(copilotGateStatus(null)).toBeNull();
  });

  it("wraps a score into the shape every surface renders, with provenance", () => {
    expect(copilotGate(82)).toMatchObject({
      score: 82,
      threshold: 82,
      status: "go",
      source: "health_engine:copilot",
    });
    expect(copilotGate(null)).toMatchObject({
      score: null,
      threshold: 82,
      status: null,
      source: "health_engine:copilot",
    });
  });

  it("carries an explicit real-coverage status, never a bare null the client must interpret (#517)", () => {
    // The whole point of #517: a client rendering "no score" needs to know WHICH
    // kind of nothing it is looking at. `copilotGate(null)` with no evaluation
    // supplied is the honest floor case — not_evaluated, never "scored".
    expect(copilotGate(null).evaluation.status).toBe("not_evaluated");
    expect(copilotGate(82).evaluation.status).toBe("scored");
    expect(copilotGate(null).evaluation.minRequiredSignals).toBe(MIN_EVALUABLE_SIGNALS_PER_PILLAR);
  });

  it("copilotGateNotEvaluated names the real reason rather than shrugging", () => {
    const gate = copilotGateNotEvaluated("no completed scan for this customer yet");
    expect(gate.score).toBeNull();
    expect(gate.status).toBeNull();
    expect(gate.evaluation.status).toBe("not_evaluated");
    expect(gate.evaluation.reason).toBe("no completed scan for this customer yet");
  });
});

/* ------------------------------------------------------------------ *
 * One engine output, one Copilot number
 * ------------------------------------------------------------------ */

/**
 * A minimal but real-shaped engine output. `copilot` accumulates 30 of a
 * possible 100 configured impact, so the display score is 100 − 30 = 70 — a
 * No-Go, which is also the more interesting side of the boundary to assert.
 */
const OUTPUT: HealthEngineOutput = {
  score: 30,
  breakdown: [
    { pillar: "copilot", score: 30, contributions: [{ signalKey: "sig.a", value: 30 }] },
    { pillar: "governance", score: 10, contributions: [{ signalKey: "sig.b", value: 10 }] },
  ],
} as unknown as HealthEngineOutput;

function impact(over: Partial<SignalHealthImpactConfig>): SignalHealthImpactConfig {
  return {
    signalKey: "sig",
    governanceImpact: 0,
    securityImpact: 0,
    complianceImpact: 0,
    adoptionImpact: 0,
    copilotImpact: 0,
    architectureImpact: 0,
    licensingImpact: 0,
    ...over,
  } as SignalHealthImpactConfig;
}

const IMPACTS = new Map<string, SignalHealthImpactConfig>([
  ["sig.a", impact({ signalKey: "sig.a", copilotImpact: 60, governanceImpact: 40 })],
  ["sig.b", impact({ signalKey: "sig.b", copilotImpact: 40, governanceImpact: 60 })],
  // Not evaluable — its weight must never reach a denominator. If it did, the
  // copilot score would rise to 100 − 30/1100×100 = 97 and the Gate would flip
  // to Go on a rule that can never fire.
  ["sig.orphan", impact({ signalKey: "sig.orphan", copilotImpact: 1000 })],
]);

const EVALUABLE = new Set(["sig.a", "sig.b"]);

describe("the Gate's score and the War Room's copilot card are one number", () => {
  it("agrees with computePillarDisplayScore for the same engine input", () => {
    const direct = computePillarDisplayScore("copilot", OUTPUT, IMPACTS, EVALUABLE);
    expect(direct).toBe(70);
    expect(copilotGate(direct).status).toBe("no_go");
  });

  it("agrees with the copilot entry buildWarRoomPillarStats reads", () => {
    // buildWarRoomPillarStats maps its `copilot` card straight off this array
    // (WAR_ROOM_ENGINE_PILLAR.copilot === "copilot", identity). Asserting
    // equality here is what makes "one engine, one computation" a checked claim
    // rather than a comment.
    const { pillars } = buildPillarViews(OUTPUT, IMPACTS, EVALUABLE);
    const copilotCard = pillars.find((p) => p.pillar === "copilot");
    expect(copilotCard?.displayScore).toBe(
      computePillarDisplayScore("copilot", OUTPUT, IMPACTS, EVALUABLE),
    );
  });

  it("excludes non-evaluable rules from the denominator, so an orphan cannot open the Gate", () => {
    const withOrphanCounted = computePillarDisplayScore(
      "copilot",
      OUTPUT,
      IMPACTS,
      new Set([...EVALUABLE, "sig.orphan"]),
    );
    // Proves the guard is load-bearing for the Gate specifically: counting the
    // orphan flips a No-Go into a Go.
    expect(copilotGate(withOrphanCounted).status).toBe("go");
    expect(copilotGate(computePillarDisplayScore("copilot", OUTPUT, IMPACTS, EVALUABLE)).status).toBe("no_go");
  });

  it("has no score, and so no verdict, when nothing configures a copilot impact", () => {
    const noCopilotWeight = new Map<string, SignalHealthImpactConfig>([
      ["sig.a", impact({ signalKey: "sig.a", governanceImpact: 40 })],
    ]);
    const score = computePillarDisplayScore("copilot", OUTPUT, noCopilotWeight, new Set(["sig.a"]));
    expect(score).toBeNull();
    expect(copilotGate(score).status).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * #517 — a clean-looking 100 from insufficient real data
 * ------------------------------------------------------------------ */

describe("the insufficient-data gate (#517)", () => {
  /**
   * The exact live-reproduced shape: a run-completion record exists, but the
   * underlying `tenant_monitor_profiles` rows are gone, so the tenant's scan
   * scope resolves down to a SINGLE Copilot-impacting signal — which then does
   * not fire, because there is no data for it to fire on.
   *
   * Before #517 that arithmetic was `100 − 0/60 × 100 = 100`: a flawless score
   * and a "CLEARED FOR ROLLOUT" verdict, produced by measuring nothing. It is
   * indistinguishable on screen from a genuinely verified-clean tenant, which is
   * the whole bug.
   */
  const CLEAN_OUTPUT: HealthEngineOutput = {
    score: 0,
    breakdown: [{ pillar: "copilot", score: 0, contributions: [] }],
  } as unknown as HealthEngineOutput;

  it("withholds the score for a pillar backed by ONE evaluable signal, instead of reporting a perfect 100", () => {
    const evaluation = evaluatePillarDisplay("copilot", CLEAN_OUTPUT, IMPACTS, new Set(["sig.a"]));

    expect(evaluation.status).toBe("insufficient_data");
    expect(evaluation.score).toBeNull();
    expect(evaluation.evaluableSignalCount).toBe(1);
    // The number that WOULD have been shown, proving the gate is load-bearing:
    // theoreticalMax 60, rawScore 0 → 100.
    expect(evaluation.theoreticalMax).toBe(60);
  });

  it("still scores the same tenant once a second real signal genuinely covers the pillar", () => {
    const evaluation = evaluatePillarDisplay("copilot", CLEAN_OUTPUT, IMPACTS, EVALUABLE);

    expect(evaluation.status).toBe("scored");
    expect(evaluation.score).toBe(100); // genuinely clean, genuinely measured
    expect(evaluation.evaluableSignalCount).toBe(2);
  });

  it("tells 'nothing feeds this pillar' apart from 'not enough does'", () => {
    const nothing = evaluatePillarDisplay(
      "copilot",
      CLEAN_OUTPUT,
      new Map([["sig.a", impact({ signalKey: "sig.a", governanceImpact: 40 })]]),
      new Set(["sig.a"]),
    );
    expect(nothing.status).toBe("not_evaluated");
    expect(nothing.evaluableSignalCount).toBe(0);

    const notEnough = evaluatePillarDisplay("copilot", CLEAN_OUTPUT, IMPACTS, new Set(["sig.a"]));
    expect(notEnough.status).toBe("insufficient_data");
    // Both have a null score — which is exactly why the status has to exist.
    expect(nothing.score).toBeNull();
    expect(notEnough.score).toBeNull();
  });

  it("gives the Gate no verdict at all in the insufficient state — never a No-Go it did not measure", () => {
    const evaluation = evaluatePillarDisplay("copilot", CLEAN_OUTPUT, IMPACTS, new Set(["sig.a"]));
    const gate = copilotGate(evaluation.score, {
      status: evaluation.status,
      evaluableSignalCount: evaluation.evaluableSignalCount,
      minRequiredSignals: evaluation.minRequiredSignals,
      reason: evaluation.reason,
    });

    expect(gate.score).toBeNull();
    expect(gate.status).toBeNull();
    expect(gate.evaluation.status).toBe("insufficient_data");
    expect(gate.evaluation.reason).toMatch(/1 evaluable signal/);
  });

  it("computePillarDisplayScore inherits the gate, so no existing caller can slip past it", () => {
    // The single-signal case returns null through the OLD entry point too —
    // deliberately, so the radar, the War Room cards and the trend replay are
    // gated without each having to opt in.
    expect(computePillarDisplayScore("copilot", CLEAN_OUTPUT, IMPACTS, new Set(["sig.a"]))).toBeNull();
    expect(computePillarDisplayScore("copilot", CLEAN_OUTPUT, IMPACTS, EVALUABLE)).toBe(100);
  });
});
