/**
 * cmpDrilldownData.ts — the Compliance drill-down content.
 *
 * Transcribed VERBATIM from the prototype's `CMP_FINDINGS` (shell 13725),
 * `CMP_ACCEPTED` (13790) and `CMP_OBLIGATIONS` (13862). These feed the three
 * Compliance drill-downs:
 *   • Open gaps            (`isCmpGaps`, 4659-4730)      — CMP_FINDINGS
 *   • Documented decisions (`isCmpDecisions`, 4732-4781) — CMP_ACCEPTED
 *   • Obligations          (`isCmpObligations`, 4783-4814) — CMP_OBLIGATIONS
 *
 * Copy is final and written in Shane's voice; the handoff forbids rewriting,
 * shortening or "improving" any of it, so every string here is the prototype's
 * character-for-character.
 *
 * ── Design content, not tenant data ─────────────────────────────────────────
 * The frameworks, counts and named accounts are the prototype's fictional
 * Halden Materials tenant. The fixture lives here — one module — so the wiring
 * pass swaps it for the real Purview / Graph reads (`tenant_check_item_details`
 * plus the compliance engine) without touching the page.
 *
 * NOTE: this is NOT `cmpDashboardData.ts` (the pillar page's area tiles, Part
 * 2's) nor the fix playbooks in `cmpFixPlaybooks.ts` (also Part 2's). The
 * findings' `fixKey`s open the shared FixPanel, which resolves them from that
 * library or falls back to a complete generic flow — the same contract every
 * other drill-down uses.
 */

export type CmpSeverity = "high" | "medium";
export type CmpObligationTone = "red" | "amber" | "green" | "slate";

export interface CmpEvidence {
  k: string;
  v: string;
}

export interface CmpFinding {
  id: string;
  title: string;
  sev: CmpSeverity;
  obligation: string;
  obligationText: string;
  why: string;
  evidence: CmpEvidence[];
  fixKey: string;
  fixLabel: string;
  fixSub: string;
}

export interface CmpAcceptedDecision {
  id: string;
  title: string;
  decision: string;
  obligation: string;
  rationale: string;
  compensating: string;
  owner: string;
  approved: string;
  review: string;
  register: string;
  note: string;
}

export interface CmpObligation {
  framework: string;
  scope: string;
  requires: string;
  state: string;
  tone: CmpObligationTone;
}

/** `cmpSevMeta` (13804). */
export const CMP_SEV_META: Readonly<Record<CmpSeverity, { c: string; label: string }>> = {
  high: { c: "#f87171", label: "Material gap" },
  medium: { c: "#c2a63d", label: "Gap" },
};

/** The mono stack the prototype's `mono` helper expands to. */
export const CMP_MONO = "'SF Mono',Menlo,Consolas,monospace";

