import { Router, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { requireAdminOrIngestToken } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";

// Git #898 (sub-issue of Epic #803) — "trigger-over-HTTP" for the UI test
// harness. Shane's ask: "the agent calls something to execute its UI test
// script and get the results delivered directly to it."
//
// The real constraint that shapes this: the manifest's uiSteps (#809) drive a
// live WebView2 browser, which needs a genuine Windows GUI session — a headless
// Claude Code terminal session cannot itself drive that browser. So this is NOT
// "run the test here in the api-server". It's a tiny rendezvous point between
// two processes that DON'T share a filesystem:
//
//   1. Claude Code (HTTP-capable, no GUI) POSTs a run request naming a manifest
//      file  ->  POST /admin/deploy/test-run   -> gets back a runId.
//   2. The already-running BuildConsole WPF app (already left open for the build
//      queue, per the established workflow) polls GET /admin/deploy/test-run/next,
//      atomically claims the oldest pending request, runs it through #806's real
//      RunManifestAsync pipeline (#807/#808/#809 executors + WebView2), and POSTs
//      the finished results back  ->  POST /admin/deploy/test-run/:runId/complete.
//   3. Claude Code polls GET /admin/deploy/test-run/:runId until status is
//      `done` or `failed`, then reads `results` (the exact ManifestRunResult JSON
//      that also lands in test-results/{issue}-{timestamp}.json per #812/#874).
//
// Same bearer-token gate (BUILD_TRACKER_INGEST_TOKEN) the Build Tracker console
// and the WPF app already use — Claude Code and BuildConsole both authenticate
// with that one ingest token, so no new auth surface is introduced. This is
// Shane's development server, not production.
const requireTestTriggerAccess = requireAdminOrIngestToken();

const log = logger.child({ channel: "admin.deploy" });

const router = Router();

type RunStatus = "pending" | "running" | "done" | "failed";

interface TestRun {
  runId: string;
  manifestFile: string;
  status: RunStatus;
  createdAt: number;
  claimedAt?: number;
  completedAt?: number;
  /** The full ManifestRunResult JSON delivered back by BuildConsole (same shape as test-results/{issue}-{timestamp}.json). */
  results?: unknown;
  /** Set on the `failed` path — a manifest that couldn't be loaded/run at all, distinct from a run that executed with some steps failing. */
  error?: string;
  requestedBy?: number | null;
}

// In-memory registry. This is deliberately NOT a DB table: it's an ephemeral,
// short-lived rendezvous between two processes that both talk to this one
// long-running dev api-server process, with a lifetime measured in minutes (a
// run either completes or the caller times out). A table would add a schema
// migration for state that never needs to survive a server restart — and per
// this task's own constraint, ad-hoc new tables invented mid-task are exactly
// what we avoid. If the server restarts mid-run, the caller times out and
// re-POSTs, which is the correct recovery for a dev tool anyway.
const runs = new Map<string, TestRun>();

// Keep the map from growing without bound over a long-lived dev server: drop
// terminal (done/failed) runs older than this, and cap total retained runs.
const RETAIN_MS = 60 * 60 * 1000; // 1 hour — long enough for any poll-then-read to still find its result.
const MAX_RUNS = 200;

function pruneOldRuns(): void {
  const now = Date.now();
  for (const [id, run] of runs) {
    const terminal = run.status === "done" || run.status === "failed";
    if (terminal && run.completedAt && now - run.completedAt > RETAIN_MS) {
      runs.delete(id);
    }
  }
  // Hard cap fallback (oldest-first) in case a flood of runs never reaches the
  // age threshold — never let this map be a memory leak.
  if (runs.size > MAX_RUNS) {
    const sorted = [...runs.values()].sort((a, b) => a.createdAt - b.createdAt);
    for (const run of sorted.slice(0, runs.size - MAX_RUNS)) runs.delete(run.runId);
  }
}

// A manifest file name is a bare filename (BuildConsole joins it with the repo's
// test-manifests/ directory). Reject anything that looks like a path or isn't a
// .json so a request can never point BuildConsole outside test-manifests/.
const MANIFEST_FILE_RE = /^[A-Za-z0-9._-]+\.json$/;

function publicView(run: TestRun) {
  return {
    runId: run.runId,
    manifestFile: run.manifestFile,
    status: run.status,
    createdAt: run.createdAt,
    claimedAt: run.claimedAt ?? null,
    completedAt: run.completedAt ?? null,
    results: run.results ?? null,
    error: run.error ?? null,
  };
}

// ── POST /admin/deploy/test-run ─────────────────────────────────────────────
// Claude Code creates a run request naming a manifest file. Returns a runId to
// poll. Does NOT run anything itself — BuildConsole claims and runs it.
router.post("/admin/deploy/test-run", requireTestTriggerAccess, (req: Request, res: Response) => {
  const manifestFile = typeof req.body?.manifestFile === "string" ? req.body.manifestFile.trim() : "";
  if (!manifestFile) {
    res.status(400).json({ ok: false, error: "manifestFile is required" });
    return;
  }
  if (!MANIFEST_FILE_RE.test(manifestFile)) {
    res.status(400).json({
      ok: false,
      error: `manifestFile must be a bare .json filename under test-manifests/ (got '${manifestFile}')`,
    });
    return;
  }

  pruneOldRuns();

  const run: TestRun = {
    runId: randomUUID(),
    manifestFile,
    status: "pending",
    createdAt: Date.now(),
    requestedBy: req.user?.id ?? null,
  };
  runs.set(run.runId, run);

  log.info(
    { runId: run.runId, manifestFile, userId: run.requestedBy, pending: [...runs.values()].filter((r) => r.status === "pending").length },
    "Test-run request created (awaiting BuildConsole to claim it)",
  );

  res.status(201).json({ runId: run.runId, status: run.status, manifestFile });
});

// ── GET /admin/deploy/test-run/next ─────────────────────────────────────────
// BuildConsole polls this to atomically claim the oldest pending run (marks it
// `running`) and get the manifest file to execute. Returns { runId: null } when
// nothing is pending. Registered BEFORE the ":runId" route below — Express
// matches in registration order, and "next" is otherwise a valid ":runId".
router.get("/admin/deploy/test-run/next", requireTestTriggerAccess, (_req: Request, res: Response) => {
  const pending = [...runs.values()]
    .filter((r) => r.status === "pending")
    .sort((a, b) => a.createdAt - b.createdAt);

  const claim = pending[0];
  if (!claim) {
    res.json({ runId: null });
    return;
  }

  claim.status = "running";
  claim.claimedAt = Date.now();

  log.info({ runId: claim.runId, manifestFile: claim.manifestFile }, "Test-run claimed by BuildConsole");
  res.json({ runId: claim.runId, manifestFile: claim.manifestFile });
});

// ── POST /admin/deploy/test-run/:runId/complete ─────────────────────────────
// BuildConsole reports a finished run. `status` is `done` (it executed — the
// results JSON itself carries per-step pass/fail) or `failed` (it couldn't run
// at all, e.g. manifest not found). `results` is the full ManifestRunResult
// JSON; `error` is a short reason on the failed path.
router.post("/admin/deploy/test-run/:runId/complete", requireTestTriggerAccess, (req: Request, res: Response) => {
  const runId = String(req.params.runId);
  const run = runs.get(runId);
  if (!run) {
    res.status(404).json({ ok: false, error: `Unknown runId: ${runId}` });
    return;
  }

  const status = req.body?.status === "failed" ? "failed" : req.body?.status === "done" ? "done" : undefined;
  if (!status) {
    res.status(400).json({ ok: false, error: "status must be 'done' or 'failed'" });
    return;
  }

  run.status = status;
  run.completedAt = Date.now();
  run.results = req.body?.results ?? null;
  run.error = typeof req.body?.error === "string" ? req.body.error : undefined;

  log.info(
    { runId, manifestFile: run.manifestFile, status, elapsedMs: run.claimedAt ? run.completedAt - run.claimedAt : undefined },
    status === "done" ? "Test-run completed" : "Test-run failed",
  );

  res.json({ ok: true, runId, status });
});

// ── GET /admin/deploy/test-run/:runId ───────────────────────────────────────
// Claude Code polls this until status is `done` or `failed`, then reads
// `results`. Registered AFTER "/next" so that literal path isn't swallowed.
router.get("/admin/deploy/test-run/:runId", requireTestTriggerAccess, (req: Request, res: Response) => {
  const runId = String(req.params.runId);
  const run = runs.get(runId);
  if (!run) {
    res.status(404).json({ ok: false, error: `Unknown runId: ${runId}` });
    return;
  }
  res.json(publicView(run));
});

export default router;
