/**
 * admin-run-history.ts
 *
 * Reads (and annotates, and forgets) Simulator Studio's Run History — the
 * server-side log of every command and query actually run from the admin
 * console, behind adminv2's `/run-history` screen.
 *
 * Routes:
 *   GET    /api/admin/simulator/run-history          — the list, newest first
 *   GET    /api/admin/simulator/run-history/:id      — one run, with its full output
 *   PATCH  /api/admin/simulator/run-history/:id      — write the operator's note
 *   DELETE /api/admin/simulator/run-history/:id      — forget one run
 *   DELETE /api/admin/simulator/run-history          — clear the log
 *
 * **Nothing here writes a run.** Rows are inserted by the routes that actually
 * run things (`admin-deploy-console.ts`, `admin-engines.ts`'s SQL and migration
 * executors) through `lib/run-history.ts`. There is deliberately no POST: a
 * client that could invent a history row would make this log worth less than
 * no log, and every real writer already lives server-side.
 *
 * ## Why the list omits `output`
 *
 * A single `pnpm build` transcript runs to tens of kilobytes, and the screen
 * shows 200 rows. The list carries everything a row *renders* plus
 * `hasOutput`, and the selected run's full text comes from `GET /:id`. Search
 * still covers the output, because finding a run by the error it printed is
 * the main reason anyone opens this screen — so the `q` filter is applied
 * server-side, in SQL, against the column the response does not return.
 *
 * ## Before the migration is run
 *
 * The table is provisioned by a manual migration Shane runs himself
 * (CLAUDE.md). Until then every route here answers 200 with
 * `tableMissing: true` and an empty list rather than 500 — the screen says
 * plainly that the migration has not been run, which is true and actionable,
 * where a stack trace would just look broken.
 */

import { Router, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import { requireAdmin } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";
import { isMissingTableError, RUN_HISTORY_MIGRATION, RUN_HISTORY_TABLE } from "../lib/run-history";

const log = logger.child({ channel: "admin.runHistory" });

const router = Router();

const BASE = "/admin/simulator/run-history";

/** The screen paginates by "show me more", not by page number. 200 is two screens of scrolling. */
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;

interface RunRow {
  id: number;
  kind: string;
  cmd: string;
  title: string;
  ticket: string;
  started_at: Date | string;
  duration_ms: number;
  ok: boolean;
  effect: unknown;
  note: string;
  migration_file: string | null;
  actor_user_id: number | null;
  has_output?: boolean;
  run_count?: string | number;
  output?: string;
}

function toWire(row: RunRow) {
  return {
    id: String(row.id),
    kind: row.kind === "sql" ? "sql" : "deploy",
    cmd: row.cmd,
    title: row.title,
    ticket: row.ticket ?? "",
    startedAt: new Date(row.started_at).toISOString(),
    durationMs: Number(row.duration_ms ?? 0),
    ok: Boolean(row.ok),
    effect: Array.isArray(row.effect) ? (row.effect as string[]) : [],
    note: row.note ?? "",
    migrationFile: row.migration_file,
    actorUserId: row.actor_user_id,
    /** How many rows share this exact command — the row's "run 14×". */
    runCount: row.run_count === undefined ? 1 : Number(row.run_count),
    hasOutput: row.has_output ?? (typeof row.output === "string" && row.output.length > 0),
    ...(row.output === undefined ? {} : { output: row.output }),
  };
}

/**
 * Answers a missing table as an empty, explained log instead of an error.
 * Returns true when it handled the response.
 */
function handleMissingTable(err: unknown, res: Response, empty: Record<string, unknown>): boolean {
  if (!isMissingTableError(err)) return false;
  res.json({ ...empty, tableMissing: true, migration: RUN_HISTORY_MIGRATION });
  return true;
}

// GET /admin/simulator/run-history?kind=&q=&limit=
router.get(BASE, requireAdmin, async (req: Request, res: Response) => {
  const kindParam = typeof req.query.kind === "string" ? req.query.kind.toLowerCase() : "";
  const kind = kindParam === "deploy" || kindParam === "sql" ? kindParam : null;
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const limitParam = Number(req.query.limit);
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, MAX_LIMIT) : DEFAULT_LIMIT;

  const where: string[] = [];
  const params: unknown[] = [];

  if (kind) {
    params.push(kind);
    where.push(`h.kind = $${params.length}`);
  }
  if (q) {
    // The design's five searchable fields, output included. Parameterised, so
    // a `%` or `_` in the query is matched literally-ish rather than injected.
    params.push(`%${q}%`);
    const p = `$${params.length}`;
    where.push(`(h.title ILIKE ${p} OR h.cmd ILIKE ${p} OR h.ticket ILIKE ${p} OR h.output ILIKE ${p} OR h.note ILIKE ${p})`);
  }

  params.push(limit);
  const limitPlaceholder = `$${params.length}`;

  const sql = `
    SELECT h.id, h.kind, h.cmd, h.title, h.ticket, h.started_at, h.duration_ms, h.ok,
           h.effect, h.note, h.migration_file, h.actor_user_id,
           (length(h.output) > 0) AS has_output,
           (SELECT count(*) FROM ${RUN_HISTORY_TABLE} c WHERE c.cmd = h.cmd) AS run_count
      FROM ${RUN_HISTORY_TABLE} h
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY h.started_at DESC, h.id DESC
     LIMIT ${limitPlaceholder}
  `;

  try {
    const [rows, totals] = await Promise.all([
      pool.query<RunRow>(sql, params),
      // Unfiltered, so the header can say "12 of 480" and the Watch tab's
      // failure count does not silently mean "failures on this page".
      pool.query<{ total: string; failed: string }>(
        `SELECT count(*) AS total, count(*) FILTER (WHERE NOT ok) AS failed FROM ${RUN_HISTORY_TABLE}`,
      ),
    ]);

    res.json({
      runs: rows.rows.map(toWire),
      total: Number(totals.rows[0]?.total ?? 0),
      failed: Number(totals.rows[0]?.failed ?? 0),
      limit,
    });
  } catch (err) {
    if (handleMissingTable(err, res, { runs: [], total: 0, failed: 0, limit })) return;
    log.error({ err }, "failed to read run history");
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to read run history" });
  }
});

