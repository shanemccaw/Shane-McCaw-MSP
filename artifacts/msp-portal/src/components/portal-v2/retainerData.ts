/**
 * retainerData.ts — the My Architect (retainer) fixture.
 *
 * Extracted verbatim from the prototype's own logic class, `Customer Portal
 * Shell.dc.html`:
 *   • RET_HOURS      15856
 *   • RET_WORK       15860-15866
 *   • RET_WEEKS      15876-15922
 *   • RET_OUTCOMES   15955-15960
 *   • RET_TERMS      15965-15973
 *   • RET_DOCS       15974-15981
 *
 * ── UI-ONLY, and why this ledger is fixture ────────────────────────────────
 * The retainer-hours ledger is greenfield — no such ledger exists anywhere in
 * the repo, so every number here is the design's own, kept in ONE module so the
 * later wiring pass has a single place to swap fixture for a real time-tracking
 * source. Nothing is retyped by hand where the prototype already wrote it down;
 * the strings below are copied value-for-value. Copy in this handoff is FINAL —
 * do not rewrite, shorten or "improve" any user-facing string.
 *
 * The derivations that shape these into what the page renders (hour totals, the
 * used percentage, the selected week's report) live in `retainerModel.ts` and
 * are unit-tested there; this file is data only.
 */

/** RET_HOURS — the retainer's hour budget. Prototype 15856. */
export const RET_HOURS = { retained: 8, rolled: 2, used: 5.5 } as const;

/** A pillar's identity colour, as the prototype's own work rows declare it. */
export type RetWorkState = "In progress" | "Closed" | "In review" | "Scheduled";

export interface RetWorkItem {
  readonly item: string;
  readonly hours: number;
  readonly pillar: string;
  readonly finding: string;
  /** Pillar identity colour — the prototype's inline value (15861-15865). */
  readonly color: string;
  readonly outcome: string;
  readonly state: RetWorkState;
  readonly week: string;
}

/** RET_WORK — where the hours went, this month. Prototype 15860-15866. */
export const RET_WORK: readonly RetWorkItem[] = [
  {
    item: "Entra Connect: cleared 11 of 14 sync errors, staged the upgrade",
    hours: 2.0,
    pillar: "Health",
    finding: "HLT-02",
    color: "#22C55E",
    outcome: "Stale OUs removed from scope. Upgrade window agreed for 27 August.",
    state: "In progress",
    week: "W34",
  },
  {
    item: "Retention: built the adaptive scope and verified coverage on 12 mailboxes",
    hours: 1.0,
    pillar: "Compliance",
    finding: "CMP-01",
    color: "#E2E8F0",
    outcome: "Coverage gap closed. Effective date recorded for the audit file.",
    state: "Closed",
    week: "W33",
  },
  {
    item: "Guest invitations restricted, Guest Inviters group built and populated",
    hours: 1.5,
    pillar: "Governance",
    finding: "GOV guests",
    color: "#3B82F6",
    outcome: "Guests can no longer invite guests. 22 inviters named, request route published.",
    state: "Closed",
    week: "W33",
  },
  {
    item: "CA001 legacy-auth block authored in report-only, exclusions reviewed",
    hours: 0.5,
    pillar: "Security",
    finding: "CA001",
    color: "#8B5CF6",
    outcome: "Report-only since 12 August. Switch to On scheduled after the 7-day review.",
    state: "In review",
    week: "W32",
  },
  {
    item: "Copilot enablement plan: department ordering and prompt-card drafting",
    hours: 0.5,
    pillar: "Adoption",
    finding: "ADP-01",
    color: "#F97316",
    outcome: "Operations and Finance sessions scheduled for 26 and 28 August.",
    state: "Scheduled",
    week: "W32",
  },
];

export interface RetWeekAsk {
  readonly who: "you" | "them";
  readonly when: string;
  readonly text: string;
}

export interface RetWeek {
  readonly key: string;
  readonly label: string;
  readonly range: string;
  readonly hours: number;
  readonly current: boolean;
  readonly author: string;
  readonly published: string;
  readonly summary: string;
  readonly log: readonly { readonly what: string; readonly hours: number }[];
  readonly deliverables: readonly string[];
  readonly asks: readonly RetWeekAsk[];
}

