/**
 * remediation-tracker-pricing.test.ts — Git #734 (Phase E of Epic #647).
 *
 * Guards the phase-gated formula ported from `Design/Remediation
 * Tracker.dc.html` onto real DB state, in particular the two behaviors that
 * are easy to get backwards:
 *
 *   1. A phase's fee is flat (the sum of its two pillars' PILLAR_FEE) until
 *      EVERY step in it is resolved — partial completion, even fully
 *      verified partial completion, must not move the price early.
 *   2. Once ready, `deferred` steps still count toward readiness but never
 *      reduce the fee (they stay outstanding forever); `shane_handles`
 *      steps block readiness outright — the opposite pairing from what the
 *      #734 issue comment initially recommended, confirmed against the
 *      design file's literal `phaseReady()`/`skip()`/`block()` code and
 *      resolved by Shane 2026-08-11 in favor of the design's real behavior.
 */

import { describe, it, expect } from "vitest";
import {
  computeRemediationTrackerPricing,
  PILLAR_FEE,
  PHASE_PILLARS,
  FULL_PROGRAMME_FEE,
  type RemediationTrackerStepState,
} from "./remediation-tracker-pricing";

const GOVERNANCE_IDS = ["s1", "s2", "s3", "s4", "s5", "s6"];
const SECURITY_IDS = ["s7", "s8", "s9", "s10", "s11", "s12", "s13"];
const COMPLIANCE_IDS = ["s14", "s15", "s16", "s17", "s18"];
const LICENSING_IDS = ["s19", "s20", "s21", "s22"];
// Steps 24 & 25 were removed from the catalogue in #757; adoption is s23 + s26.
const ADOPTION_IDS = ["s23", "s26"];
const HEALTH_IDS = ["s27", "s28", "s29", "s30"];

function rows(overrides: Record<string, Partial<RemediationTrackerStepState>>): RemediationTrackerStepState[] {
  return Object.entries(overrides).map(([stepId, r]) => ({
    stepId,
    status: r.status ?? "not_started",
    verificationState: r.verificationState ?? "unverified",
  }));
}

function completedVerified(ids: readonly string[]): Record<string, Partial<RemediationTrackerStepState>> {
  return Object.fromEntries(ids.map((id) => [id, { status: "completed", verificationState: "verified" }]));
}

describe("PILLAR_FEE / PHASE_PILLARS / FULL_PROGRAMME_FEE match the design file", () => {
  it("sums to the design's literal full-programme figure", () => {
    const sum = Object.values(PILLAR_FEE).reduce((a, b) => a + b, 0);
    expect(sum).toBe(FULL_PROGRAMME_FEE);
    expect(FULL_PROGRAMME_FEE).toBe(36200);
  });

  it("has the design's exact per-pillar fees", () => {
    expect(PILLAR_FEE).toEqual({
      governance: 9800,
      security: 6400,
      compliance: 8600,
      licensing: 3200,
      adoption: 5400,
      health: 2800,
    });
  });

  it("groups pillars into phases exactly as the design's PHASE_PILLARS does", () => {
    expect(PHASE_PILLARS).toEqual({
      1: ["governance", "security"],
      2: ["compliance", "licensing"],
      3: ["adoption", "health"],
    });
  });
});

describe("an untouched tracker (no rows at all)", () => {
  it("prices every phase flat at its two pillars' fixed fee, and no phase is ready", () => {
    const pricing = computeRemediationTrackerPricing([]);

    expect(pricing.phases).toHaveLength(3);
    expect(pricing.phases[0]).toMatchObject({ phase: 1, ready: false, fee: 9800 + 6400 });
    expect(pricing.phases[1]).toMatchObject({ phase: 2, ready: false, fee: 8600 + 3200 });
    expect(pricing.phases[2]).toMatchObject({ phase: 3, ready: false, fee: 5400 + 2800 });
  });

  it("hire totals the full programme price with no savings shown", () => {
    const pricing = computeRemediationTrackerPricing([]);
    expect(pricing.hire).toEqual({
      price: "$36,200",
      was: "$36,200",
      wasShow: false,
      saved: "$0",
      savedShow: false,
      cta: "Hire Shane McCaw",
      note: "Fixed-fee, phase by phase. Tick tasks off yourself and this number comes down.",
    });
  });
});

