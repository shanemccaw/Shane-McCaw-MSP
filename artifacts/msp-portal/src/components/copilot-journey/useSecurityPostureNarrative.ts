/**
 * useSecurityPostureNarrative.ts — the Security Posture & Blast Radius report's
 * three AI-written sections, plus the one real metric the War Room payload does
 * not carry (#343).
 *
 * Separate from `useCopilotJourney` on purpose, exactly as
 * `useCopilotReadinessNarrative` is. That hook backs all four journey screens
 * and polls; this one makes up to three real Anthropic calls server-side, so it
 * fires ONCE, only when the Security Posture report is actually open, and never
 * polls. The report's pure-data sections do not wait on it — they render the
 * moment the pillar payload lands, and each prose section shows its own pending
 * state until this settles.
 *
 * `settled` rather than a bare `loading` flag: the report has to tell "still
 * writing" apart from "resolved, and this section is honestly empty", and only
 * the first of those may show a spinner. A failed fetch settles too — the report
 * then renders its honest unavailable state rather than spinning forever on a
 * request that will not resolve.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "@/lib/auth-context";
import { reportClientEvent } from "@/lib/report-client-event";

import type { WireSecurityPosturePayload } from "./pillarSecurityPosture.ts";

const NARRATIVE_URL = "/api/portal/assessment/security-posture-narrative";
const JOURNEY_CHANNEL = "engine.dashboard";

export interface SecurityPostureNarrativeState {
  readonly narrative: WireSecurityPosturePayload | null;
  /** True once the fetch has resolved or failed — never true while in flight. */
  readonly settled: boolean;
  readonly error: string | null;
  readonly retry: () => void;
}

export function useSecurityPostureNarrative(options: {
  /** Nothing is fetched until the report is genuinely on screen. */
  readonly enabled: boolean;
}): SecurityPostureNarrativeState {
  const { fetchWithAuth, accessToken } = useAuth();
  const [narrative, setNarrative] = useState<WireSecurityPosturePayload | null>(null);
  const [settled, setSettled] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // `fetchWithAuth` is rebuilt on every silent access-token refresh (every 13
  // minutes), and a long report is read across one. Held in a ref so `load`
  // depends on nothing that churns — the same discipline `LiveBody` and
  // `useCopilotJourney` already use. Without it a refresh would re-issue three
  // billed Anthropic calls mid-read.
  const fetchRef = useRef(fetchWithAuth);
  useEffect(() => {
    fetchRef.current = fetchWithAuth;
  }, [fetchWithAuth]);

  const tokenRef = useRef(accessToken);
  useEffect(() => {
    tokenRef.current = accessToken;
  }, [accessToken]);

  const load = useCallback(async () => {
    setSettled(false);
    setError(null);
    try {
      // `silent`: this hook's consumer renders its own per-section unavailable
      // state, and fetchWithAuth's global toast would make one failure shout in
      // two places over a report the customer is reading.
      const res = await fetchRef.current(NARRATIVE_URL, undefined, { silent: true });
      if (!res.ok) throw new Error(`security posture narrative ${res.status}`);
      setNarrative((await res.json()) as WireSecurityPosturePayload);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      // Beacon rather than swallow: a customer looking at three empty sections
      // is exactly the case where the log stream needs to say why.
      reportClientEvent(tokenRef.current, "SecurityPostureNarrativeFetchFailed", message, JOURNEY_CHANNEL);
    } finally {
      // Settled either way — the report's honest empty state is reachable only
      // once this is true, so a failure must not leave it spinning.
      setSettled(true);
    }
  }, []);

  // Fires once when the report opens. Deliberately NOT re-run when the pillar
  // payload refreshes: the server re-derives its own grounding on every call,
  // and re-issuing three billed calls because a poll landed would be a real
  // cost with no new information behind it.
  const requested = useRef(false);
  useEffect(() => {
    if (!options.enabled || requested.current) return;
    requested.current = true;
    void load();
  }, [options.enabled, load]);

  const retry = useCallback(() => {
    requested.current = true;
    void load();
  }, [load]);

  return { narrative, settled, error, retry };
}
