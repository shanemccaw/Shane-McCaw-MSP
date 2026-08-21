/**
 * policyDecisionsData.ts — the Policy Decisions fixture (Part 5).
 *
 * This module OWNS the policy-decision fixture for the whole portal. It was
 * lifted out of overviewData.ts, where it lived as `OV_POLICY_DECISIONS` reduced
 * to the six fields the Overview's "policy decisions due for review" lane reads
 * (id, state, title, check, approved, review). The Operate → Policy Decisions
 * page needs the WHOLE prototype record, so the fixture is widened here and
 * overviewData now re-exports the same array under its old names — one copy, so
 * the Overview lane and this page can never disagree about a decision. Same move
 * Part 8 made for the project phases (see overviewData.ts's re-export block).
 *
 * EXTRACTED from the prototype's own `POLICY_DECISIONS` array
 * ('Customer Portal Shell.dc.html' 8154-8179), evaluated rather than retyped.
 * Every string below is the design's, verbatim — copy is final.
 *
 * Design content, not tenant data: the prototype's fictional Halden Materials
 * tenant. This is UI-only; a later pass wires it to a real source, and keeping
 * the whole fixture in one module is what makes that a single-file change.
 */

/** The four states a decision moves through — prototype `pdStates` meta (20248-20253). */
export type PolicyDecisionState = "proposed" | "live" | "due" | "expired";

/**
 * One policy decision — the full prototype record. The Policy Decisions page
 * reads all of these; the Overview lane reads only id/state/title/check/
 * approved/review, which is why overviewData used to carry a six-field subset.
 */
export interface PolicyDecision {
  id: string;
  state: PolicyDecisionState;
  pillar: string;
  title: string;
  obligation: string;
  owner: string;
  /** RACI person key on the prototype's chip; not rendered on this page, kept for provenance. */
  ownerId: string;
  approved: string;
  review: string;
  register: string;
  rationale: string;
  compensating: string;
  check: string;
}

/** prototype 8154-8179. */
export const POLICY_DECISIONS: readonly PolicyDecision[] = [
  {
    id: "CMP-A1",
    state: "live",
    pillar: "Compliance",
    title: "Teams chat retention set to 1 year rather than the 7-year records period",
    obligation: "Records schedule §4.2 · transitory communications",
    owner: "General Counsel",
    ownerId: "rc",
    approved: "14 March 2026",
    review: "14 March 2027",
    register: "RR-2026-011",
    rationale:
      "Your records schedule classifies Teams chat as transitory communication rather than a record. The record copy of any decision lives in email or in the SharePoint document set, both of which carry the 7-year label.",
    compensating:
      "Email and SharePoint retention both set to 7 years with disposition review. Channel messages in the two regulated Teams are excluded from this decision and retained for 7 years.",
    check: "Compensating control verified on the last scan.",
  },
  {
    id: "CMP-A2",
    state: "due",
    pillar: "Compliance",
    title: "OneDrive retention excludes 14 contractor accounts",
    obligation: "GDPR Art. 5(1)(e) · storage limitation",
    owner: "Controller",
    ownerId: "pr",
    approved: "2 February 2026",
    review: "2 August 2026",
    register: "RR-2026-004",
    rationale:
      "Contractor OneDrive content is deliberately not retained past engagement end. Deliverables are required to be filed in the client SharePoint site, which is covered by the 7-year label.",
    compensating:
      "Contract terms require deliverables in SharePoint before final invoice. Quarterly spot-check of 3 contractor sites, last run 2 weeks ago with no exceptions.",
    check:
      "Review date passed 18 days ago. The contractor population has changed by 4 people since the decision was signed.",
  },
  {
    id: "SEC-A3",
    state: "proposed",
    pillar: "Security",
    title: "Legacy authentication left enabled for 11 Bay 3 scanners",
    obligation: "Cyber insurance schedule 2 · MFA on all accounts",
    owner: "Dan Whitlock",
    ownerId: "dw",
    approved: "Not yet signed",
    review: "Set on approval",
    register: "Pending",
    rationale:
      "The scanners cannot do modern auth and the replacement is capital-budgeted for Q1. Blocking them stops goods-in.",
    compensating:
      "Proposed: named service accounts, IP-locked to the Bay 3 subnet, excluded from all other services, and sign-in alerting on each.",
    check: "Waiting on Priya Raman. Raised 6 days ago from CMP-03.",
  },
  {
    id: "GOV-A4",
    state: "expired",
    pillar: "Governance",
    title: "Guest access reviews deferred until the Entra P2 licences land",
    obligation: "ISO 27001 A.5.18 · access rights review",
    owner: "Shane McCaw",
    ownerId: "sm",
    approved: "9 November 2025",
    review: "9 May 2026",
    register: "RR-2025-038",
    rationale:
      "Access reviews need Entra ID P2, which was not in the licence position at the time. A manual review was judged worse than none because it would not be evidenced.",
    compensating:
      "Manual quarterly export of the guest list to the account owner. Last run 5 months ago.",
    check:
      "Expired 103 days ago and the compensating control has not run since March. This now reads as neglect rather than a decision.",
  },
];

/** The colour each state renders in — prototype `PD_TONE` / `pdStates` meta `c`. */
export const PD_TONE: Readonly<Record<PolicyDecisionState, string>> = {
  proposed: "#fbbf24",
  live: "#34d399",
  due: "#f97316",
  expired: "#f87171",
};

/** The `approved` value a decision carries when it has never been signed — 17451. */
export const PD_UNSIGNED = "Not yet signed";

/**
 * The four state counters, in the prototype's own order (`pdStates` meta,
 * 20248-20253): proposed, live, due, expired. `label` doubles as the row badge
 * text (prototype `pdRows` meta, 20269) — the two agree in the design, so they
 * share one source here.
 */
export interface PolicyStateMeta {
  key: PolicyDecisionState;
  label: string;
  sub: string;
}

export const PD_STATE_META: readonly PolicyStateMeta[] = [
  { key: "proposed", label: "Awaiting sign-off", sub: "raised, not yet a decision" },
  { key: "live", label: "Live", sub: "signed, in date, control holding" },
  { key: "due", label: "Due for review", sub: "the date has passed" },
  { key: "expired", label: "Expired", sub: "reads as neglect until renewed" },
];

/**
 * The knowledge-base article the page's info dot points at — prototype
 * `kbiDecision = kbInfo('cmp-decision')`, article at 8055-8056. The full article
 * lives in the KB overlay (a later part); the dot reproduces the hover card.
 */
export const PD_KB_INFO = {
  title: "Record a policy decision",
  summary: "How to accept a gap so it reads as a decision and not neglect.",
} as const;
