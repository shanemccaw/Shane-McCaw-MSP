/**
 * Run History — shared types and the label derivations.
 *
 * A "run" is one real execution the operator started: a Deploy Console command
 * or a SQL Runner query/migration. The rows come from `simulator_run_history`,
 * written **server-side** by the routes that do the running — see
 * `artifacts/api-server/src/lib/run-history.ts` for why the browser is not
 * asked to report what it saw.
 *
 * What stayed on the client is only what turns a stored row into what you
 * read on screen: how long ago it was, which day band it belongs under, how
 * long it took. Those are computed at render time rather than stored, so a run
 * recorded yesterday reads "yesterday" today and "Mon" next week instead of
 * staying frozen at whatever it was when it ran.
 *
 * The derivations that decide what a row *claims* — its title, its ticket, and
 * its effect chips — live server-side, next to the results they are read off.
 */

/**
 * The design's two filter chips. A manual migration run is a `sql` run whose
 * text lives on the server (see `migrationFile`), not a third kind — Deploy ·
 * SQL is the split the operator actually thinks in.
 */
export type RunKind = "deploy" | "sql";

export interface RunHistoryEntry {
  /** `simulator_run_history.id`, as a string — the doc/peek record id. */
  id: string;
  kind: RunKind;
  /**
   * What was run, verbatim — the shell command, or the query text. For a
   * manual migration this is the file's repo path, because the SQL itself is
   * only ever read server-side.
   */
  cmd: string;
  title: string;
  /** `#412` / `GH-388` lifted out of the text, or "". */
  ticket: string;
  /** ISO 8601, UTC. */
  startedAt: string;
  /** Database execution time for SQL; wall clock for a deploy command. */
  durationMs: number;
  ok: boolean;
  /** Short consequence chips, every one measured from the real result. */
  effect: string[];
  /** Free text the operator writes on the run. The only field not derived. */
  note: string;
  /** How many rows share this exact command — the row's "run 14×". */
  runCount: number;
  /** The list omits `output` (a build transcript is tens of kB); this says whether there is any. */
  hasOutput: boolean;
  /** Present only on the single-run read. Undefined means "not loaded", not "empty". */
  output?: string;
  /** Set only for a manual migration run — its SQL lives on the server. */
  migrationFile?: string | null;
  /** Which admin ran it. Null for rows written before the column meant anything. */
  actorUserId?: number | null;
}

export type RunFilter = "All" | "Deploy" | "SQL";

export const RUN_FILTERS: readonly RunFilter[] = ["All", "Deploy", "SQL"];

export function filterToKind(filter: RunFilter): RunKind | null {
  if (filter === "Deploy") return "deploy";
  if (filter === "SQL") return "sql";
  return null;
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

/** "Today" / "Yesterday" / "Earlier" — the design's three day bands, by calendar day. */
export function dayBand(startedAt: string, now: number = Date.now()): string {
  const days = calendarDaysBetween(Date.parse(startedAt), now);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return "Earlier";
}

/** "today 09:12" / "yesterday 17:40" / "Mon 11:06" / "24 Jul 08:00". */
export function whenLabel(startedAt: string, now: number = Date.now()): string {
  const ms = Date.parse(startedAt);
  if (Number.isNaN(ms)) return startedAt;
  const days = calendarDaysBetween(ms, now);
  const clock = clockLabel(ms);
  if (days <= 0) return `today ${clock}`;
  if (days === 1) return `yesterday ${clock}`;
  if (days < 7) {
    const weekday = new Date(ms).toLocaleDateString(undefined, { weekday: "short" });
    return `${weekday} ${clock}`;
  }
  const date = new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short" });
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

/** "first run" / "run 14x" — counted across the whole table, not just the loaded page. */
export function repeatLabel(runs: number): string {
  return runs > 1 ? `run ${runs}×` : "first run";
}

/** Collapses a multi-line command onto the row's single mono line, the design's `\n` -> ` ⏎ `. */
export function oneLine(cmd: string): string {
  return String(cmd ?? "").replace(/\s*\n\s*/g, " ⏎ ");
}
