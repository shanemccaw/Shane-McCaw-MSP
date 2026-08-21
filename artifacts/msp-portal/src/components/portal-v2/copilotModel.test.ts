/**
 * copilotModel.test.ts — pins the Copilot gate denominator and the pillar deltas.
 *
 * The gate denominator is the reason this file exists. The design writes "of
 * 82" as a literal, and the whole point of `COPILOT_GATE_TARGET` (#359) is that
 * no screen restates it. This test is the client-side half of the assertion the
 * constant's own comment describes: it fails if the page ever hardcodes a gate
 * number that disagrees with journeyTokens. The server side (`copilot-gate.ts`)
 * asserts the mirror separately — change one, change and re-test both.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { COPILOT_GATE_TARGET } from "../copilot-journey/journeyTokens";

import { CP_GATE, CP_PILLARS } from "./copilotData";
import {
  CP_GATE_TARGET,
  gateDenominatorLabel,
  gateScoreLabel,
  pillarDelta,
  pillarDisplayColor,
  pillarStateColors,
} from "./copilotModel";

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
    assert.equal(gateScoreLabel(CP_GATE.now), `41 / ${COPILOT_GATE_TARGET}`);
    assert.equal(gateScoreLabel(CP_GATE.now), "41 / 82");
  });

  it("does not restate 82 in the fixture", () => {
    // The gate figures are the design's own, but the target is never one of
    // them — that is what keeps the denominator single-sourced.
    assert.notEqual(CP_GATE.remediated, COPILOT_GATE_TARGET);
    assert.equal(CP_GATE.now, 41);
    assert.equal(CP_GATE.remediated, 68);
  });
});

describe("pillarDelta", () => {
  it("computes the remediation gain for each pillar the design draws", () => {
    assert.deepEqual(
      CP_PILLARS.map((p) => [p.label, pillarDelta(p)]),
      [
        ["Governance", "+27"],
        ["Security", "+34"],
        ["Compliance", "+29"],
        ["Licensing", "+22"],
        ["Adoption", "+22"],
        ["Health", "+26"],
      ],
    );
  });
});

describe("pillarDisplayColor", () => {
  it("drops Compliance's near-white to a legible slate", () => {
    const compliance = CP_PILLARS.find((p) => p.key === "compliance")!;
    assert.equal(compliance.color, "#F3F4F6");
    assert.equal(pillarDisplayColor(compliance), "#cbd5e1");
  });

  it("keeps every other pillar's identity colour", () => {
    const governance = CP_PILLARS.find((p) => p.key === "governance")!;
    assert.equal(pillarDisplayColor(governance), "#3B82F6");
  });
});

describe("pillarStateColors", () => {
  it("reds a critical pillar and ambers an attention-required one", () => {
    assert.equal(pillarStateColors("Critical").text, "#f87171");
    assert.equal(pillarStateColors("Attention required").text, "#fbbf24");
  });

  it("matches the two states the six pillars actually carry", () => {
    const states = new Set(CP_PILLARS.map((p) => p.state));
    assert.deepEqual([...states].sort(), ["Attention required", "Critical"]);
  });
});
