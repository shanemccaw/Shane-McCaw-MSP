/**
 * copilotModel.ts — the Copilot readiness derivations.
 *
 * Prototype references are to `Customer Portal Shell.dc.html`.
 *
 * The one derivation that MUST NOT be a literal on this page is the gate
 * denominator. `CP_GATE_TARGET` re-exports the real `COPILOT_GATE_TARGET` from
 * journeyTokens (mirrored server-side in `copilot-gate.ts`), so the "of 82" the
 * page renders is the single source of truth for the gate, not a hardcoded 82.
 * Change the constant and this page — and its test — move with it.
 */

// Relative, not the `@/` alias: this module is imported by a `node:test` file
// run through `tsx --test`, which does not resolve the tsconfig path alias.
import { COPILOT_GATE_TARGET } from "../copilot-journey/journeyTokens";

import type { CopilotPillar, CopilotPillarState } from "./copilotData";

/**
 * The Copilot Gate target — the denominator on "41 of 82" and the nav pill.
 * Re-exported rather than restated so the value lives in exactly one place
 * (journeyTokens), which is the point of the constant.
 */
export const CP_GATE_TARGET = COPILOT_GATE_TARGET;

/** `41 / 82` — the gate score, as the nav pill and the page header both write it. */
export function gateScoreLabel(now: number): string {
  return `${now} / ${CP_GATE_TARGET}`;
}

/** `of 82` — the sub-line under the current gate number. Prototype 6111. */
export function gateDenominatorLabel(): string {
  return `of ${CP_GATE_TARGET}`;
}

/** `+27` — a pillar's remediation gain. Prototype 20612 (`'+' + (target - now)`). */
export function pillarDelta(pillar: Pick<CopilotPillar, "now" | "target">): string {
  return `+${pillar.target - pillar.now}`;
}

/**
 * A pillar's DISPLAY colour. Prototype 20610: Compliance's identity `#F3F4F6`
 * is too near white to read as the score numeral and the row's accents, so it
 * drops to `#cbd5e1`; every other pillar shows its own identity colour.
 */
export function pillarDisplayColor(pillar: Pick<CopilotPillar, "key" | "color">): string {
  return pillar.key === "compliance" ? "#cbd5e1" : pillar.color;
}

/**
 * The state chip's colour pair. Prototype 20617: Critical is red, everything
 * else (only "Attention required" here) is amber. Returned as text + border +
 * background so the chip does not restate the same three rgba strings.
 */
export function pillarStateColors(state: CopilotPillarState): {
  readonly text: string;
  readonly border: string;
  readonly background: string;
} {
  if (state === "Critical") {
    return { text: "#f87171", border: "rgba(248,113,113,.4)", background: "rgba(248,113,113,.1)" };
  }
  return { text: "#fbbf24", border: "rgba(251,191,36,.4)", background: "rgba(251,191,36,.1)" };
}
