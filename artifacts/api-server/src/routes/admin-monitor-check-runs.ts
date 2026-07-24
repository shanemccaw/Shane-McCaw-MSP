/**
 * admin-monitor-check-runs.ts
 *
 * Execution, history and comparison for the Simulator Studio's "M365 Endpoints"
 * node.
 *
 * Routes:
 *   POST /api/admin/monitor-checks/:key/run             — start one run (202 + runId)
 *   POST /api/admin/monitor-checks/bulk-run             — run every check under a domain (202 + batchId)
 *   GET  /api/admin/monitor-check-runs                  — run history for a check
 *   GET  /api/admin/monitor-check-runs/:runId           — poll run status + result
 *   GET  /api/admin/monitor-check-runs/:runId/diff      — diff this run against another (?against=)
 *   POST /api/admin/monitor-check-runs/:runId/trace     — engine trace (phase 2)
 *   GET  /api/admin/monitor-check-batches/:batchId      — live bulk-run summary
 *
 * PHASE 3 — WHAT MOVED: run tracking used to live in a process-local
 * `Map<runId, run>`, which meant there was no run history at all: every run was
 * lost on api-server restart, so "list past runs" and "diff two runs" had nothing
 * to stand on. All persistence now goes through simulator-run-store.ts against
 * the dedicated `simulator_check_runs` table. The lifecycle model itself is
 * unchanged — pending → running → completed/failed, 202 + runId, poll until
 * terminal — only the storage backing it moved.
 *
 * RE-EVALUATE vs RE-RUN — two similarly-named but functionally different
 * actions, kept structurally distinct so neither can be mistaken for the other:
 *
 *   • RE-EVALUATE is the trace route below. It re-applies the real mapping and
 *     re-runs the real rule evaluation against the response ALREADY captured by
 *     that run. It issues NO Graph request — there is no call to
 *     executeMonitorCheck on this path at all, which is what makes tuning a rule
 *     and immediately re-checking it near-instant and repeatable against
 *     identical data.
 *   • RE-RUN is POST /:key/run. It genuinely hits the live tenant again.
 *
 * Keeping them on separate routes (rather than one route with a flag) is
 * deliberate: it makes "did this touch the network?" answerable from the
 * request line alone, in logs and in tests.
 *
 * REUSE, NOT REIMPLEMENTATION — the whole point of this route:
 *   • the actual Graph request is executed by monitor-executor.ts's own exported
 *     `executeMonitorCheck()`, which owns request building, placeholder
 *     resolution, @odata.nextLink pagination, the CSV-report path,
 *     mapping/extraction, schema validation, severity classification and the
 *     consent-revoked / license-gap classification;
 *   • BULK RUN uses that same single-check path — `startCheckRun()` below is the
 *     one execution function, called once per check by the bulk route rather
 *     than a parallel bulk-specific implementation that could drift from it;
 *   • DIFF re-runs Phase 2's real `traceCheckResponse()` per side rather than
 *     comparing runs with a second, diff-specific evaluator.
 *
 * `skipIdempotency: true` is passed deliberately: the idempotency guard exists
 * so a scheduled package run doesn't double-write per trigger, but a simulator
 * exists precisely to re-run the same check repeatedly and see a fresh live
 * response. Each run gets its own uuid triggerId regardless, so the persisted
 * tenant_monitor_profiles rows stay attributable.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, monitorChecksTable, mspCustomersTable, type MonitorCheck } from "@workspace/db";
import { and, eq, like } from "drizzle-orm";
import { randomUUID } from "crypto";
import { requireAdmin } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";
import { executeMonitorCheck, type MappingRule } from "../lib/monitor-executor";
import { traceCheckResponse } from "../lib/monitor-check-trace";
import { diffCheckRuns, type DiffSide } from "../lib/simulator-run-diff";
import {
  completeRun,
  createRun,
  getRun,
  listRunsForBatch,
  listRunsForCheck,
  markRunning,
  saveTrace,
  summarizeBatch,
  type MonitorCheckRun,
} from "../lib/simulator-run-store";
import { getAllRules } from "./admin-signal-rules";

const log = logger.child({ channel: "engine.monitor" });

const router: IRouter = Router();

export type { MonitorCheckRun, MonitorCheckRunStatus } from "../lib/simulator-run-store";

/**
 * How many checks a bulk run executes at once. Bounded because a bulk run over
 * a large domain would otherwise open dozens of concurrent Graph requests
 * against one tenant and get itself throttled — which would show up as a wall of
 * spurious "error" results that say nothing about the checks themselves.
 */
