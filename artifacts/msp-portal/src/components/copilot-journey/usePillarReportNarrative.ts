/**
 * usePillarReportNarrative.ts — the AI-written prose sections of a live-rendered
 * pillar report, fetched once when that report is genuinely open (#292).
 *
 * WHY ONE HOOK AND NOT FOUR
 * -------------------------
 * `useCopilotReadinessNarrative` (#409) and `useSecurityPostureNarrative` (#343)
 * are already the same eighty lines twice, differing only in a URL and a beacon
 * name. #292 adds four more reports on the same pattern; six copies of a fetch
 * whose whole job is "fire once, never poll, settle either way" is six places for
 * the once-only guard to rot, and that guard is what stops a token refresh
 * re-issuing three billed Anthropic calls mid-read.
 *
 * So the four reports #292 ports share this one, parameterised by the two things
 * that genuinely differ. The two existing hooks are deliberately NOT rewritten
 * onto it: they are shipped, their behaviour is asserted by their own reports'
 * suites, and a refactor of working code is not what this issue is for. If a
 * seventh report arrives, fold them in then.
 *
 * WHAT IT INHERITS UNCHANGED FROM THOSE TWO
 * -----------------------------------------
 *   • Fires ONCE, on the report opening. It never polls: the server re-derives
 *     its own grounding on every call, so re-issuing three billed calls because
 *     a poll landed would be a real cost with no new information behind it.
 *   • `fetchWithAuth` held in a ref. The portal refreshes its access token every
 *     13 minutes and a long report is read across one; depending on the function
 *     itself would re-run the effect and bill the calls again.
 *   • `settled` rather than a bare `loading` flag: a report has to tell "still
 *     writing" apart from "resolved, and this section is honestly empty", and
 *     only the first of those may show a spinner. A FAILED fetch settles too, so
 *     the report reaches its honest unavailable state rather than spinning
 *     forever on a request that will not resolve.
 *   • `silent`: each consumer renders its own per-section unavailable state, and
 *     `fetchWithAuth`'s global toast would make one failure shout in two places
 *     over a report the customer is reading.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "@/lib/auth-context";
import { reportClientEvent } from "@/lib/report-client-event";

import type { WireNarrativePayload } from "./liveReportBlocks.ts";

const JOURNEY_CHANNEL = "engine.dashboard";

export interface PillarReportNarrativeState<T extends WireNarrativePayload> {
  readonly narrative: T | null;
  /** True once the fetch has resolved or failed — never true while in flight. */
  readonly settled: boolean;
  readonly error: string | null;
  readonly retry: () => void;
}

export function usePillarReportNarrative<T extends WireNarrativePayload = WireNarrativePayload>(options: {
  /** The report's own narrative route, e.g. `/api/portal/assessment/…-narrative`. */
  readonly url: string;
  /**
   * The client-event name a failure is beaconed under. Per-report rather than
   * generic so the log stream says WHICH report's prose could not be written —
   * a customer looking at three empty sections is exactly the case where a
   * single shared event name would lose the only useful detail.
   */
  readonly failureEvent: string;
  /** Nothing is fetched until the report is genuinely on screen. */
  readonly enabled: boolean;
}): PillarReportNarrativeState<T> {
  const { url, failureEvent, enabled } = options;
  const { fetchWithAuth, accessToken } = useAuth();
  const [narrative, setNarrative] = useState<T | null>(null);
  const [settled, setSettled] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      const res = await fetchRef.current(url, undefined, { silent: true });
      if (!res.ok) throw new Error(`${failureEvent} ${res.status}`);
      setNarrative((await res.json()) as T);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      // Beacon rather than swallow: a customer looking at empty prose sections
      // is exactly the case where the log stream needs to say why.
      reportClientEvent(tokenRef.current, failureEvent, message, JOURNEY_CHANNEL);
    } finally {
      // Settled either way — the report's honest empty state is reachable only
      // once this is true, so a failure must not leave it spinning.
      setSettled(true);
    }
  }, [url, failureEvent]);

  const requested = useRef(false);
  useEffect(() => {
    if (!enabled || requested.current) return;
    requested.current = true;
    void load();
  }, [enabled, load]);

  const retry = useCallback(() => {
    requested.current = true;
    void load();
  }, [load]);

  return { narrative, settled, error, retry };
}