// GET /admin/simulator/run-history/:id — the full row, output included.
router.get(`${BASE}/:id`, requireAdmin, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "A numeric run id is required." });
    return;
  }

  try {
    const result = await pool.query<RunRow>(
      `SELECT h.*, (SELECT count(*) FROM ${RUN_HISTORY_TABLE} c WHERE c.cmd = h.cmd) AS run_count
         FROM ${RUN_HISTORY_TABLE} h WHERE h.id = $1`,
      [id],
    );
    const row = result.rows[0];
    if (!row) {
      res.status(404).json({ error: "No such run." });
      return;
    }
    res.json({ run: toWire(row) });
  } catch (err) {
    if (handleMissingTable(err, res, { run: null })) return;
    log.error({ err, id }, "failed to read one run");
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to read run" });
  }
});

// PATCH /admin/simulator/run-history/:id — the operator's note, the one field
// on this screen a human writes. Written through with no save step, matching
// how every other peek edit in adminv2 behaves.
router.patch(`${BASE}/:id`, requireAdmin, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "A numeric run id is required." });
    return;
  }
  const note = typeof req.body?.note === "string" ? req.body.note : null;
  if (note === null) {
    res.status(400).json({ error: "A note string is required." });
    return;
  }

  try {
    const result = await pool.query(`UPDATE ${RUN_HISTORY_TABLE} SET note = $1 WHERE id = $2`, [note, id]);
    if (result.rowCount === 0) {
      res.status(404).json({ error: "No such run." });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    if (handleMissingTable(err, res, { ok: false })) return;
    log.error({ err, id }, "failed to save a run note");
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to save note" });
  }
});

// DELETE /admin/simulator/run-history/:id — forgets one run. The run itself
// already happened; this only drops the record of it.
router.delete(`${BASE}/:id`, requireAdmin, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "A numeric run id is required." });
    return;
  }

  try {
    const result = await pool.query(`DELETE FROM ${RUN_HISTORY_TABLE} WHERE id = $1`, [id]);
    log.info({ id, userId: req.user?.id, removed: result.rowCount }, "run history row forgotten");
    res.json({ ok: true, removed: result.rowCount ?? 0 });
  } catch (err) {
    if (handleMissingTable(err, res, { ok: false, removed: 0 })) return;
    log.error({ err, id }, "failed to forget a run");
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to forget run" });
  }
});

// DELETE /admin/simulator/run-history — clears the whole log. Logged with the
// admin who did it, because emptying the record of what was run to the server
// is itself something worth being able to look up.
router.delete(BASE, requireAdmin, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(`DELETE FROM ${RUN_HISTORY_TABLE}`);
    log.warn({ userId: req.user?.id, removed: result.rowCount }, "run history cleared");
    res.json({ ok: true, removed: result.rowCount ?? 0 });
  } catch (err) {
    if (handleMissingTable(err, res, { ok: false, removed: 0 })) return;
    log.error({ err }, "failed to clear run history");
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to clear run history" });
  }
});

export default router;
