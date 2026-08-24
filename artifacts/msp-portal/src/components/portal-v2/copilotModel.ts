/**
 * copilotModel.ts — the Copilot readiness derivations.
 *
 * Every number the verdict page shows is now LIVE (Git #1213): pillar scores,
 * findings, the gate score and the tenant name come from the real Copilot
 * assessment engine via `useCopilotJourney()` → `JourneyView`. This module holds
 * the pure derivations that turn that view (plus the static per-pillar advisory
 * in `copilotData.ts`) into what the page renders — so the mapping is unit-tested
 * without a render, the same discipline `journeyModel.ts` follows.
 *
 * The one derivation that MUST NOT be a literal on this page is the gate
 * denominator. `CP_GATE_TARGET` re-exports the real `COPILOT_GATE_TARGET` from
 * journeyTokens (mirrored server-side in `copilot-gate.ts`), so the "of 82" the
 * page renders is the single source of truth for the gate, not a hardcoded 82.
 * Change the constant and this page — and its test — move with it.
 */

// Relative, not the `@/` alias: this module is imported by a `node:test` file
// run through `tsx --test`, which does not resolve the tsconfig path alias.
import { COPILOT_GATE_TARGET, severityForScore } from "../copilot-journey/journeyTokens";
import type { JourneyPillarView } from "../copilot-journey/journeyModel";

import type { CopilotPillarAdvice, CopilotPillarIcon, CopilotPillarState } from "./copilotData";

/**
 * The Copilot Gate target — the denominator on "N of 82" and the nav pill.
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
export function pillarDelta(pillar: { readonly now: number; readonly target: number }): string {
  return `+${pillar.target - pillar.now}`;
}

/**
 * A pillar's DISPLAY colour. Prototype 20610: Compliance's identity `#F3F4F6`
 * is too near white to read as the score numeral and the row's accents, so it
 * drops to `#cbd5e1`; every other pillar shows its own identity colour.
 */
export function pillarDisplayColor(pillar: { readonly key: string; readonly color: string }): string {
  return pillar.key === "compliance" ? "#cbd5e1" : pillar.color;
}

/**
 * The state chip's colour pair. Prototype 20617: Critical is red,
 * "Attention required" amber; a Healthy pillar (a real live score can be one)
 * greens. Returned as text + border + background so the chip does not restate
 * the same three rgba strings.
 */
export function pillarStateColors(state: CopilotPillarState): {
  readonly text: string;
  readonly border: string;
  readonly background: string;
} {
  if (state === "Critical") {
    return { text: "#f87171", border: "rgba(248,113,113,.4)", background: "rgba(248,113,113,.1)" };
  }
  if (state === "Healthy") {
    return { text: "#34d399", border: "rgba(52,211,153,.4)", background: "rgba(52,211,153,.1)" };
  }
  return { text: "#fbbf24", border: "rgba(251,191,36,.4)", background: "rgba(251,191,36,.1)" };
}

/**
 * A pillar's live state chip, from its real score. Maps `severityForScore`'s
 * three bands onto the design's chip labels — critical → "Critical", attention →
 * "Attention required", healthy → "Healthy". Never authored from a fixture.
 */
export function pillarState(score: number): CopilotPillarState {
  const band = severityForScore(score);
  if (band === "critical") return "Critical";
  if (band === "attention") return "Attention required";
  return "Healthy";
}

/**
 * The page's verdict headline, from the real tenant name and gate score.
 *
 * Mirrors `copilotReadinessReport.ts`'s headline exactly (same three cases, same
 * `COPILOT_GATE_TARGET` boundary) so the page and the report never disagree about
 * one tenant. A null score has no verdict — the copy states readiness, not a
 * Go/No-Go the platform has not measured.
 */
export function copilotHeading(tenantName: string, score: number | null): string {
  if (score === null) return `Copilot readiness for ${tenantName}`;
  return score >= CP_GATE_TARGET
    ? `It is safe to turn Copilot on at ${tenantName}`
    : `It is not yet safe to turn Copilot on at ${tenantName}`;
}

