/**
 * cmpDashboardData.ts — the Compliance pillar dashboard fixture.
 *
 * Transcribed from the prototype's own Compliance logic
 * (`Customer Portal Shell.dc.html` lines 12004-12260), read independently of the
 * Governance and Security fixtures.
 *
 * ── The README is RIGHT about this pillar, and it was wrong about the others ─
 * Governance and Security both build a `*Rows` array of findings that no
 * template ever consumes, which is why neither page renders finding rows. This
 * pillar is the opposite: `cmpFindingRows` IS rendered (proto 3956-4005), and it
 * is the richest section on the page — an id, a severity chip, the obligation it
 * touches in mono, and an expansion carrying the obligation text, why it matters
 * here, a key/value evidence grid, a wrench into the CR gate, and a "record a
 * policy decision instead" route. Two further sections have no counterpart on
 * any other pillar: Documented Policy Decisions (4013-4046) and Obligations We
 * Check Against (4048-4062).
 *
 * ── Compliance is the neutral pillar, deliberately ──────────────────────────
 * Every other pillar has an identity colour that carries the page. Compliance's
 * is `#F3F4F6`/`#E2E8F0` — near-white — and the design leans into it: an inset
 * top highlight on every panel (`cmpInset`), three-stop glows rather than two,
 * and a status pill that is a DOT rather than a warning glyph. The page reads as
 * paperwork rather than alarm, which is its own copy's point: "Nothing on this
 * page is being exploited today."
 *
 * ── Design content, not tenant data ─────────────────────────────────────────
 * The prototype's fictional Halden Materials figures, in one module so the swap
 * to live values stays a single-file change.
 */

export type CmpAreaStatus = "red" | "yellow" | "green";
export type CmpSeverity = "high" | "medium";
export type CmpObligationTone = "red" | "amber" | "green" | "slate";

/** `cmpInset` (12004) — the top highlight on every Compliance panel. */
export const CMP_INSET = "inset 0 1px 0 rgba(255,255,255,.07)";

/** Hero scalars — 12006, 17529-17530, and the literals inline in the markup. */
export const CMP_HERO = {
  score: 78,
  /** Hardcoded in the ring markup (3872), not a binding — it is not derived. */
  delta: "±0 this month",
  title: "Compliance Health",
  subtitle: "Compliance pillar score from your latest scan",
  /** The pill is a DOT plus this label (3833-3834), not a ⚠ plus a word. */
  statusLabel: "Stable · 6 gaps open",
  /** The trend's own label — "Gaps closed", NOT "Drift trend". */
  trendLabel: "Gaps closed · last 10 scans",
  /** A caption BELOW the baseline rule (3855). Security's verdict is ABOVE the chart. */
  trendCaption:
    "Eight points over ten scans. Compliance improves by closing gaps, not by repelling attacks.",
  /** The scan strip's own sentence (3894) — "gaps closed", and ", none reopened". */
  scanNumber: 14,
  gapsClosedSinceScan1: 5,
  lastScan: "2 hours ago",
  nextScan: "22 hours",
} as const;

export const CMP_HISTORY: readonly number[] = [70, 71, 71, 72, 74, 74, 75, 77, 78, 78];

/** The three hero stats (3875-3893). All three left-borders are #E2E8F0. */
export const CMP_HERO_STATS: readonly { label: string; value: string; sub: string }[] = [
  {
    label: "Retention Coverage",
    value: "99.0%",
    sub: "12 of 1,240 mailboxes uncovered",
  },
  {
    label: "Audit Retention",
    value: "180 days",
    sub: "Audit Standard ceiling · not extendable",
  },
  {
    label: "Open Gaps",
    value: "6",
    sub: "Plus 2 documented decisions",
  },
];

/** `cmpScrutiny` (12023-12027) — the "Why this pillar reads differently" cards. */
export const CMP_SCRUTINY: readonly { moment: string; when: string; what: string }[] = [
  {
    moment: "An audit",
    when: "Scheduled, months out",
    what: "The auditor asks for the retention schedule and evidence it has been enforced without interruption. A gap that opened 8 months ago is still a gap in the record — it cannot be backfilled.",
  },
  {
    moment: "A legal hold",
    when: "Days of notice, sometimes none",
    what: "Preservation obligations attach the moment litigation is reasonably anticipated. Anything already deleted under a too-short policy is simply gone, and the deletion itself becomes discoverable.",
  },
  {
    moment: "A breach investigation",
    when: "No notice at all",
    what: "Reconstruction depends on audit records older than the incident. At 180 days of audit retention, the trail expires before most intrusions are even discovered.",
  },
];

export const CMP_INTRO_LABEL = "Why this pillar reads differently";
export const CMP_INTRO_BODY =
  "Nothing on this page is being exploited today. Each item is a fact about your tenant that becomes consequential at a specific moment — and at that moment, none of it can be fixed retroactively. Retention only preserves from the day it is applied. Audit records only exist for as long as the policy in force when they were written.";

