/**
 * drift-collector.ts — the producer half of the Configuration Drift engine (#1270).
 *
 * Turns a fresh configuration scan of one domain (Conditional Access first) into
 * itemized per-setting drift events, by diffing it against the tenant's CURRENT
 * baseline snapshot and persisting each change to `drift_events`. This is what
 * finally backs the `drift.*` timeline metrics and the Health config-drift table,
 * which were previously declared/built expecting a per-event history that had
 * never existed in the backend (see #1261, #1265, and this file's schema note in
 * lib/db/src/schema/msp.ts).
 *
 * Design decisions, stated once:
 *   - The baseline is a REFERENCE, not "the previous scan". A captured baseline
 *     stays the comparison point until it is explicitly re-captured (re-signed),
 *     so drift is deviation from an approved state — not churn since last poll.
 *     Callers that genuinely want rolling "changes since last scan" pass
 *     `rebaselineAfter: true`.
 *   - First scan of a domain with no baseline captures the baseline and reports
 *     ZERO events (there is nothing to have drifted from yet) — honest, not a
 *     synthesized "everything changed".
 *   - Re-running the same scan against the same baseline never double-inserts:
 *     each event carries a deterministic idempotency key over
 *     (tenant, domain, baseline, op, setting), inserted ON CONFLICT DO NOTHING.
 *   - Verdict is driven by real attribution only. No attribution → `unattributed`
 *     (the riskiest, floated-up state), never an invented actor.
 *
 * The diff primitive is the existing in-repo `detectDrift` (pcc/drift-detector.ts),
 * which already emits `{ op, path, value, oldValue }` per changed JSON path.
 */

import { db } from "@workspace/db";
import { driftBaselineSnapshotsTable, driftEventsTable, driftCollectionStatusTable } from "@workspace/db";
import type { DriftEventStatus, DriftEventVerdict, InsertDriftEvent, DriftCollectionStatus } from "@workspace/db";
import { and, eq, isNull, desc, inArray, sql } from "drizzle-orm";
import { detectDrift, type PccDiff } from "./pcc/drift-detector.ts";
import { driftSpecForCheck, type DriftScanContext } from "./drift-check-specs.ts";
import { logger } from "./logger.ts";

const log = logger.child({ channel: "engine.dashboard" });

/**
 * The drift domains this engine knows about. `slug` is the bare domain key stored
 * on drift rows; `sourceKey` is the `drift:*` dashboard-registry metric sourceKey
 * that resolves against it. Conditional Access is the first collected domain;
 * the rest are declared so the resolver + UI light up as each gains a collector.
 */
export const DRIFT_DOMAINS = {
  "ca-policy": { sourceKey: "drift:ca-policy", label: "Conditional Access policy" },
  // #1287 — extended past CA to four more executor paths. Each has a real
  // collector (see DRIFT_CHECK_SPECS in drift-check-specs.ts) and a stable,
  // id-keyed (or single-setting) config the resolver can serve as a timeline.
  "eeeu-site-sharing": { sourceKey: "drift:eeeu-site-sharing", label: "SharePoint external site sharing" },
  "public-teams-discoverable": { sourceKey: "drift:public-teams-discoverable", label: "Public / discoverable Teams" },
  "tenant-sharing-capability": { sourceKey: "drift:tenant-sharing-capability", label: "SharePoint tenant sharing capability" },
  "email-authentication": { sourceKey: "drift:email-authentication", label: "Email authentication (SPF / DKIM / DMARC)" },
} as const;

export type DriftDomainKey = keyof typeof DRIFT_DOMAINS;

/** Bare domain slug for a `drift:*` metric sourceKey (e.g. "drift:ca-policy" → "ca-policy"). */
export function driftDomainKeyFromSourceKey(sourceKey: string): string {
  return sourceKey.startsWith("drift:") ? sourceKey.slice("drift:".length) : sourceKey;
}

/** Optional attribution for a single changed setting, supplied by the caller from the audit log. */
export interface DriftAttribution {
  changedBy?: string | null;
  crRef?: string | null;
  /**
   * #1505 — the real `msp_change_requests.id` behind `crRef` above, when the
   * caller has it. `crRef` stays the display string; this is the FK
   * `drift_events.change_request_id` is written from.
   */
  changeRequestId?: number | null;
}

/**
 * Verdict from attribution alone (pure — unit tested without a DB):
 *   linked CR            → approved
 *   known actor, no CR   → attributed_unapproved
 *   nothing known        → unattributed
 */