describe("a phase's fee stays flat until it is fully resolved (readiness gate)", () => {
  it("does not move even when most of a pillar is completed AND verified, if the phase overall is not ready", () => {
    // 5 of governance's 6 steps completed+verified; s6 untouched; all of
    // security untouched. Phase 1 is nowhere near ready.
    const pricing = computeRemediationTrackerPricing(
      rows({ ...completedVerified(["s1", "s2", "s3", "s4", "s5"]) }),
    );
    const phase1 = pricing.phases.find((p) => p.phase === 1)!;
    expect(phase1.ready).toBe(false);
    expect(phase1.fee).toBe(9800 + 6400);
  });
});

describe("once a phase is ready, the fee reduces only for steps that are completed AND verified", () => {
  it("drops a pillar's fee to zero once every one of its steps is completed and verified", () => {
    const pricing = computeRemediationTrackerPricing(
      rows({ ...completedVerified(GOVERNANCE_IDS), ...completedVerified(SECURITY_IDS) }),
    );
    const phase1 = pricing.phases.find((p) => p.phase === 1)!;
    expect(phase1.ready).toBe(true);
    expect(phase1.fee).toBe(0);
    expect(phase1.feeDisplay).toBe("$0");
  });

  it("prices proportionally: outstanding = total - (completed AND verified)", () => {
    // Governance: 5/6 completed+verified, 1 already_handled (an exempt
    // status — resolved for readiness, but never subtracted from the fee).
    // Security: all 7 resolved as already_handled (never completed/verified).
    const pricing = computeRemediationTrackerPricing(
      rows({
        ...completedVerified(["s1", "s2", "s3", "s4", "s5"]),
        s6: { status: "already_handled" },
        ...Object.fromEntries(SECURITY_IDS.map((id) => [id, { status: "already_handled" }])),
      }),
    );
    const phase1 = pricing.phases.find((p) => p.phase === 1)!;
    expect(phase1.ready).toBe(true);
    // governance: (9800/6) * 1 outstanding = 1633.33..; security: (6400/7) * 7 outstanding = 6400
    expect(phase1.fee).toBeCloseTo(9800 / 6 + 6400, 5);
    expect(phase1.feeDisplay).toBe("$8,033");
  });
});

describe("already_handled / not_applicable / deferred steps stay outstanding forever", () => {
  it("never zeroes a pillar's fee just because every step is resolved, if none are literally completed+verified", () => {
    const pricing = computeRemediationTrackerPricing(
      rows({
        s1: { status: "already_handled" },
        s2: { status: "not_applicable" },
        s3: { status: "deferred" },
        s4: { status: "already_handled" },
        s5: { status: "not_applicable" },
        s6: { status: "deferred" },
        ...Object.fromEntries(SECURITY_IDS.map((id) => [id, { status: "already_handled" }])),
      }),
    );
    const phase1 = pricing.phases.find((p) => p.phase === 1)!;
    expect(phase1.ready).toBe(true); // every step resolved...
    expect(phase1.fee).toBe(9800 + 6400); // ...but the fee never moved off the flat full price.
  });
});

describe("accepted_risk joins the resolved-but-still-outstanding bucket (#1542)", () => {
  it("counts toward phase readiness like deferred/not_applicable, but never zeroes the fee", () => {
    const pricing = computeRemediationTrackerPricing(
      rows({
        s1: { status: "accepted_risk" },
        s2: { status: "already_handled" },
        s3: { status: "deferred" },
        s4: { status: "not_applicable" },
        s5: { status: "accepted_risk" },
        s6: { status: "already_handled" },
        ...Object.fromEntries(SECURITY_IDS.map((id) => [id, { status: "already_handled" }])),
      }),
    );
    const phase1 = pricing.phases.find((p) => p.phase === 1)!;
    expect(phase1.ready).toBe(true); // a signed decline resolves the step for gating purposes...
    expect(phase1.fee).toBe(9800 + 6400); // ...but accepting a risk is not Shane doing the work, so the fee stays flat.
  });
});

