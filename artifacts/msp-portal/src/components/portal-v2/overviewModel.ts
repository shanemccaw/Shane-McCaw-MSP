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
  OV_HEADLINE_SUB,
  OV_HOLD_WINDOWS,
  OV_MC_INCOMING,
  OV_POLICY_DECISIONS,
  PD_TONE,
  PD_UNSIGNED,
  type OvEvidenceRow,
  type OvHoldWindow,
  type OvPolicyDecision,
} from "./overviewData";
import { impactTone } from "./msChangesModel";
import type { MsPost } from "./msChangesData";
import { RT_TASKS, RT_PILLAR_LABEL } from "./remediationData";
// The project fixture and gantt geometry live in projectsData.ts (Part 8); this
// derivation and the Projects page read the one copy so their gantts can't drift.
import {
  PROJECT_PHASES,
  PJ_SLIPS,
  PJ_SPANS,
  PJ_WIN,
  type ProjectPhase,
} from "./projectsData";
import { deriveHoldClock, type HoldState } from "./holds/holdState";
import { RR_RISKS, type RiskEntry } from "./riskRegisterData";
import { stateTone, type ChangeRequest } from "./ccPageData";
import type { HoldWindow } from "./holds/useRunbooks";
import { NO_SCAN_DATA_LABEL } from "./NoScanDataState";
import type { PortalV2EvaluationStatus } from "./portalV2Model";

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

/**
 * The live twin of `crLanes()` — the tenant's real change requests from
 * `useChangeControl().crs()`, once `dataState === "live"`.
 *
 * A real row's `window` is free text (`portal-change-control.ts`'s
 * `scheduled_for` column, per `ccChangeControlWire.ts`'s own header) and often
 * names no date at all ("Awaiting approval — no window booked") — there is no
 * numeric day offset to place a to-scale bar with. So this reuses the same
 * FIXED-geometry approach `pdLanes`/`acceptedRiskLanes` already use for
 * multi-month spans: the bar communicates state, not a calendar position.
 * `stateTone` is the same colour map the Change Control record itself renders
 * a state in, so a lane here can never disagree with that page's own colour
 * for the same change.
 */
