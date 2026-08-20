/**
 * portal-hold-windows.ts — the hold-window state machine.
 *
 * A hold window is a runbook step that gates the steps after it and waits on
 * ELAPSED TIME rather than on work: "enable CA01 in report-only, wait 7 days,
 * then decide". The tenant is scanned while the window runs, so a window can
 * close early when the evidence says waiting adds nothing.
 *
 * Everything here is pure. It takes a stored window and a clock and returns
 * what to render and what to notify. That matters more than usual because the
 * design prototype's own version of this logic has FOUR REAL DEFECTS, and the
 * brief for this build is to fix them rather than port them. Each fix is
 * labelled below and has a named test in portal-hold-windows.test.ts pinned to
 * the prototype's own fixture data, so a future edit that reintroduces one
 * fails on a real example rather than a synthetic one.
 *
 * ── DEFECT 1: `closing` is unreachable when the verdict is `clear` ──────────
 * The prototype's state ternary (proto 7053) is:
 *
 *     hoursLeft <= 0 ? 'due' : clear ? 'early' : hoursLeft <= 24 ? 'closing' : 'running'
 *
 * `clear` is tested BEFORE proximity, so a clear window with three hours left
 * still reads "Can close early" and never "closes tomorrow". Worse, the button
 * it produces reads "Close the window 0 days early", which is not an action.
 *
 * FIX: proximity is tested first. A window inside its final 24 hours is
 * `closing` (or `due`) whatever the scan says — the scan verdict changes the
 * ADVICE, not how close the deadline is.
 *
 * ── DEFECT 2: `early` overstates how many days it saves ─────────────────────
 * The prototype uses `Math.ceil(hoursLeft / 24)` for the days-left figure and
 * feeds it straight into "Close the window N days early". On its own
 * `hold-guest` fixture — 217 hours remaining, i.e. 9 days and 1 hour — that
 * renders "Close the window 10 days early", promising a day that does not
 * exist. The README's own alerting copy gives the correct figure for the same
 * window: "you don't need to wait the remaining 9 days".
 *
 * FIX: `Math.floor` for whole days saved, and `early` additionally requires at
 * least one whole day to actually be saved. Rounding UP is the wrong direction
 * for a deadline in any case — a countdown that overstates the time available
 * is the one that gets somebody caught out.
 *
 * ── DEFECT 3: "closes tomorrow" is asserted from hours, not from a date ─────
 * The prototype's badge says "closes tomorrow" for any window with 24 hours or
 * fewer remaining (proto 7055). At 01:00 UTC a 20-hour remainder closes at
 * 21:00 the SAME day, and the badge still claims tomorrow.
 *
 * FIX: the word is chosen by comparing UTC calendar dates — today, tomorrow, or
 * neither — not by an hours threshold.
 *
 * ── DEFECT 4: the badge and the T-minus readout use different thresholds ────
 * The badge switches state at 24 hours; the readout switches from hours to days
 * at 48 (proto 7056). A window 30 hours out therefore renders the pair
 * "Holding" and "T-30h" — a state that reads relaxed beside a number that reads
 * urgent.
 *
 * FIX: one threshold, at 24 hours, shared by both. Under 24 hours the readout
 * is in hours and the state is `closing` or `due`; at or above it the readout
 * is in days and the state is `running` or `early`.
 *
 * ── Also not carried over ──────────────────────────────────────────────────
 * `HOLD_DEFS[].c` (proto 7010) is a per-window colour that nothing ever reads —
 * card colour comes entirely from `tone`, which is derived from state. It is
 * absent from the schema rather than stored and ignored.
 *
 * ── The clock is a parameter ───────────────────────────────────────────────
 * The prototype pins `HOLD_NOW` to a literal (proto 7008). Every function here
 * takes `now` explicitly: it is what makes the four defects testable at exact
 * boundaries, and it is what lets the portal re-derive on an interval so T-24
 * arrives without a page reload.
 */

/** The four states, in the order the README's table lists them. */
export const HOLD_STATES = ["running", "closing", "due", "early"] as const;
export type HoldState = typeof HOLD_STATES[number];

