/**
 * overviewModel.ts — the Overview's geometry and lane assembly.
 *
 * Prototype references are to 'Customer Portal Shell.dc.html'.
 *
 * Every bar on this page is positioned by arithmetic over a day window, and a
 * wrong percentage renders as a plausible bar in the wrong place — the kind of
 * defect nothing else on the page contradicts. So the maths lives here, named
 * and tested, rather than inline in the component.
 */

import {
  OV_CR_PIPELINE,
  OV_HOLD_WINDOWS,
  OV_MC_INCOMING,
  OV_POLICY_DECISIONS,
  OV_PROJECT_PHASES,
  PD_TONE,
  PD_UNSIGNED,
  PJ_SLIPS,
  PJ_SPANS,
  PJ_WIN,
  type OvHoldWindow,
  type OvPolicyDecision,
  type OvProjectPhase,
} from "./overviewData";
import { deriveHoldClock, type HoldState } from "./holds/holdState";
import { RR_RISKS, type RiskEntry } from "./riskRegisterData";

/* ────────────────────────────────────────────────────────────────────────────
   The mini bar — prototype `ovBar`, 8106-8119
   ──────────────────────────────────────────────────────────────────────── */

export interface MiniBar {
  unscheduled: boolean;
  /** Percentages, left edge and width, both 0-100. */
  left: number;
  width: number;
  /** Where "today" sits on the window, as a percentage. */
  todayLeft: number;
  /** The repeating gridline step, one line a week. */
  weekStepPct: number;
}

const clamp = (x: number) => Math.max(0, Math.min(100, x));

/**
 * `ovBar(startDay, endDay, winStart, winLen, tone)` — prototype 8106.
 *
 * Two details are load-bearing and easy to lose:
 *
 *  1. A NULL start means UNSCHEDULED, and the caller must draw a word instead
 *     of a bar. CR-0149 is blocked with nobody accountable, so it genuinely has
 *     no date; inventing a zero-width bar at day 0 would put a blocked change
 *     on today's line.
 *  2. The bar has a MINIMUM WIDTH. A same-day item (`start === end`, which is
 *     most of them) would otherwise compute a zero width and vanish. The
 *     prototype floors the end at `start + max(1, winLen * 0.015)` and then
 *     floors the final width at 1.5%.
 */
export function ovBar(
  startDay: number | null,
  endDay: number | null,
  winStart: number,
  winLen: number,
): MiniBar {
  if (startDay === null || startDay === undefined) {
    return { unscheduled: true, left: 0, width: 0, todayLeft: 0, weekStepPct: 0 };
  }
  const end = endDay ?? startDay;
  const left = clamp(((startDay - winStart) / winLen) * 100);
  const rightRaw = clamp(
    ((Math.max(end, startDay + Math.max(1, winLen * 0.015)) - winStart) / winLen) * 100,
  );
  return {
    unscheduled: false,
    left,
    width: Math.max(1.5, rightRaw - left),
    todayLeft: clamp(((0 - winStart) / winLen) * 100),
    weekStepPct: Number(((7 / winLen) * 100).toFixed(2)),
  };
}

/** The lane's hatched background — prototype 8114. */
export function laneTrackBackground(weekStepPct: number): string {
  return `repeating-linear-gradient(90deg, rgba(148,163,184,.07) 0 1px, transparent 1px ${weekStepPct}%)`;
}

/* ────────────────────────────────────────────────────────────────────────────
   The six "Everything in motion" lanes
   ──────────────────────────────────────────────────────────────────────── */

export interface Lane {
  key: string;
  title: string;
  note: string;
  dateLabel: string;
  tone: string;
  bar: MiniBar;
  /** Overrides the computed bar fill where the design gradients it. */
  fill?: string;
}

/** Change requests run on a −10 → +16 day window — prototype 17399. */
export const CR_WINDOW = { start: -10, len: 26 } as const;

export function crLanes(): readonly Lane[] {
  return OV_CR_PIPELINE.map((c) => ({
    key: c.id,
    title: c.title,
    // The stage leads the note, so a blocked CR reads as blocked before it
    // reads as a sentence — prototype 17401.
    note: c.stage + (c.note ? ` · ${c.note}` : ""),
    dateLabel: c.dateLabel,
    tone: c.tone,
    bar: ovBar(c.start, c.end, CR_WINDOW.start, CR_WINDOW.len),
  }));
}

/** Microsoft changes run on a 0 → 45 day window — prototype 17410. */
export const MC_WINDOW = { start: 0, len: 45 } as const;