describe("deferred vs shane_handles readiness gating (resolved against the design file, not the issue's initial guess)", () => {
  it("deferred DOES count toward phase readiness, matching the design's skip()->\"skipped\" behavior", () => {
    const pricing = computeRemediationTrackerPricing(
      rows({
        ...Object.fromEntries(GOVERNANCE_IDS.map((id) => [id, { status: "deferred" }])),
        ...Object.fromEntries(SECURITY_IDS.map((id) => [id, { status: "deferred" }])),
      }),
    );
    const phase1 = pricing.phases.find((p) => p.phase === 1)!;
    expect(phase1.ready).toBe(true);
    // Deferred is resolved-for-readiness but never completed+verified, so
    // the fee stays at the full flat price even though the phase is ready.
    expect(phase1.fee).toBe(9800 + 6400);
  });

  it("shane_handles does NOT count toward phase readiness, matching the design's block()/handToShane() leaving status unset", () => {
    const pricing = computeRemediationTrackerPricing(
      rows({
        ...completedVerified(["s1", "s2", "s3", "s4", "s5"]),
        s6: { status: "shane_handles" },
        ...completedVerified(SECURITY_IDS),
      }),
    );
    const phase1 = pricing.phases.find((p) => p.phase === 1)!;
    // Five of six governance steps AND all of security are fully done, but
    // one shane_handles step blocks the whole phase from going ready.
    expect(phase1.ready).toBe(false);
    expect(phase1.fee).toBe(9800 + 6400);
  });
});

describe("drift automatically recomputes the fee back up — no separate drift code path", () => {
  it("a step that reverts from verified to drift on a later rescan increases the phase's outstanding fee again", () => {
    const fullyVerified = computeRemediationTrackerPricing(
      rows({ ...completedVerified(GOVERNANCE_IDS), ...completedVerified(SECURITY_IDS) }),
    );
    expect(fullyVerified.phases.find((p) => p.phase === 1)!.fee).toBe(0);

    const afterDrift = computeRemediationTrackerPricing(
      rows({
        ...completedVerified(GOVERNANCE_IDS.filter((id) => id !== "s1")),
        s1: { status: "completed", verificationState: "drift" },
        ...completedVerified(SECURITY_IDS),
      }),
    );
    const phase1 = afterDrift.phases.find((p) => p.phase === 1)!;
    expect(phase1.ready).toBe(true); // still fully resolved — drift doesn't change the claim
    expect(phase1.fee).toBeCloseTo(9800 / 6, 5); // s1 is back to outstanding
  });
});

describe("hire object mirrors the design's cta/note transitions", () => {
  it("shows 'Hire Shane for the rest' with savings once some, but not all, work is verified", () => {
    const pricing = computeRemediationTrackerPricing(
      rows({ ...completedVerified(GOVERNANCE_IDS), ...completedVerified(SECURITY_IDS) }),
    );
    expect(pricing.hire.cta).toBe("Hire Shane for the rest");
    expect(pricing.hire.wasShow).toBe(true);
    expect(pricing.hire.savedShow).toBe(true);
    expect(pricing.hire.saved).toBe("$16,200");
    expect(pricing.hire.price).toBe("$20,000");
  });

  it("switches to 'Book your gate validation' once every phase is fully resolved and verified", () => {
    const pricing = computeRemediationTrackerPricing(
      rows({
        ...completedVerified(GOVERNANCE_IDS),
        ...completedVerified(SECURITY_IDS),
        ...completedVerified(COMPLIANCE_IDS),
        ...completedVerified(LICENSING_IDS),
        ...completedVerified(ADOPTION_IDS),
        ...completedVerified(HEALTH_IDS),
      }),
    );
    expect(pricing.hire.cta).toBe("Book your gate validation");
    expect(pricing.hire.price).toBe("$0");
    expect(pricing.hire.saved).toBe("$36,200");
    expect(pricing.hire.note).toBe(
      "Everything is verified. All that remains is the gate validation and signed certification.",
    );
  });
});
