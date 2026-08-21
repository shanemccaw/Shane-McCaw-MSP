/**
 * overviewData.ts — the Tenant health overview fixture.
 *
 * EXTRACTED MECHANICALLY from the prototype's own arrays
 * ('Customer Portal Shell.dc.html') by evaluating the literals, not retyped:
 *
 *   CR_PIPELINE       8142  →  OV_CR_PIPELINE
 *   MC_INCOMING       8149  →  OV_MC_INCOMING
 *   PJ_PHASES        15999  →  OV_PROJECT_PHASES  (moved to projectsData.ts, Part 8)
 *   POLICY_DECISIONS  8155  →  OV_POLICY_DECISIONS (moved to policyDecisionsData.ts, Part 5)
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

/* ── Project fixture & gantt geometry — moved to projectsData.ts ─────────────
 *
 * Part 8 gave the Projects page ownership of the project phase fixture and the
 * gantt geometry, because the full Projects page and this Overview's mini-gantt
 * must never disagree about a phase. There is now ONE copy, in projectsData.ts;
 * these re-exports keep the Overview page and overviewModel importing them from
 * here under their original names, so nothing on the Overview side changed.
 */
export {
  PROJECT_PHASES as OV_PROJECT_PHASES,
  PJ_TODAY,
  PJ_WIN,
  PJ_SPANS,
  PJ_SLIPS,
  PJ_CONTRACT_END,
  PJ_WEEKS,
  PJ_CURRENT_WEEKS,
  PJ_PHASE_TONE,
} from "./projectsData";
export type {
  ProjectPhase as OvProjectPhase,
  PhaseStatus as OvPhaseStatus,
} from "./projectsData";

/* ── Policy decisions — moved to policyDecisionsData.ts ──────────────────────
 *
 * Part 5 gave the Policy Decisions page (Operate → Policy Decisions) ownership
 * of the policy-decision fixture, because the full page reads the WHOLE
 * prototype record while this Overview lane reads only six of its fields. There
 * is now ONE copy, in policyDecisionsData.ts; these re-exports keep the Overview
 * page and overviewModel importing it from here under their original names, so
 * nothing on the Overview side changed. Same move Part 8 made for the project
 * phases above.
 *
 * GOV-A4's `check` is the sharpest line on the page and is why this lane exists:
 * "Expired 103 days ago ... This now reads as neglect rather than a decision."
 */
export {
  POLICY_DECISIONS as OV_POLICY_DECISIONS,
  PD_TONE,
  PD_UNSIGNED,
} from "./policyDecisionsData";
export type {
  PolicyDecision as OvPolicyDecision,
  PolicyDecisionState as OvPolicyState,
} from "./policyDecisionsData";

/* ────────────────────────────────────────────────────────────────────────────
   Hold windows
   ──────────────────────────────────────────────────────────────────────── */

export interface OvHoldWindow {
  id: string;
  title: string;
  /** Which step of the runbook this window is gating. */
  gates: string;
  waitDays: number;
  /**
   * Hours from NOW at which the window closes. Negative means it already has.
   *
   * The prototype stores absolute `startedAt` dates against a FIXED clock
   * (`HOLD_NOW`), which the README says to replace with the real one. Storing
   * an offset rather than a date does that AND keeps the four windows in the
   * states the design chose to show — anchored to real dates, all four would
   * drift to `due` within a fortnight and the page would stop demonstrating
   * the state machine at all. The offsets are the design's own intervals,
   * measured from its own 20 August 2026.
   */
  closesInHours: number;
  scanVerdict: "clear" | "signals" | "watch";
}

/**
 * prototype 8581-8613, the four fields the overview's lane reads.
 *
 * The four cover three of the four hold states — `due` (twice), `early` and
 * `running`. That is the design's own spread, not an omission: `closing` is a
 * sub-24-hour state and the prototype's fixture has nothing sitting in it.
 */
export const OV_HOLD_WINDOWS: readonly OvHoldWindow[] = [
  {
    id: "hold-ca01",
    title: "CA01 in report-only — 7 day observation window",
    gates: "Gates step 4 — enforce CA01 and block legacy authentication",
    waitDays: 7,
    closesInHours: -48,
    scanVerdict: "signals",
  },
  {
    id: "hold-guest",
    title: "Guest owner confirmation — 14 day window",
    gates: "Gates step 5 — remove the guests nobody confirmed",
    waitDays: 14,
    closesInHours: 170,
    scanVerdict: "clear",
  },
  {
    id: "hold-admins",
    title: "Site admin notice period — 7 days",
    gates: "Gates step 4 — remove all but the 2 retained admins",
    waitDays: 7,
    closesInHours: -26,
    scanVerdict: "watch",
  },
  {
    id: "hold-private",
    title: "Owner notice — 30 days before automatic conversion",
    gates: "Gates step 5 — convert the site to Private automatically",
    waitDays: 30,
    closesInHours: 505,
    scanVerdict: "watch",
  },
];
