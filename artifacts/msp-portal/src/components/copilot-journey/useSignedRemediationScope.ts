/**
 * useSignedRemediationScope.ts — the Remediation Tracker's real, per-tenant
 * phase list.
 *
 * THE BUG THIS FIXES
 * -------------------
 * `RemediationTrackerBody.tsx` originally grouped every tenant's tracker into
 * the same fixed 3 phases (Governance+Security / Compliance+Licensing /
 * Adoption+Health) at fixed dollar figures — the Design/Remediation
 * Tracker.dc.html prototype's own Halden Materials template, which
 * `remediation-tracker-pricing.ts` ports server-side. That is the right
 * shape for a worked example; it is not what any real tenant actually
 * signed. Shane's direction: the phases and their exact steps in the
 * tracker must match what is really in this tenant's signed engagement —
 * however many phases that is, whatever they're titled, whatever they're
 * priced.
 *
 * WHERE THE REAL ANSWER LIVES
 * ----------------------------
 * `GET /api/portal/assessment/sow` is the same endpoint the SOW Proposal and
 * Checkout screens already read (`journeyScopeFromSow.ts`, shared with both
 * for exactly the reason its own header gives: two screens mapping this
 * payload differently would disagree about what was signed). Its
 * `selectedWorkstreamTitles` is `workstreamTitlesOf(activeDoc)` server-side —
 * the ACTIVE document's own stored selection, not a live client toggle —
 * so for an already-signed engagement this is the real, frozen scope, not a
 * recommendation that could still drift with new findings.
 *
 * This hook does nothing `journeyScopeFromSow()` doesn't already do; it only
 * adds the fetch and the "which of these are actually in scope" filter
 * (`serverSelectedTitles`, when the platform states one — every phase counts
 * as in scope when it does not, rather than rendering an empty tracker over
 * a real payload this hook simply doesn't understand yet).
 *
 * PILLAR ATTRIBUTION, NOT A SECOND PHASE MODEL. Each real phase already
 * carries `pillarShown` (`journeyScopeFromSow.ts`'s own title-pattern
 * inference — `sow_pricing_lines` has no pillar column). The tracker's step
 * catalogue is pillar-tagged too (`remediationLiveGuide.ts`), so a phase's
 * task list is simply every rendered step whose pillar matches — no new
 * phase-to-step mapping invented here.
 */

import { useEffect, useRef, useState } from "react";

import { useAuth } from "@/lib/auth-context";
import { reportClientEvent } from "@/lib/report-client-event";

import { journeyScopeFromSow, type JourneySowPhase, type WireSowState } from "./journeyScopeFromSow.ts";

const SOW_URL = "/api/portal/assessment/sow";

/** Same channel the rest of the journey beacons on (see useCopilotJourney.ts). */
const JOURNEY_CHANNEL = "engine.dashboard";

export interface SignedRemediationScope {
  /** The tenant's real, signed phases — filtered to what is actually in scope. */
  readonly phases: readonly JourneySowPhase[];
  /** True once a first payload has arrived — success, failure, or genuinely no scope yet. */
  readonly loaded: boolean;
  readonly error: string | null;
}

export function useSignedRemediationScope(): SignedRemediationScope {
  const { fetchWithAuth, accessToken } = useAuth();
  const [phases, setPhases] = useState<readonly JourneySowPhase[]>([]);
  const [loaded, setLoaded] = useState(false);
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
    let cancelled = false;
    void (async () => {
      try {
        // `silent`: this screen renders its own empty/loading state, so a
        // global toast on top of it would double-report the same failure —
        // same reasoning `useRemediationTracker.ts`'s own load uses.
        const res = await fetchRef.current(SOW_URL, undefined, { silent: true });
        if (!res.ok) throw new Error(`sow ${res.status}`);
        const body = (await res.json()) as WireSowState;
        if (cancelled) return;
        const built = journeyScopeFromSow(body);
        if (!built) {
          setPhases([]);
        } else {
          const selected = built.serverSelectedTitles;
          setPhases(selected ? built.phases.filter((p) => selected.includes(p.title)) : built.phases);
        }
        setError(null);
      } catch (e) {
        if (cancelled) return;
        const message = e instanceof Error ? e.message : String(e);
        setError(message);
        reportClientEvent(tokenRef.current, "RemediationSignedScopeLoadFailed", message, JOURNEY_CHANNEL);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { phases, loaded, error };
}
