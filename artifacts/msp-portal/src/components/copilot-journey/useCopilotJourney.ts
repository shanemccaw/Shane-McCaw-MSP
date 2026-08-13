/**
 * useCopilotJourney.ts — the one data source behind all four Copilot Readiness
 * screens.
 *
 * Everything is real and already on the wire. Nothing here invents a number:
 *
 *   • `GET /api/portal/assessment/war-room-pillars` — per-pillar score and the
 *     tenant's actual `msp_diagnostic_findings` rows. Fetched on mount and again
 *     when a run reaches its terminal state, which is the first fetch that can
 *     see that run's findings (diagnostics-runner writes them in one batch after
 *     the last check).
 *   • `GET /api/portal/assessment/status` — the overall Copilot readiness score
 *     and the nine-document generation state. Polled while anything is still
 *     generating, then left alone.
 *   • `useScanStatus()` — the live scan, for Scene 0. `scanCheckResults` (#245,
 *     #526) also feeds `view.pillars[].chips`/`headline` directly: real
 *     severity-matched results from THIS run stream in and surface pillar-by-
 *     pillar well before the run's `msp_diagnostic_findings` batch write, so
 *     the "still scanning" placeholder is now the rare case, not the common one.
 *
 * The two-phase wait is preserved deliberately and must not be collapsed: the
 * reveal fires the instant the SCAN completes and is never gated on document
 * GENERATION, which takes minutes longer. That is why `scan` and `generation`
 * are separate fields with separate readiness flags rather than one `loading`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "@/lib/auth-context";
import { useScanStatus } from "@/lib/scan-status-context";
import { reportClientEvent } from "@/lib/report-client-event";

import {
  buildJourneyView,
  formatJourneyDate,
  type JourneyTenant,
  type JourneyView,
  type WireAssessmentStatus,
  type WirePillarStatsPayload,
} from "./journeyModel.ts";
import type { PillarKey } from "./journeyTokens.ts";

const PILLAR_STATS_URL = "/api/portal/assessment/war-room-pillars";
const STATUS_URL = "/api/portal/assessment/status";

/**
 * Poll cadence while documents are generating. Matches the assessment page's own
 * 4s — the two surfaces watch the same workflow, and a second cadence would show
 * two different "N of 9 ready" counts on adjacent screens.
 */
const GENERATION_POLL_MS = 4_000;

/**
 * The telemetry channel this subsystem beacons on. There is no client-side
 * `logger.child` in this app; the browser posts to `/api/client-events` and the
 * server binds the channel, so this string is what lands in the log stream.
 */
const JOURNEY_CHANNEL = "engine.dashboard";

export interface JourneyScanState {
  /** True while a scan is genuinely running right now. */
  readonly running: boolean;
  /** True once this tenant has any completed scan at all. */
  readonly everScanned: boolean;
  /** 0 → 1 across the whole run. 0 when the total is not yet known. */
  readonly progress: number;
  readonly checksDone: number;
  readonly checksTotal: number;
  /** The check currently streaming, for the line beneath the radar. */
  readonly currentCheckLabel: string | null;
  readonly runId: string | null;
}

export interface CopilotJourneyState {
  readonly view: JourneyView;
  readonly scan: JourneyScanState;
  /** True once a first pillar payload has arrived (success or empty). */
  readonly pillarsLoaded: boolean;
  /** True once a first status payload has arrived. */
  readonly statusLoaded: boolean;
  /** Set when a fetch failed outright, so a screen can say so rather than hang. */
  readonly error: string | null;
  readonly refresh: () => void;
}

/**
 * Projected post-remediation scores, keyed by pillar.
 *
 * These come from the SOW's own phase deltas when a scope document exists; the
 * caller passes them in. Absent, `remediatedScore()` holds each pillar at its
 * current value rather than modelling an improvement nobody has quoted.
 */
export type ProjectedByPillar = Readonly<Partial<Record<PillarKey, number>>>;