/** `not safe to deploy` / `safe to deploy` — the flat verdict beside the gate score. */
export function gateVerdict(score: number): string {
  return score >= CP_GATE_TARGET ? "safe to deploy" : "not safe to deploy";
}

/**
 * The one-number summary under the gate bar, from the real gap to the Gate.
 *
 * The design's second half ("every point is a known, fixable gap with a named
 * owner and a price") is kept verbatim; only the tenant name and the gap number
 * are made real. Null when there is no score to state a gap against.
 */
export function gateSummary(tenantName: string, score: number | null): string | null {
  if (score === null) return null;
  const gap = CP_GATE_TARGET - score;
  if (gap <= 0) {
    return `${tenantName} is at or above the safe-to-deploy threshold. What follows is what keeps it there.`;
  }
  return `${tenantName} is ${gap} points from safe to deploy, and every point is a known, fixable gap with a named owner and a price.`;
}

/**
 * The note beside the remediated (projected) gate number — only meaningful when
 * a real post-remediation projection exists. `clears the gate` only when the
 * projection genuinely reaches `COPILOT_GATE_TARGET`; otherwise just the gain.
 */
export function gateRemediatedNote(now: number, remediated: number): string {
  const delta = remediated - now;
  const gainClause = delta > 0 ? `+${delta} points` : "no projected change";
  return remediated >= CP_GATE_TARGET ? `clears the gate · ${gainClause}` : gainClause;
}

/** The provenance line under the pillars, from the real last-scan date. */
export function copilotAssessedLine(scannedOn: string | null): string {
  return scannedOn
    ? `Assessed ${scannedOn} · Microsoft Graph, read-only`
    : "Not yet assessed · Microsoft Graph, read-only";
}

/**
 * One pillar row on the page, built by merging the static advisory with the
 * pillar's LIVE view and (when quoted) a post-remediation projection.
 *
 * `now`/`target`/`state`/`finding` are all real — never a fixture. `finding` is
 * the pillar's own lead finding off the scan (`satelliteFinding`, which is a real
 * finding title, a real stat readout, a clean-bill-of-health note, or a
 * still-scanning note — never fabricated); a pillar with no data at all falls
 * through to an honest "not evaluated" line rather than an invented figure.
 *
 * A projection is shown ONLY when one genuinely exists and improves on the
 * current score — the platform quotes prices, not projected pillar scores, for
 * live tenants (see `journeyScopeFromSow.ts`), so `hasProjection` is normally
 * false and the row shows today's score alone rather than a fabricated target.
 */
export interface CopilotPillarRow {
  readonly key: string;
  readonly label: string;
  readonly color: string;
  readonly icon: CopilotPillarIcon;
  readonly why: string;
  readonly fix: string;
  /** The real current score, or null when the scan could not evaluate it. */
  readonly now: number | null;
  /** The real projected score, present only when `hasProjection`. */
  readonly target: number | null;
  /** True only when a real projection improves on the current score. */
  readonly hasProjection: boolean;
  /** The live severity chip, or null when there is no score to band. */
  readonly state: CopilotPillarState | null;
  /** The pillar's real lead finding, or an honest "no data" line. */
  readonly finding: string;
  /** True when the scan produced a numeric score for this pillar. */
  readonly scored: boolean;
}

export function copilotPillarRow(
  advice: CopilotPillarAdvice,
  pillar: JourneyPillarView | undefined,
  projected: number | undefined,
): CopilotPillarRow {
  const now = pillar && typeof pillar.score === "number" ? pillar.score : null;
  const hasProjection = now !== null && typeof projected === "number" && projected > now;
  return {
    key: advice.key,
    label: advice.label,
    color: advice.color,
    icon: advice.icon,
    why: advice.why,
    fix: advice.fix,
    now,
    target: hasProjection ? (projected as number) : null,
    hasProjection,
    state: now !== null ? pillarState(now) : null,
    finding: pillar?.satelliteFinding ?? "This pillar was not evaluated in your scan.",
    scored: now !== null,
  };
}
