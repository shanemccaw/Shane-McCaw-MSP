/**
 * admin-monitor-check-runs.ts
 *
 * Single-endpoint execution for the Simulator Studio's "M365 Endpoints" node.
 *
 * Phase 1 scope: run ONE monitor check against ONE real, live connected tenant
 * and report real progress + the real response. Bulk run, run history/diff,
 * engine-trace integration and auto-classification are deliberately NOT here —
 * they are separate, later phases.
 *
 * Routes:
 *   POST /api/admin/monitor-checks/:key/run      — start a run (202 + runId)
 *   GET  /api/admin/monitor-check-runs/:runId    — poll run status + result
 *
 * REUSE, NOT REIMPLEMENTATION — the whole point of this route:
 * the actual Graph request is executed by monitor-executor.ts's own exported
 * `executeMonitorCheck()`, which owns request building, {NDaysAgo}/{id}
 * placeholder resolution, @odata.nextLink pagination, the CSV-report path,
 * mapping/extraction, schema validation, severity classification and the
 * consent-revoked / license-gap classification. None of that logic is copied
 * here — this file only resolves which check + which tenant, calls that one
 * function, and tracks status. Forking it would create a second, drifting copy
 * of request-building code that real bugs were just fixed in.
 *
 * `skipIdempotency: true` is passed deliberately: the idempotency guard exists
 * so a scheduled package run doesn't double-write per trigger, but a simulator
 * exists precisely to re-run the same check repeatedly and see a fresh live
 * response. Each run gets its own uuid triggerId regardless, so the persisted
 * tenant_monitor_profiles rows stay attributable.
 *
 * Status model is adapted from msp-diagnostics.ts's real run-status model
 * (pending → running → completed/failed, 202 + runId, poll for terminal state)
 * rather than a new invented one. It is held in memory rather than a new table:
 * a single ad-hoc simulator execution is not durable state worth a migration,
 * and this environment has no DATABASE_URL to migrate against. The persisted
 * result still lands in tenant_monitor_profiles via executeMonitorCheck().
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, monitorChecksTable, mspCustomersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { requireAdmin } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";
import { executeMonitorCheck, type CheckResult } from "../lib/monitor-executor";

const log = logger.child({ channel: "engine.monitor" });

const router: IRouter = Router();

// ── In-memory run registry ────────────────────────────────────────────────────

/** Mirrors msp-diagnostics' real run lifecycle: pending → running → completed/failed. */
export type MonitorCheckRunStatus = "pending" | "running" | "completed" | "failed";

export interface MonitorCheckRun {
  runId: string;
  checkKey: string;
  checkLabel: string;
  customerId: number;
  tenantId: string;
  status: MonitorCheckRunStatus;
  /** Human-readable status line the UI shows next to the progress bar. */
  statusText: string;
  /** 0–100. Coarse by design: one check has no sub-steps to measure. */
  progress: number;
  startedAt: string;
  completedAt?: string;
  /** The real CheckResult returned by monitor-executor.executeMonitorCheck(). */
  result?: CheckResult;
  error?: string;
  /** The real resolved request the executor was asked to run — shown in the UI. */
  request: { endpoint: string; method: string; requestBody: unknown };
}

/**
 * Bounded so a long-lived api-server process can't accumulate runs forever.
 * Oldest-first eviction; a simulator only ever needs the recent few.
 */
const MAX_TRACKED_RUNS = 200;
const runs = new Map<string, MonitorCheckRun>();

function trackRun(run: MonitorCheckRun): void {
  runs.set(run.runId, run);
  while (runs.size > MAX_TRACKED_RUNS) {
    const oldest = runs.keys().next();
    if (oldest.done) break;
    runs.delete(oldest.value);
  }
}

/** Exported for tests — keeps the registry from leaking between cases. */
export function _resetMonitorCheckRuns(): void {
  runs.clear();
}

// ── POST /api/admin/monitor-checks/:key/run ───────────────────────────────────
// Fire-and-forget, mirroring msp-diagnostics' trigger route: create the run
// record, return 202 + runId immediately, execute asynchronously.

