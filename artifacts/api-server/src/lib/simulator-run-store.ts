/**
 * simulator-run-store.ts
 *
 * Durable storage for Simulator Studio check runs (Phase 3).
 *
 * WHAT CHANGED AND WHY: phases 1 and 2 tracked runs in a process-local
 * `Map<runId, MonitorCheckRun>` inside admin-monitor-check-runs.ts. That was
 * enough for the immediate poll-for-status use case, but it meant there was no
 * run history at all — every run vanished on api-server restart, so "list past
 * runs" and "diff two runs" had nothing to stand on. This module is that
 * storage, and it is the ONLY place simulator run persistence happens.
 *
 * WHAT DID NOT CHANGE: the run lifecycle itself. pending → running →
 * completed/failed, 202 + runId, poll until terminal — the same model adapted
 * from msp-diagnostics — is untouched. Only the backing store moved from a Map
 * to a real table.
 *
 * STORAGE DECISION — a dedicated `simulator_check_runs` table, NOT extra columns
 * on `tenant_monitor_profiles` (confirmed with Shane, restated here because the
 * reasoning is load-bearing): tenant_monitor_profiles is the production
 * monitoring record read back by mergeMonitorProfileRows()/buildTenantProfile()
 * to compute real signal profiles and pillar scores, keyed on an idempotency key
 * whose whole job is to stop duplicate collection — while simulator runs
 * deliberately pass skipIdempotency and re-run the same check over and over.
 * Ad-hoc test data and real monitoring data mean different things, and merging
 * them would make the real data harder to reason about later. executeMonitorCheck
 * still writes its normal tenant_monitor_profiles row on every simulator run, so
 * this table is purely additive.
 *
 * THE TRUNCATION RULE, carried forward from Phase 2: a persisted run either
 * holds the FULL captured item list or holds none of it and says so
 * (`itemsOmitted`). A truncated prefix is never stored, because re-applying a
 * mapping to a partial list yields a confident wrong count — the exact class of
 * plausible-but-wrong number the trace exists to eliminate. The size guard below
 * is loud, not silent.
 */

import { db, simulatorCheckRunsTable, type SimulatorCheckRunStatus } from "@workspace/db";
import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { logger } from "./logger";
import type { CheckResult, MappingRule } from "./monitor-executor";

const log = logger.child({ channel: "engine.monitor" });

// ── Bounds ────────────────────────────────────────────────────────────────────

/**
 * Durable replacement for the old in-memory MAX_TRACKED_RUNS eviction: keep the
 * most recent N runs per check key and prune the rest on insert. Per-check
 * rather than global so hammering one endpoint can't evict another endpoint's
 * entire history out from under a diff.
 */
export const SIMULATOR_RUN_RETENTION_PER_CHECK = 50;

/**
 * Hard ceiling on the serialized item payload a single run will persist (~16 MB).
 * Above it the items are omitted ENTIRELY and flagged, never trimmed to fit —
 * see the truncation rule in the module header.
 */
export const MAX_PERSISTED_ITEMS_BYTES = 16 * 1024 * 1024;

// ── Types ─────────────────────────────────────────────────────────────────────

/** Mirrors msp-diagnostics' real run lifecycle: pending → running → completed/failed. */
export type MonitorCheckRunStatus = SimulatorCheckRunStatus;

/**
 * The API-shaped run record. Field-for-field the same object phases 1 and 2 kept
 * in the Map, so the route handlers, the poll contract and the UI did not have
 * to change shape when the backing store did — plus the Phase 3 additions
 * (batchId, the saved trace, the items-omitted flags).
 */
export interface MonitorCheckRun {
  runId: string;
  batchId: string | null;
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
  /**
   * Monotonic insertion order (the row id). Exposed for one purpose: breaking a
   * startedAt tie deterministically when two runs of the same check land in the
   * same millisecond, so "which of these two runs is the later one" always has
   * the same answer.
   */
  sequence: number;
  completedAt?: string;
  /** The real CheckResult returned by monitor-executor.executeMonitorCheck(). */
  result?: CheckResult;
  error?: string;
  /** The real resolved request the executor was asked to run — shown in the UI. */
  request: { endpoint: string; method: string; requestBody: unknown };
  /** The full captured response items, or undefined when omitted (see itemsOmitted). */
  items?: unknown[];
  itemsOmitted: boolean;
  itemsOmittedReason?: string;
  /** Mapping/properties in force for this run, snapshotted at run time. */
  mapping: MappingRule[];
  properties: string[];
  /** The last engine trace saved against this run, if one was run. */
  trace?: Record<string, unknown>;
  tracedAt?: string;
}

