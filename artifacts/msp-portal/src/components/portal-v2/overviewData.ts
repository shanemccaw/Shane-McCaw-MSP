/**
 * overviewData.ts — the Tenant health overview fixture.
 *
 * EXTRACTED MECHANICALLY from the prototype's own arrays
 * ('Customer Portal Shell.dc.html') by evaluating the literals, not retyped:
 *
 *   CR_PIPELINE       8142  →  OV_CR_PIPELINE
 *   MC_INCOMING       8149  →  OV_MC_INCOMING
 *   PJ_PHASES        15999  →  OV_PROJECT_PHASES
 *   POLICY_DECISIONS  8155  →  OV_POLICY_DECISIONS (the six fields this page reads)
 *
 * ── Why the page needed rebuilding ─────────────────────────────────────────
 * The round-one Overview was a score band, six rich pillar cards and a "Most
 * Urgent" list. The current design is a materially different page: a scan band
 * carrying drift chips and an evidence pack, a COMPACT six-across pillar strip,
 * and an "Everything in motion" section putting every pipeline in the tenant on
 * one screen. A copy-coverage audit put the old page at 44% of this design.
 *
 * ── What is real and what is fixture ───────────────────────────────────────
 * The pillar strip's SCORES ARE REAL — /api/portal/assessment/war-room-pillars
 * via usePortalV2Pillars, the same source the old page used. Everything in this
 * file is design content with no endpoint behind it, kept in ONE module so it
 * can be swapped, per the project's standing fixture rule.
 *
 * Three of the six "Everything in motion" lanes COULD be sourced live today —
 * accepted risks from riskRegisterData, hold windows from the runbooks API, and
 * change requests from /api/portal/change-control. They are deliberately not
 * wired here: each has a different shape, and reconciling three of them into one
 * lane model is its own piece of work rather than a detail of this page. Doing
 * it half-way would put half-real numbers beside fixture ones with nothing on
 * screen saying which is which.
 *
 * ── Design content, not tenant data ────────────────────────────────────────
 * The prototype's fictional Halden Materials tenant.
 */

/* ── Headline — prototype 20826-20828 ───────────────────────────────────── */

export const OV_HEADLINE_MAIN = "14 things are putting your tenant at risk. 3 are easy fixes.";

export const OV_HEADLINE_SUB =
  "Pulled from your last scan across all six pillars — ranked by real impact, not alphabetically.";

export const OV_LAST_SCAN = "2 hours ago";

/** The scan button's own suffix — prototype 396. */
export const OV_NEXT_SCAN = "next in 22h";

/* ── The scan band ──────────────────────────────────────────────────────── */

export interface OvDriftChip {
  num: string;
  label: string;
  tone: string;
  border: string;
  background: string;
}

/**
 * prototype 20829-20833.
 *
 * These answer "what MOVED", which is a different question from the pillar
 * scores below: a tenant can hold a flat score across a week in which three
 * things were fixed and one appeared.
 */
export const OV_DRIFT_CHIPS: readonly OvDriftChip[] = [
  { num: "3", label: "fixed this week", tone: "#34d399", border: "rgba(52,211,153,.28)", background: "rgba(52,211,153,.06)" },
  { num: "1", label: "new this week", tone: "#f87171", border: "rgba(248,113,113,.28)", background: "rgba(248,113,113,.06)" },
  { num: "5", label: "accepted as risk", tone: "#c2a63d", border: "rgba(194,166,61,.3)", background: "rgba(194,166,61,.07)" },
];

export interface OvEvidenceRow {
  title: string;
  finding: string;
  when: string;
  by: string;
}

/**
 * prototype 21151-21155.
 *
 * The band's argument is in its own copy: this is the artefact an auditor or a
 * cyber insurer asks for. Which is why every row carries WHEN the re-scan
 * confirmed the fix and WHO did it, not merely what changed — an unverified
 * claim of a fix is worth nothing to either reader.
 */
export const OV_EVIDENCE_ROWS: readonly OvEvidenceRow[] = [
  {
    title: "Legacy break-glass account disabled",
    finding: "Governance · stale admin account",
    when: "3 days ago",
    by: "auto-remediated",
  },
  {
    title: "Risky OAuth app consent revoked",
    finding: "Security · unreviewed app grant",
    when: "5 days ago",
    by: "Shane McCaw Consulting",
  },
  {
    title: "Conditional access gap closed for finance group",
    finding: "Security · MFA exemption",
    when: "6 days ago",
    by: "auto-remediated",
  },
];

/* ── Everything in motion ───────────────────────────────────────────────── */

