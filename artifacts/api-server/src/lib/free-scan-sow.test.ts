/**
 * free-scan-sow.test.ts — Git #1374.
 *
 * Locks the three pieces of the Free Scan SOW that are pure arithmetic over the
 * platform's own numbers: the score projection, the phase schedule, and the SOW
 * reference. Everything else in `free-scan-sow.ts` is a read of real catalog
 * rows and real `buildPillarSummary` output, exercised by the route tests.
 */

import { describe, it, expect, vi } from "vitest";

// Everything asserted below is pure, but the import graph reaches
// pillar-summary-stats → health-engine → tenant-signals → lib/db's index.ts,
// which hard-requires DATABASE_URL at module scope. Same `vi.hoisted` stand-in
// copilot-gate.test.ts uses: it runs before the module graph evaluates, and
// pg.Pool is lazy so nothing connects.
vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:5432/test";
});

import {
  projectPillarScore,
  computeSowSchedule,
  buildSowReference,
  FREE_SCAN_SOW_PHASES,
  FREE_SCAN_SOW_PHASE_SLUGS,
  FULL_SCOPE_DISCOUNT_PCT,
  PHASED_DEPOSIT_PCT,
} from "./free-scan-sow.ts";

function card(score: number | null, rawRiskScore: number, theoreticalMax: number, status = "scored") {
  return {
    score,
    rawRiskScore,
    evaluation: {
      status,
      score,
      evaluableSignalCount: 8,
      minRequiredSignals: 3,
      theoreticalMax,
      reason: "test",
    },
  } as Parameters<typeof projectPillarScore>[0];
}

describe("projectPillarScore", () => {
  it("is health-display's own formula with the cleared weight taken off the raw term", () => {
    // 100 − 60/100×100 = 40 today. Clear 30 of that risk → 100 − 30/100×100 = 70.
    expect(projectPillarScore(card(40, 60, 100), 30)).toBe(70);
  });

  it("clearing every finding's weight cannot exceed 100", () => {
    expect(projectPillarScore(card(40, 60, 100), 999)).toBe(100);
  });

  it("clearing nothing leaves the pillar exactly where it is", () => {
    expect(projectPillarScore(card(40, 60, 100), 0)).toBe(40);
  });

  it("never projects BELOW the current score — remediation cannot make a pillar worse", () => {
    // A rounding-inconsistent card (score says 45, the raw terms say 40) must
    // still never be reported as getting worse by being remediated.
    expect(projectPillarScore(card(45, 60, 100), 0)).toBe(45);
  });

  it("projects null for a pillar the platform is not entitled to score (#517)", () => {
    expect(projectPillarScore(card(null, 60, 100, "insufficient_data"), 30)).toBeNull();
    expect(projectPillarScore(card(null, 0, 0, "not_evaluated"), 30)).toBeNull();
  });

  it("projects null rather than dividing by a zero denominator", () => {
    expect(projectPillarScore(card(100, 0, 0), 10)).toBeNull();
  });
});

describe("computeSowSchedule", () => {
  const DURATIONS = [2, 3, 3, 1, 2, 1];

  it("staggers phases 1–3 and runs 4–6 strictly after them", () => {
    const all = DURATIONS.map(() => true);
    const { startWeeks, totalWeeks, enablementWeeks } = computeSowSchedule(DURATIONS, all);
    // 1–3 start at weeks 0/1/2 and overlap; the group ends at max(0+2, 1+3, 2+3) = 5.
    expect(startWeeks.slice(0, 3)).toEqual([0, 1, 2]);
    // 4–6 are sequential from week 5.
    expect(startWeeks.slice(3)).toEqual([5, 6, 8]);
    expect(totalWeeks).toBe(9);
    // Copilot enablement follows the licence work when it is in scope.
    expect(enablementWeeks).toBe(6);
  });

  it("gives a deselected phase no start week and shortens the critical path", () => {
    const selected = [true, false, false, false, false, false];
    const { startWeeks, totalWeeks } = computeSowSchedule(DURATIONS, selected);
    expect(startWeeks).toEqual([0, null, null, null, null, null]);
    expect(totalWeeks).toBe(2);
  });

  it("drops enablement back to the parallel group's end when licensing is out of scope", () => {
    const selected = [true, true, true, false, true, true];
    const { enablementWeeks } = computeSowSchedule(DURATIONS, selected);
    expect(enablementWeeks).toBe(5);
  });
});

describe("buildSowReference", () => {
  it("derives a stable id from the customer's own name and the scan's own date", () => {
    expect(buildSowReference("Halden Materials", new Date("2026-08-03T09:00:00Z"))).toBe("SMC-HM-2026-0803");
  });

  it("tolerates a one-word or punctuation-heavy name without producing an empty id", () => {
    expect(buildSowReference("Contoso", new Date("2026-01-09T00:00:00Z"))).toBe("SMC-C-2026-0109");
    expect(buildSowReference("!!!", new Date("2026-01-09T00:00:00Z"))).toBe("SMC-XX-2026-0109");
  });
});

describe("the fixed phase structure", () => {
  it("names six real catalog slugs, in delivery order, with only phase 1 required", () => {
    expect(FREE_SCAN_SOW_PHASE_SLUGS).toEqual([
      "identity-access-hardening",
      "sharing-exposure-remediation",
      "data-protection-baseline",
      "licence-rationalisation",
      "adoption-enablement",
      "drift-baseline-handover",
    ]);
    expect(FREE_SCAN_SOW_PHASES.filter((p) => p.required).map((p) => p.slug)).toEqual([
      "identity-access-hardening",
    ]);
  });

  it("maps each phase to a distinct War Room pillar, so a phase can name its own findings", () => {
    const pillars = FREE_SCAN_SOW_PHASES.map((p) => p.pillar);
    expect(new Set(pillars).size).toBe(pillars.length);
  });

  it("carries no price of its own — every fee is a catalog read", () => {
    for (const phase of FREE_SCAN_SOW_PHASES) {
      expect(Object.keys(phase)).not.toContain("fee");
      expect(Object.keys(phase)).not.toContain("feeCents");
    }
  });

  it("keeps the commercial constants where a reader can find them", () => {
    expect(FULL_SCOPE_DISCOUNT_PCT).toBe(20);
    expect(PHASED_DEPOSIT_PCT).toBe(40);
  });
});