export const HOLD_SCAN_VERDICTS = ["clear", "signals", "watch"] as const;
export type HoldScanVerdict = typeof HOLD_SCAN_VERDICTS[number];

/**
 * The tone per state — the README's own hex values, which are also the only
 * thing that decides a card's colour (see "Also not carried over").
 */
export const HOLD_TONE: Record<HoldState, string> = {
  running: "#64748b",
  closing: "#fbbf24",
  due: "#60a5fa",
  early: "#22d3ee",
};

/** The single proximity threshold, shared by the state machine and the readout — see DEFECT 4. */
export const HOLD_CLOSING_THRESHOLD_HOURS = 24;

const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

/** The stored fields the derivation needs. A subset of `portal_hold_windows`. */
export interface HoldWindowInput {
  readonly startedAt: Date | string;
  /** The originally agreed wait. */
  readonly waitDays: number;
  /** Days added by extensions. Kept separate so an extended window stays visibly extended. */
  readonly extendedDays?: number;
  readonly scanVerdict: HoldScanVerdict;
  readonly closedAt?: Date | string | null;
}

export interface HoldWindowDerived {
  readonly state: HoldState;
  readonly tone: string;
  /** Milliseconds from `now` to the close moment. Negative once the window has passed. */
  readonly msLeft: number;
  /**
   * Whole hours remaining, rounded toward zero. Never rounds UP — see DEFECT 2
   * for why a deadline countdown must not overstate the time available.
   */
  readonly hoursLeft: number;
  /** Whole days remaining, rounded toward zero. */
  readonly daysLeft: number;
  /** Whole days that closing now would actually save. 0 unless the state is `early`. */
  readonly daysSaved: number;
  /** The effective wait in days: the agreed wait plus every extension. */
  readonly totalDays: number;
  /** Hours elapsed, clamped into [0, totalDays * 24]. */
  readonly hoursDone: number;
  /** The moment the window closes. */
  readonly closesAt: Date;
  readonly isClosed: boolean;
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

/** The agreed wait plus extensions. Never negative. */
export function effectiveWaitDays(input: HoldWindowInput): number {
  return Math.max(0, input.waitDays + (input.extendedDays ?? 0));
}

export function closesAt(input: HoldWindowInput): Date {
  return new Date(toDate(input.startedAt).getTime() + effectiveWaitDays(input) * MS_PER_DAY);
}

/**
 * The state machine, with DEFECT 1 and DEFECT 2 fixed.
 *
 * Order is load-bearing and is the fix: proximity is tested BEFORE the scan
 * verdict, so `closing` is reachable regardless of what the scan found. Compare
 * with the prototype's ternary quoted in the header, where `clear` short-
 * circuits ahead of the 24-hour test.
 */
export function deriveHoldState(input: HoldWindowInput, now: Date): HoldState {
  const msLeft = closesAt(input).getTime() - now.getTime();

  // Past the close moment: a decision is owed regardless of verdict.
  if (msLeft <= 0) return "due";

  // Inside the final 24 hours. FIX FOR DEFECT 1: this is tested before the
  // verdict, so a `clear` window three hours out reads "closes today", not
  // "can close early" — there is no meaningful early left to offer.
  if (msLeft <= HOLD_CLOSING_THRESHOLD_HOURS * MS_PER_HOUR) return "closing";

  // FIX FOR DEFECT 2: `early` requires the scan to be clear AND at least one
  // WHOLE day to actually be saved. `Math.floor` is what stops the prototype's
  // "close 10 days early" on a window with 9 days and 1 hour left.
  if (input.scanVerdict === "clear" && Math.floor(msLeft / MS_PER_DAY) >= 1) return "early";

  return "running";
}

export function deriveHoldWindow(input: HoldWindowInput, now: Date): HoldWindowDerived {
  const closes = closesAt(input);
  const msLeft = closes.getTime() - now.getTime();
  const totalDays = effectiveWaitDays(input);
  const totalHours = totalDays * 24;

  // Toward zero, never up — see DEFECT 2.
  const hoursLeft = Math.trunc(msLeft / MS_PER_HOUR);
  const daysLeft = Math.max(0, Math.floor(msLeft / MS_PER_DAY));
  const state = deriveHoldState(input, now);
  const hoursDone = Math.max(0, Math.min(totalHours, totalHours - hoursLeft));

  return {
    state,
    tone: HOLD_TONE[state],
    msLeft,
    hoursLeft,
    daysLeft,
    daysSaved: state === "early" ? daysLeft : 0,
    totalDays,
    hoursDone,
    closesAt: closes,
    isClosed: Boolean(input.closedAt),
  };
}

/**
 * "today" / "tomorrow" / null, by UTC CALENDAR DATE — the fix for DEFECT 3.
 *
 * Everything in this platform is stored and reasoned about in UTC (the schema
 * file's own header rule), so the comparison is UTC-to-UTC. That is a real
 * limitation worth stating rather than hiding: a customer in UTC+13 reading
 * "closes today" at 23:00 their time is being told about the UTC day. Fixing
 * that properly means carrying the tenant's timezone, which nothing in the
 * schema does yet.
 */
export function closesDayWord(closes: Date, now: Date): "today" | "tomorrow" | null {
  const dayIndex = (d: Date) => Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / MS_PER_DAY);
  const delta = dayIndex(closes) - dayIndex(now);
  if (delta === 0) return "today";
  if (delta === 1) return "tomorrow";
  return null;
}