export interface OvChangeRequest {
  id: string;
  title: string;
  stage: string;
  /** Days from today. NULL is unscheduled, which the lane draws as a word. */
  start: number | null;
  end: number | null;
  tone: string;
  dateLabel: string;
  note: string;
}

/**
 * prototype 8142.
 *
 * CR-0149 is the one that matters: `start` is null because nobody is
 * accountable for it, so it CANNOT be scheduled. The lane prints "Unscheduled"
 * rather than a bar — a blocked change with no date is exactly what the page
 * exists to surface, and giving it a speculative bar would hide it.
 */
export const OV_CR_PIPELINE: readonly OvChangeRequest[] = [
  {
    id: "CR-0117",
    title: "Disable legacy authentication tenant-wide",
    stage: "Deploying",
    start: -1,
    end: 0,
    tone: "#60a5fa",
    dateLabel: "Deploying now",
    note: "Closes the security finding on 1,106 MFA-bypassing sign-ins in the last 30 days.",
  },
  {
    id: "CR-0121",
    title: "Bring 12 mailboxes into retention",
    stage: "Deploying",
    start: -1,
    end: 0,
    tone: "#60a5fa",
    dateLabel: "Deploying now",
    note: "Closes the compliance retention-coverage gap.",
  },
  {
    id: "CR-0142",
    title: "Enforce CA-014 tenant-wide (block legacy auth)",
    stage: "Awaiting approval",
    start: 5,
    end: 5,
    tone: "#fbbf24",
    dateLabel: "25 Aug",
    note: "Waiting on Dan Whitlock to sign.",
  },
  {
    id: "CR-0149",
    title: "Convert Client Deliverables to private",
    stage: "Blocked",
    start: null,
    end: null,
    tone: "#f87171",
    dateLabel: "",
    note: "Nobody accountable yet — cannot be scheduled.",
  },
  {
    id: "CR-0147",
    title: "Restrict Teams external access",
    stage: "Draft",
    start: 13,
    end: 13,
    tone: "#94a3b8",
    dateLabel: "2 Sep",
    note: "",
  },
];

export interface OvMsChange {
  id: string;
  title: string;
  /** Days from today. */
  day: number;
  tone: string;
  dateLabel: string;
  note: string;
}

/** prototype 8149. */
export const OV_MC_INCOMING: readonly OvMsChange[] = [
  {
    id: "MC1051144",
    title: "Anonymous meeting join allowed by default",
    day: 6,
    tone: "#fbbf24",
    dateLabel: "26 Aug",
    note: "Lands 4 days into the ERP go-live freeze — no opt-out.",
  },
  {
    id: "MC1039902",
    title: "Conditional Access policy templates update",
    day: 16,
    tone: "#64748b",
    dateLabel: "5 Sep",
    note: "Informational only, no action needed.",
  },
  {
    id: "MC1042318",
    title: "Basic authentication permanently disabled in Exchange Online",
    day: 42,
    tone: "#f87171",
    dateLabel: "1 Oct",
    note: "Enforced regardless of CR-0117 — Microsoft does not observe your change window.",
  },
];

export type OvPhaseStatus = "complete" | "active" | "blocked" | "pending";

export interface OvProjectPhase {
  n: number;
  name: string;
  dates: string;
  status: OvPhaseStatus;
  done: number;
  total: number;
  summary: string;
  deliverables: readonly string[];
  note: string;
}

/** prototype 15999. The overview draws the first five. */
export const OV_PROJECT_PHASES: readonly OvProjectPhase[] = [
  {
    n: 1,
    name: "Discovery & data inventory",
    dates: "4 – 13 Aug",
    status: "complete",
    done: 4,
    total: 4,
    summary:
      "Every site, mailbox and Teams channel in scope inventoried, with the oversharing baseline that phase 2 was planned against.",
    deliverables: ["Tenant data inventory report", "Oversharing exposure baseline"],
    note: "Signed off 13 Aug at the findings workshop. Both deliverables accepted without comment.",
  },
  {
    n: 2,
    name: "Governance & remediation plan",
    dates: "11 – 20 Aug",
    status: "complete",
    done: 5,
    total: 5,
    summary:
      "The remediation plan for the 412 sites in scope, sequenced so the pilot can proceed before the wider tenant is touched.",
    deliverables: ["Governance remediation plan"],
    note: "Delivered 20 Aug. Work complete on our side; the deliverable is with you for approval, which is tracked as a task rather than an open phase.",
  },
  {
    n: 3,
    name: "Pilot group configuration",
    dates: "18 Aug – 5 Sep",
    status: "active",
    done: 2,
    total: 6,
    summary:
      "Configuring the pilot tenant baseline, sharing controls and label pilot for the 24 named users.",
    deliverables: ["Pilot tenant configuration", "Sensitivity label pilot"],
    note: "Four of six tasks are running. Two cannot finish without the named pilot user list, which is a day overdue with you.",
  },
  {
    n: 4,
    name: "Enablement & training",
    dates: "1 – 12 Sep",
    status: "blocked",
    done: 0,
    total: 3,
    summary: "Enablement pack and two live training sessions for the pilot group.",
    deliverables: ["Enablement material pack", "Two training sessions delivered"],
    note: "Cannot be scheduled. Trainer and room need 10 working days notice, and the dates have not come back. If dates are not confirmed by 28 Aug the phase 5 date moves.",
  },
  {
    n: 5,
    name: "Readiness report & handover",
    dates: "15 – 26 Sep",
    status: "pending",
    done: 0,
    total: 2,
    summary:
      "The readiness report, scored against the assessment criteria in the SOW, and the handover session.",
    deliverables: ["Copilot readiness report", "Handover session"],
    note: "Not started. Depends on phase 4 completing; the end date has no float in it.",
  },
];

