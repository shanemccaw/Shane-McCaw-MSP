/**
 * useRemediationPillarScores.ts — Git #1381.
 *
 * Loads the customer's REAL per-pillar remediation scores from
 * `GET /api/portal/remediation-tracker/pillar-scores` and hands them to the
 * tracker's derivation (remediationModel.ts) as an `RtLiveScores`. This is what
 * replaces the hardcoded `RT_PILLAR_BASE`/`RT_PILLAR_TARGET` fixture headline with
 * the rolling before/now, the permanent day-one baseline and the real Copilot
 * gate.
 *
 * Read-only and best-effort, the same discipline as `useRemediationTracker`: a
 * failed load leaves `loaded: true` with empty scores, and the derivation renders
 * the honest "not enough data yet" state rather than a fabricated number. Silent
 * fetch (this surface owns its own no-data copy — a global toast would double up).
 */

import { useEffect, useRef, useState } from "react";

import { useAuth } from "@/lib/auth-context";
import { reportClientEvent } from "@/lib/report-client-event";
import { RT_SCORES_EMPTY, type RtLiveScores } from "./remediationScores";

const SCORES_URL = "/api/portal/remediation-tracker/pillar-scores";

/** Same channel the rest of the journey beacons on. */
const JOURNEY_CHANNEL = "engine.dashboard";

export interface RemediationPillarScoresState extends RtLiveScores {
  readonly error: string | null;
}

export function useRemediationPillarScores(options?: {
  readonly enabled?: boolean;
}): RemediationPillarScoresState {
  const enabled = options?.enabled !== false;
  const { fetchWithAuth, accessToken } = useAuth();

  const [scores, setScores] = useState<RtLiveScores>(RT_SCORES_EMPTY);
  const [error, setError] = useState<string | null>(null);

  const fetchRef = useRef(fetchWithAuth);
  useEffect(() => {
    fetchRef.current = fetchWithAuth;
  }, [fetchWithAuth]);

  const tokenRef = useRef(accessToken);
  useEffect(() => {
    tokenRef.current = accessToken;
  }, [accessToken]);

  useEffect(() => {
    if (!enabled) {
      setScores((s) => ({ ...s, loaded: true }));
      return;
    }
    let cancelled = false;

    void (async () => {
      try {
        const res = await fetchRef.current(SCORES_URL, undefined, { silent: true });
        if (!res.ok) throw new Error(`remediation pillar scores ${res.status}`);
        const body = (await res.json()) as Partial<RtLiveScores>;
        if (cancelled) return;
        setScores({
          pillars: body.pillars ?? {},
          copilotGate: body.copilotGate ?? null,
          taskPoints: body.taskPoints ?? {},
          loaded: true,
        });
        setError(null);
      } catch (e) {
        if (cancelled) return;
        const message = e instanceof Error ? e.message : String(e);
        setError(message);
        // Loaded, but empty — the derivation renders the honest no-data state.
        setScores({ ...RT_SCORES_EMPTY, loaded: true });
        reportClientEvent(tokenRef.current, "RemediationPillarScoresLoadFailed", message, JOURNEY_CHANNEL);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { ...scores, error };
}