/**
 * `cmpAreaRaw` (12030-12044). Note `finding`: it is an INDEX into the Open Gaps
 * list, not an id — a card with one scrolls/expands that gap rather than
 * navigating, and a card without one is not clickable at all (`cursor:default`).
 * That is why the cards are not uniformly links here, unlike Governance's.
 */
export interface CmpAreaLink {
  key: string;
  label: string;
  score: number;
  prevScore: number;
  sub: string;
  icon: string;
  cluster: string;
  /** Index into CMP_FINDINGS. Absent means the card is inert. */
  finding?: number;
  status: CmpAreaStatus;
}

export const CMP_AREA_LINKS: readonly CmpAreaLink[] = [
  { key: "compliance-retention-coverage", label: "Retention Coverage", score: 12, prevScore: 17, sub: "mailboxes uncovered", icon: "clipboard-list", cluster: "Data Lifecycle", finding: 0, status: "red" },
  { key: "compliance-retention-labels", label: "Retention Labels", score: 3, prevScore: 3, sub: "of 9 schedule categories built", icon: "file-text", cluster: "Data Lifecycle", status: "yellow" },
  { key: "compliance-disposition", label: "Disposition Review", score: 1940, prevScore: 1610, sub: "items past their period", icon: "scale", cluster: "Data Lifecycle", finding: 4, status: "red" },
  { key: "compliance-preservation-lock", label: "Preservation Lock", score: 0, prevScore: 0, sub: "of 1 policy locked", icon: "lock", cluster: "Data Lifecycle", finding: 2, status: "red" },
  { key: "compliance-sensitivity-labels", label: "Sensitivity Labels", score: 0, prevScore: 0, sub: "of 4 planned published", icon: "shield-check", cluster: "Information Protection", finding: 3, status: "red" },
  { key: "compliance-autolabel", label: "Auto-labelling", score: 3412, prevScore: 3180, sub: "documents match, none labelled", icon: "layers", cluster: "Information Protection", status: "red" },
  { key: "compliance-dlp", label: "DLP Coverage", score: 2, prevScore: 4, sub: "workloads without a policy", icon: "shield-off", cluster: "Information Protection", status: "yellow" },
  { key: "compliance-audit-retention", label: "Audit Retention", score: 180, prevScore: 180, sub: "days — Standard ceiling", icon: "clipboard-list", cluster: "Audit & Evidence", finding: 1, status: "red" },
  { key: "compliance-audit-coverage", label: "Audit Coverage", score: 2, prevScore: 5, sub: "workloads not ingesting", icon: "activity", cluster: "Audit & Evidence", status: "yellow" },
  { key: "compliance-admin-trail", label: "Admin Activity Trail", score: 0, prevScore: 1, sub: "gaps in the last 90 days", icon: "check-circle", cluster: "Audit & Evidence", status: "green" },
  { key: "compliance-holds", label: "Stale Legal Holds", score: 2, prevScore: 2, sub: "holds from closed matters", icon: "scale", cluster: "Legal Hold & Records", finding: 5, status: "yellow" },
  { key: "compliance-litigation-hold", label: "Litigation Hold", score: 41, prevScore: 41, sub: "mailboxes on indefinite hold", icon: "lock", cluster: "Legal Hold & Records", status: "yellow" },
  { key: "compliance-records", label: "Records Declaration", score: 0, prevScore: 0, sub: "labels marked as records", icon: "file-text", cluster: "Legal Hold & Records", status: "red" },
  { key: "compliance-dsr", label: "Subject Requests", score: 4, prevScore: 2, sub: "open, oldest at day 19", icon: "users", cluster: "Legal Hold & Records", status: "yellow" },
];

export const CMP_CLUSTERS: readonly string[] = [
  "Data Lifecycle",
  "Information Protection",
  "Audit & Evidence",
  "Legal Hold & Records",
];

/**
 * `statusMeta` inside `cmpAreaLinks` (12046-12050). The LABELS are Compliance's
 * own — "Gap open" / "Partially covered" / "Documented and covered", against
 * Governance's "Not yet addressed" / "Partially addressed" / "Fully covered".
 * Same three states, different vocabulary, because this pillar is about records
 * rather than remediation.
 */
export const CMP_STATUS_META: Readonly<
  Record<CmpAreaStatus, { c: string; label: string; tier: "large" | "medium" | "small"; grow: number }>
> = {
  red: { c: "#f87171", label: "Gap open", tier: "large", grow: 3 },
  yellow: { c: "#c2a63d", label: "Partially covered", tier: "medium", grow: 2 },
  green: { c: "#34d399", label: "Documented and covered", tier: "small", grow: 1 },
};