export function mcLanes(): readonly Lane[] {
  return OV_MC_INCOMING.map((m) => ({
    key: m.id,
    title: m.title,
    note: m.note,
    dateLabel: m.dateLabel,
    tone: m.tone,
    bar: ovBar(m.day, m.day, MC_WINDOW.start, MC_WINDOW.len),
  }));
}

/**
 * Policy decisions — prototype 17446-17457.
 *
 * The bar is FIXED at left 56% / width 34% rather than derived from the dates.
 * That is the prototype's own choice and it is reproduced: these decisions span
 * months to years, so a true-to-scale bar on a shared window would collapse
 * every one of them into the same sliver. The window here communicates state
 * and review position, not duration.
 */
export function pdLanes(): readonly Lane[] {
  return OV_POLICY_DECISIONS.map((d) => {
    const tone = PD_TONE[d.state] ?? "#94a3b8";
    const unsigned = d.approved === PD_UNSIGNED;
    return {
      key: d.id,
      title: d.title,
      note: d.check,
      dateLabel: unsigned ? "Awaiting approval" : `${d.approved} → ${d.review}`,
      tone,
      bar: unsigned
        ? { unscheduled: true, left: 0, width: 0, todayLeft: 0, weekStepPct: 0 }
        : { ...ovBar(-300, 220, -300, 520), left: 56, width: 34 },
      fill: `linear-gradient(90deg,${tone},${tone}30)`,
    };
  });
}

/** The count label each section header shows — prototype 17459-17464. */
export function sectionCount(n: number, noun: string): string {
  return `${n} ${noun}`;
}

/* ────────────────────────────────────────────────────────────────────────────
   Hold windows — prototype 17419-17424
   ──────────────────────────────────────────────────────────────────────── */

export interface HoldLane {
  key: string;
  title: string;
  note: string;
  /** T-minus readout, e.g. "T-7d" or "Closed 48h ago". */
  tMinus: string;
  tone: string;
  state: HoldState;
  /** How far through the wait, 0-100. */
  donePct: number;
}

/**
 * The overview's hold lane.
 *
 * The derivation is OURS, not the prototype's: `deriveHoldClock` in
 * holds/holdState.ts fixes two real defects in the prototype's version —
 * `closing` was unreachable when the verdict was `clear`, and the early-close
 * saving ceiled instead of flooring, which overstated the days saved. Reusing
 * it here means the overview and the Active Runbooks page cannot disagree
 * about the same window, which they would if this ported the prototype again.
 */
export function holdLanes(
  now: Date,
  windows: readonly OvHoldWindow[] = OV_HOLD_WINDOWS,
): readonly HoldLane[] {
  return windows.map((h) => {
    const closesAt = new Date(now.getTime() + h.closesInHours * 3_600_000).toISOString();
    const clock = deriveHoldClock({ closesAt, scanVerdict: h.scanVerdict }, now);
    const totalHours = h.waitDays * 24;
    const doneHours = Math.max(0, Math.min(totalHours, totalHours - clock.hoursLeft));
    return {
      key: h.id,
      title: h.title,
      note: h.gates,
      tMinus: clock.tMinus,
      tone: clock.tone,
      state: clock.state,
      donePct: totalHours ? Math.round((doneHours / totalHours) * 100) : 0,
    };
  });
}

/** Hold windows that need a decision now — the ones the design leads with. */
export function holdDecisionCount(lanes: readonly HoldLane[]): number {
  return lanes.filter((l) => l.state === "due" || l.state === "early").length;
}

/* ────────────────────────────────────────────────────────────────────────────
   Accepted risks — prototype 17432-17445
   ──────────────────────────────────────────────────────────────────────── */

/**
 * Reads the SAME fixture the Risk Register page renders, filtered to accepted —
 * prototype 17354 (`RR_RISKS.filter(r => r.status === 'Accepted')`). No second
 * copy of the risks exists for this page.
 *
 * Like the policy lane, the bar is FIXED rather than to-scale (prototype 17441
 * hardcodes `left:6%;width:80%`): acceptances run for months to years, and a
 * true-to-scale bar across one shared window would collapse them all.
 */
export function acceptedRiskLanes(risks: readonly RiskEntry[] = RR_RISKS): readonly Lane[] {
  return risks
    .filter((r) => r.status === "Accepted")
    .map((r) => {
      const by = r.accepted ? r.accepted.by : r.owner;
      const on = r.accepted ? r.accepted.on : r.review;
      const until = r.accepted ? r.accepted.until : r.review;
      return {
        key: r.id,
        title: r.title,
        note: `Accepted by ${by} until ${until}`,
        dateLabel: `${on} → ${until}`,
        tone: "#c2a63d",
        bar: { ...ovBar(-20, 220, -20, 240), left: 6, width: 80 },
        fill: "linear-gradient(90deg,#c2a63d,rgba(194,166,61,.15))",
      };
    });
}

