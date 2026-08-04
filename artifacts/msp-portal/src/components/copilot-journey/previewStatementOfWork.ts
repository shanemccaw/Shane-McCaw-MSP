/**
 * previewStatementOfWork.ts — document 9 of 9, the contract copy.
 *
 * The SOW's *numbers* are not here. Every figure the customer signs against —
 * the fee, the weeks, the phase count, the projected score — is computed by
 * `journeyPricing.ts` from `PREVIEW_SCOPE`, the same module and the same scope
 * the standalone proposal screen uses. Two surfaces over one agreement must not
 * be able to disagree about what it costs, so only one of them is allowed to do
 * arithmetic, and it is not this file.
 *
 * What lives here is the contract's prose: the eight numbered sections, the
 * findings-by-pillar carry-over, the deliverable summary and the terms. Verbatim
 * from `Design/Document Viewer.dc.html`, reachable only behind `?preview=design`.
 */

import type { PillarKey, Severity } from "./journeyTokens.ts";

export interface SowRow {
  readonly label: string;
  readonly tone: Severity;
  /** Omitted where the value is computed from the live scope at render time. */
  readonly value?: string;
  /** Names the derived figure the renderer substitutes. */
  readonly derived?: "total" | "projected" | "findings" | "phaseCount" | "weeks" | "newBudget" | "netYear" | "gateLabel";
}

export interface SowSection {
  readonly heading: string;
  readonly intro?: string;
  readonly rows: readonly SowRow[];
}

/** The findings each pillar carries into scope, for section 7. */
export interface SowPillarCarry {
  readonly pillar: PillarKey;
  readonly count: number;
  readonly detail: string;
}