/**
 * The badge text. DEFECT 3's fix lands here: the `closing` badge names the real
 * calendar day rather than always saying "tomorrow".
 */
export function holdBadge(input: HoldWindowInput, now: Date): string {
  const d = deriveHoldWindow(input, now);
  switch (d.state) {
    case "due": {
      const hoursAgo = Math.abs(d.hoursLeft);
      return hoursAgo === 0 ? "T-0 · decision due" : `T-0 · decision due ${hoursAgo}h ago`;
    }
    case "closing": {
      const word = closesDayWord(d.closesAt, now);
      const when = word ? `closes ${word}` : "closes within a day";
      return `T-${Math.max(0, d.hoursLeft)}h · ${when}`;
    }
    case "early":
      return "Can close early";
    default:
      return "Holding";
  }
}

/**
 * The large T-minus readout. DEFECT 4's fix lands here: the hours/days switch
 * is at HOLD_CLOSING_THRESHOLD_HOURS, the same boundary the state machine uses,
 * so the badge and this figure can never disagree about urgency.
 */
export function holdTMinus(input: HoldWindowInput, now: Date): string {
  const d = deriveHoldWindow(input, now);
  if (d.state === "due") {
    const hoursAgo = Math.abs(d.hoursLeft);
    return hoursAgo === 0 ? "T-0" : `Closed ${hoursAgo}h ago`;
  }
  if (d.msLeft <= HOLD_CLOSING_THRESHOLD_HOURS * MS_PER_HOUR) return `T-${Math.max(0, d.hoursLeft)}h`;
  return `T-${d.daysLeft}d`;
}

/** The scan verdict, in the design's words (proto 7057). */
export function holdScanLabel(verdict: HoldScanVerdict): string {
  switch (verdict) {
    case "clear":
      return "Scan says: no further interruption expected";
    case "signals":
      return "Scan says: enforcing today would break something";
    default:
      return "Scan says: watch this one";
  }
}

/** The scan label's colour (proto 7058). */
export function holdScanTone(verdict: HoldScanVerdict): string {
  switch (verdict) {
    case "clear":
      return "#22d3ee";
    case "signals":
      return "#f87171";
    default:
      return "#94a3b8";
  }
}

/**
 * The primary action offered, per the README's decision table. The `early`
 * label carries `daysSaved`, which is the floored figure — the prototype's
 * ceiling is what produced "Close the window 10 days early" on a window with
 * nine days left.
 */
export function holdPrimaryAction(
  input: HoldWindowInput,
  now: Date,
): { readonly kind: "release" | "decide" | "close_early" | "prepare_cr"; readonly label: string } {
  const d = deriveHoldWindow(input, now);
  if (d.state === "due") {
    return input.scanVerdict === "signals"
      ? { kind: "decide", label: "Decide — release, exclude or extend" }
      : { kind: "release", label: "Release the gated step" };
  }
  if (d.state === "early") {
    return {
      kind: "close_early",
      label: `Close the window ${d.daysSaved} day${d.daysSaved === 1 ? "" : "s"} early`,
    };
  }
  return { kind: "prepare_cr", label: "Prepare the change request now" };
}