/** RET_WEEKS — the four selectable weekly reports. Prototype 15876-15922. */
export const RET_WEEKS: readonly RetWeek[] = [
  {
    key: "W34",
    label: "W34",
    range: "17–23 Aug",
    hours: 2.0,
    current: true,
    author: "Priya Raman · M365 Architect",
    published: "Draft — publishes Friday 22 August",
    summary:
      "Most of this week went into the sync server. Eleven of the fourteen failing objects are cleared; the remaining three are genuine duplicates where two on-premises accounts claim the same proxy address, and those need a decision from you about which record wins rather than a technical fix from me. The upgrade itself is staged and I have booked the window for the 27th. I have deliberately not built the standby server yet — doing that before the errors are clean would replicate a broken configuration.",
    log: [
      { what: "Removed 3 stale OUs from sync scope", hours: 0.5 },
      { what: "Worked 11 object errors individually with IdFix", hours: 1.0 },
      { what: "Staged the Connect upgrade and agreed the window", hours: 0.5 },
    ],
    deliverables: [
      "Sync error report with the 3 outstanding duplicates named",
      "Upgrade runbook for the 27 August window",
    ],
    asks: [
      {
        who: "you",
        when: "Yesterday 16:12",
        text: "On the three duplicates — can you just pick whichever record has the newer sign-in? I do not want to hold up the upgrade for this.",
      },
      {
        who: "them",
        when: "Yesterday 17:40",
        text: "I would rather not, and here is why: two of the three are shared mailboxes where the older record holds the mail and the newer one is an empty re-creation. Picking by sign-in date would move the wrong one. It is 15 minutes with your service desk lead to settle all three — I have put a hold on his calendar for Thursday. The upgrade window is not at risk.",
      },
    ],
  },
  {
    key: "W33",
    label: "W33",
    range: "10–16 Aug",
    hours: 2.5,
    current: false,
    author: "Priya Raman · M365 Architect",
    published: "Published Friday 15 August",
    summary:
      "Two findings closed this week. The retention adaptive scope is the one worth flagging: the previous policy used a static list, which is why twelve mailboxes drifted out of coverage after onboarding. The new scope re-evaluates membership, so that particular gap cannot reopen. Guest invitations are now restricted and the Guest Inviters group has 22 people in it, which was slightly more than we expected — sales and client delivery both had legitimate cases.",
    log: [
      { what: "Built and verified the retention adaptive scope", hours: 1.0 },
      { what: "Restricted guest invitations, built the inviters group", hours: 1.0 },
      { what: "Published the guest request route and briefed the service desk", hours: 0.5 },
    ],
    deliverables: [
      "Retention coverage evidence export with effective dates",
      "Guest invitation standard, one page",
    ],
    asks: [
      {
        who: "you",
        when: "15 Aug 11:02",
        text: "Does restricting invitations break the vendor onboarding flow the ops team uses?",
      },
      {
        who: "them",
        when: "15 Aug 11:38",
        text: "No — I checked before applying it. The two people who run that flow are both in the Guest Inviters group. I also tested an invitation from an ordinary member account to confirm the block works and produces a sensible message rather than a silent failure.",
      },
    ],
  },
  {
    key: "W32",
    label: "W32",
    range: "3–9 Aug",
    hours: 1.0,
    current: false,
    author: "Priya Raman · M365 Architect",
    published: "Published Friday 8 August",
    summary:
      "A lighter week by design — most of the hours went into authoring CA001 in report-only and reviewing what it would have blocked. Four accounts would have been affected, all of them the legacy-auth accounts already on the Security pillar. Nothing unexpected surfaced, which is the outcome you want from a report-only week. I also drafted the Copilot enablement ordering, which is on the Adoption page.",
    log: [
      { what: "Authored CA001 in report-only and reviewed impact", hours: 0.5 },
      { what: "Copilot enablement ordering and prompt cards", hours: 0.5 },
    ],
    deliverables: ["CA001 report-only impact review", "Copilot enablement plan, 6 departments"],
    asks: [],
  },
  {
    key: "W31",
    label: "W31",
    range: "27 Jul–2 Aug",
    hours: 0,
    current: false,
    author: "Priya Raman · M365 Architect",
    published: "Published Friday 1 August",
    summary:
      "No hours logged. You were mid-quarter-close and asked to defer, so the two hours from this week rolled into August. They expire on 31 August if unused — worth noting because there are 4.5 hours available and nine days left.",
    log: [],
    deliverables: [],
    asks: [],
  },
];

export type RetOutcomeTone = "green" | "blue" | "amber";

export interface RetOutcome {
  readonly what: string;
  readonly detail: string;
  readonly tone: RetOutcomeTone;
}

