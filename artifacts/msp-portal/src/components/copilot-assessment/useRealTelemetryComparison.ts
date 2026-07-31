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
 * ── The recompute cadence — STILL FLAGGED FOR SHANE (#245 asked not to guess) ─
 * The panel CAN move mid-scan for a real reason: `executeMonitorCheck` writes
 * each check's `tenant_monitor_profiles` row before the next check starts, and
 * `buildTenantProfile` reads the latest row per check key — so the health
 * engine's inputs genuinely grow as the run progresses. What is a judgement call
 * is how often to pay for that recompute. Each one runs
 * `calculateArchitectureHealthScore` (tenant profile build + signal rules +
 * security engine) plus the findings queries — roughly a dozen queries — so
 * recomputing on every check event of a 120-check package is not viable.
 *
 * The cadence, unchanged by #277 and still pending Shane's call:
 *   • at most one recompute per RECOMPUTE_MIN_INTERVAL_MS (4s) while checks are
 *     arriving — a real check takes appreciably longer than that, so the panel
 *     visibly tracks the run without a recompute per check;
 *   • a forced recompute the moment the run reaches a terminal state, which is
 *     the authoritative one (it is also the first fetch that can see the run's
 *     own persisted findings, written in one batch after its last check).
 * Alternatives to weigh: recompute every N checks instead of every N seconds, or
 * only at real milestones (25/50/75/100% of the check inventory). #277 changed
 * only what happens to a recompute the cadence asked for but could NOT perform —
 * see below — not how often one is asked for.
 *
 * ── Why this is a request QUEUE and not a bare throttle (#277) ───────────────
 * Shane, live, after 83+ real scans: the Actual Telemetry gauge sat at 23 for a
 * whole 137-check run and the gap bars with it, and the run's real final score
 * never landed. Measured against a real full-length 137-check run driven through
 * this exact hook in a real browser, the stream is NOT the problem — every check
 * arrives, `scanCheckResults` grows 1→137 monotonically, terminal detection
 * fires on time. What was broken is that this hook had two ways to DROP a
 * recompute outright, both silent and both unrecoverable:
 *
 *   1. an in-flight recompute made the next request a no-op. Harmless for a
 *      mid-run tick (another check follows), fatal for the terminal one: it is
 *      requested exactly ONCE, the instant the run goes terminal, which is
 *      milliseconds after its last check — i.e. reliably inside the window of
 *      the recompute that last check just kicked off, because that recompute
 *      takes seconds. Dropped there, it was never asked for again, and the panel
 *      kept showing a number computed partway through the run for good.
 *      Reproduced deterministically: run ends at t=55.7s with a recompute in
 *      flight → gauge frozen at 67, real final 92 never fetched, zero further
 *      requests in the following 34s.
 *
 *   2. a non-OK response was discarded with no retry (and `{ silent: true }`,
 *      so no toast and no console line either). One failing window — the health
 *      engine timing out under the load of the very scan it is measuring is the
 *      obvious real candidate — froze the panel at its last good value for the
 *      rest of the run AND past the end of it. Reproduced: recompute endpoint
 *      starts failing at check 20 → gauge stuck at 27 for the remaining 117
 *      checks and after completion, presented as a settled "Health Engine"
 *      figure with nothing on screen saying otherwise.
 *
 * So: a recompute that could not be performed is now REMEMBERED rather than
 * dropped. `want` holds the strongest outstanding reason (terminal beats live),
 * successive requests coalesce into it instead of piling up, and `pump()` is the
 * single place that decides when it may actually run — after the 4s throttle for
 * a live tick, immediately for a terminal one, after an exponential backoff for
 * a retry. A failed recompute did not happen and is re-requested; the terminal
 * recompute cannot be lost to a collision, because a collision now queues it.
 *
 * Two real things this deliberately does NOT do, so they are not mistaken for
 * fixed: it does not reconnect the run's SSE stream if that drops (observed once
 * mid-run in testing, at 135/137, with no reconnect — scan-status-context.tsx's
 * `es.onerror = () => es.close()`; it did not freeze the panel, because the
 * poll-driven terminal recompute still recovered it), and it does not tell the
 * customer on screen when the number they are looking at is one the panel could
 * not refresh — the caption still reads "Health Engine". Both belong in their
 * own change.
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

/** First retry delay after a failed recompute; doubles per consecutive failure. */
export const RECOMPUTE_RETRY_BASE_MS = 2_000;

/**
 * How many consecutive failures to keep retrying through before giving up until
 * something new asks again (the next check, the terminal event, a new run).
 * 5 attempts at 2/4/8/16/32s covers ~62s of a struggling engine, which is longer
 * than any single check takes — so a transient failure window cannot outlive the
 * retries, while a genuinely dead endpoint is not hammered forever.
 */
export const RECOMPUTE_MAX_RETRIES = 5;

/**
 * Why a recompute was asked for. `terminal` outranks `live`: it is the
 * authoritative one (the first that can see the run's own persisted findings),
 * so when both are outstanding the terminal one wins and skips the throttle.
 */
type RecomputeReason = 'initial' | 'live' | 'terminal';

const REASON_RANK: Record<RecomputeReason, number> = { initial: 0, live: 1, terminal: 2 };

function strongest(a: RecomputeReason | null, b: RecomputeReason): RecomputeReason {
  return a == null || REASON_RANK[b] > REASON_RANK[a] ? b : a;
}

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

  // fetchWithAuth is re-created whenever the access token refreshes. Read through
  // a ref so none of the recompute machinery — or the effects that drive it —
  // is rebuilt mid-run by a token refresh it has nothing to do with.
  const fetchRef = useRef(fetchWithAuth);
  fetchRef.current = fetchWithAuth;

  const cancelledRef = useRef(false);
  const inFlightRef = useRef(false);
  /** The outstanding recompute request, if any — see `strongest`. */
  const wantRef = useRef<RecomputeReason | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastFetchAtRef = useRef(0);
  /** Consecutive failures; drives the backoff and the give-up point. */
  const failuresRef = useRef(0);
  /** Epoch ms before which no retry may run. 0 = no backoff owed. */
  const retryNotBeforeRef = useRef(0);

  // pump ⇄ run are mutually recursive; a ref breaks the useCallback cycle
  // without making either of them change identity.
  const pumpRef = useRef<() => void>(() => {});

  const run = useCallback(async (reason: RecomputeReason) => {
    inFlightRef.current = true;
    lastFetchAtRef.current = Date.now();
    let ok = false;
    try {
      const res = await fetchRef.current(COMPARISON_URL, undefined, { silent: true });
      if (res.ok) {
        const body = (await res.json()) as TelemetryComparisonPayload;
        ok = true;
        if (!cancelledRef.current) setPayload(body);
      }
    } catch {
      // Network failure — same treatment as a non-OK response below: the
      // recompute did not happen, so it stays owed rather than being lost.
    } finally {
      inFlightRef.current = false;
    }

    if (cancelledRef.current) return;

    if (ok) {
      failuresRef.current = 0;
      retryNotBeforeRef.current = 0;
    } else if (failuresRef.current < RECOMPUTE_MAX_RETRIES) {
      const attempt = failuresRef.current++;
      retryNotBeforeRef.current = Date.now() + RECOMPUTE_RETRY_BASE_MS * 2 ** attempt;
      // Re-request what just failed. If something stronger queued up while this
      // was in flight (a terminal recompute), that wins.
      wantRef.current = strongest(wantRef.current, reason);
    }

    // Anything that queued up during the request now gets its turn.
    pumpRef.current();
  }, []);

  /**
   * The single place that decides whether the outstanding request may run now.
   * Terminal recomputes skip the cadence throttle; everything waits out any
   * backoff owed from a failure.
   */
  const pump = useCallback(() => {
    if (cancelledRef.current || inFlightRef.current) return;
    const reason = wantRef.current;
    if (reason == null) return;

    const now = Date.now();
    const throttleWait =
      reason === 'terminal' ? 0 : Math.max(0, RECOMPUTE_MIN_INTERVAL_MS - (now - lastFetchAtRef.current));
    const backoffWait = Math.max(0, retryNotBeforeRef.current - now);
    const delay = Math.max(throttleWait, backoffWait);

    if (timerRef.current) clearTimeout(timerRef.current);
    if (delay > 0) {
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        pumpRef.current();
      }, delay);
      return;
    }

    timerRef.current = null;
    wantRef.current = null;
    void run(reason);
  }, [run]);

  pumpRef.current = pump;

  /** Ask for a recompute. Never drops one: worst case it is deferred and coalesced. */
  const request = useCallback((reason: RecomputeReason) => {
    wantRef.current = strongest(wantRef.current, reason);
    pumpRef.current();
  }, []);

  // Mount / unmount. Deliberately `[]`: the first fetch happens once, and the
  // teardown flag is not flipped by an unrelated auth-token refresh.
  useEffect(() => {
    cancelledRef.current = false;
    request('initial');
    return () => {
      cancelledRef.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [request]);

  // Live recompute while checks arrive, throttled per the cadence note above.
  // A tick that lands while a recompute is in flight is now queued, not dropped.
  const checkCount = scanCheckResults.length;
  useEffect(() => {
    if (checkCount === 0) return;
    request('live');
  }, [checkCount, request]);

  // Clear the panel back to its real "no data yet" state the moment a NEW
  // triggered run appears (#251), reusing the same `triggeredRunId` pattern
  // #243 built in scan-status-context.tsx. Without this, `payload`'s own
  // best-effort "keep showing the last real payload" behavior above (meant
  // for transient fetch failures) had the side effect of holding the
  // PREVIOUS run's numbers on screen until this run's own recompute cadence
  // eventually overwrote them. The failure state is reset with it: a new run
  // must not inherit the previous one's exhausted retry budget.
  const previousTriggeredRunIdRef = useRef<string | null>(null);
  useEffect(() => {
    const previous = previousTriggeredRunIdRef.current;
    previousTriggeredRunIdRef.current = triggeredRunId;
    if (triggeredRunId == null || triggeredRunId === previous) return;
    setPayload(null);
    failuresRef.current = 0;
    retryNotBeforeRef.current = 0;
  }, [triggeredRunId]);

  // Terminal recompute — the authoritative one. `streamedRunId` goes null when
  // the run's stream closes on its real complete/error event (or when the poll
  // releases a run that finished before the stream attached), which is exactly
  // when this run's own findings have been persisted. Requested once, so it is
  // the one recompute that must never be dropped — see the #277 note above.
  const previousStreamedRunIdRef = useRef<string | null>(null);
  useEffect(() => {
    const previous = previousStreamedRunIdRef.current;
    previousStreamedRunIdRef.current = streamedRunId;
    if (previous != null && streamedRunId == null) {
      // A run just ended: give the terminal recompute a full retry budget of its
      // own, whatever the mid-run recomputes spent.
      failuresRef.current = 0;
      retryNotBeforeRef.current = 0;
      request('terminal');
    }
  }, [streamedRunId, request]);

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
