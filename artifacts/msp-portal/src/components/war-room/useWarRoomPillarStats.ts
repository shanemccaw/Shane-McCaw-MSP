/**
 * useWarRoomPillarStats.ts — #320 (War Room epic #302).
 *
 * Fetches the real seven-pillar card payload for the War Room's completed-scan
 * summary cards — the scores and the 28 stat callouts that used to be the
 * hardcoded `HERO_PHASE` numbers. See api-server's lib/war-room-pillar-stats.ts
 * for what each number really is.
 *
 * ── Cadence, and why it is NOT the telemetry panel's ─────────────────────────
 * `useRealTelemetryComparison` (#245/#277) recomputes every 4s through a whole
 * run, because its gauge and gap bars are meant to visibly move while checks
 * land. These cards are not: they are the COMPLETED-scan summary, and their
 * stat callouts only render once a pillar is done. Recomputing ~20 monitor
 * metrics plus the seat arithmetic every 4s would be a lot of query load in
 * service of numbers nothing is showing yet.
 *
 * So this fetches on mount, and again when a run reaches its terminal state —
 * which is also the first fetch that can see the run's own persisted findings
 * (they are written in ONE batch after the last check, per diagnostics-runner).
 * That terminal fetch is requested exactly once, so it must never be dropped:
 * the queue-not-throttle discipline #277 established after a real 137-check run
 * froze the telemetry gauge is reused here in its smaller form — an outstanding
 * request is remembered rather than discarded when one is already in flight, and
 * a failed fetch is retried with backoff instead of silently leaving the cards
 * on nothing.
 *
 * A new triggered run clears the payload (#251's pattern), so a re-scan cannot
 * leave the previous run's numbers on screen presented as this one's.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useScanStatus } from "@/lib/scan-status-context";
import type { WarRoomPillarStatsPayload } from "./warRoomPillarStats";

const PILLAR_STATS_URL = "/api/portal/assessment/war-room-pillars";

/** First retry delay after a failed fetch; doubles per consecutive failure. */
export const PILLAR_STATS_RETRY_BASE_MS = 2_000;

/**
 * Consecutive failures to retry through before giving up until something new
 * asks. 4 attempts at 2/4/8/16s covers ~30s of a struggling engine — longer than
 * the health engine takes even under the load of the scan it is measuring.
 */
export const PILLAR_STATS_MAX_RETRIES = 4;

export interface WarRoomPillarStats {
  payload: WarRoomPillarStatsPayload | null;
  /** True once a first real payload has arrived. */
  loaded: boolean;
}

export function useWarRoomPillarStats(): WarRoomPillarStats {
  const { fetchWithAuth } = useAuth();
  const { streamedRunId, triggeredRunId } = useScanStatus();
  const [payload, setPayload] = useState<WarRoomPillarStatsPayload | null>(null);

  // fetchWithAuth is re-created on every access-token refresh; read it through a
  // ref so a refresh mid-run cannot rebuild the request machinery.
  const fetchRef = useRef(fetchWithAuth);
  fetchRef.current = fetchWithAuth;

  const cancelledRef = useRef(false);
  const inFlightRef = useRef(false);
  /** An outstanding request that could not run yet. Remembered, never dropped. */
  const wantRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const failuresRef = useRef(0);
  const retryNotBeforeRef = useRef(0);

  // pump ⇄ run are mutually recursive; a ref breaks the cycle without either
  // changing identity.
  const pumpRef = useRef<() => void>(() => {});

  const run = useCallback(async () => {
    inFlightRef.current = true;
    let ok = false;
    try {
      const res = await fetchRef.current(PILLAR_STATS_URL, undefined, { silent: true });
      if (res.ok) {
        const body = (await res.json()) as WarRoomPillarStatsPayload;
        ok = true;
        if (!cancelledRef.current) setPayload(body);
      }
    } catch {
      // Network failure — treated the same as a non-OK response: the fetch did
      // not happen, so it stays owed rather than being lost.
    } finally {
      inFlightRef.current = false;
    }

    if (cancelledRef.current) return;

    if (ok) {
      failuresRef.current = 0;
      retryNotBeforeRef.current = 0;
    } else if (failuresRef.current < PILLAR_STATS_MAX_RETRIES) {
      const attempt = failuresRef.current++;
      retryNotBeforeRef.current = Date.now() + PILLAR_STATS_RETRY_BASE_MS * 2 ** attempt;
      wantRef.current = true;
    }

    pumpRef.current();
  }, []);

  const pump = useCallback(() => {
    if (cancelledRef.current || inFlightRef.current || !wantRef.current) return;

    const delay = Math.max(0, retryNotBeforeRef.current - Date.now());
    if (timerRef.current) clearTimeout(timerRef.current);
    if (delay > 0) {
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        pumpRef.current();
      }, delay);
      return;
    }

    timerRef.current = null;
    wantRef.current = false;
    void run();
  }, [run]);

  pumpRef.current = pump;

  const request = useCallback(() => {
    wantRef.current = true;
    pumpRef.current();
  }, []);

  // Mount / unmount. Deliberately `[]` on the teardown flag so an unrelated
  // auth-token refresh cannot flip it mid-flight.
  useEffect(() => {
    cancelledRef.current = false;
    request();
    return () => {
      cancelledRef.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [request]);

  // A new triggered run must not keep showing the previous run's cards. Reset the
  // retry budget with it — a new run does not inherit an exhausted one.
  const previousTriggeredRunIdRef = useRef<string | null>(null);
  useEffect(() => {
    const previous = previousTriggeredRunIdRef.current;
    previousTriggeredRunIdRef.current = triggeredRunId;
    if (triggeredRunId == null || triggeredRunId === previous) return;
    setPayload(null);
    failuresRef.current = 0;
    retryNotBeforeRef.current = 0;
  }, [triggeredRunId]);

  // The terminal fetch — the authoritative one. `streamedRunId` goes null when
  // the run's stream closes on its real complete/error event, which is exactly
  // when that run's findings have been persisted and its last check's monitor
  // profile row is in. Requested once, with a fresh retry budget.
  const previousStreamedRunIdRef = useRef<string | null>(null);
  useEffect(() => {
    const previous = previousStreamedRunIdRef.current;
    previousStreamedRunIdRef.current = streamedRunId;
    if (previous != null && streamedRunId == null) {
      failuresRef.current = 0;
      retryNotBeforeRef.current = 0;
      request();
    }
  }, [streamedRunId, request]);

  return { payload, loaded: payload != null };
}