router.post("/admin/monitor-checks/:key/run", requireAdmin, async (req: Request, res: Response) => {
  try {
    const key = req.params.key as string;
    const body = (req.body ?? {}) as Record<string, unknown>;

    const customerId = Number(body.customerId);
    if (!Number.isInteger(customerId) || customerId <= 0) {
      return void res.status(400).json({ error: "customerId is required" });
    }

    const [check] = await db
      .select()
      .from(monitorChecksTable)
      .where(eq(monitorChecksTable.key, key))
      .limit(1);
    if (!check) return void res.status(404).json({ error: "Monitor check not found" });

    // A check flagged requiresCustomerScript has no Graph request to issue — the
    // executor would return requires_script without ever calling Graph. Say so
    // plainly rather than starting a run that can only report a non-result.
    if (check.requiresCustomerScript) {
      return void res.status(400).json({
        error: "This check requires a customer-side PowerShell script — it has no Graph endpoint to execute here",
      });
    }

    const [customer] = await db
      .select({ id: mspCustomersTable.id, tenantId: mspCustomersTable.tenantId })
      .from(mspCustomersTable)
      .where(eq(mspCustomersTable.id, customerId))
      .limit(1);
    if (!customer) return void res.status(404).json({ error: "Customer not found" });
    if (!customer.tenantId) {
      return void res.status(400).json({
        error: "That customer has no connected M365 tenant — nothing to execute against",
      });
    }

    // Per-run overrides let the operator edit endpoint/method/body before running
    // (scope item 4) WITHOUT mutating the stored check. Editing the catalog row is
    // the separate PATCH route; a simulator run must be able to try a candidate
    // endpoint without persisting it.
    const endpointOverride = typeof body.endpoint === "string" && body.endpoint.trim() ? body.endpoint.trim() : null;
    const methodOverride = typeof body.method === "string" && body.method.trim() ? body.method.trim().toUpperCase() : null;
    const bodyOverridePresent = Object.prototype.hasOwnProperty.call(body, "requestBody");

    // A synthetic in-memory check row. Every field the executor reads comes from
    // the real stored check; only the three request fields can be overridden.
    const effectiveCheck = {
      ...check,
      endpoint: endpointOverride ?? check.endpoint,
      method: methodOverride ?? check.method,
      requestBody: (bodyOverridePresent ? body.requestBody : check.requestBody) as typeof check.requestBody,
    };

    const runId = randomUUID();
    const run: MonitorCheckRun = {
      runId,
      checkKey: check.key,
      checkLabel: check.label,
      customerId,
      tenantId: customer.tenantId,
      status: "pending",
      statusText: "Queued",
      progress: 0,
      startedAt: new Date().toISOString(),
      request: {
        endpoint: effectiveCheck.endpoint,
        method: effectiveCheck.method ?? "GET",
        requestBody: effectiveCheck.requestBody ?? null,
      },
    };
    trackRun(run);

    res.status(202).json({ runId, status: "pending", run });

    // Fire-and-forget — same shape as msp-diagnostics' async run.
    void (async () => {
      run.status = "running";
      run.progress = 25;
      run.statusText = `Requesting ${run.request.method} ${run.request.endpoint}`;
      try {
        // ── The reuse point. All request execution belongs to monitor-executor. ──
        const result = await executeMonitorCheck({
          check: effectiveCheck,
          tenantId: customer.tenantId as string,
          triggerId: runId,
          skipIdempotency: true,
        });

        run.result = result;
        run.progress = 100;
        run.completedAt = new Date().toISOString();
        // executeMonitorCheck never throws for a failed check — it returns a
        // status. Map its real statuses onto the run's terminal state so the UI
        // never shows a green "completed" over a consent_revoked/error result.
        if (result.status === "ok") {
          run.status = "completed";
          run.statusText = `Completed — ${result.itemCount} item(s) across ${result.pageCount} page(s)`;
        } else {
          run.status = "failed";
          run.statusText = result.errorMessage
            ? `${result.status}: ${result.errorMessage}`
            : `Finished with status ${result.status}`;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        run.status = "failed";
        run.progress = 100;
        run.completedAt = new Date().toISOString();
        run.statusText = message;
        run.error = message;
        log.error({ err, runId, checkKey: key }, "admin-monitor-check-runs: run failed");
      }
    })();
  } catch (err) {
    log.error({ err }, "admin-monitor-check-runs: failed to start run");
    if (!res.headersSent) res.status(500).json({ error: "Failed to start monitor check run" });
  }
});

// ── GET /api/admin/monitor-check-runs/:runId ──────────────────────────────────

router.get("/admin/monitor-check-runs/:runId", requireAdmin, (req: Request, res: Response) => {
  const runId = req.params.runId as string;
  const run = runs.get(runId);
  if (!run) return void res.status(404).json({ error: "Run not found" });
  res.json({ run });
});

export default router;