/** The history-list projection: everything except the heavy payload columns. */
export interface MonitorCheckRunSummary {
  runId: string;
  batchId: string | null;
  checkKey: string;
  checkLabel: string;
  customerId: number;
  tenantId: string;
  status: MonitorCheckRunStatus;
  statusText: string;
  progress: number;
  resultStatus: string | null;
  itemCount: number | null;
  pageCount: number | null;
  severityMatched: string | null;
  licenseFeature: string | null;
  errorMessage: string | null;
  /**
   * Just the endpoint out of the run's `request` jsonb — NOT the whole request.
   *
   * Phase 4 needs it: the failure classifier reads the endpoint as corroborating
   * evidence (a /beta target, a literal non-HTTP scheme prefix), and without it a
   * run classified from the batch list could disagree with the same run classified
   * from its detail view. The request body is deliberately not projected — it can
   * be arbitrarily large and nothing on a list needs it.
   */
  requestEndpoint: string | null;
  startedAt: string;
  completedAt: string | null;
  /** True when a trace was saved against this run — the list never carries the payload. */
  hasTrace: boolean;
  /** True when the response was too large to persist; this run cannot be traced or diffed. */
  itemsOmitted: boolean;
}

export interface CreateRunInput {
  runId: string;
  batchId?: string | null;
  checkKey: string;
  checkLabel: string;
  customerId: number;
  tenantId: string;
  request: { endpoint: string; method: string; requestBody: unknown };
  mapping: MappingRule[];
  properties: string[];
}

// ── Row ⇄ API mapping ─────────────────────────────────────────────────────────

const iso = (v: Date | string | null | undefined): string | undefined => {
  if (v == null) return undefined;
  return v instanceof Date ? v.toISOString() : String(v);
};

function rowToRun(row: Record<string, any>): MonitorCheckRun {
  const run: MonitorCheckRun = {
    runId: row["runId"],
    batchId: row["batchId"] ?? null,
    checkKey: row["checkKey"],
    checkLabel: row["checkLabel"],
    customerId: Number(row["customerId"]),
    tenantId: row["tenantId"],
    status: row["status"],
    statusText: row["statusText"] ?? "",
    progress: Number(row["progress"] ?? 0),
    startedAt: iso(row["startedAt"]) ?? new Date(0).toISOString(),
    sequence: Number(row["id"] ?? 0),
    request: row["request"],
    itemsOmitted: Boolean(row["itemsOmitted"]),
    mapping: (row["mapping"] ?? []) as MappingRule[],
    properties: (row["properties"] ?? []) as string[],
  };
  const completedAt = iso(row["completedAt"]);
  if (completedAt) run.completedAt = completedAt;
  if (row["result"]) run.result = row["result"] as CheckResult;
  if (row["errorMessage"]) run.error = row["errorMessage"];
  if (Array.isArray(row["items"])) run.items = row["items"] as unknown[];
  if (row["itemsOmittedReason"]) run.itemsOmittedReason = row["itemsOmittedReason"];
  if (row["trace"]) run.trace = row["trace"] as Record<string, unknown>;
  const tracedAt = iso(row["tracedAt"]);
  if (tracedAt) run.tracedAt = tracedAt;
  return run;
}

function rowToSummary(row: Record<string, any>): MonitorCheckRunSummary {
  return {
    runId: row["runId"],
    batchId: row["batchId"] ?? null,
    checkKey: row["checkKey"],
    checkLabel: row["checkLabel"],
    customerId: Number(row["customerId"]),
    tenantId: row["tenantId"],
    status: row["status"],
    statusText: row["statusText"] ?? "",
    progress: Number(row["progress"] ?? 0),
    resultStatus: row["resultStatus"] ?? null,
    itemCount: row["itemCount"] ?? null,
    pageCount: row["pageCount"] ?? null,
    severityMatched: row["severityMatched"] ?? null,
    licenseFeature: row["licenseFeature"] ?? null,
    errorMessage: row["errorMessage"] ?? null,
    requestEndpoint: (row["request"] as { endpoint?: string } | null)?.endpoint ?? null,
    startedAt: iso(row["startedAt"]) ?? new Date(0).toISOString(),
    completedAt: iso(row["completedAt"]) ?? null,
    hasTrace: Boolean(row["hasTrace"]),
    itemsOmitted: Boolean(row["itemsOmitted"]),
  };
}

