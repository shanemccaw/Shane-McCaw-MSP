import { describe, it, expect } from "vitest";
import { evaluateDocGateCoverage, DOC_GATE_MIN_COVERAGE_PCT } from "./doc-gate-coverage";

describe("evaluateDocGateCoverage — graded document-generation gate", () => {
  it("threshold is the single documented knob", () => {
    expect(DOC_GATE_MIN_COVERAGE_PCT).toBe(50);
  });

  it("CONFIRMED-LIVE case: 9 passing + 10 license-gap + 2 error (of 29) proceeds", () => {
    // The exact tenant this work exists to unblock: real majority signal (~65%
    // evaluable) that the old hard status='completed' gate discarded because 2
    // technical errors pinned the run to 'partial'.
    const d = evaluateDocGateCoverage({
      checksOk: 9,
      checksLicenseGap: 10,
      checksError: 2,
      checksTotal: 29,
    });
    expect(d.evaluableChecks).toBe(19);
    expect(d.coveragePct).toBe(66); // round(19/29*100)
    expect(d.band).toBe("sufficient");
    expect(d.proceed).toBe(true);
  });

  it("license gaps count as coverage, not failures", () => {
    const d = evaluateDocGateCoverage({
      checksOk: 0,
      checksLicenseGap: 15,
      checksError: 0,
      checksTotal: 20,
    });
    expect(d.coveragePct).toBe(75);
    expect(d.proceed).toBe(true);
  });

  it("a fully-clean all-pass tenant proceeds", () => {
    const d = evaluateDocGateCoverage({ checksOk: 20, checksLicenseGap: 0, checksError: 0, checksTotal: 20 });
    expect(d.coveragePct).toBe(100);
    expect(d.band).toBe("sufficient");
  });

  it("exactly 50% coverage proceeds (inclusive boundary)", () => {
    const d = evaluateDocGateCoverage({ checksOk: 5, checksLicenseGap: 5, checksError: 0, checksTotal: 20 });
    expect(d.coveragePct).toBe(50);
    expect(d.proceed).toBe(true);
  });

  it("just below 50% is blocked (insufficient), not a silent hang", () => {
    const d = evaluateDocGateCoverage({ checksOk: 9, checksLicenseGap: 0, checksError: 1, checksTotal: 20 });
    expect(d.coveragePct).toBe(45);
    expect(d.band).toBe("insufficient");
    expect(d.proceed).toBe(false);
    expect(d.reason).toMatch(/too few checks/i);
  });

  it("near-zero coverage is blocked with an honest reason", () => {
    const d = evaluateDocGateCoverage({ checksOk: 2, checksLicenseGap: 1, checksError: 15, checksTotal: 20 });
    expect(d.coveragePct).toBe(15);
    expect(d.proceed).toBe(false);
    expect(d.band).toBe("insufficient");
  });

  it("un-run requiresScript checks stay in the denominator (honest coverage)", () => {
    // 9 ok + 10 gap of 29 total, the other 10 never ran (requiresScript) — still
    // 66% of the package produced a real result, so it proceeds.
    const d = evaluateDocGateCoverage({ checksOk: 9, checksLicenseGap: 10, checksError: 0, checksTotal: 29 });
    expect(d.coveragePct).toBe(66);
    expect(d.proceed).toBe(true);
  });

  it("a zero-check run is no_data and never generates", () => {
    const d = evaluateDocGateCoverage({ checksOk: 0, checksLicenseGap: 0, checksError: 0, checksTotal: 0 });
    expect(d.band).toBe("no_data");
    expect(d.coveragePct).toBe(0);
    expect(d.proceed).toBe(false);
  });

  it("is total — NaN/garbage counts degrade to 0, never throw", () => {
    const d = evaluateDocGateCoverage({
      checksOk: NaN as unknown as number,
      checksLicenseGap: undefined as unknown as number,
      checksError: 3,
      checksTotal: NaN as unknown as number,
    });
    expect(d.band).toBe("no_data");
    expect(d.proceed).toBe(false);
  });
});
