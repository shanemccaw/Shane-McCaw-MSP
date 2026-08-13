import { Router, type Request, type Response } from "express";
import { requireAdminOrIngestToken } from "../middlewares/requireAuth";
import { pool } from "@workspace/db";
import { splitSqlStatements } from "../lib/sql-statement-splitter";

// Git #702 — Shane's Build Tracker browser extension floats a Deploy Console
// over claude.ai, reusing this exact route (not a new backend) with the same
// bearer-token pattern already used elsewhere in Build Tracker. His own
// words: "I'm already doing it with the existing console... just [wanted it]
// on a different page." This is his development server, not production.
const requireDeployAccess = requireAdminOrIngestToken();
import { exec, execSync } from "child_process";
import { logger } from "../lib/logger";
import { recordDeployRun } from "../lib/run-history";

const log = logger.child({ channel: "admin.deploy" });

const router = Router();

// process.cwd() is NOT reliable here — in this pnpm workspace, running a
// package's own dev/start script sets cwd to that package's directory, not
// the monorepo root. Ask git itself for the real repo root instead, which is
// correct regardless of where the process was launched from. Resolved lazily
// on first use (not at module load) so a resolution failure only breaks the
// deploy console route, never server startup — this is a secondary admin
// feature and must never be able to take the whole server down.
let cachedWorkspaceRoot: string | undefined;

