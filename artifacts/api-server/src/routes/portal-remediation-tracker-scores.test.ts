/**
 * portal-remediation-tracker-scores.test.ts — Git #1381.
 *
 * Pins the pure reduction the /portal/remediation-tracker/pillar-scores route
 * runs over `tenant_pillar_snapshots` and the latest run's findings: the rolling
 * before/now pair, the PERMANENT day-one baseline, the single-scan / no-data
 * honesty states, the health→architecture key mapping, and the per-task point
 * weight taken from the real underlying finding severity.
 */

import { describe, it, expect } from "vitest";

import {
  reducePillarScores,
  buildTaskPoints,
  SEVERITY_WEIGHT,
} from "../lib/remediation-pillar-scores";

const at = (isoStr: string) => new Date(isoStr);

/** A minimal, real slice of STEP_CHECK_KEYS — kept db-free so the reduction stays pure. */
const STEP_CHECK_KEYS = {
  s7: ["identity:mfa-registration"],
  s8: ["identity:ca-policy-count", "identity:ca-mfa-coverage"],
} as const;

describe("reducePillarScores — rolling before/now + permanent day-one", () => {
  it("reads before as the latest row's previousScore and dayOne as the earliest row's score", () => {
    // Three security scans: 28 → 30 → 32. Latest row carries previousScore 30.
    const rows = [
      { pillarKey: "security", score: 28, previousScore: null, capturedAt: at("2026-07-01T00:00:00Z") },
      { pillarKey: "security", score: 30, previousScore: 28, capturedAt: at("2026-07-15T00:00:00Z") },
      { pillarKey: "security", score: 32, previousScore: 30, capturedAt: at("2026-08-01T00:00:00Z") },
    ];
    const p = reducePillarScores(rows).security;
    expect(p.now).toBe(32);
    expect(p.before).toBe(30); // previous scan, not day one
    expect(p.dayOne).toBe(28); // permanent baseline, distinct from before
    expect(p.delta).toBe(2);
    expect(p.status).toBe("scored");
    expect(p.scanCount).toBe(3);
  });

  it("a single scan has now + dayOne but no before to compare", () => {
    const rows = [
      { pillarKey: "governance", score: 41, previousScore: null, capturedAt: at("2026-08-01T00:00:00Z") },
    ];
    const p = reducePillarScores(rows).governance;
    expect(p.now).toBe(41);
    expect(p.dayOne).toBe(41);
    expect(p.before).toBe(null);
    expect(p.delta).toBe(null);
    expect(p.status).toBe("single_scan");
  });

  it("maps the tracker's health pillar from the engine's architecture snapshot rows", () => {
    const rows = [
      { pillarKey: "architecture", score: 40, previousScore: null, capturedAt: at("2026-07-01T00:00:00Z") },
      { pillarKey: "architecture", score: 50, previousScore: 40, capturedAt: at("2026-08-01T00:00:00Z") },
    ];
    const out = reducePillarScores(rows);
    expect(out.health.now).toBe(50);
    expect(out.health.before).toBe(40);
    expect(out.health.dayOne).toBe(40);
  });

  it("reports insufficient_data for a pillar with no snapshot at all", () => {
    const out = reducePillarScores([]);
    for (const key of ["governance", "security", "compliance", "licensing", "adoption", "health"]) {
      expect(out[key].status).toBe("insufficient_data");
      expect(out[key].now).toBe(null);
      expect(out[key].dayOne).toBe(null);
    }
  });

  it("never surfaces copilot as a tracker pillar cell", () => {
    const rows = [
      { pillarKey: "copilot", score: 70, previousScore: 60, capturedAt: at("2026-08-01T00:00:00Z") },
    ];
    const out = reducePillarScores(rows);
    expect(out.copilot).toBeUndefined();
  });
});

describe("buildTaskPoints — the task's real underlying finding severity", () => {
  it("weights a step by its mapped check's real finding severity", () => {
    // s7 → identity:mfa-registration. A critical finding weighs 3.
    const sev = new Map<string, string>([["identity:mfa-registration", "critical"]]);
    const out = buildTaskPoints(sev, STEP_CHECK_KEYS);
    expect(out.s7).toEqual({ severity: "critical", weight: SEVERITY_WEIGHT.critical });
  });

  it("takes the WORST severity across a multi-check step", () => {
    // s8 → identity:ca-policy-count + identity:ca-mfa-coverage.
    const sev = new Map<string, string>([
      ["identity:ca-policy-count", "ok"],
      ["identity:ca-mfa-coverage", "warning"],
    ]);
    expect(buildTaskPoints(sev, STEP_CHECK_KEYS).s8).toEqual({ severity: "warning", weight: SEVERITY_WEIGHT.warning });
  });

  it("omits a step whose mapped checks produced no finding this run", () => {
    const out = buildTaskPoints(new Map(), STEP_CHECK_KEYS);
    expect(out.s7).toBeUndefined();
    expect(Object.keys(out).length).toBe(0);
  });

  it("weights a clean (ok) finding at 0 — nothing left to earn", () => {
    const sev = new Map<string, string>([["identity:mfa-registration", "ok"]]);
    expect(buildTaskPoints(sev, STEP_CHECK_KEYS).s7).toEqual({ severity: "ok", weight: 0 });
  });
});