const BULK_RUN_CONCURRENCY = 3;

// ── Shared execution path ─────────────────────────────────────────────────────

interface RunOverrides {
  endpoint?: string | null;
  method?: string | null;
  /** Present-flag separate from value, so an explicit `null` body can be sent. */
  requestBodyPresent?: boolean;
  requestBody?: unknown;
}

/**
 * Starts ONE check run: persists it pending, kicks off the real execution, and
 * hands back both the persisted record (for an immediate 202) and a promise that
 * settles when the run reaches a terminal state.
 *
 * The returned promise NEVER rejects. That is what lets the bulk route await a
 * whole batch without one check's failure aborting the rest — a failed check is
 * a persisted `failed` run, not a thrown error.
 */
async function startCheckRun(opts: {
  check: MonitorCheck;
  customerId: number;
  tenantId: string;
  overrides?: RunOverrides;
  batchId?: string | null;
}): Promise<{ run: MonitorCheckRun; done: Promise<void> }> {
  const { check, customerId, tenantId, overrides = {}, batchId = null } = opts;

  // Per-run overrides let the operator edit endpoint/method/body before running
  // WITHOUT mutating the stored check. Editing the catalog row is the separate
  // PATCH route; a simulator run must be able to try a candidate endpoint
  // without persisting it. A bulk run passes none of these.
  const effectiveCheck: MonitorCheck = {
    ...check,
    endpoint: overrides.endpoint ?? check.endpoint,
    method: overrides.method ?? check.method,
    requestBody: (overrides.requestBodyPresent ? overrides.requestBody : check.requestBody) as MonitorCheck["requestBody"],
  };

  const runId = randomUUID();
  const run = await createRun({
    runId,
    batchId,
    checkKey: check.key,
    checkLabel: check.label,
    customerId,
    tenantId,
    request: {
      endpoint: effectiveCheck.endpoint,
      method: effectiveCheck.method ?? "GET",
      requestBody: effectiveCheck.requestBody ?? null,
    },
    mapping: (check.mapping ?? []) as MappingRule[],
    properties: (check.properties ?? []) as string[],
  });

  const done = (async () => {
    try {
      await markRunning(runId, `Requesting ${run.request.method} ${run.request.endpoint}`);

      // ── The reuse point. All request execution belongs to monitor-executor. ──
      const result = await executeMonitorCheck({
        check: effectiveCheck,
        tenantId,
        triggerId: runId,
        skipIdempotency: true,
        // Keep the untruncated item list so the engine trace (and later a diff)
        // can re-apply the real mapping to the real response without re-fetching.
        includeItems: true,
      });

      // executeMonitorCheck never throws for a failed check — it returns a
      // status. Map its real statuses onto the run's terminal state so the UI
      // never shows a green "completed" over a consent_revoked/error result.
      if (result.status === "ok") {
        await completeRun({
          runId,
          status: "completed",
          statusText: `Completed — ${result.itemCount} item(s) across ${result.pageCount} page(s)`,
          result,
        });
      } else {
        await completeRun({
          runId,
          status: "failed",
          statusText: result.errorMessage
            ? `${result.status}: ${result.errorMessage}`
            : `Finished with status ${result.status}`,
          result,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error({ err, runId, checkKey: check.key }, "admin-monitor-check-runs: run failed");
      try {
        await completeRun({ runId, status: "failed", statusText: message, errorMessage: message });
      } catch (persistErr) {
        // Losing the failure record must not escalate into an unhandled rejection
        // that could take a whole bulk batch with it.
        log.error({ err: persistErr, runId }, "admin-monitor-check-runs: failed to persist run failure");
      }
    }
  })();

  return { run, done };
}

/** Loads a customer and asserts it has a connected tenant. */
async function resolveCustomer(
  customerId: number,
): Promise<{ ok: true; tenantId: string } | { ok: false; status: number; error: string }> {
  const [customer] = await db
    .select({ id: mspCustomersTable.id, tenantId: mspCustomersTable.tenantId })
    .from(mspCustomersTable)
    .where(eq(mspCustomersTable.id, customerId))
    .limit(1);
  if (!customer) return { ok: false, status: 404, error: "Customer not found" };
  if (!customer.tenantId) {
    return { ok: false, status: 400, error: "That customer has no connected M365 tenant — nothing to execute against" };
  }
  return { ok: true, tenantId: customer.tenantId };
}

// ── POST /api/admin/monitor-checks/:key/run ───────────────────────────────────
// Fire-and-forget, mirroring msp-diagnostics' trigger route: persist the run,
// return 202 + runId immediately, execute asynchronously.

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

    const customer = await resolveCustomer(customerId);
    if (!customer.ok) return void res.status(customer.status).json({ error: customer.error });

    const { run, done } = await startCheckRun({
      check,
      customerId,
      tenantId: customer.tenantId,
      overrides: {
        endpoint: typeof body.endpoint === "string" && body.endpoint.trim() ? body.endpoint.trim() : null,
        method: typeof body.method === "string" && body.method.trim() ? body.method.trim().toUpperCase() : null,
        requestBodyPresent: Object.prototype.hasOwnProperty.call(body, "requestBody"),
        requestBody: body.requestBody,
      },
    });

    res.status(202).json({ runId: run.runId, status: run.status, run });
    void done;
  } catch (err) {
    log.error({ err }, "admin-monitor-check-runs: failed to start run");
    if (!res.headersSent) res.status(500).json({ error: "Failed to start monitor check run" });
  }
});

