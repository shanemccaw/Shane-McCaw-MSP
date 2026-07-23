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
 *   POST /api/admin/monitor-checks/:key/run          — start a run (202 + runId)
 *   GET  /api/admin/monitor-check-runs/:runId        — poll run status + result
 *   POST /api/admin/monitor-check-runs/:runId/trace  — engine trace (phase 2)
 *
 * RE-EVALUATE vs RE-RUN — two similarly-named but functionally different
 * actions, kept structurally distinct so neither can be mistaken for the other:
 *
 *   • RE-EVALUATE is the trace route below. It re-applies the real mapping and
 *     re-runs the real rule evaluation against the response ALREADY captured by
 *     the last run, held in `run.items`. It issues NO Graph request — there is
 *     no call to executeMonitorCheck on this path at all, which is what makes
 *     tuning a rule and immediately re-checking it near-instant and repeatable
 *     against identical data.
 *   • RE-RUN is the existing POST /:key/run above. It genuinely hits the live
 *     tenant again, then the client traces the fresh response.
 *
 * Keeping them on separate routes (rather than one route with a flag) is
 * deliberate: it makes "did this touch the network?" answerable from the
 * request line alone, in logs and in tests.
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
import { executeMonitorCheck, type CheckResult, type MappingRule } from "../lib/monitor-executor";
import { traceCheckResponse } from "../lib/monitor-check-trace";
import { getAllRules } from "./admin-signal-rules";

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
  /**
   * The full captured response items from this run, kept in memory so
   * "Re-evaluate" can re-trace without touching the network.
   *
   * Deliberately NOT read back from tenant_monitor_profiles.rawResponse:
   * that column holds only the FIRST page (and for a CSV usage report only the
   * first five rows), so re-applying a mapping to it would report wrong counts
   * for every paginated check — the precise class of plausible-but-wrong number
   * this trace exists to eliminate.
   */
  items?: unknown[];
  /**
   * The mapping/properties actually in force for this run. Snapshotted at run
   * time so a later catalog edit can't retroactively change what this run's
   * trace claims the response produced.
   */
  mapping: MappingRule[];
  properties: string[];
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
      mapping: (check.mapping ?? []) as MappingRule[],
      properties: (check.properties ?? []) as string[],
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
          // Keep the untruncated item list so the engine trace can re-apply the
          // real mapping to the real response without re-fetching it.
          includeItems: true,
        });

        run.items = result.items;
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
  // `items` is the full fetched payload — potentially thousands of Graph objects.
  // It stays server-side for the trace route rather than riding along on every
  // one-second poll; the response body the UI already renders is result.
  const { items: _items, ...pollable } = run;
  res.json({ run: pollable });
});

// ── POST /api/admin/monitor-check-runs/:runId/trace ───────────────────────────
// RE-EVALUATE. No network call, by construction: this handler never touches
// executeMonitorCheck or Graph. It re-applies the check's real mapping and
// re-runs the real rule evaluation against the response this run already
// captured, so tuning a rule and re-checking it is instant and compares
// like-for-like against identical data.

router.post("/admin/monitor-check-runs/:runId/trace", requireAdmin, async (req: Request, res: Response) => {
  try {
    const runId = req.params.runId as string;
    const run = runs.get(runId);
    if (!run) return void res.status(404).json({ error: "Run not found" });

    if (run.status !== "completed" || !run.items) {
      // Be explicit rather than tracing an empty array, which would render as a
      // confident "this response produces no keys" over a run that never
      // returned a usable response.
      return void res.status(409).json({
        error:
          run.status === "failed"
            ? "That run did not complete successfully — there is no captured response to trace"
            : "That run has no captured response yet",
        runStatus: run.status,
      });
    }

    // Optional per-request mapping/properties override lets the operator try a
    // candidate mapping against the SAME captured response before saving it to
    // the catalog. Absent, the run's own snapshotted config is used.
    const body = (req.body ?? {}) as Record<string, unknown>;
    const mapping = Array.isArray(body.mapping) ? (body.mapping as MappingRule[]) : run.mapping;
    const properties = Array.isArray(body.properties) ? (body.properties as string[]) : run.properties;

    // Platform-owned rules only (msp_id IS NULL) — getAllRules already enforces
    // that scope, matching how the rest of this session's rule work is scoped.
    const rules = await getAllRules();

    const trace = traceCheckResponse({
      checkKey: run.checkKey,
      items: run.items,
      mapping,
      properties,
      rules,
    });

    res.json({ trace, runId, tracedAt: new Date().toISOString() });
  } catch (err) {
    log.error({ err }, "admin-monitor-check-runs: trace failed");
    res.status(500).json({ error: "Failed to trace this run" });
  }
});

export default router;
