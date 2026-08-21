/**
 * riskRegisterWire.ts — the shapes `portal-risk-register.ts` serves, and the
 * normalisation from those into the register's own model types.
 *
 * Split out of `riskRegisterLive.ts` so it can be tested as plain functions:
 * this module imports nothing but types, while the hooks module pulls in React
 * and the auth context. The rule this file encodes is the one worth testing.
 *
 * ── Null is a real answer, and it is not filled in ──────────────────────────
 * `msp_risk_decisions` gained the register's own columns (pillar, owner,
 * likelihood, impact, weight, outcome, evidence, plan, register ref, rationale,
 * obligation) in 2026-08-21's migration — all nullable, no backfill. Every row
 * written before it, and every row `msp-rbd.ts` writes now, has them empty.
 *
 * So normalisation NEVER invents a plausible value:
 *
 *   • text  -> "Not recorded". The colour maps (`RR_SEV_META`,
 *     `RR_STATUS_META`) have no key for it, so such a cell renders with no
 *     accent colour rather than borrowing a severity's. A missing severity
 *     should look unset, not look like Low.
 *   • weight -> 0. It contributes nothing to the totals, so "score suppressed
 *     by acceptance" stays true rather than being inflated by a guess.
 *   • likelihood / impact -> 0. The heat map's grid only has cells for 1-5, so
 *     a risk with no recorded coordinates is simply not plotted. Placing it at
 *     1x1 would assert "very unlikely, negligible" — a claim nobody made.
 */

import type { RiskEntry, RiskAcceptance } from "./riskRegisterData";
import type { PolicyDecision, PolicyDecisionState } from "./policyDecisionsData";

/** What the page shows where the register genuinely holds nothing. */
export const NOT_RECORDED = "Not recorded";

/* ── The wire shapes, exactly as portal-risk-register.ts serves them ──────── */

export interface WireAcceptance {
  readonly by: string;
  readonly on: string;
  readonly until: string | null;
  readonly register: string | null;
  readonly why: string | null;
  readonly compensating: string | null;
  readonly statement: string | null;
}

export interface WireRisk {
  readonly id: string;
  readonly title: string;
  readonly pillar: string | null;
  readonly inherent: string | null;
  readonly residual: string | null;
  readonly status: string | null;
  readonly owner: string | null;
  readonly review: string | null;
  readonly weight: number | null;
  readonly likelihood: number | null;
  readonly impact: number | null;
  readonly what: string;
  readonly outcome: string | null;
  readonly evidence: string | null;
  readonly controls: readonly string[];
  readonly plan: string | null;
  readonly accepted?: WireAcceptance;
  readonly isAccepted: boolean;
  readonly liabilityValueUsd: number;
  readonly framework: string;
  readonly controlViolated: string;
}

export interface WirePolicyDecision {
  readonly id: string;
  readonly state: string | null;
  readonly pillar: string | null;
  readonly title: string;
  readonly obligation: string | null;
  readonly owner: string | null;
  readonly ownerId: string | null;
  readonly approved: string | null;
  readonly review: string | null;
  readonly register: string | null;
  readonly rationale: string | null;
  readonly compensating: string | null;
  readonly check: string | null;
}

/* ── Normalisation ───────────────────────────────────────────────────────── */

const text = (v: string | null | undefined): string => {
  const s = (v ?? "").trim();
  return s === "" ? NOT_RECORDED : s;
};

const num = (v: number | null | undefined): number =>
  typeof v === "number" && Number.isFinite(v) ? v : 0;

/**
 * ISO 8601 -> "12 August 2026", matching the fixture's own format.
 *
 * `en-GB` is pinned rather than using the visitor's locale: the surrounding
 * copy is written in that form, and a date that flipped to "August 12, 2026"
 * for one reader would sit inconsistently beside the fixture-derived rows the
 * pillar pages still show. A value that will not parse is returned unchanged
 * rather than becoming "Invalid Date".
 *
 * THE TIMEZONE IS PINNED TO UTC, AND THAT IS NOT COSMETIC. Every timestamp in
 * this schema is stored UTC, and the MSP-side signature string `msp-rbd.ts`
 * writes says so in its own text ("2026-08-19 03:40:40 UTC"). Formatting in the
 * viewer's local zone would render an acceptance stamped at 00:30 UTC as the
 * PREVIOUS DAY for anyone west of Greenwich — so the same permanent, "never
 * editable after the fact" record would show two different dates depending on
 * who opened it. On a liability transfer that is the date that matters.
 */
export function formatLongDate(iso: string | null): string {
  if (!iso) return NOT_RECORDED;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function acceptance(w: WireAcceptance): RiskAcceptance {
  return {
    by: text(w.by),
    on: formatLongDate(w.on),
    until: text(w.until),
    register: text(w.register),
    why: text(w.why),
    compensating: text(w.compensating),
  };
}

export function toRiskEntry(w: WireRisk): RiskEntry {
  return {
    id: w.id,
    title: w.title,
    pillar: text(w.pillar),
    inherent: text(w.inherent),
    residual: text(w.residual),
    status: text(w.status),
    owner: text(w.owner),
    review: text(w.review),
    weight: num(w.weight),
    likelihood: num(w.likelihood),
    impact: num(w.impact),
    what: w.what,
    outcome: text(w.outcome),
    evidence: text(w.evidence),
    controls: [...w.controls],
    plan: text(w.plan),
    ...(w.accepted ? { accepted: acceptance(w.accepted) } : {}),
  };
}

const DECISION_STATES: readonly PolicyDecisionState[] = ["proposed", "live", "due", "expired"];

/**
 * An unrecognised `decision_state` falls back to `proposed` — the least
 * committed of the four. Dropping the row instead would hide a real decision
 * because of a bad enum value, which is worse than showing it in the lane that
 * claims the least about it.
 */
export function decisionState(v: string | null): PolicyDecisionState {
  const s = (v ?? "").trim().toLowerCase() as PolicyDecisionState;
  return DECISION_STATES.includes(s) ? s : "proposed";
}

export function toPolicyDecision(w: WirePolicyDecision): PolicyDecision {
  return {
    id: w.id,
    state: decisionState(w.state),
    pillar: text(w.pillar),
    title: w.title,
    obligation: text(w.obligation),
    owner: text(w.owner),
    ownerId: (w.ownerId ?? "").trim(),
    approved: w.approved ? formatLongDate(w.approved) : NOT_RECORDED,
    review: text(w.review),
    register: text(w.register),
    rationale: text(w.rationale),
    compensating: text(w.compensating),
    check: text(w.check),
  };
}
