/**
 * useRealTelemetryComparison.ts
 *
 * Real backing for the Copilot Assessment telemetry page's right panel (#245,
 * parent epic #183) — the Score gauges, the Multi-Dimension Radar, the Dimension
 * Gap Analysis bars and Top Discrepancies.
 *
 * Fetches GET /api/portal/assessment/telemetry-comparison (the real health
 * engine + the real `msp_diagnostic_findings` rows — see api-server's
 * lib/telemetry-comparison.ts) and RE-fetches it while a scan is running, so the
 * panel moves with the real run instead of rendering once at the end.
 *
 * All shaping lives in telemetryComparison.ts (pure, tested); this hook only
 * owns fetching, the recompute cadence, and joining in the run's live per-check
 * results from ScanStatusProvider.
 *
 * ── The recompute cadence — FLAGGED FOR SHANE (#245 asked not to guess) ───────
 * The panel CAN move mid-scan for a real reason: `executeMonitorCheck` writes
 * each check's `tenant_monitor_profiles` row before the next check starts, and
 * `buildTenantProfile` reads the latest row per check key — so the health
 * engine's inputs genuinely grow as the run progresses. What is a judgement call
 * is how often to pay for that recompute. Each one runs
 * `calculateArchitectureHealthScore` (tenant profile build + signal rules +
 * security engine) plus the findings queries — roughly a dozen queries — so
 * recomputing on every check event of a 120-check package is not viable.
 *
 * The cadence implemented here, pending Shane's call:
 *   • at most one recompute per RECOMPUTE_MIN_INTERVAL_MS (4s) while checks are
 *     arriving — a real check takes appreciably longer than that, so the panel
 *     visibly tracks the run without a recompute per check;
 *   • a forced recompute the moment the run reaches a terminal state, which is
 *     the authoritative one (it is also the first fetch that can see the run's
 *     own persisted findings, written in one batch after its last check).
 * Alternatives to weigh: recompute every N checks instead of every N seconds, or
 * only at real milestones (25/50/75/100% of the check inventory).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useScanStatus } from '@/lib/scan-status-context';
import {
  actualGaugeScore,
  selectDiscrepancies,
  toGapBars,
  toPillarViews,
  type PillarView,
  type TelemetryComparisonPayload,
  type TelemetryDiscrepancy,
} from './telemetryComparison';

const COMPARISON_URL = '/api/portal/assessment/telemetry-comparison';

/** See the cadence note in the file header — deliberately a named constant, not a literal. */
export const RECOMPUTE_MIN_INTERVAL_MS = 4_000;

export interface RealTelemetryComparison {
  /** 0–100 real overall health for the "Actual Telemetry" gauge; null = no real data yet. */
  actualScore: number | null;
  /** The real seven-pillar radar axes (pillars with no real data are absent, not zeroed). */
  pillars: PillarView[];
  /** Real gap bars — same per-pillar numbers as the radar, worst exposure first. */
  gapBars: PillarView[];
  /** Real discrepancies: this run's live failing checks while it streams, its persisted findings after. */
  discrepancies: TelemetryDiscrepancy[];
  discrepancySource: 'live' | 'persisted' | 'none';
  /** The run the discrepancies belong to — so the panel can say WHICH scan it is showing. */
  discrepancyRunId: string | null;
  /** True while a real run is streaming per-check results into this panel. */
  live: boolean;
  /** True once a first real payload has arrived (the panel can stop saying "waiting"). */
  loaded: boolean;
  /** Real engine timestamp of the payload currently rendered. */
  generatedAt: string | null;
}

export function useRealTelemetryComparison(): RealTelemetryComparison {
  const { fetchWithAuth } = useAuth();
  const { scanCheckResults, streamedRunId, triggeredRunId } = useScanStatus();
  const [payload, setPayload] = useState<TelemetryComparisonPayload | null>(null);

  const lastFetchAtRef = useRef(0);
  const inFlightRef = useRef(false);
  const cancelledRef = useRef(false);

  const load = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    lastFetchAtRef.current = Date.now();
    try {
      const res = await fetchWithAuth(COMPARISON_URL, undefined, { silent: true });
      if (!res.ok) return;
      const body = (await res.json()) as TelemetryComparisonPayload;
      if (!cancelledRef.current) setPayload(body);
    } catch {
      // Best-effort — keep showing the last real payload rather than blanking
      // the panel on a transient failure.
    } finally {
      inFlightRef.current = false;
    }
  }, [fetchWithAuth]);

  useEffect(() => {
    cancelledRef.current = false;
    void load();
    return () => {
      cancelledRef.current = true;
    };
  }, [load]);

  // Live recompute while checks arrive, throttled per the cadence note above.
  const checkCount = scanCheckResults.length;
  useEffect(() => {
    if (checkCount === 0) return;
    const sinceLast = Date.now() - lastFetchAtRef.current;
    if (sinceLast >= RECOMPUTE_MIN_INTERVAL_MS) {
      void load();
      return;
    }
    const timer = setTimeout(() => void load(), RECOMPUTE_MIN_INTERVAL_MS - sinceLast);
    return () => clearTimeout(timer);
  }, [checkCount, load]);

  // Clear the panel back to its real "no data yet" state the moment a NEW
  // triggered run appears (#251), reusing the same `triggeredRunId` pattern
  // #243 built in scan-status-context.tsx. Without this, `payload`'s own
  // best-effort "keep showing the last real payload" behavior above (meant
  // for transient fetch failures) had the side effect of holding the
  // PREVIOUS run's numbers on screen until this run's own recompute cadence
  // eventually overwrote them.
  const previousTriggeredRunIdRef = useRef<string | null>(null);
  useEffect(() => {
    const previous = previousTriggeredRunIdRef.current;
    previousTriggeredRunIdRef.current = triggeredRunId;
    if (triggeredRunId != null && triggeredRunId !== previous) setPayload(null);
  }, [triggeredRunId]);

  // Terminal recompute — the authoritative one. `streamedRunId` goes null when
  // the run's stream closes on its real complete/error event (or when the poll
  // releases a run that finished before the stream attached), which is exactly
  // when this run's own findings have been persisted.
  const previousStreamedRunIdRef = useRef<string | null>(null);
  useEffect(() => {
    const previous = previousStreamedRunIdRef.current;
    previousStreamedRunIdRef.current = streamedRunId;
    if (previous != null && streamedRunId == null) void load();
  }, [streamedRunId, load]);

  const streaming = streamedRunId != null;

  const discrepancies = useMemo(
    () => selectDiscrepancies({ payload, liveCheckResults: scanCheckResults, streaming }),
    [payload, scanCheckResults, streaming],
  );

  return {
    actualScore: actualGaugeScore(payload),
    pillars: toPillarViews(payload),
    gapBars: toGapBars(payload),
    discrepancies: discrepancies.items,
    discrepancySource: discrepancies.source,
    discrepancyRunId: discrepancies.runId,
    live: streaming,
    loaded: payload != null,
    generatedAt: payload?.generatedAt ?? null,
  };
}