export function useCopilotJourney(options?: {
  readonly tenantName?: string | null;
  readonly seatCount?: number | null;
  readonly projectedByPillar?: ProjectedByPillar;
}): CopilotJourneyState {
  const { fetchWithAuth, accessToken } = useAuth();
  const scanStatus = useScanStatus();

  const [pillarStats, setPillarStats] = useState<WirePillarStatsPayload | null>(null);
  const [status, setStatus] = useState<WireAssessmentStatus | null>(null);
  const [pillarsLoaded, setPillarsLoaded] = useState(false);
  const [statusLoaded, setStatusLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // `fetchWithAuth` is rebuilt on every access-token refresh. Reading it through
  // a ref keeps a refresh mid-scan from tearing down the polling machinery — the
  // same discipline `useWarRoomPillarStats` uses.
  const fetchRef = useRef(fetchWithAuth);
  useEffect(() => {
    fetchRef.current = fetchWithAuth;
  }, [fetchWithAuth]);

  const tokenRef = useRef(accessToken);
  useEffect(() => {
    tokenRef.current = accessToken;
  }, [accessToken]);

  const load = useCallback(
    async (what: "pillars" | "status" | "both") => {
      const jobs: Promise<void>[] = [];

      if (what === "pillars" || what === "both") {
        jobs.push(
          (async () => {
            // `silent` because this hook renders its own unavailable state and
            // polls: fetchWithAuth's default global toast would otherwise fire
            // once every 4s for the whole time a payload is unavailable.
            const res = await fetchRef.current(PILLAR_STATS_URL, undefined, { silent: true });
            if (!res.ok) throw new Error(`pillar stats ${res.status}`);
            const body = (await res.json()) as WirePillarStatsPayload;
            setPillarStats(body && Array.isArray(body.pillars) ? body : { pillars: [] });
            setPillarsLoaded(true);
          })(),
        );
      }

      if (what === "status" || what === "both") {
        jobs.push(
          (async () => {
            const res = await fetchRef.current(STATUS_URL, undefined, { silent: true });
            if (!res.ok) throw new Error(`assessment status ${res.status}`);
            setStatus((await res.json()) as WireAssessmentStatus);
            setStatusLoaded(true);
          })(),
        );
      }

      try {
        await Promise.all(jobs);
        setError(null);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        setError(message);
        // Beacon rather than swallow: a customer staring at an empty reveal is
        // exactly the case where the log stream needs to say why.
        reportClientEvent(
          tokenRef.current,
          "CopilotJourneyFetchFailed",
          message,
          JOURNEY_CHANNEL,
          { what },
        );
        // Still mark loaded so screens fall through to their unavailable states
        // instead of spinning forever on a route that will never resolve.
        if (what !== "status") setPillarsLoaded(true);
        if (what !== "pillars") setStatusLoaded(true);
      }
    },
    [],
  );

  useEffect(() => {
    void load("both");
  }, [load]);

  // Re-read the pillars when a streamed run reaches its terminal state — the
  // first moment that run's findings exist to be read.
  const streamedRunId = scanStatus.streamedRunId;
  const previousStreamedRunId = useRef<string | null>(streamedRunId);
  useEffect(() => {
    const was = previousStreamedRunId.current;
    previousStreamedRunId.current = streamedRunId;
    if (was && !streamedRunId) void load("both");
  }, [streamedRunId, load]);

  // Poll only while something is genuinely still generating. A finished set is
  // left alone — the whole point of the "you can close this page" note is that
  // the customer is not required to sit on an open socket.
  const generating = useMemo(() => {
    const docs = status?.documents;
    if (!docs) return false;
    if (docs.allReady === true) return false;
    return (docs.generating ?? 0) > 0 || (docs.total ?? 0) === 0;
  }, [status]);

  useEffect(() => {
    if (!generating) return;
    const timer = setInterval(() => void load("status"), GENERATION_POLL_MS);
    return () => clearInterval(timer);
  }, [generating, load]);

  const tenant: JourneyTenant = useMemo(
    () => ({
      name: options?.tenantName?.trim() || "Your tenant",
      seatCount: typeof options?.seatCount === "number" ? options.seatCount : null,
      scannedOn: formatJourneyDate(scanStatus.data?.lastScanAt ?? null),
    }),
    [options?.tenantName, options?.seatCount, scanStatus.data?.lastScanAt],
  );

  // #518: whether a scan is genuinely running right now, needed by `view` (a
  // pillar below the #517 evaluable-signal floor because the run hasn't
  // finished collecting is a different fact from one that stayed thin) as well
  // as by `scan` below — one source, so the two can't disagree about it.
  const scanData = scanStatus.data;
  const scanRunning = Boolean(scanData?.active ?? null);

  const view = useMemo(
    () =>
      buildJourneyView({
        tenant,
        pillarStats,
        status,
        projectedByPillar: options?.projectedByPillar,
        isPreview: false,
        scanRunning,
        // #526: this run's own live per-check severity results, streamed off
        // the same SSE feed `scan.currentCheckLabel` below already reads —
        // real findings can now surface pillar-by-pillar while the scan is
        // still in flight, instead of only once its findings batch writes.
        liveCheckResults: scanStatus.scanCheckResults,
      }),
    [tenant, pillarStats, status, options?.projectedByPillar, scanRunning, scanStatus.scanCheckResults],
  );

  const scan: JourneyScanState = useMemo(() => {
    const active = scanData?.active ?? null;
    const progressState = scanStatus.scanCheckProgress;

    // Prefer the SSE stream's own index/total — it is per-check and arrives
    // ahead of the polled summary. Fall back to the run summary's counters,
    // which are the only thing available before the stream attaches.
    const done = progressState?.index ?? (active ? active.checksOk + active.checksError : 0);
    const total = progressState?.total ?? active?.checksTotal ?? 0;

    return {
      running: scanRunning,
      everScanned: scanData?.everScanned === true,
      progress: total > 0 ? Math.max(0, Math.min(1, done / total)) : 0,
      checksDone: done,
      checksTotal: total,
      currentCheckLabel: progressState?.checkLabel ?? null,
      runId: active?.runId ?? null,
    };
  }, [scanData, scanStatus.scanCheckProgress, scanRunning]);

  const refresh = useCallback(() => {
    void load("both");
  }, [load]);

  return { view, scan, pillarsLoaded, statusLoaded, error, refresh };
}
