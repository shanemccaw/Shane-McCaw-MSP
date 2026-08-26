/**
 * retainerModel.ts — the My Architect (retainer) derivations.
 *
 * Prototype references are to `Customer Portal Shell.dc.html`.
 *
 * The page shows the SAME hour budget at two zoom levels — a month rollup and a
 * selectable week — and every headline number (used, available, remaining, the
 * used percentage, each week's logged total) is DERIVED from `RET_HOURS` and the
 * week list rather than typed in. Deriving it once here, and pinning it in
 * `retainerModel.test.ts`, is what stops the progress bar and the "of N hours"
 * label drifting apart the first time the fixture changes.
 */

import {
  RET_HOURS,
  RET_WEEKS,
  type RetOutcomeTone,
  type RetWeek,
  type RetWorkState,
} from "./retainerData";

/** `retAvailable` — retained plus rolled-forward. Prototype 15857. */
export const RET_AVAILABLE = RET_HOURS.retained + RET_HOURS.rolled;
/** `retRemaining` — what is left after the hours used. Prototype 15858. */
export const RET_REMAINING = RET_AVAILABLE - RET_HOURS.used;
/** `retUsedPct` — the progress bar's fill, as a whole percent. Prototype 15859. */
export const RET_USED_PCT = Math.round((RET_HOURS.used / RET_AVAILABLE) * 100);

/** One decimal, the way every hour figure on the page is written. */
export function formatHours(n: number): string {
  return n.toFixed(1);
}

/** `<n> h` — a logged-time chip. Prototype 15869, 15928, 15943. */
export function hoursChip(n: number): string {
  return `${formatHours(n)} h`;
}

export interface RetSummary {
  readonly used: string;
  readonly available: string;
  readonly remaining: string;
  readonly rolled: string;
  readonly usedPctLabel: string;
  readonly usedPct: number;
}

/**
 * The four headline hour figures, pre-formatted, from an arbitrary
 * retained/rolled/used triple — real (the customer's live bucket, #1285) or
 * fixture (`RET_HOURS`). Kept as one derivation so the live and fixture paths
 * can never compute the bar fill / remaining figure differently.
 */
export function computeRetSummary(hours: { retained: number; rolled: number; used: number }): RetSummary {
  const available = hours.retained + hours.rolled;
  const remaining = available - hours.used;
  const usedPct = available > 0 ? Math.round((hours.used / available) * 100) : 0;
  return {
    used: formatHours(hours.used),
    available: formatHours(available),
    remaining: formatHours(remaining),
    rolled: formatHours(hours.rolled),
    usedPctLabel: `${usedPct}%`,
    usedPct,
  };
}

/**
 * The four headline hour figures, pre-formatted. Prototype 19617-19622.
 * Kept together so the summary card reads one object rather than four calls.
 */
export const retSummary = computeRetSummary(RET_HOURS);

/**
 * A work row's right-hand state colour. Prototype 15874: Closed is the green
 * "done", In progress is the blue "moving", everything else is the amber
 * "waiting" — the three states the design colours, not a per-string map.
 */
export function workStateColor(state: RetWorkState): string {
  if (state === "Closed") return "#34d399";
  if (state === "In progress") return "#60a5fa";
  return "#c2a63d";
}

/**
 * A pillar chip's text colour. Prototype 15872: Compliance's near-white
 * `#E2E8F0` would not hold as text, so it drops to `#cbd5e1`; every other
 * pillar uses its own identity colour directly.
 */
export function pillarTextColor(color: string): string {
  return color === "#E2E8F0" ? "#cbd5e1" : color;
}

/** An outcome dot's colour, by tone. Prototype 15962. */
export function outcomeToneColor(tone: RetOutcomeTone): string {
  const map: Record<RetOutcomeTone, string> = {
    green: "#34d399",
    blue: "#60a5fa",
    amber: "#c2a63d",
  };
  return map[tone];
}

/**
 * The selected week, CLAMPED to a real one. The key arrives from component
 * state (the prototype) or could arrive from anywhere a caller passes it, so an
 * unknown key falls back to the current week rather than returning undefined
 * and throwing while the report renders. Prototype 15935 uses the same
 * `find(...) || RET_WEEKS[0]` fallback; the default here is the *current* week
 * (`W34`), which is `RET_WEEKS[0]`.
 */
export function selectWeek(key: string | null | undefined, weeks: readonly RetWeek[] = RET_WEEKS): RetWeek {
  return weeks.find((w) => w.key === key) ?? weeks[0];
}

/** "You" for the customer, the architect's name for the reply. Prototype 15949. */
export function askWho(who: "you" | "them"): string {
  return who === "you" ? "You" : "Priya Raman";
}

export interface RetWeekView {
  readonly key: string;
  readonly label: string;
  readonly range: string;
  readonly author: string;
  readonly published: string;
  readonly summary: string;
  /** `<n> h logged` — prototype 15942. */
  readonly hours: string;
  readonly log: readonly { readonly what: string; readonly hours: string }[];
  readonly hasLog: boolean;
  readonly deliverables: readonly string[];
  readonly hasDeliverables: boolean;
  readonly asks: readonly {
    readonly who: string;
    readonly when: string;
    readonly text: string;
    /** `true` for the customer's own question — drives the two-tone row. */
    readonly fromYou: boolean;
  }[];
  readonly hasAsks: boolean;
}

/**
 * The selected week, shaped for the report card. Prototype 15936-15954.
 * Formats the hour figures, maps the ask authors, and carries the three
 * `has*` flags the design uses to omit an empty log / deliverables / asks block
 * rather than draw an empty heading.
 */
export function buildWeekView(key: string | null | undefined, weeks: readonly RetWeek[] = RET_WEEKS): RetWeekView {
  const week = selectWeek(key, weeks);
  return {
    key: week.key,
    label: week.label,
    range: week.range,
    author: week.author,
    published: week.published,
    summary: week.summary,
    hours: `${hoursChip(week.hours)} logged`,
    log: week.log.map((l) => ({ what: l.what, hours: hoursChip(l.hours) })),
    hasLog: week.log.length > 0,
    deliverables: week.deliverables,
    hasDeliverables: week.deliverables.length > 0,
    asks: week.asks.map((a) => ({
      who: askWho(a.who),
      when: a.when,
      text: a.text,
      fromYou: a.who === "you",
    })),
    hasAsks: week.asks.length > 0,
  };
}