/** Columns the list projections select — deliberately excludes items/result/trace. */
const SUMMARY_COLUMNS = {
  runId: simulatorCheckRunsTable.runId,
  batchId: simulatorCheckRunsTable.batchId,
  checkKey: simulatorCheckRunsTable.checkKey,
  checkLabel: simulatorCheckRunsTable.checkLabel,
  customerId: simulatorCheckRunsTable.customerId,
  tenantId: simulatorCheckRunsTable.tenantId,
  status: simulatorCheckRunsTable.status,
  statusText: simulatorCheckRunsTable.statusText,
  progress: simulatorCheckRunsTable.progress,
  resultStatus: simulatorCheckRunsTable.resultStatus,
  itemCount: simulatorCheckRunsTable.itemCount,
  pageCount: simulatorCheckRunsTable.pageCount,
  severityMatched: simulatorCheckRunsTable.severityMatched,
  licenseFeature: simulatorCheckRunsTable.licenseFeature,
  errorMessage: simulatorCheckRunsTable.errorMessage,
  // The endpoint is projected out of this in rowToSummary; `result`/`items`/`trace`
  // stay excluded, which is what keeps these projections light.
  request: simulatorCheckRunsTable.request,
  startedAt: simulatorCheckRunsTable.startedAt,
  completedAt: simulatorCheckRunsTable.completedAt,
  tracedAt: simulatorCheckRunsTable.tracedAt,
  itemsOmitted: simulatorCheckRunsTable.itemsOmitted,
};

/** `hasTrace` is derived from tracedAt so the list never has to read the trace jsonb. */
const withHasTrace = (row: Record<string, any>) => ({ ...row, hasTrace: row["tracedAt"] != null });

// ── Writes ────────────────────────────────────────────────────────────────────

/**
 * Inserts the run in its initial `pending` state and returns the API-shaped
 * record, so the 202 response body is built from what was actually persisted
 * rather than from a parallel in-memory object that could drift from it.
 */
export async function createRun(input: CreateRunInput): Promise<MonitorCheckRun> {
  const startedAt = new Date();
  const inserted = await db.insert(simulatorCheckRunsTable).values({
    runId: input.runId,
    batchId: input.batchId ?? null,
    checkKey: input.checkKey,
    checkLabel: input.checkLabel,
    customerId: input.customerId,
    tenantId: input.tenantId,
    status: "pending",
    statusText: "Queued",
    progress: 0,
    request: input.request,
    mapping: input.mapping,
    properties: input.properties,
    startedAt,
  })
    .returning({ id: simulatorCheckRunsTable.id });

  // Best-effort: a full history table is never a reason to fail a run.
  void pruneRunsForCheck(input.checkKey).catch((err) => {
    log.warn({ err, checkKey: input.checkKey }, "simulator-run-store: retention prune failed");
  });

  return {
    runId: input.runId,
    batchId: input.batchId ?? null,
    checkKey: input.checkKey,
    checkLabel: input.checkLabel,
    customerId: input.customerId,
    tenantId: input.tenantId,
    status: "pending",
    statusText: "Queued",
    progress: 0,
    startedAt: startedAt.toISOString(),
    sequence: Number(inserted[0]?.id ?? 0),
    request: input.request,
    itemsOmitted: false,
    mapping: input.mapping,
    properties: input.properties,
  };
}

/** Moves a run to `running` with its live status line. */
export async function markRunning(runId: string, statusText: string, progress = 25): Promise<void> {
  await db
    .update(simulatorCheckRunsTable)
    .set({ status: "running", statusText, progress })
    .where(eq(simulatorCheckRunsTable.runId, runId));
}

/**
 * Persists a terminal run.
 *
 * `result.items` is split off into its own column: the history list and the
 * one-second poll both read `result`, and neither should drag thousands of Graph
 * objects along for the ride.
 */