/** `w` (12051). Note the score sizes are 24/19/16 — Governance's are 26/20/17. */
export const CMP_TIER = {
  large: { pad: "15px", icon: 16, score: 24, label: 12 },
  medium: { pad: "11px", icon: 13, score: 19, label: 11 },
  small: { pad: "9px", icon: 11, score: 16, label: 10 },
} as const;

/** The per-card derived values (12052-12057, 12077-12079). */
export function cmpAreaGeometry(a: CmpAreaLink) {
  const meta = CMP_STATUS_META[a.status];
  const delta = a.score - a.prevScore;
  const deltaColor =
    a.status === "green" ? "#64748b" : delta > 0 ? "#f87171" : delta < 0 ? "#34d399" : "#64748b";
  const deltaText = delta > 0 ? `+${delta}` : delta < 0 ? `${delta}` : "±0";
  const sparkVals = Array.from(
    { length: 4 },
    (_, i) => a.prevScore + (a.score - a.prevScore) * (i / 3),
  );
  const sMin = Math.min(...sparkVals);
  const sMax = Math.max(...sparkVals, sMin + 1);
  const sparkBars = sparkVals.map((v, i) => ({
    height: Math.max(3, Math.round(((v - sMin) / (sMax - sMin)) * 16)),
    opacity: i === 3 ? 1 : 0.4,
  }));
  return { meta, deltaText, deltaColor, sparkBars };
}

/* ── Open Gaps — CMP_FINDINGS (12085-12149) ───────────────────────────────── */

export interface CmpFinding {
  id: string;
  title: string;
  sev: CmpSeverity;
  obligation: string;
  obligationText: string;
  why: string;
  evidence: { k: string; v: string }[];
  fixKey: string;
  fixLabel: string;
  fixSub: string;
}

/** `cmpSevMeta` (12164). */
export const CMP_SEV_META: Readonly<Record<CmpSeverity, { c: string; label: string }>> = {
  high: { c: "#f87171", label: "Material gap" },
  medium: { c: "#c2a63d", label: "Gap" },
};

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

/* ── Documented Policy Decisions — CMP_ACCEPTED (12150-12163) ─────────────── */

export interface CmpAccepted {
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

export const CMP_ACCEPTED: readonly CmpAccepted[] = [
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

/** The 2×2 meta grid on each decision card (12199-12205). */
export function cmpAcceptedMeta(a: CmpAccepted) {
  return [
    { k: "Approved by", v: a.owner },
    { k: "Approved", v: a.approved },
    { k: "Next review", v: a.review },
    { k: "Risk register", v: a.register },
  ];
}

/* ── Obligations We Check Against — CMP_OBLIGATIONS (12207-12215) ─────────── */

export interface CmpObligation {
  framework: string;
  scope: string;
  requires: string;
  state: string;
  tone: CmpObligationTone;
}

export const CMP_OBLIGATION_TONE: Readonly<Record<CmpObligationTone, string>> = {
  red: "#f87171",
  amber: "#c2a63d",
  green: "#34d399",
  slate: "#64748b",
};

export const CMP_OBLIGATIONS: readonly CmpObligation[] = [
  { framework: "SOX §802 · 17 CFR 210.2-06", scope: "In scope", requires: "Seven-year retention of records relating to an audit or review.", state: "2 findings open — retention coverage and preservation lock", tone: "red" },
  { framework: "SEC 17a-4(f) · FINRA 4511", scope: "In scope", requires: "Non-rewritable, non-erasable retention, or the 2022 audit-trail alternative with reconstructable versions.", state: "Preservation Lock not applied; audit retention below the reconstruction window", tone: "red" },
  { framework: "GDPR Art. 5(1)(e) · Art. 32", scope: "In scope", requires: "Storage limitation, and technical measures appropriate to the risk.", state: "Over-retention on 1,940 items; no classification published", tone: "red" },
  { framework: "GDPR Art. 15 · subject access", scope: "In scope", requires: "Response within one month of the request.", state: "4 open requests, oldest at day 19 — inside the window", tone: "amber" },
  { framework: "HIPAA §164.316(b)(2)(i)", scope: "In scope", requires: "Six-year retention of required documentation, including audit records.", state: "Audit retention at 180 days against a 6-year requirement", tone: "red" },
  { framework: "GDPR Art. 30 · records of processing", scope: "In scope", requires: "A maintained record of processing activities.", state: "Maintained and current, last reviewed 6 weeks ago", tone: "green" },
  { framework: "PCI DSS v4.0", scope: "Marked out of scope", requires: "Applies only if you store, process, or transmit cardholder data.", state: "You marked this out of scope in onboarding. Tell us if that changed and every check re-evaluates.", tone: "slate" },
];

/** `cmpOpenCount` / `cmpAcceptedCount` (17529-17530) — lengths, not literals. */
export const CMP_OPEN_COUNT = CMP_FINDINGS.length;
export const CMP_ACCEPTED_COUNT = CMP_ACCEPTED.length;
