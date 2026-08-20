/**
 * holdState.ts — the client-side mirror of the hold-window derivation.
 *
 * ── Why this exists at all, given the server already derives it ────────────
 * The README is explicit: "use the real clock in production, and re-derive
 * state on an interval so T-24 fires without a reload." A window sitting at
 * T-25h when the page loads must become `closing` an hour later on a page
 * nobody has touched. Re-fetching every minute to discover that would be a
 * request per minute per open tab to learn something the browser can work out
 * from a timestamp it already has.
 *
 * So: the server sends `closesAt` and `scanVerdict`, and this recomputes the
 * state from them on a tick. The server's answer stays authoritative for
 * anything that matters — it is what raises change requests and what will drive
 * the alerting transport — and this is only ever the display between fetches.
 *
 * ── This is a deliberate second copy, and it is guarded ───────────────────
 * Two implementations of one rule is a real risk, and the house answer to it is
 * the drift test: `remediation-tracker-catalogue.test.ts` and
 * `portal-remediation-tracker-step-ids.test.ts` do exactly this for the
 * remediation step catalogue, each reading the other side's list. Here,
 * `holdState.test.ts` pins the SAME four defect cases, at the SAME boundaries,
 * with the SAME expected answers as the server's `portal-hold-windows.test.ts`.
 * If either side is changed alone, one of the two suites goes red.
 *
 * The four defects being guarded against — all present in the design
 * prototype's own version of this logic, all fixed here and on the server:
 *   1. `closing` unreachable when the verdict is `clear`.
 *   2. `early` overstating the days it saves (Math.ceil, no proximity floor).
 *   3. "closes tomorrow" asserted from an hours threshold, not a calendar date.
 *   4. The badge and the T-minus readout switching at different thresholds.
 * See `api-server/src/lib/portal-hold-windows.ts` for the full write-up.
 */

export type HoldState = "running" | "closing" | "due" | "early";
export type HoldScanVerdict = "clear" | "signals" | "watch";

/** The README's tone per state. */
export const HOLD_TONE: Record<HoldState, string> = {
  running: "#64748b",
  closing: "#fbbf24",
  due: "#60a5fa",
  early: "#22d3ee",
};

/** One threshold, shared by the state machine and the readout — the fix for defect 4. */
export const HOLD_CLOSING_THRESHOLD_HOURS = 24;

const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

export interface HoldClockInput {
  /** ISO string from the server. */
  readonly closesAt: string;
  readonly scanVerdict: HoldScanVerdict;
  readonly closedAt?: string | null;
}

export interface HoldClock {
  readonly state: HoldState;
  readonly tone: string;
  readonly msLeft: number;
  readonly hoursLeft: number;
  readonly daysLeft: number;
  readonly daysSaved: number;
  readonly badge: string;
  readonly tMinus: string;
}

/**
 * The state machine. Order is load-bearing: proximity is tested BEFORE the scan
 * verdict, which is the fix for defect 1 — the prototype tested `clear` first,
 * so a clear window three hours out could never read `closing`.
 */
export function deriveHoldState(input: HoldClockInput, now: Date): HoldState {
  const msLeft = new Date(input.closesAt).getTime() - now.getTime();
  if (msLeft <= 0) return "due";
  if (msLeft <= HOLD_CLOSING_THRESHOLD_HOURS * MS_PER_HOUR) return "closing";
  // Floor, and at least one whole day actually saved — the fix for defect 2.
  if (input.scanVerdict === "clear" && Math.floor(msLeft / MS_PER_DAY) >= 1) return "early";
  return "running";
}

/** "today" / "tomorrow" / null by UTC CALENDAR DATE — the fix for defect 3. */
export function closesDayWord(closes: Date, now: Date): "today" | "tomorrow" | null {
  const dayIndex = (d: Date) =>
    Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / MS_PER_DAY);
  const delta = dayIndex(closes) - dayIndex(now);
  if (delta === 0) return "today";
  if (delta === 1) return "tomorrow";
  return null;
}

export function deriveHoldClock(input: HoldClockInput, now: Date): HoldClock {
  const closes = new Date(input.closesAt);
  const msLeft = closes.getTime() - now.getTime();
  // Toward zero, never up: a countdown that overstates the time available is
  // the one that catches somebody out.
  const hoursLeft = Math.trunc(msLeft / MS_PER_HOUR);
  const daysLeft = Math.max(0, Math.floor(msLeft / MS_PER_DAY));
  const state = deriveHoldState(input, now);
  const daysSaved = state === "early" ? daysLeft : 0;

  let badge: string;
  if (state === "due") {
    const ago = Math.abs(hoursLeft);
    badge = ago === 0 ? "T-0 · decision due" : `T-0 · decision due ${ago}h ago`;
  } else if (state === "closing") {
    const word = closesDayWord(closes, now);
    badge = `T-${Math.max(0, hoursLeft)}h · ${word ? `closes ${word}` : "closes within a day"}`;
  } else if (state === "early") {
    badge = "Can close early";
  } else {
    badge = "Holding";
  }

  let tMinus: string;
  if (state === "due") {
    const ago = Math.abs(hoursLeft);
    tMinus = ago === 0 ? "T-0" : `Closed ${ago}h ago`;
  } else if (msLeft <= HOLD_CLOSING_THRESHOLD_HOURS * MS_PER_HOUR) {
    tMinus = `T-${Math.max(0, hoursLeft)}h`;
  } else {
    tMinus = `T-${daysLeft}d`;
  }

  return { state, tone: HOLD_TONE[state], msLeft, hoursLeft, daysLeft, daysSaved, badge, tMinus };
}

/** The primary action label, matching the server's `holdPrimaryAction`. */
export function holdPrimaryLabel(input: HoldClockInput, now: Date): string {
  const c = deriveHoldClock(input, now);
  if (c.state === "due") {
    return input.scanVerdict === "signals"
      ? "Decide — release, exclude or extend"
      : "Release the gated step";
  }
  if (c.state === "early") {
    return `Close the window ${c.daysSaved} day${c.daysSaved === 1 ? "" : "s"} early`;
  }
  return "Prepare the change request now";
}