// ── POST /api/admin/monitor-checks/bulk-run ───────────────────────────────────
// Runs every active check under one domain prefix (e.g. every `identity:*`)
// against one tenant, as ONE batch the UI polls for a live summary.
//
// Each check goes through the same startCheckRun() the single-run route uses —
// there is no bulk-specific execution function to drift from it.

router.post("/admin/monitor-checks/bulk-run", requireAdmin, async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;

    const customerId = Number(body.customerId);
    if (!Number.isInteger(customerId) || customerId <= 0) {
      return void res.status(400).json({ error: "customerId is required" });
    }

    const domain = typeof body.domain === "string" ? body.domain.trim() : "";
    // The domain prefix is the real taxonomy (monitor_checks has no category
    // column — `identity:mfa-registration` belongs to `identity` by its key).
    if (!/^[a-z0-9_-]+$/i.test(domain)) {
      return void res.status(400).json({ error: "domain is required (the check-key prefix, e.g. \"identity\")" });
    }

    const customer = await resolveCustomer(customerId);
    if (!customer.ok) return void res.status(customer.status).json({ error: customer.error });

    const checks = await db
      .select()
      .from(monitorChecksTable)
      .where(and(like(monitorChecksTable.key, `${domain}:%`), eq(monitorChecksTable.status, "active")))
      .orderBy(monitorChecksTable.key);

    // Script-collected checks have no Graph request to issue. Reported as
    // explicitly skipped rather than started as runs that could only ever
    // return a non-result and pollute the batch's error count.
    const runnable = checks.filter((c) => !c.requiresCustomerScript);
    const skipped = checks
      .filter((c) => c.requiresCustomerScript)
      .map((c) => ({ checkKey: c.key, reason: "Collected by a customer-side script — no Graph endpoint to execute" }));

    if (runnable.length === 0) {
      return void res.status(404).json({
        error: `No runnable active checks found under "${domain}:"`,
        skipped,
      });
    }

    const batchId = randomUUID();
    const started: MonitorCheckRun[] = [];

    // The first check is started synchronously so the 202 can carry a batch that
    // already exists — a UI poll immediately after this response always finds it.
    const first = await startCheckRun({ check: runnable[0]!, customerId, tenantId: customer.tenantId, batchId });
    started.push(first.run);

    res.status(202).json({
      batchId,
      domain,
      customerId,
      checkKeys: runnable.map((c) => c.key),
      skipped,
      total: runnable.length,
    });

    // Remaining checks run behind a bounded worker pool. Every promise from
    // startCheckRun settles rather than rejects, so one check's failure cannot
    // stop the others — the failure is a persisted `failed` run.
    void (async () => {
      const queue = runnable.slice(1);
      // The first check is already executing, so it counts against the
      // concurrency budget — spawn one fewer worker rather than BULK_RUN_CONCURRENCY + 1.
      const workerCount = Math.max(1, BULK_RUN_CONCURRENCY - 1);

      const worker = async (): Promise<void> => {
        for (;;) {
          const next = queue.shift();
          if (!next) return;
          try {
            const { done } = await startCheckRun({
              check: next,
              customerId,
              tenantId: customer.tenantId,
              batchId,
            });
            await done;
          } catch (err) {
            // startCheckRun only throws if the run row itself couldn't be
            // persisted. Log it and keep the batch moving.
            log.error({ err, batchId, checkKey: next.key }, "admin-monitor-check-runs: bulk run could not start a check");
          }
        }
      };

      await Promise.all([first.done, ...Array.from({ length: workerCount }, () => worker())]);
      log.info({ batchId, domain, total: runnable.length }, "admin-monitor-check-runs: bulk run finished");
    })();
  } catch (err) {
    log.error({ err }, "admin-monitor-check-runs: failed to start bulk run");
    if (!res.headersSent) res.status(500).json({ error: "Failed to start bulk run" });
  }
});

