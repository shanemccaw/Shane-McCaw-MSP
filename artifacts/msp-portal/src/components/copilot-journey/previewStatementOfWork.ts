/**
 * previewStatementOfWork.ts — document 9 of 9, the contract copy.
 *
 * The SOW's *numbers* are not here. Every figure the customer signs against —
 * the fee, the weeks, the phase count, the projected score — is computed by
 * `journeyPricing.ts` from the active scope, the same module and the same
 * phase/add-on data the standalone proposal screen uses. Two surfaces over one
 * agreement must not be able to disagree about what it costs, so only one of
 * them is allowed to do arithmetic, and it is not this file.
 *
 * What lives here is the contract's prose: the eight numbered sections, the
 * findings-by-pillar carry-over, the deliverable summary and the terms.
 * `STATEMENT_OF_WORK` itself, `PREVIEW_*` inputs aside, is verbatim from
 * `Design/Document Viewer.dc.html` — reachable only behind `?preview=design`,
 * where `Halden Materials` / `SMC-HM-2026-0803` are the design's own worked
 * example, not a live tenant's data.
 *
 * ── WHAT #292 (SOW) CHANGED ──────────────────────────────────────────────────
 * A handful of rows stated a figure that only exists for Halden Materials — a
 * site count, an elapsed-days count, an E5 uplift budget, a 40%-deposit payment
 * schedule — with no real producer behind it for another tenant. Those rows
 * moved from a static `value` to a `derived` kind so `StatementOfWorkBody.tsx`
 * can resolve them from real data on a live journey, and reproduce the exact
 * design figure in preview (the switch's `isPreview` branch is the verbatim
 * design text, unchanged). See each `derived` case in `StatementOfWorkBody.tsx`
 * for what is real and what is an honest declared gap.
 */

import type { PillarKey, Severity } from "./journeyTokens.ts";

