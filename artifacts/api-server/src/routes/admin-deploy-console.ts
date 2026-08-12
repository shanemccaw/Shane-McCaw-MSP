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