/**
 * The README's alerting contract, as data.
 *
 * "A window must notify at T-24 and at T-0, and again the moment a scan turns
 * the verdict to `clear` before the window ends. The third is not a reminder —
 * it is a finding."
 *
 * This reports which of the three are DUE for a given window and clock, taking
 * the already-sent stamps into account so nothing re-fires. It deliberately
 * sends nothing: the transport is out of round one (BUILD_PLAN §7), and keeping
 * the decision pure is what lets it be tested at the exact boundary.
 */
export const HOLD_NOTIFICATIONS = ["t24", "t0", "early_clear"] as const;
export type HoldNotification = typeof HOLD_NOTIFICATIONS[number];

export interface HoldNotificationState {
  readonly notifiedT24At?: Date | string | null;
  readonly notifiedT0At?: Date | string | null;
  readonly notifiedEarlyClearAt?: Date | string | null;
}

export function dueHoldNotifications(
  input: HoldWindowInput & HoldNotificationState,
  now: Date,
): HoldNotification[] {
  // A closed window owes nobody anything.
  if (input.closedAt) return [];

  const d = deriveHoldWindow(input, now);
  const due: HoldNotification[] = [];

  // T-24 becomes due the moment the window enters its final 24 hours, and stays
  // due until sent — a window that passed T-24 while nothing was watching must
  // still notify rather than silently skipping it.
  if (!input.notifiedT24At && d.msLeft <= HOLD_CLOSING_THRESHOLD_HOURS * MS_PER_HOUR) {
    due.push("t24");
  }

  if (!input.notifiedT0At && d.msLeft <= 0) {
    due.push("t0");
  }

  // The finding, not a reminder: the scan turned clear while the window still
  // has real time left to save. Guarded on `daysSaved >= 1` for the same reason
  // `early` is — "you don't need to wait the remaining 0 days" is not a finding.
  if (!input.notifiedEarlyClearAt && d.state === "early" && d.daysSaved >= 1) {
    due.push("early_clear");
  }

  return due;
}

/**
 * The day-tick track under each card (proto 7060-7065): one tick per day of the
 * effective wait, filled for a day fully elapsed, half-lit for the day in
 * progress.
 */
export function holdDayTicks(
  input: HoldWindowInput,
  now: Date,
): ReadonlyArray<"done" | "partial" | "todo"> {
  const d = deriveHoldWindow(input, now);
  return Array.from({ length: d.totalDays }, (_, i) => {
    if ((i + 1) * 24 <= d.hoursDone) return "done";
    if (i * 24 < d.hoursDone) return "partial";
    return "todo";
  });
}

/**
 * The provenance line the card prints, composed from the three stored parts
 * rather than stored as finished prose — "{source}, scanned {cadence}, last
 * {HH:MM}". Storing the sentence would mean a timestamp that never updates.
 */
export function holdScanProvenance(input: {
  scanSource: string;
  scanCadence: string;
  scanAt?: Date | string | null;
}): string {
  const parts = [input.scanSource, `scanned ${input.scanCadence}`];
  if (input.scanAt) {
    const at = toDate(input.scanAt);
    if (!Number.isNaN(at.getTime())) {
      const hh = String(at.getUTCHours()).padStart(2, "0");
      const mm = String(at.getUTCMinutes()).padStart(2, "0");
      parts.push(`last ${hh}:${mm} UTC`);
    }
  }
  return parts.join(", ");
}

/**
 * The runbook status label the card shows, which the design derives from the
 * window rather than from the runbook (proto 16866): a runbook carrying an open
 * hold is `Holding` / `Decision due` / `Clear to close early` in preference to
 * `On track` or `Overdue`.
 */
export function runbookStatusFromHold(state: HoldState): string {
  switch (state) {
    case "due":
      return "Decision due";
    case "early":
      return "Clear to close early";
    case "closing":
      return "Holding";
    default:
      return "Holding";
  }
}