export function crLanesFromLive(crs: readonly ChangeRequest[]): readonly Lane[] {
  return crs.map((c) => {
    const tone = stateTone(c.state);
    const unscheduled = /no window booked/i.test(c.window);
    return {
      key: c.code,
      title: c.title,
      note: c.state,
      dateLabel: unscheduled ? "" : c.window,
      tone,
      bar: unscheduled
        ? { unscheduled: true, left: 0, width: 0, todayLeft: 0, weekStepPct: 0 }
        : { ...ovBar(-20, 220, -20, 240), left: 6, width: 80 },
      fill: `linear-gradient(90deg,${tone},${tone}30)`,
    };
  });
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
 * The live twin of `mcLanes()` — the tenant's real Microsoft 365 Message Center
 * posts from `useMessageCenter().dataset.posts` (the same daily Graph pull the
 * Microsoft Changes page renders), once that dataset is `live`.
 *
 * A real post carries `when` (Microsoft's own free-text land date) and a
 * per-tenant `impact` band, but no numeric day offset from today to place a
 * to-scale bar with — the fixture's `day` is a design contrivance. So this
 * reuses the same FIXED-geometry approach `crLanesFromLive`/`pdLanes` already
 * use: the bar communicates state (`impactTone`, the exact colour the Microsoft
 * Changes page itself renders that impact in, so the two can never disagree),
 * not a calendar position. Posts are ordered soonest-first by `month`, so the
 * lane leads with what lands next rather than in corpus order.
 */
export function mcLanesFromLive(posts: readonly MsPost[]): readonly Lane[] {
  return [...posts]
    .sort((a, b) => a.month - b.month)
    .map((p) => {
      const tone = impactTone(p.impact);
      return {
        key: p.id,
        title: p.title,
        note: p.kind,
        dateLabel: p.when,
        tone,
        bar: { ...ovBar(-20, 220, -20, 240), left: 6, width: 80 },
        fill: `linear-gradient(90deg,${tone},${tone}30)`,
      };
    });
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
export function pdLanes(
  decisions: readonly OvPolicyDecision[] = OV_POLICY_DECISIONS,
): readonly Lane[] {
  return decisions.map((d) => {
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

/**
 * The live twin of `holdLanes()` — the tenant's real hold windows from
 * `useRunbooks().payload.holds`.
 *
 * Unlike the fixture path, the server (`portal-runbooks.ts` /
 * `portal-hold-windows.ts`) has already run `deriveHoldClock` itself and sent
 * the result — `tMinus`, `tone` and `state` on the wire — so this does not
 * re-derive the clock a second time from a `closesAt` timestamp. It only
 * computes `donePct`, which the wire shape does not carry directly: `totalDays`
 * already reflects any real extension the tenant was granted, so the fraction
 * elapsed can't disagree with the T-minus readout sitting next to it.
 */
export function holdLanesFromLive(holds: readonly HoldWindow[]): readonly HoldLane[] {
  return holds.map((h) => {
    const totalHours = h.totalDays * 24;
    const doneHours = Math.max(0, Math.min(totalHours, totalHours - h.hoursLeft));
    return {
      key: h.holdKey,
      title: h.title,
      note: h.gates,
      tMinus: h.tMinus,
      tone: h.tone,
      state: h.state,
      donePct: totalHours ? Math.round((doneHours / totalHours) * 100) : 0,
    };
  });
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
  status: ProjectPhase["status"];
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
export function pjRows(phases: readonly ProjectPhase[] = PROJECT_PHASES): readonly PjRow[] {
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
 *
 * #1406: a zero-findings count is ambiguous on its own — it means either "a
 * real scan found nothing" or "nothing was ever measured". #1392 already
 * resolved that same ambiguity for the score itself via `evaluation`; this
 * takes the same signal so the sub-line can't lie when the number above it is
 * honestly blank. Only `"scored"` is real enough to claim "On track" — the
 * generic `not_evaluated` / `insufficient_data` gate.
 */
export function pillarStripSub(
  counts: { critical: number; warning: number },
  evaluation: PortalV2EvaluationStatus,
): string {
  if (evaluation !== "scored") return NO_SCAN_DATA_LABEL;
  const open = counts.critical + counts.warning;
  if (open === 0) return "On track";
  return `${open} open finding${open === 1 ? "" : "s"}`;
}

/* ────────────────────────────────────────────────────────────────────────────
   The headline stat, the scan band's timing, and the drift chips — real data,
   real absence
   ──────────────────────────────────────────────────────────────────────── */

/**
 * The headline's real total — every open (critical + warning) finding across
 * all six pillars, from the same `findingCounts` the strip below already
 * renders. No second count of "how many things are wrong" is invented.
 *
 * The prototype's second sentence, "3 are easy fixes", has no real counterpart
 * anywhere in this platform — no finding carries an effort/quick-fix
 * classification a client can read — so it is not reproduced. Per the
 * project's own rule, a number with no backing source is left out entirely,
 * never guessed.
 */
export function pillarsOpenFindingsTotal(
  pillars: readonly { findingCounts: { critical: number; warning: number } }[],
): number {
  return pillars.reduce((sum, p) => sum + p.findingCounts.critical + p.findingCounts.warning, 0);
}

/** The headline sentence, built from the real total above. */
export function headlineMain(totalFindings: number | null): string {
  if (totalFindings === null) return "Reading your tenant's risk picture…";
  if (totalFindings === 0) return "Nothing is putting your tenant at risk right now.";
  return `${totalFindings} thing${totalFindings === 1 ? " is" : "s are"} putting your tenant at risk.`;
}

/**
 * The headline's sub-line, gated on the real scan state rather than asserted
 * unconditionally.
 *
 * The design's own line — `OV_HEADLINE_SUB`, "Pulled from your last scan across
 * all six pillars…" — is a CLAIM about a scan, and it is only true once a scan
 * has actually happened. Printing it over a tenant that has never scanned (or
 * before the first poll lands) would be a fabricated provenance, exactly the
 * kind of thing the headline stat above was already made honest about. So this
 * returns the design copy only when there is a real last scan to have pulled
 * from, an honest "not scanned yet" line when the tenant genuinely has none, and
 * nothing at all while the first read is still in flight (the main headline is
 * already saying "Reading your tenant's risk picture…" at that point).
 */
export function headlineSub(loaded: boolean, lastScanAt: string | null): string {
  if (!loaded) return "";
  if (!lastScanAt) return "No scan on record yet — this fills in the moment your first scan lands.";
  return OV_HEADLINE_SUB;
}

/**
 * The evidence pack's rows — the tenant's REAL verified remediation, not a
 * fixture.
 *
 * The band's whole argument is that every row is a fix a re-scan confirmed
 * ("what changed, when the re-scan confirmed it, and which finding it closes").
 * The one place this platform holds that fact is `remediation_tracker_steps`:
 * only `reverifyRemediationTrackerSteps()`, fired from inside a real scan, ever
 * moves a step to `verified` with a `verifiedAt` timestamp (see
 * `useRemediationTracker` / `portal-remediation-tracker.ts`). A ticked-but-
 * unverified step is a claim, not evidence, and is deliberately excluded — the
 * caller passes only `verified` entries.
 *
 * The step's title and pillar come from the remediation catalogue
 * (`remediationData.ts`) joined by the same `stepId` seam `remediationLive.ts`
 * uses; a verified step whose id is not in the catalogue is dropped rather than
 * shown headless. Rows are ordered most-recently-verified first.
 */
export interface VerifiedRemediationStep {
  readonly stepId: string;
  readonly verifiedAt: string | null;
}

const RT_STEP_TO_TASK = new Map(
  RT_TASKS.filter((t) => t.stepId !== null).map((t) => [t.stepId as string, t]),
);

export function evidenceFromVerifiedSteps(
  verified: readonly VerifiedRemediationStep[],
): readonly OvEvidenceRow[] {
  return verified
    .map((v) => ({ v, task: RT_STEP_TO_TASK.get(v.stepId) }))
    .filter((x): x is { v: VerifiedRemediationStep; task: (typeof RT_TASKS)[number] } => !!x.task)
    .sort((a, b) => (b.v.verifiedAt ?? "").localeCompare(a.v.verifiedAt ?? ""))
    .map(({ v, task }) => ({
      title: task.t,
      finding: `${RT_PILLAR_LABEL[task.pl]} · ${task.sv}`,
      when: v.verifiedAt ? timeAgo(v.verifiedAt) : "recently",
      by: "verified by re-scan",
    }));
}

/** Same relative-time rendering `scan-status-indicator.tsx` uses for its own "Last scan: …" line. */
export function timeAgo(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

/**
 * The scan band's "Since your last scan · …" value, from the real
 * `scan-status-context` payload. `loaded` is the shared context's own "first
 * response has landed" flag (success or failure) — distinct from `lastScanAt`
 * being null, which means a real answer of "this tenant has never scanned".
 */
export function lastScanLabel(lastScanAt: string | null, loaded: boolean): string {
  if (!loaded) return "—";
  if (!lastScanAt) return "never";
  return timeAgo(lastScanAt);
}

export interface DriftChip {
  num: string;
  label: string;
  tone: string;
  border: string;
  background: string;
}

const DRIFT_CHIP_STYLE = {
  fixed: { tone: "#34d399", border: "rgba(52,211,153,.28)", background: "rgba(52,211,153,.06)" },
  new: { tone: "#f87171", border: "rgba(248,113,113,.28)", background: "rgba(248,113,113,.06)" },
  accepted: { tone: "#c2a63d", border: "rgba(194,166,61,.3)", background: "rgba(194,166,61,.07)" },
} as const;

/**
 * The scan band's three drift chips.
 *
 * Only `acceptedAsRisk` has a real producer today — the tenant's own accepted
 * risk register, the same live rows `acceptedRiskLanes` renders below.
 * "Fixed this week" / "new this week" would need a real run-to-run finding
 * diff (comparing this tenant's latest completed scan against the one from
 * roughly seven days earlier) — a genuine feature this platform does not
 * compute anywhere yet, not a detail of this page. Per the project's rule on
 * items with no backing source, those two render the honest em-dash rather
 * than an invented count, exactly like `MetricGrid`'s not_available tiles do
 * elsewhere in this build.
 */
export function driftChips(input: {
  fixedThisWeek: number | null;
  newThisWeek: number | null;
  acceptedAsRisk: number | null;
}): readonly DriftChip[] {
  const numOf = (n: number | null) => (n === null ? "—" : String(n));
  return [
    { num: numOf(input.fixedThisWeek), label: "fixed this week", ...DRIFT_CHIP_STYLE.fixed },
    { num: numOf(input.newThisWeek), label: "new this week", ...DRIFT_CHIP_STYLE.new },
    { num: numOf(input.acceptedAsRisk), label: "accepted as risk", ...DRIFT_CHIP_STYLE.accepted },
  ];
}