export interface SowRow {
  readonly label: string;
  readonly tone: Severity;
  /** Omitted where the value is computed from the live scope at render time. */
  readonly value?: string;
  /** Names the derived figure the renderer substitutes. */
  readonly derived?:
    | "total"
    | "projected"
    | "findings"
    | "phaseCount"
    | "weeks"
    | "newBudget"
    | "netYear"
    | "gateLabel"
    | "objective"
    | "findingsCarried"
    | "whyMatters"
    | "basisOfScope"
    | "changeWindows"
    | "elapsedDays"
    | "telemetrySource"
    | "wasteRecovered"
    | "paymentTerms"
    | "validity";
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

/** `SOW-{docId}` — the platform's only existing stable per-agreement id (`sow_documents.id`, carried on both `GET .../sow` and `.../sow/payment-options` as `doc.id` / `docId`). No other document-reference scheme exists anywhere in this platform (checked: no `agreementNumber`, `contractNumber` or similar). `null` before a SOW document exists for this tenant. */
export function sowReference(docId: number | null): string {
  return docId !== null ? `SOW-${docId}` : "SOW-DRAFT";
}

export function sowKicker(reference: string): string {
  return `Statement of work · ${reference}`;
}

export function sowHeadline(tenantName: string): string {
  return `Copilot Gate clearance for ${tenantName}`;
}

export function sowStandfirst(scannedOn: string | null): string {
  return `A contract artifact. Every finding, figure and phase below is carried from ${
    scannedOn ? `the assessment of ${scannedOn}` : "your tenant's own assessment"
  } — nothing here is authored for presentation.`;
}

export function sowConsent(tenantName: string): string {
  return `I am authorised to commit ${tenantName} to this scope and these terms.`;
}

/** Section 6's deliverable summary — the two rows that named a figure elsewhere in the contract take it as a parameter rather than repeating a number that could drift from it. */
export function sowDeliverables(ctx: {
  readonly findingsLabel: string;
  readonly blockersLabel: string;
}): readonly { readonly section: string; readonly detail: string }[] {
  return [
    { section: "1 · Scope & Objective", detail: `${ctx.findingsLabel} carried into scope · deliverable: agreed objective and gate target` },
    { section: "2 · Approach & Sequence", detail: "Dependency order and named change windows · deliverable: signed sequence plan" },
    { section: "3 · SOW Telemetry", detail: "Deliverable: re-scan evidence per phase sign-off" },
    { section: "4 · Commercial Terms", detail: "deliverable: fixed-fee delivery against agreed phases" },
    {
      section: "5 · Governance Gate Status",
      detail: `${ctx.blockersLabel} holding it below the threshold · deliverable: gate validation and readiness certification`,
    },
    {
      section: "7 · Findings by Pillar",
      detail: `${ctx.findingsLabel} across six pillars · deliverable: full traceability from every finding to the phase that clears it`,
    },
    { section: "8 · Phase Breakdown & Scope", detail: "deliverable: findings remediated, verified and signed off" },
  ];
}

export const STATEMENT_OF_WORK = {
  sections: [
    {
      heading: "1 · Scope & Objective",
      intro:
        "The objective of this engagement is to clear the Copilot Gate for your tenant — moving readiness to at or above the required threshold — by remediating the findings surfaced in your assessment.",
      rows: [
        { label: "The objective", tone: "attention", derived: "objective" },
        { label: "Findings carried into scope", tone: "critical", derived: "findingsCarried" },
        { label: "Why this matters", tone: "critical", derived: "whyMatters" },
        { label: "Basis of scope", tone: "healthy", derived: "basisOfScope" },
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
        { label: "Change windows", tone: "attention", derived: "changeWindows" },
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
        { label: "Elapsed time since assessment", tone: "healthy", derived: "elapsedDays" },
        { label: "Critical path duration", tone: "attention", derived: "weeks" },
        { label: "Telemetry source", tone: "healthy", derived: "telemetrySource" },
      ],
    },
    {
      heading: "4 · Commercial Terms",
      rows: [
        { label: "Professional services", tone: "healthy", derived: "total" },
        { label: "New budget required", tone: "attention", derived: "newBudget" },
        { label: "Licence waste recovered", tone: "healthy", derived: "wasteRecovered" },
        { label: "Net year one impact", tone: "healthy", derived: "netYear" },
        { label: "Payment terms", tone: "healthy", derived: "paymentTerms" },
        { label: "Validity", tone: "attention", derived: "validity" },
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

  /** Section 5's blockers — the design's own worked-example list. Preview only; a live tenant's blockers are its own real critical findings, built in `StatementOfWorkBody.tsx`. */
  blockers: [
    { pillar: "governance", text: "212 sites shared org-wide, four holding HR and finance content" },
    { pillar: "governance", text: "2,940 anonymous links with no expiry" },
    { pillar: "security", text: "4 Global Administrators without MFA" },
    { pillar: "security", text: "No Conditional Access policy scoped to privileged roles" },
    { pillar: "compliance", text: "No DLP policy covering Teams chat" },
    { pillar: "compliance", text: "61% of content carrying no sensitivity label" },
  ] satisfies readonly { readonly pillar: PillarKey; readonly text: string }[],

  /** Section 7, preview only. Ordered by finding count, the way the design ranks them. A live tenant's carry table is built from its own real ranked findings in `StatementOfWorkBody.tsx`. */
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

  timeline: {
    heading: "Delivery Timeline & Deliverables",
    intro:
      "Phases 1 to 3 overlap by design — Compliance labelling begins while Governance sharing work continues, since both touch the same sites. Phases 4 to 6 are strictly sequential. The schedule below recalculates as you set scope.",
    /** Per-phase deliverables, in `PREVIEW_PHASES` order. Preview only — a live SOW workstream has a scope sentence but no per-phase deliverable list of its own. */
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
    unsignedCta: "Confirm authorisation to sign",
    signedCta: "Sign and lock this scope",
  },

  /**
   * The design credits the already-paid assessment fee against the professional
   * services total, but only when every phase is taken. Preview only: no check
   * this platform runs reads whether an assessment fee was paid or how much it
   * was, so a live tenant gets no credit rather than a guessed one.
   */
  fullScopeCredit: {
    amountUsd: 5000,
    note: "Includes the $5,000 assessment fee you have already paid, credited in full.",
  },

  /** The design's own E5 uplift/waste figures. Preview only — see `newBudget`/`netYear`'s live case in `StatementOfWorkBody.tsx` for why neither is asserted for a real tenant. */
  budget: { upliftUsd: 27600, recoveredUsd: 18400 },
} as const;
