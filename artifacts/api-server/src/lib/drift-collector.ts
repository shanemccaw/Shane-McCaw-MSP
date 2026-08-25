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
import { driftBaselineSnapshotsTable, driftEventsTable } from "@workspace/db";
import type { DriftEventVerdict, InsertDriftEvent } from "@workspace/db";
import { and, eq, isNull, desc } from "drizzle-orm";
import { detectDrift, type PccDiff } from "./pcc/drift-detector.ts";
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
    };
  });
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
    return { firstRun: true, baselineSnapshotId: id, inserted: [] };
  }

  const diffs = detectDrift(baseline.config, currentConfig);
  const planned = planDriftEvents(diffs, opts.attributionFor);

  let inserted: PlannedDriftEvent[] = [];
  if (planned.length > 0) {
    const rows: InsertDriftEvent[] = planned.map((p) => ({
      tenantId,
      domainKey,
      idempotencyKey: buildDriftIdempotencyKey(tenantId, domainKey, baseline.id, p.op, p.setting),
      setting: p.setting,
      op: p.op,
      oldValue: p.oldValue,
      newValue: p.newValue,
      changedBy: p.changedBy,
      verdict: p.verdict,
      crRef: p.crRef,
      baselineSnapshotId: baseline.id,
    }));
    const returned = await db
      .insert(driftEventsTable)
      .values(rows)
      .onConflictDoNothing({ target: driftEventsTable.idempotencyKey })
      .returning({ idempotencyKey: driftEventsTable.idempotencyKey });
    const insertedKeys = new Set(returned.map((r) => r.idempotencyKey));
    inserted = planned.filter((p) =>
      insertedKeys.has(buildDriftIdempotencyKey(tenantId, domainKey, baseline.id, p.op, p.setting)),
    );
    log.info(
      { tenantId, domainKey, detected: planned.length, inserted: inserted.length },
      "drift: persisted config-drift events",
    );
  }

  if (opts.rebaselineAfter) {
    const id = await captureBaseline(tenantId, domainKey, currentConfig, { capturedBy: opts.capturedBy });
    return { firstRun: false, baselineSnapshotId: id, inserted };
  }
  return { firstRun: false, baselineSnapshotId: baseline.id, inserted };
}