/** RET_OUTCOMES — what the retainer has produced since 1 April. Prototype 15955-15960. */
export const RET_OUTCOMES: readonly RetOutcome[] = [
  {
    what: "6 findings closed and verified by re-scan",
    detail: "Across Governance, Compliance and Security since 1 June",
    tone: "green",
  },
  {
    what: "Compliance score 74 → 78",
    detail: "Retention coverage and disposition reviewers account for most of it",
    tone: "green",
  },
  {
    what: "Governance score held at 62 while 4 new findings appeared",
    detail: "Closures kept pace with new detections rather than falling behind",
    tone: "blue",
  },
  {
    what: "2 findings handed back rather than absorbed",
    detail:
      "Teams Phone rollout and the Exchange decommission both need a project, not retainer hours — quoted separately so they do not silently eat the retainer",
    tone: "amber",
  },
];

/** RET_TERMS — how the retainer works. Prototype 15965-15973. */
export const RET_TERMS: readonly { readonly k: string; readonly v: string }[] = [
  {
    k: "Retained hours",
    v: "8 hours a month, $2,400 — $300 an hour equivalent, billed monthly on the 1st",
  },
  {
    k: "Roll-forward",
    v: "Unused hours roll forward one month, then expire. 2.0 hours from July expire on 31 August.",
  },
  {
    k: "How time is logged",
    v: "Per work item, as you see it below. This is a running total rather than per-minute tracking — if a line looks wrong, say so and we will correct it that day.",
  },
  {
    k: "Response time",
    v: "Within one business day for questions, 4 business hours for anything blocking a change window",
  },
  {
    k: "In scope",
    v: "Advisory, configuration, remediation of findings, review of your own work, and answering questions in writing",
  },
  {
    k: "Out of scope",
    v: "Migrations, decommissions and rollouts with a fixed deliverable. Those are quoted as a statement of work so they do not quietly consume the retainer.",
  },
  {
    k: "Overage",
    v: "We stop and ask before exceeding your hours. Extra hours are $300 with your written approval, never applied retrospectively.",
  },
];

/** RET_DOCS — the retainer's documents rail. Prototype 15974-15981. */
export const RET_DOCS: readonly { readonly name: string; readonly when: string; readonly kind: string }[] = [
  { name: "Weekly status report · W33", when: "15 August 2026", kind: "Status report" },
  { name: "Retention coverage evidence export", when: "14 August 2026", kind: "Evidence" },
  { name: "Guest invitation standard", when: "13 August 2026", kind: "Standard" },
  { name: "CA001 report-only impact review", when: "8 August 2026", kind: "Review" },
  { name: "Copilot enablement plan · 6 departments", when: "7 August 2026", kind: "Plan" },
  { name: "August retainer summary", when: "Publishes 1 September", kind: "Rollup" },
];

/* ── Static header/meta copy — prototype 1990-1996, 2030-2038. Verbatim. ──── */
export const RET_COPY = {
  eyebrow: "My Architect",
  heading: "My Architect · August 2026",
  subhead:
    "8 hours a month with a named architect. Every hour below is attached to the work it went into and, where there is one, the finding it closed. Nothing here is a summary written after the fact — it is the working log.",
  architect: "Priya Raman · M365 Architect",
  billing: "$2,400/mo · next status report Friday",
  timeLabel: "Time this period",
  timeMeta: "Logged per work item · running total",
  retainedMonthly: "8.0 hours",
  rolledExpiry: "expire 31 Aug",
  remainingTail: "9 days left",
  timeNote:
    "Time is recorded against work items rather than tracked to the minute. If a line looks wrong, say so on the status report below and it is corrected the same day.",
  findingsClosedLabel: "Findings closed",
  findingsClosedValue: "2 this month",
  findingsClosedSub: "6 since 1 June, all verified by re-scan rather than marked done",
  nextScheduledLabel: "Next scheduled",
  nextScheduledValue: "27 August · Connect upgrade",
  nextScheduledSub: "Window agreed, runbook published. 1.5 hours estimated.",
  hoursHeading: "Where the hours went · August",
  hoursHeadingNote: "Each line names the pillar and the finding it belongs to",
  weekDetailLabel: "Week detail",
  weekDetailNote: "Pick a week — the month above stays put",
  askPlaceholder: "Ask about anything in this week's report…",
  askNote:
    "Answered within one business day, and it becomes part of the report rather than disappearing into email.",
  producedLabel: "What the retainer has produced",
  producedNote: "Since the retainer started on 1 April.",
  documentsLabel: "Documents",
  documentsAll: "All documents",
  termsLabel: "How the retainer works",
} as const;