export function deriveVerdict(attr: DriftAttribution | undefined): DriftEventVerdict {
  if (attr?.crRef) return "approved";
  if (attr?.changedBy) return "attributed_unapproved";
  return "unattributed";
}

/** Deterministic per-(baseline, setting) key so a repeated scan never double-inserts. */
export function buildDriftIdempotencyKey(
  tenantId: string,
  domainKey: string,
  baselineSnapshotId: number,
  op: string,
  setting: string,
): string {
  return `${tenantId}|${domainKey}|${baselineSnapshotId}|${op}|${setting}`;
}

export interface PlannedDriftEvent {
  setting: string;
  op: PccDiff["op"];
  oldValue: unknown;
  newValue: unknown;
  changedBy: string | null;
  verdict: DriftEventVerdict;
  crRef: string | null;
  /** #1505 — the real FK behind `crRef`, see `DriftAttribution.changeRequestId`. */
  changeRequestId: number | null;
}

/**
 * Pure: map raw diffs → planned drift events, applying attribution/verdict.
 * `attributionFor` is looked up by the setting path; absent → unattributed.
 * Unit-tested without a database.
 */
export function planDriftEvents(
  diffs: PccDiff[],
  attributionFor?: (setting: string) => DriftAttribution | undefined,
): PlannedDriftEvent[] {
  return diffs.map((d) => {
    const setting = d.path || "/";
    const attr = attributionFor?.(setting);
    return {
      setting,
      op: d.op,
      // A 'remove' has no new value; an 'add' has no old value. detectDrift
      // omits the absent side, so normalize to null rather than undefined.
      oldValue: d.oldValue ?? null,
      newValue: d.value ?? null,
      changedBy: attr?.changedBy ?? null,
      verdict: deriveVerdict(attr),
      crRef: attr?.crRef ?? null,
      changeRequestId: attr?.changeRequestId ?? null,
    };
  });
}

// ── Resolution / reopen lifecycle (#1290) ─────────────────────────────────────
//
// The baseline is the reference, so a drift event's WHOLE life plays out against
// one baseline snapshot. Given the current drift set (planned) for that baseline
// and the events already stored against it, three transitions are possible:
//   * a setting that drifted before and no longer appears in the diff has
//     returned to baseline           → RESOLVE it (status='resolved').
//   * a setting whose event was previously resolved appears in the diff again
//     → REOPEN it (status='reopened'). This is the regression the idempotency
//       key (tenant|domain|baseline|op|setting) otherwise makes impossible to
//       record as a second event.
//   * a setting still drifting whose event is already open/reopened → unchanged.
// A setting drifting for the first time is a plain insert.

/** The stored lifecycle state of an existing drift event, for the planner below. */
export interface ExistingDriftEventState {
  idempotencyKey: string;
  status: DriftEventStatus;
}

export interface DriftLifecyclePlan {
  /** Brand-new events — no existing row for the key. Inserted as status='open'. */
  toInsert: PlannedDriftEvent[];
  /** Events whose key matched a RESOLVED row — the finding reappeared. Reopened. */
  toReopen: PlannedDriftEvent[];
  /** Events whose key matched an already open/reopened row — no state change. */
  unchanged: PlannedDriftEvent[];
  /** Keys of existing open/reopened rows no longer drifting — returned to baseline. */
  toResolveKeys: string[];
}

/**
 * Pure: given the current drift set and the events already stored against the
 * SAME baseline, decide inserts / reopens / resolutions. Unit-tested without a DB.
 */
export function planDriftLifecycle(
  planned: PlannedDriftEvent[],
  keyFor: (p: PlannedDriftEvent) => string,
  existing: ExistingDriftEventState[],
): DriftLifecyclePlan {
  const statusByKey = new Map(existing.map((e) => [e.idempotencyKey, e.status]));
  const currentKeys = new Set(planned.map(keyFor));

  const toInsert: PlannedDriftEvent[] = [];
  const toReopen: PlannedDriftEvent[] = [];
  const unchanged: PlannedDriftEvent[] = [];
  for (const p of planned) {
    const status = statusByKey.get(keyFor(p));
    if (status === undefined) toInsert.push(p);
    else if (status === "resolved") toReopen.push(p);
    else unchanged.push(p);
  }

  const toResolveKeys = existing
    .filter((e) => (e.status === "open" || e.status === "reopened") && !currentKeys.has(e.idempotencyKey))
    .map((e) => e.idempotencyKey);

  return { toInsert, toReopen, unchanged, toResolveKeys };
}

