/**
 * rbd-scope-diff.test.ts — #1510's own derivation, exercised for every case the
 * issue names. `rbd-scope-diff.ts` has no `@workspace/db` dependency, so this
 * runs without touching the database.
 */
import { describe, it, expect } from "vitest";
import { computeRbdScopeDiff, diffNarrativeSnapshot } from "./rbd-scope-diff.ts";

describe("computeRbdScopeDiff", () => {
  it("requires a signature for the very first version, even with an empty scope", () => {
    expect(computeRbdScopeDiff(null, [])).toEqual({ added: [], removed: [], requiresSignature: true });
  });

  it("requires a signature for the very first version with a non-empty scope", () => {
    expect(computeRbdScopeDiff(null, [1, 2])).toEqual({ added: [1, 2], removed: [], requiresSignature: true });
  });

  it("does not require a signature when the scope is unchanged", () => {
    expect(computeRbdScopeDiff([1, 2], [1, 2])).toEqual({ added: [], removed: [], requiresSignature: false });
  });

  it("does not require a signature for a subtraction-only change", () => {
    expect(computeRbdScopeDiff([1, 2, 3], [1])).toEqual({ added: [], removed: [2, 3], requiresSignature: false });
  });

  it("requires a signature for an addition-only change", () => {
    expect(computeRbdScopeDiff([1, 2], [1, 2, 3])).toEqual({ added: [3], removed: [], requiresSignature: true });
  });

  it("requires a signature when additions and subtractions happen together — nobody consents to being safer", () => {
    // #1510: "Any addition present => true (signature required), regardless of
    // simultaneous subtractions." A mixed change must not read as "net safer"
    // and skip the signature just because more was removed than added.
    expect(computeRbdScopeDiff([1, 2], [2, 3])).toEqual({ added: [3], removed: [1], requiresSignature: true });
  });

  it("never silently absorbs a new instance: an addition on top of an otherwise-unchanged scope still requires a signature", () => {
    const diff = computeRbdScopeDiff([10], [10, 99]);
    expect(diff.added).toEqual([99]);
    expect(diff.requiresSignature).toBe(true);
  });
});

const baseNarrative = {
  hazardDescription: "MFA not enforced on 22 accounts",
  compensatingControls: [{ type: "technical" as const, description: "Conditional Access blocks legacy auth" }],
  residualRiskScore: 8,
  residualRiskLevel: "medium",
};

describe("diffNarrativeSnapshot", () => {
  it("reports no changes against a null previous snapshot (the first version ever)", () => {
    expect(diffNarrativeSnapshot(null, baseNarrative)).toEqual([]);
  });

  it("reports no changes when nothing narrative moved", () => {
    expect(diffNarrativeSnapshot(baseNarrative, { ...baseNarrative })).toEqual([]);
  });

  it("catches a residual score + level move even though it never requires a signature", () => {
    const next = { ...baseNarrative, residualRiskScore: 15, residualRiskLevel: "Medium" };
    const changes = diffNarrativeSnapshot(baseNarrative, next);
    expect(changes).toEqual([
      { field: "residualRiskScore", previousValue: 8, newValue: 15 },
      { field: "residualRiskLevel", previousValue: "medium", newValue: "Medium" },
    ]);
  });

  it("catches a hazard-description-only edit", () => {
    const next = { ...baseNarrative, hazardDescription: "MFA not enforced on 24 accounts" };
    expect(diffNarrativeSnapshot(baseNarrative, next)).toEqual([
      { field: "hazardDescription", previousValue: baseNarrative.hazardDescription, newValue: next.hazardDescription },
    ]);
  });

  it("catches a compensating-controls change", () => {
    const next = { ...baseNarrative, compensatingControls: [] as typeof baseNarrative.compensatingControls };
    expect(diffNarrativeSnapshot(baseNarrative, next)).toEqual([
      { field: "compensatingControls", previousValue: baseNarrative.compensatingControls, newValue: [] },
    ]);
  });
});