// ── GET /api/admin/monitor-check-batches/:batchId ─────────────────────────────
// The live bulk-run summary: per-check rows plus aggregate counts, recomputed
// from the persisted rows on every poll.

router.get("/admin/monitor-check-batches/:batchId", requireAdmin, async (req: Request, res: Response) => {
  try {
    const batchId = req.params.batchId as string;
    const runs = await listRunsForBatch(batchId);
    if (runs.length === 0) return void res.status(404).json({ error: "Batch not found" });
    res.json({ summary: summarizeBatch(batchId, runs), runs });
  } catch (err) {
    log.error({ err }, "admin-monitor-check-runs: failed to load batch");
    res.status(500).json({ error: "Failed to load bulk run" });
  }
});

// ── GET /api/admin/monitor-check-runs ─────────────────────────────────────────
// Run history for one check. Reads persisted rows, so it survives a restart —
// which is the entire reason this phase exists.

router.get("/admin/monitor-check-runs", requireAdmin, async (req: Request, res: Response) => {
  try {
    const checkKey = typeof req.query.checkKey === "string" ? req.query.checkKey : "";
    if (!checkKey) return void res.status(400).json({ error: "checkKey is required" });

    const customerIdRaw = Number(req.query.customerId);
    const customerId = Number.isInteger(customerIdRaw) && customerIdRaw > 0 ? customerIdRaw : undefined;
    const limitRaw = Number(req.query.limit);
    const limit = Number.isInteger(limitRaw) && limitRaw > 0 ? limitRaw : undefined;

    const runs = await listRunsForCheck({
      checkKey,
      ...(customerId != null ? { customerId } : {}),
      ...(limit != null ? { limit } : {}),
    });
    res.json({ runs });
  } catch (err) {
    log.error({ err }, "admin-monitor-check-runs: failed to list run history");
    res.status(500).json({ error: "Failed to load run history" });
  }
});

// ── GET /api/admin/monitor-check-runs/:runId ──────────────────────────────────