/** The current (superseded_at IS NULL) baseline snapshot for a (tenant, domain), if any. */
export async function getCurrentBaseline(tenantId: string, domainKey: string) {
  const [row] = await db
    .select()
    .from(driftBaselineSnapshotsTable)
    .where(
      and(
        eq(driftBaselineSnapshotsTable.tenantId, tenantId),
        eq(driftBaselineSnapshotsTable.domainKey, domainKey),
        isNull(driftBaselineSnapshotsTable.supersededAt),
      ),
    )
    .orderBy(desc(driftBaselineSnapshotsTable.capturedAt))
    .limit(1);
  return row ?? null;
}

export interface CaptureBaselineOpts {
  capturedBy?: string;
  signed?: boolean;
}

/**
 * Capture `config` as the new current baseline for (tenant, domain), superseding
 * any existing current baseline. Returns the new snapshot's integer id.
 */
export async function captureBaseline(
  tenantId: string,
  domainKey: string,
  config: unknown,
  opts: CaptureBaselineOpts = {},
): Promise<number> {
  await db
    .update(driftBaselineSnapshotsTable)
    .set({ supersededAt: new Date() })
    .where(
      and(
        eq(driftBaselineSnapshotsTable.tenantId, tenantId),
        eq(driftBaselineSnapshotsTable.domainKey, domainKey),
        isNull(driftBaselineSnapshotsTable.supersededAt),
      ),
    );
  const [inserted] = await db
    .insert(driftBaselineSnapshotsTable)
    .values({
      tenantId,
      domainKey,
      config,
      signed: opts.signed ?? false,
      capturedBy: opts.capturedBy ?? "system",
    })
    .returning({ id: driftBaselineSnapshotsTable.id });
  return inserted.id;
}

export interface CollectDriftOpts {
  /** Look up attribution (actor / linked CR) for a changed setting path. */
  attributionFor?: (setting: string) => DriftAttribution | undefined;
  /** After detecting drift, capture the fresh config as the new baseline. Default false. */
  rebaselineAfter?: boolean;
  capturedBy?: string;
}

export interface CollectDriftResult {
  /** True when there was no prior baseline — one was captured and no events were emitted. */
  firstRun: boolean;
  baselineSnapshotId: number;
  /** Drift events newly persisted this run (excludes ones already present by idempotency key). */
  inserted: PlannedDriftEvent[];
  /** Previously-resolved events that drifted again this run and were reopened (#1290). */
  reopened: PlannedDriftEvent[];
  /** How many open/reopened events returned to baseline this run and were resolved (#1290). */
  resolved: number;
}

/**
 * Diff a fresh `currentConfig` scan of (tenant, domain) against the current
 * baseline and persist itemized drift events. Captures the baseline on first run.
 */