export const STATEMENT_OF_WORK = {
  reference: "SMC-HM-2026-0803",
  kicker: "Statement of work · SMC-HM-2026-0803",
  headline: "Copilot Gate clearance for Halden Materials",
  standfirst:
    "A contract artifact. Every finding, figure and phase below is carried from the assessment of 3 August 2026 — nothing here is authored for presentation.",

  sections: [
    {
      heading: "1 · Scope & Objective",
      intro:
        "The objective of this engagement is to clear the Copilot Gate for Halden Materials — moving readiness from 41 to at or above the 82 threshold — by remediating the 41 findings surfaced in the assessment of 3 August 2026.",
      rows: [
        { label: "The objective", tone: "attention", value: "Copilot Gate clearance · readiness 41 → 82 minimum" },
        { label: "Findings carried into scope", tone: "critical", value: "41 findings across six pillars · 6 of them gate blockers" },
        {
          label: "Why this matters",
          tone: "critical",
          value:
            "Copilot inherits every permission, label and licence state on day one. Enabling it against the current configuration extends a known identity and exposure gap into a conversational interface across 1,847 sites.",
        },
        {
          label: "Basis of scope",
          tone: "healthy",
          value: "Read-only Microsoft Graph assessment · 158 signal derivation checks · no configuration altered",
        },
      ],
    },
    {
      heading: "2 · Approach & Sequence",
      intro:
        "Work follows the dependency order established in the Full Remediation Guide. Identity lands before anything is exposed to Copilot; drift telemetry lands last so it baselines the remediated state rather than the starting point.",
      rows: [
        { label: "Critical path", tone: "attention", derived: "weeks" },
        {
          label: "Phases in parallel",
          tone: "healthy",
          value:
            "Phases 1–3 overlap by design — Compliance labelling begins while Governance sharing work continues, since both touch the same sites",
        },
        {
          label: "Strictly sequential",
          tone: "attention",
          value: "Phases 4–6 · enablement cannot precede validation, certification cannot precede either",
        },
        {
          label: "Change windows",
          tone: "attention",
          value:
            "2 change windows — legacy authentication retirement (1 week notice) and device compliance enforcement (3 days, 88 devices)",
        },
        {
          label: "Change control",
          tone: "healthy",
          value:
            "Conditional Access and DLP changes enter report-only or review mode first. No enforcement without an observation period.",
        },
      ],
    },
    {
      heading: "3 · Statement of Work Telemetry",
      rows: [
        { label: "Findings in scope", tone: "attention", derived: "findings" },
        { label: "Objective target", tone: "attention", derived: "projected" },
        { label: "Elapsed time since assessment", tone: "healthy", value: "12 days" },
        { label: "Critical path duration", tone: "attention", derived: "weeks" },
        {
          label: "Telemetry source",
          tone: "healthy",
          value: "Microsoft Graph API · read-only delegated permissions · 3 August 2026",
        },
      ],
    },
    {
      heading: "4 · Commercial Terms",
      rows: [
        { label: "Professional services", tone: "healthy", derived: "total" },
        { label: "New budget required", tone: "attention", derived: "newBudget" },
        { label: "Licence waste recovered", tone: "healthy", value: "$18,400 a year, available from month one" },
        { label: "Net year one impact", tone: "healthy", derived: "netYear" },
        {
          label: "Payment terms",
          tone: "healthy",
          value: "40% deposit at signature · balance invoiced per phase on your sign-off · 14 days net",
        },
        {
          label: "Validity",
          tone: "attention",
          value: "Quoted pricing holds until 2 September 2026, after which a fresh scan is required",
        },
      ],
    },
    {
      heading: "5 · Governance Gate Status",
      rows: [
        { label: "Copilot Gate", tone: "critical", derived: "gateLabel" },
        { label: "Gate percentage", tone: "attention", derived: "projected" },
      ],
    },
    {
      heading: "7 · Findings by Pillar (Carried Into Scope)",
      intro:
        "Every finding above traces to a named check in the assessment. Nothing in this scope was authored — it is the assessment output, carried forward.",
      rows: [],
    },
  ] satisfies readonly SowSection[],

  /** Section 5's blockers — the six findings holding the gate shut. */
  blockers: [
    { pillar: "governance", text: "212 sites shared org-wide, four holding HR and finance content" },
    { pillar: "governance", text: "2,940 anonymous links with no expiry" },
    { pillar: "security", text: "4 Global Administrators without MFA" },
    { pillar: "security", text: "No Conditional Access policy scoped to privileged roles" },
    { pillar: "compliance", text: "No DLP policy covering Teams chat" },
    { pillar: "compliance", text: "61% of content carrying no sensitivity label" },
  ] satisfies readonly { readonly pillar: PillarKey; readonly text: string }[],

  /** Section 7. Ordered by finding count, the way the design ranks them. */
  carry: [
    {
      pillar: "governance",
      count: 9,
      detail: "212 org-wide sites, 2,940 anonymous links, 148 inactive sites, 61 public channels, no lifecycle policy",
    },
    {
      pillar: "security",
      count: 8,
      detail: "14 accounts without MFA, 11 standing Global Admins, legacy auth enabled, 88 non-compliant devices",
    },
    {
      pillar: "compliance",
      count: 7,
      detail: "no DLP on Teams chat, 61% unlabelled, retention on 3 of 9 workloads, 90-day audit retention",
    },
    {
      pillar: "health",
      count: 6,
      detail: "37 unreviewed changes, no configuration baseline, 214 OneDrive sync errors, 19 orphaned channels",
    },
    {
      pillar: "adoption",
      count: 6,
      detail: "412 users dormant 30+ days, 31% OneDrive activation, four competing procurement patterns",
    },
    {
      pillar: "licensing",
      count: 5,
      detail: "$18,400 annual waste, 22 dormant Copilot seats, 47 SKU mismatches, 96 users needing E5",
    },
  ] satisfies readonly SowPillarCarry[],

  /** Section 6, keyed to the numbered sections above. */
  deliverables: [
    { section: "1 · Scope & Objective", detail: "41 findings carried into scope · deliverable: agreed objective and gate target" },
    { section: "2 · Approach & Sequence", detail: "Dependency order and 2 change windows · deliverable: signed sequence plan" },
    { section: "3 · SOW Telemetry", detail: "158 signal checks · deliverable: re-scan evidence per phase sign-off" },
    { section: "4 · Commercial Terms", detail: "deliverable: fixed-fee delivery against agreed phases" },
    {
      section: "5 · Governance Gate Status",
      detail: "6 findings holding it below the threshold · deliverable: gate validation and readiness certification",
    },
    {
      section: "7 · Findings by Pillar",
      detail: "41 findings across six pillars · deliverable: full traceability from every finding to the phase that clears it",
    },
    { section: "8 · Phase Breakdown & Scope", detail: "deliverable: findings remediated, verified and signed off" },
  ],

  timeline: {
    heading: "Delivery Timeline & Deliverables",
    intro:
      "Phases 1 to 3 overlap by design — Compliance labelling begins while Governance sharing work continues, since both touch the same sites. Phases 4 to 6 are strictly sequential. The schedule below recalculates as you set scope.",
    /** Per-phase deliverables, in `PREVIEW_PHASES` order. */
    deliverables: [
      "CA policy set, MFA evidence pack, guest removal log",
      "Sharing revocation report, lifecycle policy, owner attestations",
      "Label taxonomy, DLP policy set, auto-labelling rules",
      "Reclaim report, E5 uplift model, renewal calendar",
      "Enablement sessions, persona playbooks, usage baseline",
      "Signed configuration baseline, change-review runbook, handover pack",
    ],
  },

  phases: {
    heading: "8 · Phase Breakdown & Scope",
    intro:
      "Phase 1 is required and cannot be removed — it is the identity work that must land before Copilot is enabled for anyone. The remaining five are your scope decision, and the totals below move as you set them.",
  },

  signature: {
    unsignedEyebrow: "Authorise this scope",
    signedEyebrow: "Executed agreement",
    unsignedBlurb:
      "Set your scope using the phase toggles below. Once you sign, that selection is fixed and the toggles stop working.",
    signedBlurb:
      "This agreement is executed. The phase selection below is fixed as signed and can no longer be changed — any variation requires a written amendment.",
    consent: "I am authorised to commit Halden Materials to this scope and these terms.",
    unsignedCta: "Confirm authorisation to sign",
    signedCta: "Sign and lock this scope",
  },

  /**
   * The design credits the already-paid assessment fee against the professional
   * services total, but only when every phase is taken. Shown as its own line
   * rather than folded into `computeTotals`, so the standalone proposal screen's
   * figures are not silently changed by a contract rule this document introduces.
   */
  fullScopeCredit: {
    amountUsd: 5000,
    note: "Includes the $5,000 assessment fee you have already paid, credited in full.",
  },

  /** The E5 uplift the remediation depends on, and the waste that offsets it. */
  budget: { upliftUsd: 27600, recoveredUsd: 18400 },
} as const;