router.get("/admin/monitor-check-runs/:runId", requireAdmin, async (req: Request, res: Response) => {
  try {
    const run = await getRun(req.params.runId as string);
    if (!run) return void res.status(404).json({ error: "Run not found" });
    // `items` is the full fetched payload — potentially thousands of Graph
    // objects. It stays server-side for the trace/diff routes rather than riding
    // along on every one-second poll; the response body the UI renders is result.
    const { items: _items, trace: _trace, ...pollable } = run;
    res.json({ run: pollable });
  } catch (err) {
    log.error({ err }, "admin-monitor-check-runs: failed to load run");
    res.status(500).json({ error: "Failed to load run" });
  }
});

// ── GET /api/admin/monitor-check-runs/:runId/diff?against=<runId> ─────────────
// What changed between two persisted runs of the SAME check: which produced
// values differ, and which rules started or stopped firing.

router.get("/admin/monitor-check-runs/:runId/diff", requireAdmin, async (req: Request, res: Response) => {
  try {
    const runId = req.params.runId as string;
    const against = typeof req.query.against === "string" ? req.query.against : "";
    if (!against) return void res.status(400).json({ error: "against=<runId> is required" });
    if (against === runId) return void res.status(400).json({ error: "Pick two different runs to compare" });

    const [a, b] = await Promise.all([getRun(runId), getRun(against)]);
    if (!a) return void res.status(404).json({ error: "Run not found" });
    if (!b) return void res.status(404).json({ error: "The run being compared against was not found" });

    // Diffing across two different checks would compare unrelated key universes
    // and report every key as added/removed — meaningless, so refuse.
    if (a.checkKey !== b.checkKey) {
      return void res.status(409).json({
        error: `Those runs are of different checks (${a.checkKey} vs ${b.checkKey}) — there is nothing meaningful to compare`,
      });
    }

    // Both sides need a real captured response. Be explicit rather than diffing
    // an empty array, which would render as a confident "everything disappeared".
    for (const side of [a, b]) {
      if (!Array.isArray(side.items)) {
        return void res.status(409).json({
          error: side.itemsOmitted
            ? `Run ${side.runId} has no stored response: ${side.itemsOmittedReason ?? "its response was not persisted"}`
            : `Run ${side.runId} did not capture a usable response — there is nothing to compare`,
          runId: side.runId,
          runStatus: side.status,
        });
      }
    }

    // Platform-owned rules only (msp_id IS NULL), fetched once and used for BOTH
    // sides so a flipped rule is a statement about the responses, not about a
    // rule edit between the two traces.
    const rules = await getAllRules();

    const toSide = (run: MonitorCheckRun): DiffSide => ({
      runId: run.runId,
      checkKey: run.checkKey,
      items: run.items as unknown[],
      mapping: run.mapping,
      properties: run.properties,
      startedAt: run.startedAt,
      sequence: run.sequence,
      status: run.status,
      resultStatus: run.result?.status ?? null,
    });

    const diff = diffCheckRuns({ sideA: toSide(a), sideB: toSide(b), rules });
    res.json({ diff });
  } catch (err) {
    log.error({ err }, "admin-monitor-check-runs: diff failed");
    res.status(500).json({ error: "Failed to diff these runs" });
  }
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
    const run = await getRun(runId);
    if (!run) return void res.status(404).json({ error: "Run not found" });

    if (run.status !== "completed" || !Array.isArray(run.items)) {
      // Be explicit rather than tracing an empty array, which would render as a
      // confident "this response produces no keys" over a run that never
      // returned a usable response.
      return void res.status(409).json({
        error: run.itemsOmitted
          ? `That run's response was not stored: ${run.itemsOmittedReason ?? "it was too large to persist"}`
          : run.status === "failed"
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

    // Persisted alongside the run so the history list can show which runs have
    // been traced, and so a trace outlives the process that produced it.
    const tracedAt = await saveTrace(runId, trace as unknown as Record<string, unknown>);

    res.json({ trace, runId, tracedAt });
  } catch (err) {
    log.error({ err }, "admin-monitor-check-runs: trace failed");
    res.status(500).json({ error: "Failed to trace this run" });
  }
});

export default router;