export async function collectDrift(
  tenantId: string,
  domainKey: string,
  currentConfig: unknown,
  opts: CollectDriftOpts = {},
): Promise<CollectDriftResult> {
  const baseline = await getCurrentBaseline(tenantId, domainKey);

  if (!baseline) {
    const id = await captureBaseline(tenantId, domainKey, currentConfig, { capturedBy: opts.capturedBy });
    log.info({ tenantId, domainKey, baselineSnapshotId: id }, "drift: captured first baseline (no prior reference)");
    return { firstRun: true, baselineSnapshotId: id, inserted: [], reopened: [], resolved: 0 };
  }

  const diffs = detectDrift(baseline.config, currentConfig);
  const planned = planDriftEvents(diffs, opts.attributionFor);
  const keyFor = (p: PlannedDriftEvent) =>
    buildDriftIdempotencyKey(tenantId, domainKey, baseline.id, p.op, p.setting);

  // Existing events for THIS baseline, so we can resolve settings that reverted
  // and reopen settings that drifted again after being resolved (#1290).
  const existing = await db
    .select({ idempotencyKey: driftEventsTable.idempotencyKey, status: driftEventsTable.status })
    .from(driftEventsTable)
    .where(
      and(
        eq(driftEventsTable.tenantId, tenantId),
        eq(driftEventsTable.domainKey, domainKey),
        eq(driftEventsTable.baselineSnapshotId, baseline.id),
      ),
    );

  const plan = planDriftLifecycle(planned, keyFor, existing);
  const now = new Date();

  // 1. Resolve open/reopened events whose setting returned to baseline.
  if (plan.toResolveKeys.length > 0) {
    await db
      .update(driftEventsTable)
      .set({ status: "resolved", resolvedAt: now })
      .where(inArray(driftEventsTable.idempotencyKey, plan.toResolveKeys));
  }

  // 2. Insert brand-new drift events (status defaults to 'open').
  let inserted: PlannedDriftEvent[] = [];
  if (plan.toInsert.length > 0) {
    const rows: InsertDriftEvent[] = plan.toInsert.map((p) => ({
      tenantId,
      domainKey,
      idempotencyKey: keyFor(p),
      setting: p.setting,
      op: p.op,
      oldValue: p.oldValue,
      newValue: p.newValue,
      changedBy: p.changedBy,
      verdict: p.verdict,
      crRef: p.crRef,
      changeRequestId: p.changeRequestId,
      baselineSnapshotId: baseline.id,
    }));
    // ON CONFLICT DO NOTHING guards a concurrent inserter racing the same key.
    const returned = await db
      .insert(driftEventsTable)
      .values(rows)
      .onConflictDoNothing({ target: driftEventsTable.idempotencyKey })
      .returning({ idempotencyKey: driftEventsTable.idempotencyKey });
    const insertedKeys = new Set(returned.map((r) => r.idempotencyKey));
    inserted = plan.toInsert.filter((p) => insertedKeys.has(keyFor(p)));
  }

  // 3. Reopen previously-resolved events whose setting drifted from baseline again.
  const reopened: PlannedDriftEvent[] = [];
  for (const p of plan.toReopen) {
    const returned = await db
      .update(driftEventsTable)
      .set({
        status: "reopened",
        reopenedAt: now,
        resolvedAt: null,
        reopenCount: sql`${driftEventsTable.reopenCount} + 1`,
        detectedAt: now,
        // Refresh the change detail/attribution to the current drift.
        oldValue: p.oldValue,
        newValue: p.newValue,
        changedBy: p.changedBy,
        verdict: p.verdict,
        crRef: p.crRef,
        changeRequestId: p.changeRequestId,
      })
      .where(
        and(
          eq(driftEventsTable.idempotencyKey, keyFor(p)),
          eq(driftEventsTable.status, "resolved"),
        ),
      )
      .returning({ idempotencyKey: driftEventsTable.idempotencyKey });
    if (returned.length > 0) reopened.push(p);
  }

  if (inserted.length > 0 || reopened.length > 0 || plan.toResolveKeys.length > 0) {
    log.info(
      {
        tenantId,
        domainKey,
        detected: planned.length,
        inserted: inserted.length,
        reopened: reopened.length,
        resolved: plan.toResolveKeys.length,
      },
      "drift: persisted config-drift lifecycle changes",
    );
  }

  if (opts.rebaselineAfter) {
    const id = await captureBaseline(tenantId, domainKey, currentConfig, { capturedBy: opts.capturedBy });
    return { firstRun: false, baselineSnapshotId: id, inserted, reopened, resolved: plan.toResolveKeys.length };
  }
  return { firstRun: false, baselineSnapshotId: baseline.id, inserted, reopened, resolved: plan.toResolveKeys.length };
}

// ── Honest per-domain collection status (#1287) ───────────────────────────────
//
// The producer above knows three outcomes (first baseline / clean / events). The
// #1287 rollout to every executor type adds a fourth the resolver could not
// otherwise tell apart from "never scanned": a scan RAN this run but no stable
// diff could be made (e.g. a fan-out that hit its coverage cap). This upsert is
// the durable, readable record of the LAST collection attempt per (tenant,
// domain), so the UI can show a SPECIFIC reason instead of a silent gap.

export interface DriftCollectionStatusInput {
  status: DriftCollectionStatus;
  /** Specific human reason for not_comparable / error; NULL for tracked / baseline_captured. */
  reason?: string | null;
  /** The monitor_checks.key that drives this domain, for provenance. */
  checkKey?: string | null;
  /** Optional coverage / diagnostic detail (scanned/total/truncated/run status). */
  coverage?: Record<string, unknown> | null;
  /** New drift events this run inserted (0 for clean / not_comparable / error). */
  eventsInserted?: number;
}