export async function completeRun(opts: {
  runId: string;
  status: Extract<MonitorCheckRunStatus, "completed" | "failed">;
  statusText: string;
  result?: CheckResult;
  errorMessage?: string;
}): Promise<void> {
  const { runId, status, statusText, result, errorMessage } = opts;

  const items = result?.items;
  const { items: _omit, ...resultWithoutItems } = (result ?? {}) as CheckResult & Record<string, unknown>;

  let persistedItems: unknown[] | null = null;
  let itemsOmitted = false;
  let itemsOmittedReason: string | null = null;

  if (Array.isArray(items)) {
    const bytes = safeByteLength(items);
    if (bytes == null) {
      itemsOmitted = true;
      itemsOmittedReason = "The captured response could not be serialized for storage (circular or non-JSON value).";
    } else if (bytes > MAX_PERSISTED_ITEMS_BYTES) {
      // Loud, not silent: store none of it rather than a prefix that would make
      // a re-applied mapping report a wrong count.
      itemsOmitted = true;
      itemsOmittedReason =
        `The captured response was ${Math.round(bytes / (1024 * 1024))} MB across ${items.length} item(s), ` +
        `over the ${Math.round(MAX_PERSISTED_ITEMS_BYTES / (1024 * 1024))} MB persistence limit. ` +
        `It was NOT stored in part — a partial list would make the trace report wrong counts. Re-run to trace it.`;
    } else {
      persistedItems = items;
    }
  }

  await db
    .update(simulatorCheckRunsTable)
    .set({
      status,
      statusText,
      progress: 100,
      completedAt: new Date(),
      result: result ? (resultWithoutItems as Record<string, unknown>) : null,
      resultStatus: result?.status ?? null,
      itemCount: result?.itemCount ?? null,
      pageCount: result?.pageCount ?? null,
      severityMatched: result?.severityMatched ?? null,
      licenseFeature: result?.licenseFeature ?? null,
      errorMessage: errorMessage ?? result?.errorMessage ?? null,
      items: persistedItems,
      itemsOmitted,
      itemsOmittedReason,
    })
    .where(eq(simulatorCheckRunsTable.runId, runId));
}

/** Saves the engine trace a Re-evaluate produced against this run. */
export async function saveTrace(runId: string, trace: Record<string, unknown>): Promise<string> {
  const tracedAt = new Date();
  await db
    .update(simulatorCheckRunsTable)
    .set({ trace, tracedAt })
    .where(eq(simulatorCheckRunsTable.runId, runId));
  return tracedAt.toISOString();
}

/**
 * Keeps the most recent SIMULATOR_RUN_RETENTION_PER_CHECK runs for a check key.
 * Two statements rather than one correlated DELETE so the intent stays legible
 * and the deleted set is knowable for logging.
 */
export async function pruneRunsForCheck(checkKey: string): Promise<number> {
  // Ordered by id, not started_at: id is the monotonic insertion order, so
  // "keep the newest N, delete everything below the oldest kept id" is exactly
  // consistent with itself. Two runs started in the same millisecond would make
  // a started_at ordering ambiguous here.
  const keep = await db
    .select({ id: simulatorCheckRunsTable.id })
    .from(simulatorCheckRunsTable)
    .where(eq(simulatorCheckRunsTable.checkKey, checkKey))
    .orderBy(desc(simulatorCheckRunsTable.id))
    .limit(SIMULATOR_RUN_RETENTION_PER_CHECK);

  if (keep.length < SIMULATOR_RUN_RETENTION_PER_CHECK) return 0;

  const oldestKeptId = keep[keep.length - 1]!.id;
  const stale = await db
    .select({ id: simulatorCheckRunsTable.id })
    .from(simulatorCheckRunsTable)
    .where(and(eq(simulatorCheckRunsTable.checkKey, checkKey), lt(simulatorCheckRunsTable.id, oldestKeptId)));

  if (stale.length === 0) return 0;
  await db.delete(simulatorCheckRunsTable).where(inArray(simulatorCheckRunsTable.id, stale.map((r) => r.id)));
  return stale.length;
}

// ── Reads ─────────────────────────────────────────────────────────────────────

/** Full run record including the captured items. Null when the run is unknown. */
export async function getRun(runId: string): Promise<MonitorCheckRun | null> {
  const rows = await db
    .select()
    .from(simulatorCheckRunsTable)
    .where(eq(simulatorCheckRunsTable.runId, runId))
    .limit(1);
  const row = rows[0];
  return row ? rowToRun(row as Record<string, any>) : null;
}