export const CMP_FINDINGS: readonly CmpFinding[] = [
  {
    id: "CMP-01",
    title: "12 mailboxes are not covered by any retention policy",
    sev: "high",
    obligation: "SOX §802 · 17 CFR 210.2-06",
    obligationText:
      "Records relating to an audit or review must be retained for seven years. A mailbox with no retention policy cannot demonstrate that period.",
    why: "Nothing preserves the contents of these 12 mailboxes. A user or an administrator can permanently delete anything in them today, and the deletion is irreversible once the recoverable-items window passes. Two of the 12 belong to the finance team, which is squarely inside the SOX scope you marked in onboarding.",
    evidence: [
      { k: "Where this comes from", v: "Purview Policy lookup, cross-checked against the full mailbox list from Graph" },
      { k: "Uncovered mailboxes", v: "12 of 1,240 — 2 finance, 1 legal, 4 contractor, 5 shared" },
      { k: "Oldest gap", v: "8 months. The finance mailboxes were created after the last policy scope update." },
      { k: "What is at risk", v: "Roughly 41 GB of mail with no preservation of any kind" },
      { k: "Retroactive fix", v: "None. Applying a policy today preserves from today forward. Anything already deleted is gone." },
    ],
    fixKey: "cmp-retention-coverage",
    fixLabel: "Apply an adaptive-scope retention policy that covers new mailboxes automatically",
    fixSub: "Adaptive scope, so this gap does not reopen the next time someone is onboarded",
  },
  {
    id: "CMP-02",
    title: "Audit log retention is 180 days — the ceiling on your current licence",
    sev: "high",
    obligation: "HIPAA §164.316(b)(2)(i) · SEC 17a-4(f) audit trail alternative",
    obligationText:
      "Documentation must be retained six years from creation. The 17a-4 audit-trail alternative expects audit records sufficient to reconstruct a particular version of a record.",
    why: "Audit Standard retains 180 days and cannot be extended. Most intrusions are discovered long after they begin, so the records needed to reconstruct what happened routinely expire before anyone knows to look for them. This is also the first thing a cyber insurer asks for after an incident.",
    evidence: [
      { k: "Current state", v: "Audit (Standard) · 180-day retention, tenant-wide, not configurable" },
      { k: "Available", v: "Audit (Premium) retains 1 year, with a 10-year add-on. Requires E5 or the Audit add-on licence." },
      { k: "Licence position", v: "You hold E3 plus the Compliance add-on on 41 seats, which does not include Audit Premium" },
      { k: "Practical effect", v: "Anything before 20 February 2026 is already unavailable to search" },
      { k: "Retroactive fix", v: "None. Extending retention applies to records generated from that point forward." },
    ],
    fixKey: "cmp-audit-retention",
    fixLabel: "Move to Audit (Premium) and set a 1-year retention policy",
    fixSub: "Includes the licence delta and which seats actually need it",
  },
  {
    id: "CMP-03",
    title: "The one retention policy you have is not protected by Preservation Lock",
    sev: "high",
    obligation: "SEC 17a-4(f)(2)(i)(B) · FINRA 4511",
    obligationText:
      "Records must be kept in a non-rewritable, non-erasable form. Preservation Lock is the control Microsoft documents as meeting this requirement in Microsoft 365.",
    why: "Without the lock, any Global Administrator can delete the policy or shorten its period, which means the retention claim cannot be proven to a regulator — the control is only as good as the last admin who chose not to change it. Six people hold Global Administrator in this tenant.",
    evidence: [
      { k: "Where this comes from", v: "Get-RetentionCompliancePolicy · RestrictiveRetention: False" },
      { k: "Who can change it today", v: "6 Global Administrators, 2 Compliance Administrators" },
      { k: "Licence requirement", v: "Preservation Lock requires E5 or the equivalent add-on" },
      { k: "Irreversibility", v: "A locked policy cannot be turned off, deleted, or made less restrictive by anyone, including Microsoft support. Periods can be extended, never shortened." },
      { k: "Sequencing", v: "Lock after the schedule is right, not before. This is the one finding where moving too fast is worse than moving slowly." },
    ],
    fixKey: "cmp-preservation-lock",
    fixLabel: "Apply Preservation Lock once the retention schedule is signed off",
    fixSub: "Deliberately gated behind a schedule review — the lock is permanent",
  },
  {
    id: "CMP-04",
    title: "No sensitivity labels are published — 0 of the 4 in your plan",
    sev: "high",
    obligation: "GDPR Art. 32(1) · appropriate technical measures",
    obligationText:
      "Controllers must implement measures appropriate to the risk, including measures to ensure confidentiality. Classification is the control every other measure keys off.",
    why: "Unlabelled content is indistinguishable to every downstream control. DLP has nothing to match on, encryption has nothing to attach to, and Copilot has no signal about what it should not surface. This is also one of the three findings currently holding the Copilot readiness gate closed.",
    evidence: [
      { k: "Where this comes from", v: "Get-Label · 4 labels created in the label store, 0 published to any user" },
      { k: "Labels drafted", v: "Public · Internal · Confidential · Highly Confidential — created 5 months ago, never published" },
      { k: "Documents affected", v: "3,412 documents match a sensitive information type with no label applied" },
      { k: "Downstream", v: "DLP policies referencing Confidential currently match nothing" },
    ],
    fixKey: "cmp-sensitivity-labels",
    fixLabel: "Publish the four labels with a default of Internal",
    fixSub: "Staged: publish, then default, then mandatory labelling",
  },
  {
    id: "CMP-05",
    title: "1,940 items have passed their retention period with no disposition review",
    sev: "medium",
    obligation: "GDPR Art. 5(1)(e) · storage limitation",
    obligationText:
      "Personal data must be kept no longer than necessary for the purpose it was collected for. Over-retention is a finding in its own right, not a safe default.",
    why: "Keeping data past its schedule is a violation in the same way deleting it early is. It also enlarges every breach: data you no longer need is still data an attacker can take. The count is rising — 1,610 last quarter, 1,940 now.",
    evidence: [
      { k: "Where this comes from", v: "Purview Records Management · Disposition · 1,940 items pending, 0 reviewed" },
      { k: "Oldest item", v: "3 years 4 months past its retention period" },
      { k: "Reviewer assigned", v: "None. Disposition review is enabled on the label but no reviewer is named." },
      { k: "Direction of travel", v: "+330 items this quarter" },
    ],
    fixKey: "cmp-disposition",
    fixLabel: "Name reviewers and run the first disposition cycle",
    fixSub: "Includes an exportable disposition record per item, which is what the auditor wants",
  },
  {
    id: "CMP-06",
    title: "Two In-Place Holds from a closed matter are still active on 6 mailboxes",
    sev: "medium",
    obligation: "FRCP 26(b)(1) proportionality · GDPR Art. 5(1)(c) minimisation",
    obligationText:
      "Preservation should be proportionate to the matter. A hold that outlives its matter keeps data alive with no legal basis and no owner.",
    why: "These holds preserve everything in those mailboxes indefinitely, including data that should have been disposed of two years ago. In a future matter, the same holds make it harder to argue your preservation is deliberate rather than accidental.",
    evidence: [
      { k: "Where this comes from", v: "Get-CaseHoldPolicy and Get-MailboxSearch · 2 holds, both from matter LIT-2023-04" },
      { k: "Matter status", v: "Closed 26 months ago per your legal team’s register" },
      { k: "Mailboxes affected", v: "6, including 2 that belong to departed employees" },
      { k: "Release authority", v: "Legal, not IT. This one needs a signed release before anything is removed." },
    ],
    fixKey: "cmp-stale-holds",
    fixLabel: "Prepare the hold release for legal sign-off",
    fixSub: "We prepare and evidence it; your counsel authorises the release",
  },
];

