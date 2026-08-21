/**
 * policyDecisionsModel.ts — the Policy Decisions page's derivations (Part 5).
 *
 * Prototype references are to 'Customer Portal Shell.dc.html'. The page itself
 * (portal-v2-policy-decisions.tsx) is a transcription of the `isPolicyDecisions`
 * markup (4578-4657); the counting and filtering that markup drives lives here,
 * named and tested, so a wrong count can't render as a plausible-but-wrong
 * number the rest of the page never contradicts.
 *
 * Everything here is a pure function of the fixture and the current filter —
 * there is no data wiring in this phase, and the filter is local UI state.
 */

import {
  PD_STATE_META,
  PD_TONE,
  POLICY_DECISIONS,
  type PolicyDecision,
  type PolicyDecisionState,
} from "./policyDecisionsData";

/** The four states in the prototype's `pdStates` order. */
const STATE_ORDER: readonly PolicyDecisionState[] = PD_STATE_META.map((m) => m.key);

/** How many decisions sit in each state — the number on each counter card. */
export function pdStateCounts(
  decisions: readonly PolicyDecision[] = POLICY_DECISIONS,
): Readonly<Record<PolicyDecisionState, number>> {
  const counts: Record<PolicyDecisionState, number> = {
    proposed: 0,
    live: 0,
    due: 0,
    expired: 0,
  };
  for (const d of decisions) counts[d.state] += 1;
  return counts;
}

/**
 * The two states that mean someone has to act — prototype `cmpPolicyDue`
 * (8806): `due` or `expired`. This is the number the design draws as the
 * nav badge ("N due"); it is surfaced on the page's own counters too.
 */
export function pdFlaggedCount(
  decisions: readonly PolicyDecision[] = POLICY_DECISIONS,
): number {
  return decisions.filter((d) => d.state === "due" || d.state === "expired").length;
}

/** One counter card, ready to render — prototype `pdStates` (20247-20265). */
export interface PolicyStateCard {
  key: PolicyDecisionState;
  label: string;
  sub: string;
  value: string;
  tone: string;
  /** True when this card is the active filter, which the design draws brighter. */
  active: boolean;
}

/**
 * The four counter cards, in prototype order. `active` reflects the current
 * filter; clicking a card toggles the filter, which is the caller's job.
 */
export function pdStateCards(
  filter: PolicyDecisionState | null,
  decisions: readonly PolicyDecision[] = POLICY_DECISIONS,
): readonly PolicyStateCard[] {
  const counts = pdStateCounts(decisions);
  return PD_STATE_META.map((m) => ({
    key: m.key,
    label: m.label,
    sub: m.sub,
    value: String(counts[m.key]),
    tone: PD_TONE[m.key],
    active: filter === m.key,
  }));
}

/**
 * The decisions to show. With no filter, all of them in fixture order; with a
 * filter, only that state — prototype `pdRows` (20268).
 */
export function pdVisible(
  filter: PolicyDecisionState | null,
  decisions: readonly PolicyDecision[] = POLICY_DECISIONS,
): readonly PolicyDecision[] {
  return filter ? decisions.filter((d) => d.state === filter) : decisions;
}

/**
 * The note under the counters — prototype `pdFilterNote` (20267): shown only
 * while a filter is applied, empty otherwise. Verbatim.
 */
export function pdFilterNote(filter: PolicyDecisionState | null): string {
  return filter ? "Filtered. Click the box again to show all four." : "";
}

/** One decision's row badge — label + colour. Prototype `pdRows` meta (20269). */
export function pdRowBadge(state: PolicyDecisionState): { label: string; tone: string } {
  const meta = PD_STATE_META.find((m) => m.key === state);
  return { label: meta ? meta.label : state, tone: PD_TONE[state] };
}

/**
 * Which action buttons a decision offers — prototype `pdRows` (20283-20284):
 * a proposed decision can be signed off; a due or expired one can be renewed;
 * every decision can be withdrawn.
 */
export function pdActions(state: PolicyDecisionState): {
  canSign: boolean;
  canRenew: boolean;
} {
  return {
    canSign: state === "proposed",
    canRenew: state === "due" || state === "expired",
  };
}

/** The four expandable meta fields — prototype `pdRows.meta2` (20282). */
export interface PolicyMetaField {
  k: string;
  v: string;
}

export function pdMetaFields(d: PolicyDecision): readonly PolicyMetaField[] {
  return [
    { k: "Owner", v: d.owner },
    { k: "Signed", v: d.approved },
    { k: "Next review", v: d.review },
    { k: "Risk register", v: d.register },
  ];
}

export { STATE_ORDER as PD_STATE_ORDER };