/** Run history for one check, newest first. Never carries items/result/trace. */
export async function listRunsForCheck(opts: {
  checkKey: string;
  customerId?: number;
  limit?: number;
}): Promise<MonitorCheckRunSummary[]> {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), SIMULATOR_RUN_RETENTION_PER_CHECK);
  const where =
    opts.customerId != null
      ? and(
          eq(simulatorCheckRunsTable.checkKey, opts.checkKey),
          eq(simulatorCheckRunsTable.customerId, opts.customerId),
        )
      : eq(simulatorCheckRunsTable.checkKey, opts.checkKey);

  const rows = await db
    .select(SUMMARY_COLUMNS)
    .from(simulatorCheckRunsTable)
    .where(where)
    // id is the tiebreak: two runs started in the same millisecond would
    // otherwise come back in an unstable order and make the history list jitter.
    .orderBy(desc(simulatorCheckRunsTable.startedAt), desc(simulatorCheckRunsTable.id))
    .limit(limit);

  return rows.map((r) => rowToSummary(withHasTrace(r as Record<string, any>)));
}

/** Every run in one bulk-run batch, oldest first (the order they were queued). */
export async function listRunsForBatch(batchId: string): Promise<MonitorCheckRunSummary[]> {
  const rows = await db
    .select(SUMMARY_COLUMNS)
    .from(simulatorCheckRunsTable)
    .where(eq(simulatorCheckRunsTable.batchId, batchId))
    .orderBy(simulatorCheckRunsTable.startedAt, simulatorCheckRunsTable.id);

  return rows.map((r) => rowToSummary(withHasTrace(r as Record<string, any>)));
}

// ── Batch summary ─────────────────────────────────────────────────────────────

export interface BatchSummary {
  batchId: string;
  total: number;
  /** Lifecycle counts — how far the batch has got. */
  pending: number;
  running: number;
  completed: number;
  failed: number;
  /** Outcome counts, from the executor's real CheckResult.status. */
  ok: number;
  error: number;
  licenseGap: number;
  consentRevoked: number;
  requiresScript: number;
  /** Distinct customer-safe add-on names behind the license_gap results. */
  licenseGapFeatures: string[];
  /** True once no run in the batch is still pending or running. */
  finished: boolean;
}

/**
 * Aggregates a batch from its persisted rows.
 *
 * Lifecycle counts (pending/running/completed/failed) and outcome counts
 * (ok/error/license_gap) are reported SEPARATELY and never collapsed: a
 * license_gap run is a `failed` run in lifecycle terms — the run route maps
 * every non-ok executor status to `failed` so the UI can't show green over a
 * non-result — but it is emphatically not an error in outcome terms, it means
 * the tenant lacks the SKU. Collapsing the two would report a healthy tenant's
 * missing add-on as a broken check.
 */
export function summarizeBatch(batchId: string, runs: MonitorCheckRunSummary[]): BatchSummary {
  const count = (pred: (r: MonitorCheckRunSummary) => boolean) => runs.filter(pred).length;
  const licenseGapFeatures = Array.from(
    new Set(runs.filter((r) => r.resultStatus === "license_gap" && r.licenseFeature).map((r) => r.licenseFeature!)),
  ).sort();

  return {
    batchId,
    total: runs.length,
    pending: count((r) => r.status === "pending"),
    running: count((r) => r.status === "running"),
    completed: count((r) => r.status === "completed"),
    failed: count((r) => r.status === "failed"),
    ok: count((r) => r.resultStatus === "ok"),
    error: count((r) => r.resultStatus === "error"),
    licenseGap: count((r) => r.resultStatus === "license_gap"),
    consentRevoked: count((r) => r.resultStatus === "consent_revoked"),
    requiresScript: count((r) => r.resultStatus === "requires_script"),
    licenseGapFeatures,
    finished: runs.every((r) => r.status === "completed" || r.status === "failed"),
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Byte length of the JSON encoding, or null when the value can't be serialized. */
function safeByteLength(value: unknown): number | null {
  try {
    return Buffer.byteLength(JSON.stringify(value) ?? "", "utf8");
  } catch {
    return null;
  }
}