export const CMP_ACCEPTED: readonly CmpAcceptedDecision[] = [
  {
    id: "CMP-A1",
    title: "Teams chat retention set to 1 year rather than the 7-year records period",
    decision: "Documented policy decision",
    obligation: "Records schedule §4.2 · transitory communications",
    rationale:
      "Your records schedule classifies Teams chat as transitory communication rather than a record. The record copy of any decision lives in email or in the SharePoint document set, both of which carry the 7-year label.",
    compensating:
      "Email and SharePoint retention both set to 7 years with disposition review. Channel messages in the two regulated Teams are excluded from this decision and retained for 7 years.",
    owner: "General Counsel",
    approved: "14 March 2026",
    review: "14 March 2027",
    register: "RR-2026-011",
    note: "This is a legitimate policy position, recorded so that an auditor sees a decision with an owner and a review date rather than an unexplained gap.",
  },
  {
    id: "CMP-A2",
    title: "OneDrive retention excludes 14 contractor accounts",
    decision: "Documented policy decision",
    obligation: "GDPR Art. 5(1)(e) · storage limitation",
    rationale:
      "Contractor OneDrive content is deliberately not retained past engagement end. Deliverables are required to be filed in the client SharePoint site, which is covered by the 7-year label.",
    compensating:
      "Contract terms require deliverables in SharePoint before final invoice. Quarterly spot-check of 3 contractor sites, last run 2 weeks ago with no exceptions.",
    owner: "Controller",
    approved: "2 February 2026",
    review: "2 August 2026",
    register: "RR-2026-004",
    note: "Review date is 6 months rather than 12 because the contractor population changes frequently.",
  },
];

export const CMP_OBLIGATIONS: readonly CmpObligation[] = [
  { framework: "SOX §802 · 17 CFR 210.2-06", scope: "In scope", requires: "Seven-year retention of records relating to an audit or review.", state: "2 findings open — retention coverage and preservation lock", tone: "red" },
  { framework: "SEC 17a-4(f) · FINRA 4511", scope: "In scope", requires: "Non-rewritable, non-erasable retention, or the 2022 audit-trail alternative with reconstructable versions.", state: "Preservation Lock not applied; audit retention below the reconstruction window", tone: "red" },
  { framework: "GDPR Art. 5(1)(e) · Art. 32", scope: "In scope", requires: "Storage limitation, and technical measures appropriate to the risk.", state: "Over-retention on 1,940 items; no classification published", tone: "red" },
  { framework: "GDPR Art. 15 · subject access", scope: "In scope", requires: "Response within one month of the request.", state: "4 open requests, oldest at day 19 — inside the window", tone: "amber" },
  { framework: "HIPAA §164.316(b)(2)(i)", scope: "In scope", requires: "Six-year retention of required documentation, including audit records.", state: "Audit retention at 180 days against a 6-year requirement", tone: "red" },
  { framework: "GDPR Art. 30 · records of processing", scope: "In scope", requires: "A maintained record of processing activities.", state: "Maintained and current, last reviewed 6 weeks ago", tone: "green" },
  { framework: "PCI DSS v4.0", scope: "Marked out of scope", requires: "Applies only if you store, process, or transmit cardholder data.", state: "You marked this out of scope in onboarding. Tell us if that changed and every check re-evaluates.", tone: "slate" },
];