/** Upsert the current drift-collection status for one (tenant, domain). */
export async function recordDriftCollectionStatus(
  tenantId: string,
  domainKey: string,
  input: DriftCollectionStatusInput,
): Promise<void> {
  const now = new Date();
  await db
    .insert(driftCollectionStatusTable)
    .values({
      tenantId,
      domainKey,
      checkKey: input.checkKey ?? null,
      status: input.status,
      reason: input.reason ?? null,
      coverage: input.coverage ?? null,
      eventsInserted: input.eventsInserted ?? 0,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [driftCollectionStatusTable.tenantId, driftCollectionStatusTable.domainKey],
      set: {
        checkKey: input.checkKey ?? null,
        status: input.status,
        reason: input.reason ?? null,
        coverage: input.coverage ?? null,
        eventsInserted: input.eventsInserted ?? 0,
        updatedAt: now,
      },
    });
}

export interface MaybeCollectDriftParams {
  /** The monitor_checks.key that just completed. */
  checkKey: string;
  tenantId: string;
  /** The completed scan, in the executor-agnostic shape every path can populate. */
  scan: DriftScanContext;
  /** Per-setting attribution (only Conditional Access supplies one today). */
  attributionFor?: (setting: string) => DriftAttribution | undefined;
}

export interface MaybeCollectDriftResult {
  /** False when the check has no drift spec (not drift-tracked — an intended no-op). */
  driftTracked: boolean;
  domainKey?: string;
  /** The status this run recorded, when drift-tracked. */
  status?: DriftCollectionStatus;
  /** The specific reason, when status is not_comparable / error. */
  reason?: string;
}

/**
 * The universal drift entry point every executor path calls after it has its
 * `items` / `extracted` / `status`. It:
 *   1. looks up the check's drift spec — no spec ⇒ not drift-tracked, a clean no-op;
 *   2. asks the (pure) spec to build a stable comparable config, OR an honest
 *      reason it can't (recorded as not_comparable, no events written);
 *   3. runs collectDrift and records tracked / baseline_captured with counts.
 *
 * Self-contained and non-fatal: any failure is caught, recorded as `error`, and
 * swallowed (a monitoring scan must never fail because drift bookkeeping did).
 */
export async function maybeCollectDriftForCheck(
  params: MaybeCollectDriftParams,
): Promise<MaybeCollectDriftResult> {
  const { checkKey, tenantId, scan, attributionFor } = params;
  const spec = driftSpecForCheck(checkKey);
  if (!spec) return { driftTracked: false };

  const coverage: Record<string, unknown> = { runStatus: scan.status };
  const fo = scan.extracted?._fanOut;
  if (fo && typeof fo === "object") {
    const f = fo as Record<string, unknown>;
    coverage.sourceItemsEligible = f.sourceItemsEligible;
    coverage.sourceItemsScanned = f.sourceItemsScanned;
    coverage.sourceItemsSucceeded = f.sourceItemsSucceeded;
    coverage.truncated = f.truncated;
  }

  try {
    const outcome = spec.buildConfig(scan);
    if (!outcome.comparable) {
      await recordDriftCollectionStatus(tenantId, spec.domainKey, {
        status: "not_comparable",
        reason: outcome.reason,
        checkKey,
        coverage,
      });
      log.info(
        { tenantId, checkKey, domainKey: spec.domainKey, reason: outcome.reason },
        "drift: scan not comparable this run — recorded honest reason, no events written",
      );
      return { driftTracked: true, domainKey: spec.domainKey, status: "not_comparable", reason: outcome.reason };
    }

    const result = await collectDrift(tenantId, spec.domainKey, outcome.config, { attributionFor });
    const status: DriftCollectionStatus = result.firstRun ? "baseline_captured" : "tracked";
    await recordDriftCollectionStatus(tenantId, spec.domainKey, {
      status,
      checkKey,
      coverage,
      eventsInserted: result.inserted.length + result.reopened.length,
    });
    return { driftTracked: true, domainKey: spec.domainKey, status };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn({ err, tenantId, checkKey, domainKey: spec.domainKey }, "drift: collection failed (non-fatal)");
    try {
      await recordDriftCollectionStatus(tenantId, spec.domainKey, {
        status: "error",
        reason: message,
        checkKey,
        coverage,
      });
    } catch (statusErr) {
      log.warn({ err: statusErr, tenantId, checkKey }, "drift: could not record error status");
    }
    return { driftTracked: true, domainKey: spec.domainKey, status: "error", reason: message };
  }
}
