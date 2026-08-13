/**
 * Simulator Studio's Run History — the recorder.
 *
 * One row per command or query actually run from the admin console, written
 * **here, server-side**, by the routes that do the running: the Deploy
 * Console's two POSTs (`admin-deploy-console.ts`) and the SQL/migration
 * executors (`admin-engines.ts`). The browser is not asked to report what it
 * saw. That is the whole point of the table:
 *
 * - a run is kept even when the tab is closed, the response never arrives, or
 *   the admin walked away mid-`pnpm install`;
 * - a second admin's runs show up in the first admin's history;
 * - the row cannot disagree with what the server actually did, because
 *   nothing in between gets to reinterpret it.
 *
 * ## Recording never breaks a run
 *
 * Every entry point here swallows its own failures. A deploy that succeeded
 * and a history row that could not be written is a logging problem; turning it
 * into a failed deploy would be a much worse one. In particular the table is
 * provisioned by a manual migration Shane runs himself
 * (`lib/db/migrations/manual/2026-08-09-simulator-run-history.sql`), so
 * "relation does not exist" is an expected state until he does — it warns once
 * per process and is otherwise silent, the same way
 * `admin-engines.ts` already degrades around `simulator_migration_runs`.
 *
 * ## The effect strings are measured, not declared
 *
 * `effect` is the short consequence list a row shows ("read only", "41 rows
 * changed", "stopped at pnpm install"). Every entry comes off the real result:
 * a SQL statement that came back with `fields` returned rows, one that came
 * back with a `rowCount` and no fields changed them. Reading that off the
 * query text instead would call `insert ... returning` read-only — which is
 * exactly the direction that gets someone hurt — so it is never done.
 *
 * A free-typed deploy command gets no kind at all, and therefore claims
 * nothing about its effect. Only the six whitelisted operations, whose
 * read/write nature is known from the whitelist itself, can say "read only".
 */

import { pool } from "@workspace/db";
import { logger } from "./logger";

const log = logger.child({ channel: "admin.runHistory" });

export const RUN_HISTORY_TABLE = "simulator_run_history";
export const RUN_HISTORY_MIGRATION = "2026-08-09-simulator-run-history.sql";

/** Past this the tail is dropped, with a marker saying so. A `pnpm build` transcript is the long one. */
export const MAX_OUTPUT_CHARS = 20_000;

export type RunKind = "deploy" | "sql";

/** Postgres `undefined_table`. The expected state until the manual migration is run. */
const UNDEFINED_TABLE = "42P01";

export function isMissingTableError(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === UNDEFINED_TABLE;
}

let warnedMissing = false;

function handleWriteError(err: unknown, context: Record<string, unknown>): void {
  if (isMissingTableError(err)) {
    if (!warnedMissing) {
      warnedMissing = true;
      log.warn(
        { ...context, migration: RUN_HISTORY_MIGRATION },
        `${RUN_HISTORY_TABLE} does not exist — run history is not being kept until the manual migration is run`,
      );
    }
    return;
  }
  log.error({ ...context, err }, "failed to record a run");
}

// ── Derivations ──────────────────────────────────────────────────────────────