function getWorkspaceRoot(): string {
  if (cachedWorkspaceRoot) return cachedWorkspaceRoot;
  let root: string;
  try {
    root = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
  } catch (err) {
    throw new Error(
      `admin-deploy-console: failed to resolve workspace root via 'git rev-parse --show-toplevel': ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
  if (!root) {
    throw new Error("admin-deploy-console: 'git rev-parse --show-toplevel' returned an empty result");
  }
  cachedWorkspaceRoot = root;
  return root;
}

interface DeployStep {
  label: string;
  command: string;
  timeoutMs: number;
}

// Fixed, real whitelist of deploy-console operations. Each key maps to a
// fixed sequence of shell commands — the ":operation" route param is only
// ever used as a lookup key into this object, never interpolated into a
// command string. No free-text/arbitrary command execution path exists.
const DEPLOY_OPERATIONS: Record<string, DeployStep[]> = {
  "git-status": [
    { label: "git status", command: "git status --short --branch", timeoutMs: 15_000 },
  ],
  "version-info": [
    { label: "git log -1", command: "git log -1 --format=%H%n%an%n%ad%n%s", timeoutMs: 15_000 },
    { label: "git rev-list --count HEAD", command: "git rev-list --count HEAD", timeoutMs: 15_000 },
  ],
  "git-pull": [
    // --ff-only: this repo's convention is committing directly to main, so a
    // pull that would require a merge commit means local and remote have
    // diverged — surface that as a failure instead of silently merging.
    { label: "git pull --ff-only", command: "git pull --ff-only", timeoutMs: 60_000 },
  ],
  "pnpm-install": [
    { label: "pnpm install", command: "pnpm install", timeoutMs: 300_000 },
  ],
  "pnpm-build": [
    { label: "pnpm run build", command: "pnpm run build", timeoutMs: 600_000 },
  ],
  "full-rebuild": [
    { label: "git pull --ff-only", command: "git pull --ff-only", timeoutMs: 60_000 },
    { label: "pnpm install", command: "pnpm install", timeoutMs: 300_000 },
    { label: "pnpm run build", command: "pnpm run build", timeoutMs: 600_000 },
  ],
  // Git #911 — restart the running server so a just-pulled commit is actually
  // loaded. A `git pull` only rewrites files on disk; the old code stays in the
  // running process's memory until the process itself is replaced.
  //
  // Deliberately DEFERRED and DETACHED: the kill is backgrounded behind a short
  // sleep (and its stdio sent to /dev/null so Node's exec doesn't block on the
  // pipe), so this command returns immediately with a scheduled-restart message
  // and the HTTP response can flush before the process dies. Callers must NOT
  // wait for the server to come back on this connection — it drops — they poll
  // GET /api/internal/deploy-status (#805) for the new commit hash instead.
  //
  // `kill 1` (signal PID 1, the Repl container's init) is the standard Replit
  // self-restart: this repo has no Procfile / PM2 / other supervisor that would
  // relaunch a bare `process.exit()`, and dev runs under Replit workflows that
  // do NOT auto-restart an exited process — rebooting the container re-runs the
  // Run button (git pull + Start Projects), bringing every workspace app back on
  // the new commit. UNVERIFIED against Shane's actual deployment — flagged in the
  // build-complete route below and the PLATFORM_BUILD.md row for #911.
  "restart": [
    {
      label: "restart server",
      command:
        '( sleep 2; kill 1 ) >/dev/null 2>&1 & echo "restart scheduled: killing PID 1 in ~2s to load the pulled commit; poll GET /api/internal/deploy-status for the new commit hash"',
      timeoutMs: 15_000,
    },
  ],
};

// Whether each whitelisted operation reads or writes. This is the ONLY thing
// that lets Run History put a "read only" chip on a run — a free-typed command
// has no entry here and therefore claims nothing about its effect, because a
// wrong "read only" on a command that wrote is the most misleading thing that
// screen could say. Kept beside the whitelist it describes, so adding an
// operation without classifying it is visible in one place.
const OPERATION_KIND: Record<string, "read" | "write" | "heavy"> = {
  "git-status": "read",
  "version-info": "read",
  "git-pull": "write",
  "pnpm-install": "write",
  "pnpm-build": "write",
  "full-rebuild": "heavy",
  "restart": "write",
};

interface StepResult {
  label: string;
  command: string;
  ok: boolean;
  output: string;
}

function runStep(step: DeployStep, workspaceRoot: string): Promise<StepResult> {
  return new Promise((resolve) => {
    exec(
      step.command,
      { cwd: workspaceRoot, timeout: step.timeoutMs, env: { ...process.env }, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const output = [stdout, stderr].filter(Boolean).join("\n").trim();
        resolve({ label: step.label, command: step.command, ok: !err, output: err ? (output || err.message) : output });
      }
    );
  });
}

// GET /admin/simulator/deploy/operations — lists the fixed whitelist so the
// frontend never has to hardcode operation keys independently of the server.
router.get("/admin/simulator/deploy/operations", requireDeployAccess, (_req: Request, res: Response) => {
  res.json({
    operations: Object.entries(DEPLOY_OPERATIONS).map(([key, steps]) => ({
      key,
      steps: steps.map((s) => s.label),
    })),
  });
});

// POST /admin/simulator/deploy/console — runs one admin-typed command
// verbatim. Unlike the whitelist below, this is genuinely free text: the
// Deploy Console's floating console is meant to be a real terminal into this
// server, gated by requireAdmin exactly like everything else in this file.
// Every command is logged with the requesting admin's user id — this is
// meant to be used, not hidden, but it has to stay attributable given what
// it can do.
//
// Registered BEFORE the ":operation" wildcard route below: Express matches
// routes in registration order, not most-specific-first, so "console" would
// otherwise be swallowed by ":operation" as an unrecognised whitelist key
// and never reach this handler.
router.post("/admin/simulator/deploy/console", requireDeployAccess, async (req: Request, res: Response) => {
  const command = typeof req.body?.command === "string" ? req.body.command.trim() : "";
  if (!command) {
    res.status(400).json({ ok: false, error: "No command given" });
    return;
  }

  let workspaceRoot: string;
  try {
    workspaceRoot = getWorkspaceRoot();
  } catch (err) {
    log.error({ err: err instanceof Error ? err.message : String(err) }, "Deploy console workspace root resolution failed");
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    return;
  }

  log.info({ command, userId: req.user?.id }, "Deploy console free-text command starting");

  const startedAt = Date.now();
  const result = await runStep({ label: command, command, timeoutMs: 300_000 }, workspaceRoot);

  log.info(
    { command, userId: req.user?.id, ok: result.ok },
    result.ok ? "Deploy console free-text command completed" : "Deploy console free-text command failed",
  );

  // No opKind: this is free text, and Run History says nothing about the
  // effect of a command it cannot classify. Awaited, but it never throws.
  await recordDeployRun({
    command,
    startedAt,
    ok: result.ok,
    steps: [result],
    actorUserId: req.user?.id ?? null,
  });

  res.json({ ok: result.ok, command, output: result.output });
});

// POST /admin/deploy/sql-test — runs one Shane/agent-supplied read-only SQL
// verification query against the real DB and returns the rows directly, so a
// build's own automation can check its work without a manual copy-paste
// through Shane. READ-ONLY ONLY, enforced here, not just documented: rejected
// (400, never executed) unless the query is a single statement that is
// unambiguously a SELECT, with a belt-and-suspenders keyword scan on top in
// case a SELECT-shaped string smuggles a write in a subquery/CTE. This must
// never grow into a general SQL-execution endpoint — that's the deploy
// console's free-text `/admin/simulator/deploy/console` route above, which is
// deliberately unrestricted and gated the same way.
const SQL_TEST_ROW_CAP = 1000;
const SQL_TEST_TIMEOUT_MS = 15_000;

// Multiple statements separated by `;` are rejected outright below; this
// only needs to catch write/DDL keywords appearing anywhere in the single
// remaining statement (e.g. inside a CTE or subquery a naive SELECT-prefix
// check would miss).
const SQL_TEST_FORBIDDEN_KEYWORDS =
  /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|call|merge|vacuum|copy|execute|lock)\b/i;

interface SqlTestExpect {
  rowCount?: number;
  columns?: string[];
}

// Leading `-- comment` / `/* comment */` noise ahead of the real SELECT
// keyword, stripped so a commented query isn't wrongly rejected as "not a
// SELECT". Reuses the same comment grammar `splitSqlStatements` already
// understands, just walked from the front instead of scanned end-to-end.
function stripLeadingComments(text: string): string {
  let s = text;
  for (;;) {
    const trimmed = s.replace(/^\s+/, "");
    if (trimmed.startsWith("--")) {
      const newline = trimmed.indexOf("\n");
      s = newline === -1 ? "" : trimmed.slice(newline + 1);
      continue;
    }
    if (trimmed.startsWith("/*")) {
      const end = trimmed.indexOf("*/");
      s = end === -1 ? "" : trimmed.slice(end + 2);
      continue;
    }
    return trimmed;
  }
}

function validateSqlTestQuery(rawQuery: unknown): { ok: true; query: string } | { ok: false; error: string } {
  if (typeof rawQuery !== "string" || !rawQuery.trim()) {
    return { ok: false, error: "No query given" };
  }

  // SQL-aware split (respects string literals, dollar-quoting, comments —
  // see sql-statement-splitter.ts) rather than a naive semicolon count, so a
  // literal like 'a;b' inside a genuine single statement isn't mistaken for
  // two statements.
  const statements = splitSqlStatements(rawQuery);
  if (statements.length !== 1) {
    return { ok: false, error: "Only a single SQL statement is allowed — no semicolon-separated statements" };
  }

  const statement = statements[0]!.trim();
  const withoutTrailingSemicolon = statement.endsWith(";") ? statement.slice(0, -1).trim() : statement;

  if (!/^select\b/i.test(stripLeadingComments(withoutTrailingSemicolon))) {
    return { ok: false, error: "Only SELECT statements are allowed" };
  }

  if (SQL_TEST_FORBIDDEN_KEYWORDS.test(withoutTrailingSemicolon)) {
    return { ok: false, error: "Query contains a forbidden write/DDL keyword" };
  }

  return { ok: true, query: withoutTrailingSemicolon };
}

function evaluateSqlTestExpectation(
  rows: Record<string, unknown>[],
  expect: SqlTestExpect | undefined,
): { pass: boolean; reasons: string[] } | null {
  if (!expect) return null;
  const reasons: string[] = [];

  if (typeof expect.rowCount === "number" && rows.length !== expect.rowCount) {
    reasons.push(`Expected rowCount ${expect.rowCount}, got ${rows.length}`);
  }

  if (Array.isArray(expect.columns)) {
    const actualColumns = new Set(rows.length > 0 ? Object.keys(rows[0]) : []);
    for (const col of expect.columns) {
      if (!actualColumns.has(col)) {
        reasons.push(`Expected column '${col}' not present in result`);
      }
    }
  }

  return { pass: reasons.length === 0, reasons };
}

router.post("/admin/deploy/sql-test", requireDeployAccess, async (req: Request, res: Response) => {
  const rawQuery = req.body?.query;
  const expect = req.body?.expect as SqlTestExpect | undefined;
  const userId = req.user?.id;

  const validated = validateSqlTestQuery(rawQuery);
  if (!validated.ok) {
    log.warn({ query: rawQuery, userId, error: validated.error }, "SQL test-runner query rejected");
    res.status(400).json({ ok: false, error: validated.error });
    return;
  }

  const { query } = validated;
  log.info({ query, userId }, "SQL test-runner query starting");

  const capped = `SELECT * FROM (${query}) AS sql_test_subquery LIMIT ${SQL_TEST_ROW_CAP}`;

  // A dedicated connection (not db.execute's shared pool helper) so
  // `SET statement_timeout` lands on the SAME connection the query itself
  // runs on — that's what makes Postgres actually cancel a runaway query
  // server-side, instead of the app merely giving up on awaiting it while
  // the query keeps burning a connection in the background.
  const client = await pool.connect();
  try {
    await client.query(`SET statement_timeout = ${SQL_TEST_TIMEOUT_MS}`);
    const result = await client.query(capped);
    const rows = (result.rows ?? []) as Record<string, unknown>[];
    const evaluation = evaluateSqlTestExpectation(rows, expect);

    log.info({ query, userId, rowCount: rows.length, pass: evaluation?.pass ?? null }, "SQL test-runner query completed");

    res.json({
      ok: true,
      rowCount: rows.length,
      rows,
      truncated: rows.length >= SQL_TEST_ROW_CAP,
      expectation: evaluation,
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.error({ query, userId, error }, "SQL test-runner query failed");
    res.status(500).json({ ok: false, error });
  } finally {
    client.release();
  }
});

// POST /admin/deploy/build-complete — Git #911 (Epic #803). The single call a
// finished build makes so a deploy actually lands: push any schema-changing
// SQL, pull, and restart so the new commit is loaded.
//
//   body: { schemaSql?: string }
//
// 1. If `schemaSql` is given it is split into individual statements and the
//    WHOLE request is hard-rejected (400, NOTHING executed) unless EVERY
//    statement begins with CREATE, ALTER or INSERT (case-insensitive, leading
//    whitespace/comments ignored). This is a deliberate, narrow exception to
//    this codebase's standing "Claude never touches the live DB, Shane runs all
//    SQL by hand" rule — CONFIRMED with Shane on the issue — and it is a HARD
//    safety filter, not a warning: a DROP/DELETE/TRUNCATE/UPDATE (or anything
//    else not starting CREATE/ALTER/INSERT) never runs, not even partially. The
//    allowed statements then execute inside ONE transaction (all-or-nothing —
//    any failure rolls the entire batch back). Because we wrap them ourselves,
//    the supplied SQL must be bare statements with no BEGIN/COMMIT of its own
//    (those would be rejected as non-CREATE/ALTER/INSERT anyway).
// 2. Then git-pull (the existing whitelisted git-pull step).
// 3. Then the whitelisted `restart` operation, which is deferred/detached so
//    this handler returns a full step-by-step StepResult[] result FIRST; the
//    connection then drops when the process restarts. The caller polls
//    GET /api/internal/deploy-status (#805) until the commit hash flips to
//    confirm the new commit is live — we never block on the server returning.
//
// Registered before the ":operation" wildcard, same reasoning as the console
// and sql-test routes above (Express matches in registration order).
const BUILD_COMPLETE_SQL_TIMEOUT_MS = 120_000;

// A statement is allowed only if, after leading whitespace/comments are
// stripped, it starts with one of these three keywords. `\b` prevents e.g.
// "insertfoo" from matching; anything else (DROP/DELETE/TRUNCATE/UPDATE/SET/
// BEGIN/…) fails and hard-rejects the whole request.
const SCHEMA_SQL_ALLOWED_PREFIX = /^(?:create|alter|insert)\b/i;

interface SchemaSqlValidation {
  ok: boolean;
  statements: string[];
  offending?: { index: number; preview: string };
}

function validateSchemaSql(sql: string): SchemaSqlValidation {
  const statements = splitSqlStatements(sql);
  for (let i = 0; i < statements.length; i++) {
    const head = stripLeadingComments(statements[i]!);
    if (!SCHEMA_SQL_ALLOWED_PREFIX.test(head)) {
      return { ok: false, statements, offending: { index: i, preview: head.slice(0, 120) } };
    }
  }
  return { ok: true, statements };
}

function firstLine(statement: string): string {
  return statement.split("\n").map((l) => l.trim()).filter(Boolean)[0] ?? statement.trim();
}

// Runs the already-validated statements inside a single transaction on a
// dedicated connection (all-or-nothing) and returns one StepResult describing
// the whole batch. Logs exactly what ran. Never throws — a failure is captured
// in the returned StepResult (ok: false) after a ROLLBACK.
async function applySchemaSqlTransaction(statements: string[], userId: number | undefined): Promise<StepResult> {
  const count = statements.length;
  const label = `apply schema SQL (${count} statement${count === 1 ? "" : "s"})`;
  const command = statements.map((s) => s.replace(/\s+/g, " ").trim()).join(";\n");
  const lines: string[] = [];

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // SET LOCAL so the timeout resets automatically at COMMIT/ROLLBACK and never
    // leaks onto the next borrower of this pooled connection.
    await client.query(`SET LOCAL statement_timeout = ${BUILD_COMPLETE_SQL_TIMEOUT_MS}`);
    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i]!;
      const result = await client.query(stmt);
      lines.push(`[${i + 1}/${count}] ${firstLine(stmt)} → ${result.rowCount ?? 0} row(s)`);
    }
    await client.query("COMMIT");
    log.info({ userId, count, statements }, "build-complete: schema SQL committed");
    return { label, command, ok: true, output: lines.join("\n") };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    const error = err instanceof Error ? err.message : String(err);
    log.error({ userId, count, error }, "build-complete: schema SQL failed — transaction rolled back, nothing applied");
    return {
      label,
      command,
      ok: false,
      output: [...lines, `error: ${error} — transaction rolled back, nothing applied`].join("\n"),
    };
  } finally {
    client.release();
  }
}

router.post("/admin/deploy/build-complete", requireDeployAccess, async (req: Request, res: Response) => {
  const userId = req.user?.id;
  const actorUserId = userId ?? null;
  const rawSchemaSql = req.body?.schemaSql;

  // schemaSql is optional; when present it must be a string.
  if (rawSchemaSql !== undefined && typeof rawSchemaSql !== "string") {
    res.status(400).json({ ok: false, error: "schemaSql must be a string when provided" });
    return;
  }

  let workspaceRoot: string;
  try {
    workspaceRoot = getWorkspaceRoot();
  } catch (err) {
    log.error({ err: err instanceof Error ? err.message : String(err) }, "build-complete: workspace root resolution failed");
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    return;
  }

  const startedAt = Date.now();
  const steps: StepResult[] = [];
  const recordCommand = "build-complete: apply schema SQL -> git pull --ff-only -> restart";

  // ── 1. Schema SQL (optional, hard-filtered, all-or-nothing) ─────────────────
  const schemaSql = typeof rawSchemaSql === "string" ? rawSchemaSql : "";
  if (schemaSql.trim()) {
    const validation = validateSchemaSql(schemaSql);
    if (!validation.ok) {
      // Hard reject: the WHOLE request, nothing executed. Not a warning.
      const { index, preview } = validation.offending!;
      log.warn(
        { userId, statementIndex: index, preview },
        "build-complete: schema SQL rejected — a statement is not CREATE/ALTER/INSERT; whole request refused, nothing executed",
      );
      res.status(400).json({
        ok: false,
        error: `Statement ${index + 1} of ${validation.statements.length} is not a CREATE/ALTER/INSERT statement — the whole build-complete request was rejected and nothing was executed.`,
        offendingStatement: preview,
      });
      return;
    }

    if (validation.statements.length > 0) {
      log.info({ userId, count: validation.statements.length }, "build-complete: applying schema SQL in a transaction");
      const sqlStep = await applySchemaSqlTransaction(validation.statements, userId);
      steps.push(sqlStep);
      if (!sqlStep.ok) {
        // SQL failed and was rolled back — do NOT pull or restart.
        await recordDeployRun({ command: recordCommand, startedAt, ok: false, steps, opKind: "write", error: "schema SQL failed", actorUserId });
        res.status(500).json({ ok: false, steps, error: "Schema SQL failed and was rolled back — git pull and restart were skipped." });
        return;
      }
    }
  }

  // ── 2. git pull ─────────────────────────────────────────────────────────────
  const gitPullStep = await runStep(DEPLOY_OPERATIONS["git-pull"][0]!, workspaceRoot);
  steps.push(gitPullStep);
  if (!gitPullStep.ok) {
    log.error({ userId }, "build-complete: git pull failed — restart skipped");
    await recordDeployRun({ command: recordCommand, startedAt, ok: false, steps, opKind: "write", error: "git pull failed", actorUserId });
    res.status(500).json({ ok: false, steps, error: "git pull failed — restart was skipped, the server keeps running the current commit." });
    return;
  }

  // ── 3. restart (deferred/detached) ──────────────────────────────────────────
  // The whitelisted restart step returns immediately (its kill is backgrounded
  // behind a short sleep), so the full result below flushes before the process
  // dies. Everything past this point must assume the connection may drop.
  log.info({ userId }, "build-complete: scheduling restart to load the pulled commit");
  const restartStep = await runStep(DEPLOY_OPERATIONS["restart"][0]!, workspaceRoot);
  steps.push(restartStep);

  await recordDeployRun({ command: recordCommand, startedAt, ok: restartStep.ok, steps, opKind: "write", actorUserId });
  log.info({ userId, ok: restartStep.ok }, "build-complete: pipeline finished, restart scheduled");

  res.json({
    ok: restartStep.ok,
    steps,
    restarting: restartStep.ok,
    pollUrl: "/api/internal/deploy-status",
    note: "Restart scheduled — this server will drop the connection shortly. Poll GET /api/internal/deploy-status (#805) until commitHash changes to confirm the new commit is live; do not wait on this request.",
  });
});

// POST /admin/simulator/deploy/:operation — runs one whitelisted operation.
// :operation is validated against DEPLOY_OPERATIONS' keys and used only as a
// lookup; the executed command string always comes from the whitelist entry.
router.post("/admin/simulator/deploy/:operation", requireDeployAccess, async (req: Request, res: Response) => {
  const operation = String(req.params.operation);
  const steps = Object.prototype.hasOwnProperty.call(DEPLOY_OPERATIONS, operation)
    ? DEPLOY_OPERATIONS[operation]
    : undefined;

  if (!steps) {
    res.status(400).json({ error: `Unknown deploy operation: ${operation}` });
    return;
  }

  let workspaceRoot: string;
  try {
    workspaceRoot = getWorkspaceRoot();
  } catch (err) {
    log.error({ operation, err: err instanceof Error ? err.message : String(err) }, "Deploy console workspace root resolution failed");
    res.status(500).json({ ok: false, operation, error: err instanceof Error ? err.message : String(err) });
    return;
  }

  log.info({ operation, userId: req.user?.id }, "Deploy console operation starting");

  const startedAt = Date.now();
  const opKind = OPERATION_KIND[operation];
  const actorUserId = req.user?.id ?? null;

  const results: StepResult[] = [];
  for (const step of steps) {
    const result = await runStep(step, workspaceRoot);
    results.push(result);
    if (!result.ok) {
      log.error({ operation, step: step.label }, "Deploy console step failed");
      // Recorded on the failure path too — a stopped rebuild is the run you
      // most want to find again three days later.
      await recordDeployRun({
        command: steps.map((s) => s.command).join(" && "),
        startedAt,
        ok: false,
        steps: results,
        opKind,
        error: `${step.label} failed`,
        actorUserId,
      });
      res.status(500).json({ ok: false, operation, steps: results, error: `${step.label} failed` });
      return;
    }
  }

  log.info({ operation }, "Deploy console operation completed");
  await recordDeployRun({
    command: steps.map((s) => s.command).join(" && "),
    startedAt,
    ok: true,
    steps: results,
    opKind,
    actorUserId,
  });
  res.json({ ok: true, operation, steps: results });
});

export default router;
