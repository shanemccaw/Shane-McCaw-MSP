/**
 * pillar-drift.ts — the pillar pages' "CONFIG DRIFT BASELINE" panel (Git #4578).
 *
 * The design's panel (`Pillar Pages.dc.html` → `drift`) names a tracked drift
 * domain, a `tracked` / `not comparable` state and a note. The real backing is
 * the drift collector's three tables — `drift_baseline_snapshots`,
 * `drift_events`, `drift_collection_status` — which until now were reachable
 * only through the dashboard-metric resolver (`resolveDriftEvents`), keyed by a
 * registry metric rather than by pillar.
 *
 * ── STATUS FIRST, BASELINE SECOND ───────────────────────────────────────────
 * `resolveDriftEvents` only consults `drift_collection_status` when NO baseline
 * exists. A domain whose baseline was captured on an earlier run and whose
 * latest run was recorded `not_comparable` therefore reads as "ok, no events" —
 * a fabricated "no drift" (live example on the testbed tenant: `ca-policy`,
 * baseline 2026-09-16, status `not_comparable`, reason `gate_not_satisfied`).
 * This panel reads the collector's own latest verdict FIRST: what the collector
 * said about the most recent run is the fact; the baseline and event counts are
 * only meaningful when that run could be compared.
 *
 * ── WHICH PILLAR A DOMAIN BELONGS TO ────────────────────────────────────────
 * Not a second hand-kept table. Every drift domain is collected by exactly one
 * check (`drift_collection_status.check_key`, falling back to the spec's own
 * `checkKeyForDriftDomain`), and `buildPillarSummary` has already resolved every
 * check to a pillar (`checkKeyPillars`, rule-derived first). The domain simply
 * inherits its check's pillar, so the panel and the score can never disagree
 * about where a check lives.
 */

import { and, eq, gte, isNull } from "drizzle-orm";
import {
  db,
  driftBaselineSnapshotsTable,
  driftCollectionStatusTable,
  driftEventsTable,
} from "@workspace/db";
import { checkKeyForDriftDomain } from "./drift-check-specs.ts";

/** The panel's vocabulary: the design's two states plus the collector's own `error`. */
export type PillarDriftState = "tracked" | "not_comparable" | "error";

export interface PillarDriftDomain {
  domainKey: string;
  state: PillarDriftState;
  /** The collector's recorded reason for `not_comparable` / `error`; null otherwise. */
  reason: string | null;
  baselineCapturedAt: string | null;
  /** Real `drift_events` detected since the current baseline was captured. */
  deviationCount: number;
}

/** One `drift_collection_status` row, as far as this panel reads it. */
export interface DriftStatusInput {
  domainKey: string;
  checkKey: string | null;
  status: string;
  reason: string | null;
}

/** The tenant's current baseline for a domain, and the real events since it. */
export interface DriftBaselineInput {
  domainKey: string;
  capturedAt: Date;
  deviationCount: number;
}

/**
 * Pure: the panel state for one domain.
 *
 * `tracked` and `baseline_captured` are both "a baseline exists and is being
 * watched" (the second is simply the first run); `not_comparable` and `error`
 * keep the collector's own reason. A domain with a baseline but no status row
 * predates status recording — it is reported as tracked because a baseline that
 * exists and was never marked otherwise is exactly that, with no reason to add.
 */
export function driftStateFromStatus(status: string | null): PillarDriftState {
  if (status === "not_comparable") return "not_comparable";
  if (status === "error") return "error";
  return "tracked";
}

/**
 * Pure: fold the three real reads into the per-pillar panel entries.
 *
 * A domain that resolves to no pillar (its check is in no pillar) is dropped —
 * it has no page to appear on — and a pillar with no domain gets no entry, so
 * the panel is simply absent for it (the design's `drift: null`).
 */
export function buildPillarDrift<P extends string>(
  statuses: readonly DriftStatusInput[],
  baselines: readonly DriftBaselineInput[],
  checkKeyPillars: Readonly<Record<string, P>>,
): Map<P, PillarDriftDomain[]> {
  const baselineByDomain = new Map(baselines.map((b) => [b.domainKey, b]));
  const statusByDomain = new Map(statuses.map((s) => [s.domainKey, s]));
  const domainKeys = new Set([...statusByDomain.keys(), ...baselineByDomain.keys()]);

  const out = new Map<P, PillarDriftDomain[]>();
  for (const domainKey of [...domainKeys].sort()) {
    const status = statusByDomain.get(domainKey) ?? null;
    const baseline = baselineByDomain.get(domainKey) ?? null;
    const checkKey = status?.checkKey ?? checkKeyForDriftDomain(domainKey) ?? null;
    const pillar = checkKey ? checkKeyPillars[checkKey] : undefined;
    if (!pillar) continue;

    const state = driftStateFromStatus(status?.status ?? null);
    const entry: PillarDriftDomain = {
      domainKey,
      state,
      reason: state === "tracked" ? null : (status?.reason ?? null),
      baselineCapturedAt: baseline ? baseline.capturedAt.toISOString() : null,
      deviationCount: baseline ? baseline.deviationCount : 0,
    };
    const list = out.get(pillar) ?? [];
    list.push(entry);
    out.set(pillar, list);
  }
  return out;
}

/**
 * The tenant's real drift panel data, grouped per pillar.
 *
 * Three small reads: the collector's status rows, each domain's current
 * (non-superseded) baseline, and a count of events per domain since that
 * baseline. A tenant that has never been drift-scanned yields an empty map —
 * every pillar then renders no panel at all, never a placeholder.
 */
export async function fetchPillarDrift<P extends string>(
  tenantId: string,
  checkKeyPillars: Readonly<Record<string, P>>,
): Promise<Map<P, PillarDriftDomain[]>> {
  const [statusRows, baselineRows] = await Promise.all([
    db
      .select({
        domainKey: driftCollectionStatusTable.domainKey,
        checkKey: driftCollectionStatusTable.checkKey,
        status: driftCollectionStatusTable.status,
        reason: driftCollectionStatusTable.reason,
      })
      .from(driftCollectionStatusTable)
      .where(eq(driftCollectionStatusTable.tenantId, tenantId)),
    db
      .select({
        domainKey: driftBaselineSnapshotsTable.domainKey,
        capturedAt: driftBaselineSnapshotsTable.capturedAt,
      })
      .from(driftBaselineSnapshotsTable)
      .where(
        and(
          eq(driftBaselineSnapshotsTable.tenantId, tenantId),
          isNull(driftBaselineSnapshotsTable.supersededAt),
        ),
      ),
  ]);

  // Newest current baseline per domain (a domain should have exactly one; the
  // guard keeps a stray duplicate from double-counting).
  const latestBaseline = new Map<string, Date>();
  for (const row of baselineRows) {
    const seen = latestBaseline.get(row.domainKey);
    if (!seen || row.capturedAt > seen) latestBaseline.set(row.domainKey, row.capturedAt);
  }

  const baselines: DriftBaselineInput[] = await Promise.all(
    [...latestBaseline].map(async ([domainKey, capturedAt]) => {
      const events = await db
        .select({ id: driftEventsTable.id })
        .from(driftEventsTable)
        .where(
          and(
            eq(driftEventsTable.tenantId, tenantId),
            eq(driftEventsTable.domainKey, domainKey),
            gte(driftEventsTable.detectedAt, capturedAt),
          ),
        );
      return { domainKey, capturedAt, deviationCount: events.length };
    }),
  );

  return buildPillarDrift(statusRows, baselines, checkKeyPillars);
}
