/**
 * copilotModel.test.ts — pins the Copilot gate denominator and the verdict-page
 * derivations that turn the live `JourneyView` into what the page renders (#1213).
 *
 * The gate denominator is the reason this file first existed. The design writes
 * "of 82" as a literal, and the whole point of `COPILOT_GATE_TARGET` (#359) is
 * that no screen restates it. This test is the client-side half of the assertion
 * the constant's own comment describes: it fails if the page ever hardcodes a
 * gate number that disagrees with journeyTokens. The server side
 * (`copilot-gate.ts`) asserts the mirror separately — change one, change and
 * re-test both.
 *
 * #1213 added the live derivations: the page no longer carries a `CP_PILLARS` /
 * `CP_GATE` fixture at all, so the tests that pinned those fabricated numbers are
 * gone, replaced by tests of the pure functions that now compute every figure
 * from the real engine output.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { COPILOT_GATE_TARGET } from "../copilot-journey/journeyTokens";
import type { JourneyPillarView } from "../copilot-journey/journeyModel";

import { CP_PILLAR_ADVICE } from "./copilotData";
import {
  CP_GATE_TARGET,
  copilotHeading,
  copilotPillarRow,
  gateDenominatorLabel,
  gateRemediatedNote,
  gateScoreLabel,
  gateSummary,
  gateVerdict,
  pillarDelta,
  pillarDisplayColor,
  pillarState,
  pillarStateColors,
} from "./copilotModel";

/** Minimal JourneyPillarView for the fields `copilotPillarRow` reads. */
function pillarView(score: number | null, satelliteFinding: string | null): JourneyPillarView {
  return { score, satelliteFinding } as unknown as JourneyPillarView;
}

describe("gate denominator", () => {
  it("is the real COPILOT_GATE_TARGET, never a local literal", () => {
    assert.equal(CP_GATE_TARGET, COPILOT_GATE_TARGET);
    // Guards the current value so an accidental edit to the constant is caught
    // here as well as on the server side.
    assert.equal(CP_GATE_TARGET, 82);
  });

  it("renders the denominator from the constant", () => {
    assert.equal(gateDenominatorLabel(), `of ${COPILOT_GATE_TARGET}`);
  });

  it("writes the gate score against that target", () => {
    assert.equal(gateScoreLabel(41), `41 / ${COPILOT_GATE_TARGET}`);
    assert.equal(gateScoreLabel(41), "41 / 82");
  });
});

describe("copilotHeading", () => {
  it("names the real tenant and states no verdict without a score", () => {
    assert.equal(copilotHeading("Contoso", null), "Copilot readiness for Contoso");
  });

  it("says not-yet-safe below the gate", () => {
    assert.equal(copilotHeading("Contoso", 41), "It is not yet safe to turn Copilot on at Contoso");
  });

  it("says safe at or above the gate", () => {
    assert.equal(copilotHeading("Contoso", 82), "It is safe to turn Copilot on at Contoso");
    assert.equal(copilotHeading("Contoso", 90), "It is safe to turn Copilot on at Contoso");
  });
});

describe("gateVerdict", () => {
  it("is the flat verdict against the real gate", () => {
    assert.equal(gateVerdict(41), "not safe to deploy");
    assert.equal(gateVerdict(81), "not safe to deploy");
    assert.equal(gateVerdict(82), "safe to deploy");
  });
});

describe("gateSummary", () => {
  it("is null with no score", () => {
    assert.equal(gateSummary("Contoso", null), null);
  });

  it("states the real gap and keeps the design's second half", () => {
    assert.equal(
      gateSummary("Contoso", 41),
      "Contoso is 41 points from safe to deploy, and every point is a known, fixable gap with a named owner and a price.",
    );
  });

  it("stops asserting a gap once cleared", () => {
    assert.equal(
      gateSummary("Contoso", 82),
      "Contoso is at or above the safe-to-deploy threshold. What follows is what keeps it there.",
    );
  });
});

describe("gateRemediatedNote", () => {
  it("says clears the gate only when the projection reaches the target", () => {
    assert.equal(gateRemediatedNote(41, 82), "clears the gate · +41 points");
    assert.equal(gateRemediatedNote(41, 68), "+27 points");
  });
});

describe("pillarState", () => {
  it("maps the real score onto the design's three chips", () => {
    assert.equal(pillarState(34), "Critical");
    assert.equal(pillarState(57), "Attention required");
    assert.equal(pillarState(72), "Healthy");
  });
});

describe("pillarDelta", () => {
  it("computes the remediation gain from now → target", () => {
    assert.equal(pillarDelta({ now: 34, target: 61 }), "+27");
    assert.equal(pillarDelta({ now: 38, target: 72 }), "+34");
  });
});

describe("pillarDisplayColor", () => {
  it("drops Compliance's near-white to a legible slate", () => {
    const compliance = CP_PILLAR_ADVICE.find((p) => p.key === "compliance")!;
    assert.equal(compliance.color, "#F3F4F6");
    assert.equal(pillarDisplayColor(compliance), "#cbd5e1");
  });

  it("keeps every other pillar's identity colour", () => {
    const governance = CP_PILLAR_ADVICE.find((p) => p.key === "governance")!;
    assert.equal(pillarDisplayColor(governance), "#3B82F6");
  });
});

describe("pillarStateColors", () => {
  it("reds a critical pillar, ambers an attention one, greens a healthy one", () => {
    assert.equal(pillarStateColors("Critical").text, "#f87171");
    assert.equal(pillarStateColors("Attention required").text, "#fbbf24");
    assert.equal(pillarStateColors("Healthy").text, "#34d399");
  });
});

describe("copilotPillarRow", () => {
  const governance = CP_PILLAR_ADVICE.find((p) => p.key === "governance")!;

  it("takes the real score, state and lead finding from the live pillar", () => {
    const row = copilotPillarRow(
      governance,
      pillarView(34, "212 sites shared with everyone"),
      undefined,
    );
    assert.equal(row.now, 34);
    assert.equal(row.scored, true);
    assert.equal(row.state, "Critical");
    assert.equal(row.finding, "212 sites shared with everyone");
    // No SOW projection quoted → no fabricated target.
    assert.equal(row.hasProjection, false);
    assert.equal(row.target, null);
  });

  it("falls through to an honest line for an unscored pillar, never a red zero", () => {
    const row = copilotPillarRow(governance, pillarView(null, null), undefined);
    assert.equal(row.now, null);
    assert.equal(row.scored, false);
    assert.equal(row.state, null);
    assert.equal(row.finding, "This pillar was not evaluated in your scan.");
  });

  it("shows a projection only when it genuinely improves on the current score", () => {
    const improves = copilotPillarRow(governance, pillarView(34, "finding"), 61);
    assert.equal(improves.hasProjection, true);
    assert.equal(improves.target, 61);
    assert.equal(pillarDelta({ now: improves.now!, target: improves.target! }), "+27");

    const flat = copilotPillarRow(governance, pillarView(34, "finding"), 34);
    assert.equal(flat.hasProjection, false);
    assert.equal(flat.target, null);
  });
});