/* ────────────────────────────────────────────────────────────────────────────
   The project gantt — prototype 16240-16268
   ──────────────────────────────────────────────────────────────────────── */

/** `pct(d) = d / PJ_WIN * 100` — prototype 16243. */
export function pjPct(day: number): number {
  return (day / PJ_WIN) * 100;
}

export interface PjRow {
  n: number;
  name: string;
  dates: string;
  status: OvProjectPhase["status"];
  tone: string;
  /** Bar left/width as percentages of the window. */
  left: number;
  width: number;
  /** Progress fill inside the bar, as a percentage of the BAR, not the window. */
  donePct: number;
  barText: string;
  slip: { left: number; width: number } | null;
}

/**
 * `pjGanttRows` — prototype 16248-16268.
 *
 * `barText` is a THREE-way branch, not a progress string: a complete phase says
 * "Signed off", a blocked one says "Blocked", and only a live one counts tasks.
 * Printing "0/3 tasks" on a blocked phase would read as no-progress-yet rather
 * than cannot-start, which is the opposite of what phase 4 means.
 */
export function pjRows(phases: readonly OvProjectPhase[] = OV_PROJECT_PHASES): readonly PjRow[] {
  return phases.map((p) => {
    const span = PJ_SPANS[p.n];
    const slip = PJ_SLIPS[p.n];
    const left = pjPct(span[0]);
    const width = pjPct(span[1] - span[0]);
    return {
      n: p.n,
      name: p.name,
      dates: p.dates,
      status: p.status,
      tone: {
        complete: "#34d399",
        active: "#60a5fa",
        blocked: "#f87171",
        pending: "#64748b",
      }[p.status],
      left,
      width,
      donePct: p.total ? Math.round((p.done / p.total) * 100) : 0,
      barText:
        p.status === "complete"
          ? "Signed off"
          : p.status === "blocked"
            ? "Blocked"
            : `${p.done}/${p.total} tasks`,
      slip: slip ? { left: pjPct(slip[0]), width: pjPct(slip[1] - slip[0]) } : null,
    };
  });
}

/** How many phases have slipped past their planned window. */
export function slippedPhaseCount(rows: readonly PjRow[] = pjRows()): number {
  return rows.filter((r) => r.slip !== null).length;
}

/** Policy decisions in a state that needs someone to look — 17464. */
export function flaggedPolicyCount(
  decisions: readonly OvPolicyDecision[] = OV_POLICY_DECISIONS,
): number {
  return decisions.filter((d) => d.state === "due" || d.state === "expired").length;
}

/* ────────────────────────────────────────────────────────────────────────────
   The pillar strip — derived from LIVE data, not the fixture
   ──────────────────────────────────────────────────────────────────────── */

/**
 * The strip's delta — prototype 8508 formats `pillarScoreData[key].delta`.
 *
 * The prototype hardcodes each pillar's delta. We have the real replayed
 * history on `trend.series`, so it is derived: last checkpoint minus the one
 * before it. Returns null when there is no second point to compare against —
 * a tenant with one checkpoint has no trend, and printing "±0" would claim a
 * stable score we have not observed.
 */
export function pillarDelta(series: readonly number[] | null | undefined): number | null {
  if (!series || series.length < 2) return null;
  return series[series.length - 1] - series[series.length - 2];
}

/** `d.delta > 0 ? '+n' : d.delta === 0 ? '±0' : 'n'` — prototype 8508. */
export function pillarDeltaLabel(delta: number | null): string {
  if (delta === null) return "";
  if (delta > 0) return `+${delta}`;
  if (delta === 0) return "±0";
  return String(delta);
}

/** The tone the delta is printed in — prototype `trendMeta`, 8497-8501. */
export function pillarDeltaTone(delta: number | null): string {
  if (delta === null) return "#64748b";
  if (delta > 0) return "#22C55E";
  if (delta < 0) return "#f43f5e";
  return "#64748b";
}

/**
 * The strip's sub-line — prototype `pillarScoreData[key].sub`.
 *
 * The prototype writes each one by hand ("2 open findings", "$2,280/mo
 * reclaimable", "On track"). Five of the six are a finding count, which we hold
 * for real, so it is derived. The one that is not — Licensing's reclaimable
 * spend — is NOT reproduced: inventing a dollar figure from a finding count
 * would be a fabricated number on a money line, which is exactly the kind of
 * thing the no-hardcoding rule exists to stop.
 */
export function pillarStripSub(counts: { critical: number; warning: number }): string {
  const open = counts.critical + counts.warning;
  if (open === 0) return "On track";
  return `${open} open finding${open === 1 ? "" : "s"}`;
}