/**
 * A human name for a run, from the text itself.
 *
 * Order matters: a leading comment is something the operator wrote on purpose
 * and always beats a guess. Ported from the design's `histTitle`, because it
 * encodes a convention Shane already writes to — `-- #412 tenants still
 * missing a consent row`.
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

/** The issue reference in the text, or '' — the design's `histTicket`. */
export function runTicket(text: string): string {
  const match = /(#\d+|GH-\d+)/i.exec(String(text ?? ""));
  return match ? match[0] : "";
}

export function truncateOutput(output: string): string {
  if (output.length <= MAX_OUTPUT_CHARS) return output;
  return `${output.slice(0, MAX_OUTPUT_CHARS)}\n… ${output.length - MAX_OUTPUT_CHARS} more characters, not kept`;
}

/** One step of a deploy run — matches `admin-deploy-console.ts`'s `StepResult`. */
export interface DeployStepLike {
  label: string;
  command: string;
  ok: boolean;
  output: string;
}

/** One statement result — matches `admin-engines.ts`'s `StatementResult`. */
export interface SqlStatementLike {
  success: boolean;
  rows: unknown[];
  rowCount: number;
  fields: string[];
  executionMs: number;
  error?: string;
}

export function deployEffect(steps: DeployStepLike[], ok: boolean, opKind?: "read" | "write" | "heavy"): string[] {
  const effect: string[] = [];
  if (opKind === "read") effect.push("read only");
  if (steps.length > 1) effect.push(`${steps.length} steps`);
  const failed = steps.find((s) => !s.ok);
  if (failed) effect.push(`stopped at ${failed.label}`);
  if (!ok && steps.length === 0) effect.push("did not run");
  return effect;
}

export function sqlEffect(statements: SqlStatementLike[]): string[] {
  const effect: string[] = [];
  if (statements.length > 1) effect.push(`${statements.length} statements`);

  const returning = statements.filter((s) => s.success && s.fields.length > 0);
  const changing = statements.filter((s) => s.success && s.fields.length === 0 && s.rowCount > 0);

  if (returning.length > 0) {
    const rows = returning.reduce((total, s) => total + s.rowCount, 0);
    effect.push(`${rows} row${rows === 1 ? "" : "s"}`);
  }
  if (changing.length > 0) {
    const rows = changing.reduce((total, s) => total + s.rowCount, 0);
    effect.push(`${rows} row${rows === 1 ? "" : "s"} changed`, "writes");
  } else if (returning.length > 0) {
    effect.push("read only");
  }

  const failedIndex = statements.findIndex((s) => !s.success);
  if (returning.length === 0 && changing.length === 0 && statements.length > 0 && failedIndex < 0) {
    effect.push("no rows returned");
  }
  if (failedIndex >= 0) effect.push(`failed at statement ${failedIndex + 1}`);

  return effect;
}

/** Tab-separated, the same shape the SQL Runner's own "Copy all" produces. */
export function formatStatements(statements: SqlStatementLike[]): string {
  return statements
    .map((s) => {
      if (!s.success) return `-- error: ${s.error ?? "failed"}`;
      if (s.fields.length === 0) return `-- ${s.rowCount} row${s.rowCount === 1 ? "" : "s"}, nothing returned`;
      const rows = s.rows as Record<string, unknown>[];
      return [s.fields.join("\t"), ...rows.map((row) => s.fields.map((f) => String(row[f])).join("\t"))].join("\n");
    })
    .join("\n\n");
}

// ── Writes ───────────────────────────────────────────────────────────────────

interface InsertArgs {
  kind: RunKind;
  cmd: string;
  title: string;
  ticket: string;
  startedAt: Date;
  durationMs: number;
  ok: boolean;
  effect: string[];
  output: string;
  migrationFile: string | null;
  actorUserId: number | null;
}

async function insertRun(row: InsertArgs): Promise<void> {
  await pool.query(
    `INSERT INTO ${RUN_HISTORY_TABLE}
       (kind, cmd, title, ticket, started_at, duration_ms, ok, effect, output, migration_file, actor_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11)`,
    [
      row.kind,
      row.cmd,
      row.title,
      row.ticket,
      row.startedAt.toISOString(),
      Math.max(0, Math.round(row.durationMs)),
      row.ok,
      JSON.stringify(row.effect),
      truncateOutput(row.output),
      row.migrationFile,
      row.actorUserId,
    ],
  );
}

export interface DeployRunInput {
  command: string;
  startedAt: number;
  ok: boolean;
  steps: DeployStepLike[];
  /**
   * The whitelisted operation's kind, when the run came from one of the six
   * buttons. Left undefined for a free-typed command — and never inferred from
   * the text. See the file doc comment.
   */
  opKind?: "read" | "write" | "heavy";
  error?: string;
  actorUserId?: number | null;
}

/** Records one Deploy Console run. Never throws. */
export async function recordDeployRun(input: DeployRunInput): Promise<void> {
  try {
    const body = input.steps.map((s) => `$ ${s.command}\n${s.output}`.trimEnd()).join("\n\n");
    const output = input.error ? [body, `error: ${input.error}`].filter(Boolean).join("\n\n") : body;

    await insertRun({
      kind: "deploy",
      cmd: input.command,
      title: runTitle(input.command) || input.command,
      ticket: runTicket(input.command),
      startedAt: new Date(input.startedAt),
      durationMs: Date.now() - input.startedAt,
      ok: input.ok,
      effect: deployEffect(input.steps, input.ok, input.opKind),
      output,
      migrationFile: null,
      actorUserId: input.actorUserId ?? null,
    });
  } catch (err) {
    handleWriteError(err, { kind: "deploy", command: input.command });
  }
}

export interface SqlRunInput {
  /** The query text, or the migration's repo path when `migrationFile` is set. */
  cmd: string;
  startedAt: number;
  statements: SqlStatementLike[];
  /** A migration's filename, when the run came from one. Beats a derived title. */
  migrationFile?: string | null;
  actorUserId?: number | null;
}

/** Records one SQL Runner / migration run. Never throws. */
export async function recordSqlRun(input: SqlRunInput): Promise<void> {
  try {
    const statements = input.statements ?? [];
    const effect = sqlEffect(statements);
    if (input.migrationFile) effect.unshift("migration file");

    await insertRun({
      kind: "sql",
      cmd: input.cmd,
      title: input.migrationFile || runTitle(input.cmd) || input.cmd,
      ticket: runTicket(input.cmd),
      startedAt: new Date(input.startedAt),
      // The database's own reported time, not wall clock — it is the figure
      // that means something for a query, and the one the design shows.
      durationMs: statements.reduce((total, s) => total + (Number.isFinite(s.executionMs) ? s.executionMs : 0), 0),
      ok: statements.length > 0 && statements.every((s) => s.success),
      effect,
      output: formatStatements(statements),
      migrationFile: input.migrationFile ?? null,
      actorUserId: input.actorUserId ?? null,
    });
  } catch (err) {
    handleWriteError(err, { kind: "sql", migrationFile: input.migrationFile });
  }
}

/**
 * Records a SQL run that never reached the database at all (the executor threw
 * before producing per-statement results). Kept separate from the normal path
 * so a run with zero statements is never silently reported as "succeeded with
 * nothing to say".
 */
export async function recordFailedSqlRun(input: {
  cmd: string;
  startedAt: number;
  error: string;
  migrationFile?: string | null;
  actorUserId?: number | null;
}): Promise<void> {
  try {
    await insertRun({
      kind: "sql",
      cmd: input.cmd,
      title: input.migrationFile || runTitle(input.cmd) || input.cmd,
      ticket: runTicket(input.cmd),
      startedAt: new Date(input.startedAt),
      durationMs: Date.now() - input.startedAt,
      ok: false,
      effect: input.migrationFile ? ["migration file", "did not run"] : ["did not run"],
      output: input.error,
      migrationFile: input.migrationFile ?? null,
      actorUserId: input.actorUserId ?? null,
    });
  } catch (err) {
    handleWriteError(err, { kind: "sql", migrationFile: input.migrationFile });
  }
}