/* ── Project gantt geometry — prototype 16240-16244 ─────────────────────── */

/** Day index of "today" on the project window. */
export const PJ_TODAY = 19;

/** The window is 63 days; `pct(d) = d / PJ_WIN * 100`. */
export const PJ_WIN = 63;

export const PJ_SPANS: Readonly<Record<number, readonly [number, number]>> = {
  1: [0, 9],
  2: [7, 16],
  3: [14, 32],
  4: [28, 39],
  5: [42, 53],
};

/**
 * Phases 4 and 5 carry a SLIP band — a dashed hatch showing where the phase was
 * meant to sit, drawn beside where it now does. Only two phases have one, and
 * the page is honest about that rather than drawing an empty band on the rest.
 */
export const PJ_SLIPS: Readonly<Record<number, readonly [number, number]>> = {
  4: [39, 46],
  5: [53, 60],
};

/** The contract's end date, drawn as a hard line — prototype 16265, day 53. */
export const PJ_CONTRACT_END = 53;

export const PJ_WEEKS: readonly string[] = [
  "4 Aug",
  "11 Aug",
  "18 Aug",
  "25 Aug",
  "1 Sep",
  "8 Sep",
  "15 Sep",
  "22 Sep",
  "29 Sep",
];

/** The two week columns the design highlights as "now" — prototype 16246. */
export const PJ_CURRENT_WEEKS: readonly number[] = [2, 3];

export const PJ_PHASE_TONE: Readonly<Record<OvPhaseStatus, string>> = {
  complete: "#34d399",
  active: "#60a5fa",
  blocked: "#f87171",
  pending: "#64748b",
};

/* ── Policy decisions ───────────────────────────────────────────────────── */

export type OvPolicyState = "proposed" | "live" | "due" | "expired";

export interface OvPolicyDecision {
  id: string;
  state: OvPolicyState;
  title: string;
  check: string;
  approved: string;
  review: string;
}

/**
 * prototype 8155, reduced to the six fields this page's lane reads.
 *
 * GOV-A4's `check` is the sharpest line on the page and is why the lane exists:
 * "Expired 103 days ago ... This now reads as neglect rather than a decision."
 */
export const OV_POLICY_DECISIONS: readonly OvPolicyDecision[] = [
  {
    id: "CMP-A1",
    state: "live",
    title: "Teams chat retention set to 1 year rather than the 7-year records period",
    check: "Compensating control verified on the last scan.",
    approved: "14 March 2026",
    review: "14 March 2027",
  },
  {
    id: "CMP-A2",
    state: "due",
    title: "OneDrive retention excludes 14 contractor accounts",
    check:
      "Review date passed 18 days ago. The contractor population has changed by 4 people since the decision was signed.",
    approved: "2 February 2026",
    review: "2 August 2026",
  },
  {
    id: "SEC-A3",
    state: "proposed",
    title: "Legacy authentication left enabled for 11 Bay 3 scanners",
    check: "Waiting on Priya Raman. Raised 6 days ago from CMP-03.",
    approved: "Not yet signed",
    review: "Set on approval",
  },
  {
    id: "GOV-A4",
    state: "expired",
    title: "Guest access reviews deferred until the Entra P2 licences land",
    check:
      "Expired 103 days ago and the compensating control has not run since March. This now reads as neglect rather than a decision.",
    approved: "9 November 2025",
    review: "9 May 2026",
  },
];

export const PD_TONE: Readonly<Record<OvPolicyState, string>> = {
  proposed: "#fbbf24",
  live: "#34d399",
  due: "#f97316",
  expired: "#f87171",
};

/** The label a decision's lane shows when it has never been signed — 17451. */
export const PD_UNSIGNED = "Not yet signed";
