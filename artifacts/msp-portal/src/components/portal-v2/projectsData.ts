/**
 * projectsData.ts — the Projects page (SOW-based delivery) fixture.
 *
 * Prototype references are to 'Customer Portal Shell.dc.html'.
 *
 * ── Single source of truth for the project phases ──────────────────────────
 * The phase fixture and the gantt geometry USED TO LIVE in overviewData.ts,
 * because the Overview shipped a mini-gantt first (its `ProjectSchedule` lane).
 * The full Projects page and that mini-gantt must never disagree about which
 * phase is where, how wide it is or how far through it is — in the prototype
 * the Overview's rows are literally `pjGanttRows.slice(0, 5)` of THIS page's
 * rows (shell 17426). So the phase fixture (PROJECT_PHASES) and the gantt
 * geometry (PJ_*) now live here, and overviewData.ts re-exports them under
 * their old names. There is ONE copy of the phases; both pages read it.
 *
 * ── UI-only, so this is design content, not tenant data ────────────────────
 * Every number and string below is the prototype's own fictional Copilot
 * Readiness Assessment for the Halden Materials tenant, extracted from the
 * `PJ_*` literals rather than retyped. A later pass swaps this module for a
 * real source; keeping it in ONE module per page is what makes that a
 * one-file change.
 *
 * ── What is deliberately NOT modelled here ─────────────────────────────────
 * The prototype's three "Waiting on you" tasks carry an `openForm` field set
 * (shell 16066-16090) that drives a slide-over form. The form primitive lives
 * on the shell logic class, which Part 8 must not touch, and building the
 * drawer is a behaviour a later wiring pass owns — so the action buttons
 * render exactly as the design draws them but are inert, the same call the
 * Change Control rebuild made for its approve/reject controls. The field
 * definitions are omitted rather than stored dead; they return with the form.
 */

/* ── Phases — prototype PJ_PHASES, shell 15999 ──────────────────────────────
 * `status` drives both the gantt bar and the phase rail. The four states are
 * the prototype's own and are load-bearing: `blocked` is "blocked on you", not
 * "failed", which is why it is drawn AMBER, not red (see PHASE_META).
 */

export type PhaseStatus = "complete" | "active" | "blocked" | "pending";

export interface ProjectPhase {
  n: number;
  name: string;
  dates: string;
  status: PhaseStatus;
  done: number;
  total: number;
  summary: string;
  deliverables: readonly string[];
  note: string;
}

