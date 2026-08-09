/**
 * Run History — shared types and the label derivations.
 *
 * A "run" here is one real execution the operator started from adminv2: a
 * Deploy Console command (`screens/git/deployStore.ts`) or a SQL Runner
 * query/migration (`screens/sql/sqlStore.ts`). Both already run for real
 * against the live server; this screen is the log they were previously not
 * keeping.
 *
 * Nothing in this module is seeded, sampled or invented. `RUN_HISTORY` in
 * `Design/adminv2/Admin Shell.dc.html` is seven hand-written prototype rows —
 * it is a picture of the shape, not data to port, and an empty log here means
 * nothing has been run yet, which is the honest thing to show.
 *
 * The derivations below (`runTitle`, `runTicket`) are ported from the design's
 * own `histTitle`/`histTicket`, because they encode a real convention Shane
 * already writes to: a leading `--` comment naming what the query is for, and
 * a `#412` / `GH-388` issue reference somewhere in the text.
 */

/**
 * Kept to the design's two filter chips. A manual migration run is a `sql`
 * run whose text lives on the server rather than in the editor — see
 * `migrationFile` — not a third kind, because "Deploy · SQL" is the split the
 * operator actually thinks in.
 */
export type RunKind = "deploy" | "sql";

export interface RunHistoryEntry {
  /** Monotonic within a browser profile. Also the doc/peek record id. */
  id: string;
  kind: RunKind;
  /**
   * What was run, verbatim — the shell command, or the query text. For a
   * manual migration this is the file's repo path, because the SQL itself is
   * only ever read server-side (see `migrationFile`).
   */
  cmd: string;
  /** Derived once, at record time — see `runTitle`. */
  title: string;
  /** `#412` / `GH-388` lifted out of the text, or "" when there is none. */
  ticket: string;
  /** Epoch ms. Day banding and the "when" label are derived from this at render time. */
  startedAt: number;
  /**
   * For SQL, the database's own reported execution time (summed across
   * statements). For a deploy command, wall clock — the route reports no
   * finer figure.
   */
  durationMs: number;
  ok: boolean;
  /**
   * Short consequence chips — "3 rows", "read only", "41 rows changed",
   * "stopped at pnpm install". Every one is derived from what actually came
   * back; there is no fixed vocabulary to pick from.
   */
  effect: string[];
  /** Whatever the run printed. Truncated at `MAX_OUTPUT_CHARS` before storage. */
  output: string;
  /** Free text the operator types on the run afterwards. Persisted with it. */
  note: string;
  /**
   * Set only for a manual migration run (`lib/db/migrations/manual/<file>`).
   * Its SQL is read off the server filesystem, so `cmd` is the path and
   * re-running means asking the server for the file again, not replaying text.
   */
  migrationFile?: string;
}

export type RunFilter = "All" | "Deploy" | "SQL";

export const RUN_FILTERS: readonly RunFilter[] = ["All", "Deploy", "SQL"];

/**
 * A human name for a run, from the text itself.
 *
 * Ported from the design's `histTitle`. Order matters: a leading comment is
 * something the operator wrote on purpose and always wins over a guess.
 */
export function runTitle(text: string): string {
  const first = String(text ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)[0];
  if (!first) return "";

  const comment = /^(?:--|#|\/\/)\s*(.+)$/.exec(first);
  if (comment) {
    const stripped = comment[1]!.replace(/^(?:#\d+|GH-\d+)\s*/i, "").trim();
    return stripped || first;
  }

  const issue = /(?:#|GH-|issue\s*)(\d+)/i.exec(text);
  if (issue) return `Issue ${issue[1]}`;

  return first.length > 52 ? `${first.slice(0, 52)}…` : first;
}

/** The issue reference in the text, or "" — the design's `histTicket`. */
export function runTicket(text: string): string {
  const match = /(#\d+|GH-\d+)/i.exec(String(text ?? ""));
  return match ? match[0] : "";
}

/** "Today" / "Yesterday" / "Earlier" — the design's three day bands, by calendar day. */
export function dayBand(startedAt: number, now: number = Date.now()): string {
  const days = calendarDaysBetween(startedAt, now);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return "Earlier";
}

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function calendarDaysBetween(then: number, now: number): number {
  return Math.round((startOfDay(now) - startOfDay(then)) / 86_400_000);
}

function clockLabel(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * "today 09:12" / "yesterday 17:40" / "Mon 11:06" / "24 Jul 08:00".
 *
 * The design's rows carry pre-baked strings; these are computed at render
 * time instead, so a run recorded yesterday reads "yesterday" today and
 * "Mon" next week rather than staying frozen at whatever it was when it ran.
 */
export function whenLabel(startedAt: number, now: number = Date.now()): string {
  const days = calendarDaysBetween(startedAt, now);
  const clock = clockLabel(startedAt);
  if (days <= 0) return `today ${clock}`;
  if (days === 1) return `yesterday ${clock}`;
  if (days < 7) {
    const weekday = new Date(startedAt).toLocaleDateString(undefined, { weekday: "short" });
    return `${weekday} ${clock}`;
  }
  const date = new Date(startedAt).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  return `${date} ${clock}`;
}

/** "34 ms" / "0.4s" / "22s" / "1m 24s" — the design's own duration ladder. */
export function durationLabel(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const seconds = ms / 1000;
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  const rest = Math.round(seconds - mins * 60);
  return rest === 0 ? `${mins}m` : `${mins}m ${rest}s`;
}

/** "first run" / "run 14x" — the count is of this exact command across the whole log. */
export function repeatLabel(runs: number): string {
  return runs > 1 ? `run ${runs}×` : "first run";
}

/** Collapses a multi-line command onto the row's single mono line, the design's `\n` -> ` ⏎ `. */
export function oneLine(cmd: string): string {
  return String(cmd ?? "").replace(/\s*\n\s*/g, " ⏎ ");
}
