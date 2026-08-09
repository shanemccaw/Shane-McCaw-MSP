/**
 * Presentation helpers shared by the body, the two panels and the peek
 * resolvers, so a severity is never tinted two different colours depending on
 * where you happen to be looking at it.
 *
 * The time vocabulary ("today 08:52", "yesterday 16:30", "Aug 5 11:20") is the
 * design's own — `Admin Shell.dc.html` writes every timestamp that way. The
 * real rows are ISO strings, so the conversion lives here rather than being
 * open-coded at each of the dozen sites that render one.
 */

import { ACCENT, TEXT } from "../../theme";

/** Severity tint. `SEV_COLOR` in the design, verbatim. */
export function severityTone(severity: string): string {
  if (severity === "critical") return ACCENT.danger;
  if (severity === "major") return ACCENT.amberDim;
  return "#7aa7cc";
}

/** Exception-group status tint: open needs attention, resolved is healthy, suppressed is quiet. */
export function exceptionStatusTone(status: string): string {
  if (status === "open") return ACCENT.amberDim;
  if (status === "resolved") return ACCENT.greenBright;
  return TEXT.groupLabel;
}

/** Incident status tint. Resolved is done, monitoring is informational, the rest still need you. */
export function incidentStatusTone(status: string): string {
  if (status === "resolved") return ACCENT.greenBright;
  if (status === "monitoring") return "#7aa7cc";
  return ACCENT.amberDim;
}

function two(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * "today 08:52" / "yesterday 16:30" / "Aug 5 11:20".
 *
 * `now` is injectable purely so the tests can pin it — nothing in the app
 * passes it.
 */
export function whenLabel(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "unknown";

  const clock = `${two(d.getHours())}:${two(d.getMinutes())}`;
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  if (sameDay(d, now)) return `today ${clock}`;

  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (sameDay(d, yesterday)) return `yesterday ${clock}`;

  return `${MONTHS[d.getMonth()]} ${d.getDate()} ${clock}`;
}

/** Date only — for "first seen Aug 3", where the clock adds nothing. */
export function dayLabel(iso: string | null | undefined): string {
  if (!iso) return "never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "unknown";
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** "server/engines/drift.ts:214 · engine" — where an exception group lives. */
export function exceptionWhere(group: { file: string | null; line: number | null; channel: string }): string {
  const at = group.file ? `${group.file}${group.line ? `:${group.line}` : ""}` : "unknown file";
  return `${at} · ${group.channel}`;
}

/**
 * Splits a stored `code_frame` into lines and marks the offending one.
 *
 * `lib/exception-tracker.ts`'s `readCodeFrame` numbers every line and writes
 * `"<n> > <code>"` for the throwing one against `"<n>   <code>"` for its
 * neighbours — the design's `excFrame` looks for the same `>`. The frame is
 * null whenever code frames are disabled or the source file was unreadable at
 * runtime, which is a legitimate state, not an error: the caller renders
 * nothing rather than guessing which line is guilty.
 */
export function codeFrameLines(frame: string | null): { text: string; hit: boolean }[] {
  if (!frame) return [];
  return frame.split("\n").map((text) => ({ text, hit: /^\d+\s+>\s/.test(text) }));
}