/** prototype 15999. The Overview draws the first five; this page draws all five. */
export const PROJECT_PHASES: readonly ProjectPhase[] = [
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

/* ── Gantt geometry — prototype 16239-16242 ─────────────────────────────────
 * `pct(d) = d / PJ_WIN * 100` positions every bar; the derivation lives in
 * overviewModel.pjRows and is reused here rather than re-implemented.
 */

/** The window is 63 days: 4 Aug (0) → 6 Oct (63) = 9 exact weeks. */
export const PJ_WIN = 63;

/** Day index of "today" on the window — prototype 16240. */
export const PJ_TODAY = 19;

/** Each phase's [startDay, endDay] on the window — prototype 16241. */
export const PJ_SPANS: Readonly<Record<number, readonly [number, number]>> = {
  1: [0, 9],
  2: [7, 16],
  3: [14, 32],
  4: [28, 39],
  5: [42, 53],
};

/**
 * Phases 4 and 5 carry a SLIP band — a dashed hatch showing where the phase was
 * meant to sit, drawn beside where it now does — prototype 16242. Only two
 * phases have one, and the page is honest about that rather than drawing an
 * empty band on the rest.
 */
export const PJ_SLIPS: Readonly<Record<number, readonly [number, number]>> = {
  4: [39, 46],
  5: [53, 60],
};

/** The contract's end date, drawn as a hard line — day 53, 26 Sep. */
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

/**
 * A drifted-emerald tone kept ONLY for the overviewData re-export contract —
 * nothing renders it. The Overview's mini-gantt and this page both colour their
 * bars from PHASE_META below, which is the prototype's own `pjPhaseMeta`.
 */
export const PJ_PHASE_TONE: Readonly<Record<PhaseStatus, string>> = {
  complete: "#34d399",
  active: "#60a5fa",
  blocked: "#f87171",
  pending: "#64748b",
};

/**
 * The phase palette the gantt and the phase rail actually draw — prototype
 * `pjPhaseMeta`, shell 16021. `blocked` is AMBER, not red: it means "blocked on
 * you", a your-move signal consistent with the amber "Waiting on you" card, and
 * it must match the gantt legend swatch, which labels it "Blocked on you" in
 * the same amber (PJ_GANTT_LEGEND).
 */
export interface PhaseMeta {
  color: string;
  label: string;
  border: string;
  background: string;
}

export const PHASE_META: Readonly<Record<PhaseStatus, PhaseMeta>> = {
  complete: { color: "#4ade80", label: "Signed off", border: "rgba(74,222,128,.35)", background: "rgba(74,222,128,.06)" },
  active: { color: "#60a5fa", label: "In progress", border: "rgba(96,165,250,.45)", background: "rgba(96,165,250,.08)" },
  blocked: { color: "#fbbf24", label: "Blocked on you", border: "rgba(251,191,36,.5)", background: "rgba(251,191,36,.09)" },
  pending: { color: "#64748b", label: "Not started", border: "rgba(30,41,59,.9)", background: "rgba(15,23,42,.4)" },
};

/* ── Milestones on the gantt's own row — prototype 16271-16276 ──────────────*/

export type MilestoneTone = "met" | "next" | "risk";

export interface ProjectMilestone {
  /** Day on the window. */
  day: number;
  label: string;
  tone: MilestoneTone;
}

export const PJ_MILESTONES: readonly ProjectMilestone[] = [
  { day: 9, label: "Inventory", tone: "met" },
  { day: 16, label: "Plan delivered", tone: "met" },
  { day: 32, label: "Pilot configured", tone: "next" },
  { day: 53, label: "Report & handover", tone: "risk" },
];

export const MILESTONE_TONE: Readonly<Record<MilestoneTone, string>> = {
  met: "#4ade80",
  next: "#60a5fa",
  risk: "#f87171",
};

/* ── The gantt legend — prototype 16288-16297 ──────────────────────────────*/

export interface GanttLegendItem {
  label: string;
  color: string;
  /** The slip swatch is a red dashed hatch, not a solid fill. */
  slip?: boolean;
}

export const PJ_GANTT_LEGEND: readonly GanttLegendItem[] = [
  { label: "Signed off", color: "#4ade80" },
  { label: "In progress", color: "#60a5fa" },
  { label: "Blocked on you", color: "#fbbf24" },
  { label: "Not started", color: "#64748b" },
  { label: "Where it slips", color: "#f87171", slip: true },
];

/* ── The task board — prototype PJ_TASKS / PJ_LANES, shell 16060-16123 ──────*/

export type TaskPriority = "Critical" | "High" | "Medium" | "Low";

/** prototype `pjPrioMeta`, shell 15993. */
export const PRIO_META: Readonly<Record<TaskPriority, { color: string; background: string }>> = {
  Critical: { color: "#f87171", background: "rgba(248,113,113,.12)" },
  High: { color: "#fb923c", background: "rgba(251,146,60,.12)" },
  Medium: { color: "#c2a63d", background: "rgba(194,166,61,.12)" },
  Low: { color: "#64748b", background: "rgba(100,116,139,.12)" },
};

export type DueTone = "red" | "amber" | "neutral" | "done";

/** prototype `pjDueTone`, shell 16116. */
export const DUE_TONE: Readonly<Record<DueTone, string>> = {
  red: "#f87171",
  amber: "#fbbf24",
  neutral: "#64748b",
  done: "#4ade80",
};

export type LaneKey = "backlog" | "progress" | "waiting" | "review" | "done";

export interface TaskLane {
  key: LaneKey;
  label: string;
  color: string;
  note: string;
}

/** prototype `PJ_LANES`, shell 16117. The five columns, left to right. */
export const PJ_LANES: readonly TaskLane[] = [
  { key: "backlog", label: "Backlog", color: "#64748b", note: "Sized, not started" },
  { key: "progress", label: "In progress", color: "#60a5fa", note: "With us" },
  { key: "waiting", label: "Waiting on you", color: "#fbbf24", note: "You are the blocker" },
  { key: "review", label: "In review", color: "#a78bfa", note: "Awaiting sign-off" },
  { key: "done", label: "Completed", color: "#4ade80", note: "Accepted" },
];

export interface ProjectTask {
  id: string;
  lane: LaneKey;
  title: string;
  prio: TaskPriority;
  dueLabel: string;
  dueTone: DueTone;
  owner: string;
  phase: number;
  /** The amber one-line summary a blocked-on-you card always shows. */
  reason?: string;
  /** "What it holds" — shown when the card is expanded. */
  blocks?: string;
  /** "What happens when you do it" — shown when the card is expanded. */
  next?: string;
  /** The neutral body an in-flight/queued card shows when expanded. */
  detail?: string;
  /** The label on the (inert) primary action button. */
  actionLabel?: string;
}

/** prototype `PJ_TASKS`, shell 16060 (the `fields` form payloads omitted; see header). */
export const PJ_TASKS: readonly ProjectTask[] = [
  {
    id: "t1",
    lane: "waiting",
    title: "Confirm the 24 named pilot users",
    prio: "Critical",
    dueLabel: "1 day overdue",
    dueTone: "red",
    owner: "You · IT",
    phase: 3,
    reason:
      "We have the draft list of 31 candidates from the licence audit. We need the final 24 confirmed before the sharing baseline can be scoped to them.",
    blocks: "Holds 2 tasks in phase 3 and the whole of phase 4.",
    next: "Confirm the names and we start the baseline configuration the same day. Every day this sits moves the phase 5 end date, which has no float.",
    actionLabel: "Confirm the pilot user list",
  },
  {
    id: "t2",
    lane: "waiting",
    title: "Approve the governance remediation plan",
    prio: "High",
    dueLabel: "in 3 days",
    dueTone: "amber",
    owner: "You · IT + Legal",
    phase: 2,
    reason:
      "The plan was delivered 20 Aug. It changes tenant sharing defaults, so we do not act on it without written approval from both IT and legal.",
    blocks: "Phase 2 deliverable stays unaccepted; no tenant settings change until it is signed.",
    next: "Approve and the phase 2 milestone invoices at the same time. Reject any line and we reissue within two working days.",
    actionLabel: "Review and approve the plan",
  },
  {
    id: "t3",
    lane: "waiting",
    title: "Book the two training sessions",
    prio: "Medium",
    dueLabel: "in 6 days",
    dueTone: "amber",
    owner: "You · IT",
    phase: 4,
    reason:
      "Trainer and room need 10 working days notice. Phase 4 runs 1–12 Sep, so dates confirmed after 28 Aug cannot land inside the contracted window.",
    blocks: "Phase 4 cannot be scheduled at all. Phase 5 slips with it.",
    next: "Pick two dates from the offered windows and we confirm the trainer within a day.",
    actionLabel: "Pick training dates",
  },
  {
    id: "t4",
    lane: "progress",
    title: "Configure the pilot tenant sharing baseline",
    prio: "High",
    dueLabel: "in 7 days",
    dueTone: "neutral",
    owner: "Priya Raman",
    phase: 3,
    detail:
      "Baseline written and peer reviewed. Applying it is a 40-minute change under CR-2026-0186, which is approved and scheduled for the evening of 27 Aug.",
  },
  {
    id: "t5",
    lane: "progress",
    title: "Remediate 9 anonymous links inside pilot scope",
    prio: "High",
    dueLabel: "in 5 days",
    dueTone: "neutral",
    owner: "Priya Raman",
    phase: 3,
    detail:
      "Four of nine expired. The remaining five are on the Marketing Assets Hub and need a replacement route for one link with 312 opens before it is cut.",
  },
  {
    id: "t6",
    lane: "progress",
    title: "Sensitivity label pilot for 10 users",
    prio: "Medium",
    dueLabel: "in 11 days",
    dueTone: "neutral",
    owner: "Dan Okafor",
    phase: 3,
    detail:
      "Three non-encrypting labels published to the pilot group. The encrypting label waits for the two external advisers to be added to the permitted set.",
  },
  {
    id: "t7",
    lane: "progress",
    title: "Semantic index readiness check on 4 sites",
    prio: "Medium",
    dueLabel: "in 8 days",
    dueTone: "neutral",
    owner: "Dan Okafor",
    phase: 3,
    detail:
      "Two sites clear. Two have unindexed content that Copilot would silently skip; both are being reported rather than fixed under this SOW.",
  },
  {
    id: "t8",
    lane: "review",
    title: "Discovery findings pack — technical review",
    prio: "High",
    dueLabel: "in 4 days",
    dueTone: "neutral",
    owner: "Priya + you",
    phase: 1,
    detail: "Joint review booked for 26 Aug. Nothing is needed from you before the call.",
  },
  {
    id: "t9",
    lane: "review",
    title: "Pilot configuration runbook — peer review",
    prio: "Medium",
    dueLabel: "in 6 days",
    dueTone: "neutral",
    owner: "Internal",
    phase: 3,
    detail: "Second architect reviewing. Ours to close; you see the runbook when it publishes.",
  },
  {
    id: "t10",
    lane: "backlog",
    title: "Licence gap analysis for the 34 waiting users",
    prio: "Medium",
    dueLabel: "3 Sep",
    dueTone: "neutral",
    owner: "Unassigned",
    phase: 3,
    detail:
      "Sized but not started. Depends on the pilot list, since the 24 come out of the same pool.",
  },
  {
    id: "t11",
    lane: "backlog",
    title: "Draft the Copilot usage policy",
    prio: "Medium",
    dueLabel: "8 Sep",
    dueTone: "neutral",
    owner: "Unassigned",
    phase: 4,
    detail: "Template ready. Written during phase 4 so it reflects what the pilot actually shows.",
  },
  {
    id: "t12",
    lane: "backlog",
    title: "Readiness scorecard template",
    prio: "Low",
    dueLabel: "12 Sep",
    dueTone: "neutral",
    owner: "Unassigned",
    phase: 5,
  },
  {
    id: "t13",
    lane: "backlog",
    title: "Handover session agenda",
    prio: "Low",
    dueLabel: "22 Sep",
    dueTone: "neutral",
    owner: "Unassigned",
    phase: 5,
  },
  {
    id: "t14",
    lane: "done",
    title: "Tenant data inventory across 412 sites",
    prio: "High",
    dueLabel: "done 11 Aug",
    dueTone: "done",
    owner: "Priya Raman",
    phase: 1,
  },
  {
    id: "t15",
    lane: "done",
    title: "Copilot licence and entitlement audit",
    prio: "Medium",
    dueLabel: "done 9 Aug",
    dueTone: "done",
    owner: "Dan Okafor",
    phase: 1,
  },
  {
    id: "t16",
    lane: "done",
    title: "Oversharing exposure baseline",
    prio: "High",
    dueLabel: "done 12 Aug",
    dueTone: "done",
    owner: "Priya Raman",
    phase: 1,
  },
  {
    id: "t17",
    lane: "done",
    title: "Phase 1 findings workshop",
    prio: "Medium",
    dueLabel: "done 13 Aug",
    dueTone: "done",
    owner: "Priya + you",
    phase: 1,
  },
  {
    id: "t18",
    lane: "done",
    title: "Governance remediation plan drafted",
    prio: "High",
    dueLabel: "done 19 Aug",
    dueTone: "done",
    owner: "Priya Raman",
    phase: 2,
  },
];

/* ── The "With us" card list — prototype `pjMine`, shell 16181 ──────────────*/

export interface ProjectMineItem {
  title: string;
  due: string;
}

export const PJ_MINE: readonly ProjectMineItem[] = [
  { title: "Pilot tenant baseline applied under CR-2026-0186", due: "27 Aug" },
  { title: "Anonymous link remediation inside pilot scope", due: "27 Aug" },
  { title: "Semantic index readiness report", due: "30 Aug" },
  { title: "Sensitivity label pilot for 10 users", due: "2 Sep" },
];

/* ── The "Scope delivered" card — prototype 1296-1326 ──────────────────────*/

export interface ScopeBar {
  label: string;
  value: string;
  /** The fill width, 0-100. */
  pct: number;
  color: string;
}

export const PJ_SCOPE_BARS: readonly ScopeBar[] = [
  { label: "Contracted deliverables accepted", value: "2 of 8", pct: 25, color: "#4ade80" },
  { label: "Tasks closed", value: "5 of 18", pct: 28, color: "#60a5fa" },
  { label: "Schedule elapsed", value: "36%", pct: 36, color: "#94a3b8" },
];

export const PJ_SCOPE_NOTE =
  "Work is eight points behind elapsed time, all of it attributable to the overdue pilot user list. Nothing else is behind.";

/* ── Page copy — every user-facing string, verbatim ────────────────────────*/

export const PROJECT_META = {
  sowLabel: "Fixed-scope project · SOW-2026-0114",
  title: "Copilot Readiness Assessment",
  intro:
    "A defined scope with a start, five phases and an end. This page answers two questions: how much of the contracted scope is done, and whose move it is. Everything else is detail underneath those two.",
  lead: "Priya Raman · delivery lead",
  terms: "4 Aug – 26 Sep 2026 · fixed fee $14,800",
  day: "Day 19 of 53 · next report Friday",
} as const;

export const PJ_WAITING_CARD = {
  kicker: "Waiting on you",
  overdue: "1 overdue",
  tail: "items are with you. One of them is holding two phases.",
} as const;

export const PJ_MINE_CARD = {
  kicker: "With us",
  clear: "Nothing overdue on our side",
  tail: "items in flight. Next change window 27 Aug.",
} as const;

export const PJ_SCOPE_KICKER = "Scope delivered";

export const PJ_SCHEDULE = {
  kicker: "Schedule · 4 Aug – 26 Sep, day 19 of 53",
  hint: "Select a phase for its deliverables and dependencies",
  callout: "On track to 26 Sep only if the training dates come back by 28 Aug.",
  calloutBody:
    "Phases 1 and 2 are signed off. Phase 3 is running. Phase 4 cannot be scheduled without 10 working days notice, and phase 5 has no float behind it — the striped bars are where the dates go if that notice is missed.",
  nextMilestoneKicker: "Next milestone",
  nextMilestone: "Pilot configured · 5 Sep",
  nextMilestoneMeta: "13 days out · 4 tasks left",
  phaseHeading: "Phase",
  milestonesHeading: "Milestones",
  contractedEnd: "Contracted end · 26 Sep",
  today: "Today · 23 Aug",
} as const;

export const PJ_BOARD = {
  kicker: "Task board · 18 tasks across the five phases",
  hint: "Select a card for what it is waiting on",
} as const;

export const PJ_CARD_LABELS = {
  holds: "What it holds",
  whenDone: "What happens when you do it",
  ask: "Ask ShaneBot about this",
} as const;

export const PJ_FOOTER = {
  changeControl: "Open CR-2026-0181 in Change Control",
  docs: "Read the signed SOW and schedule 2",
  ask: "Ask ShaneBot where this project stands",
  billing: "Fee, invoices and milestone releases live in Billing",
} as const;
