import { describe, it, expect, vi } from "vitest";

/**
 * Unit tests for m365-change-router.ts (#1534) — the pure routing-decision half.
 * What these lock down (Shane's settled rule, #1534 2026-08-28):
 *
 *   1. INTAKE is derived from the interpretation's who_acts / controllable, in
 *      the exact precedence of Shane's table: controllable → approval,
 *      admin-acts → advisory, else → informed.
 *   2. IMPLEMENTER mirrors who_acts: Microsoft for a forced change, the
 *      customer's own team for the admin-work (advisory) case.
 *   3. The GATE: only measured + non-zero + structurally-dated + announced
 *      AUTO-CREATES; undated / no-announcement / zero-affected only PROPOSE; a
 *      not-measured resolution routes nothing. This is the ONLY noise control.
 *   4. TARGET RESOURCE is built from the interpretation's real touches — never
 *      invented — and falls back to the title when touches are empty.
 */

// The module imports db-backed neighbours at module scope; the pure functions
// under test never touch them, so they are stubbed inert (same pattern as
// m365-change-resolver.test.ts).
vi.mock("@workspace/db", () => ({
  db: {},
  m365ChangeInterpretationsTable: {},
  m365ChangeResolutionsTable: {},
  m365ChangeRoutingsTable: {},
  mspChangeRequestsTable: {},
  mspMessageCenterItemsTable: {},
  mspRiskDecisionsTable: {},
  tenantsTable: {},
}));
vi.mock("drizzle-orm", () => ({
  and: vi.fn(),
  eq: vi.fn(),
}));
vi.mock("./logger", () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));

import {
  changeClassForIntake,
  decideRouting,
  deriveImplementer,
  deriveIntake,
  riskScoreForLevel,
  targetResourceForInterpretation,
} from "./m365-change-router";

describe("deriveIntake — the #1534 intake axis", () => {
  it("a control existing is always the approval case, regardless of who acts", () => {
    expect(deriveIntake({ whoActs: "microsoft", controllable: "yes" })).toBe("approval");
    expect(deriveIntake({ whoActs: "admin", controllable: "yes" })).toBe("approval");
  });

  it("an admin having to act (no control) is the advisory / requires-work case", () => {
    expect(deriveIntake({ whoActs: "admin", controllable: "no" })).toBe("advisory");
    expect(deriveIntake({ whoActs: "admin", controllable: "unknown" })).toBe("advisory");
  });

  it("Microsoft acting with no opt-out is the informed case", () => {
    expect(deriveIntake({ whoActs: "microsoft", controllable: "no" })).toBe("informed");
    expect(deriveIntake({ whoActs: "microsoft", controllable: "unknown" })).toBe("informed");
  });
});

describe("deriveImplementer — who executes the change", () => {
  it("Microsoft implements everything except the admin-work case", () => {
    expect(deriveImplementer({ whoActs: "microsoft" })).toBe("microsoft");
  });
  it("the customer's own team implements the admin-work (advisory) case", () => {
    expect(deriveImplementer({ whoActs: "admin" })).toBe("customer");
  });
});

describe("changeClassForIntake — informed is auto-approved low ceremony", () => {
  it("informed → standard (pre-approved); approval/advisory → normal", () => {
    expect(changeClassForIntake("informed")).toBe("standard");
    expect(changeClassForIntake("approval")).toBe("normal");
    expect(changeClassForIntake("advisory")).toBe("normal");
  });
});

describe("decideRouting — the gate (the only noise control)", () => {
  const dated = { hasAnnouncement: true, hasStructuralDate: true };

  it("measured + non-zero + dated + announced → auto_created", () => {
    expect(decideRouting({ resolutionStatus: "measured", affectedCount: 412, ...dated })).toEqual({
      decision: "auto_created",
      reason: "auto_created",
    });
  });

  it("a measured ZERO proposes, never auto-creates (touches nothing counted)", () => {
    expect(decideRouting({ resolutionStatus: "measured", affectedCount: 0, ...dated })).toEqual({
      decision: "proposed",
      reason: "zero_affected",
    });
  });

  it("non-zero but no tenant announcement yet → propose (no_announcement)", () => {
    expect(
      decideRouting({ resolutionStatus: "measured", affectedCount: 5, hasAnnouncement: false, hasStructuralDate: false }),
    ).toEqual({ decision: "proposed", reason: "no_announcement" });
  });

  it("non-zero, announced, but undated (incl. #1536 date-unclear) → propose (undated)", () => {
    expect(
      decideRouting({ resolutionStatus: "measured", affectedCount: 5, hasAnnouncement: true, hasStructuralDate: false }),
    ).toEqual({ decision: "proposed", reason: "undated" });
  });

  it("not measured routes nothing — the honest 'not read against this notice' stands", () => {
    expect(decideRouting({ resolutionStatus: "not_measured", affectedCount: null, ...dated })).toEqual({
      decision: "none",
      reason: "not_measured",
    });
    expect(decideRouting({ resolutionStatus: "error", affectedCount: null, ...dated })).toEqual({
      decision: "none",
      reason: "not_measured",
    });
    // A "measured" status with a null count is not a real measurement — never route it.
    expect(decideRouting({ resolutionStatus: "measured", affectedCount: null, ...dated })).toEqual({
      decision: "none",
      reason: "not_measured",
    });
  });
});

describe("targetResourceForInterpretation — real touches, never invented", () => {
  it("joins the interpretation's own services/protocols/skus/settings, de-duped", () => {
    expect(
      targetResourceForInterpretation({
        title: "EWS retirement",
        touches: { services: ["Exchange"], protocols: ["EWS", "EWS"], skus: [], settings: [] },
      }),
    ).toBe("Exchange, EWS");
  });

  it("falls back to the title when there is nothing to touch", () => {
    expect(
      targetResourceForInterpretation({
        title: "Some announcement",
        touches: { services: [], protocols: [], skus: [], settings: [] },
      }),
    ).toBe("Some announcement");
  });
});

describe("riskScoreForLevel — declining accepts the risk whole (residual == raw)", () => {
  it("maps the stored risk level to a 0-100 score", () => {
    expect(riskScoreForLevel("critical")).toBe(100);
    expect(riskScoreForLevel("high")).toBe(75);
    expect(riskScoreForLevel("medium")).toBe(50);
    expect(riskScoreForLevel("low")).toBe(25);
    expect(riskScoreForLevel("unknown-value")).toBe(25);
  });
});
