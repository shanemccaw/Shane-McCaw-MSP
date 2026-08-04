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
  copilotGateStatus,
} from "./copilot-gate.ts";
import { computePillarDisplayScore } from "./health-display.ts";
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
    expect(copilotGate(82)).toEqual({
      score: 82,
      threshold: 82,
      status: "go",
      source: "health_engine:copilot",
    });
    expect(copilotGate(null)).toEqual({
      score: null,
      threshold: 82,
      status: null,
      source: "health_engine:copilot",
    });
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
