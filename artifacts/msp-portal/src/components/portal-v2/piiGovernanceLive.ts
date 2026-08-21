/**
 * piiGovernanceLive.ts — the PII Governance page's real data.
 *
 *   GET /api/portal/pii-governance
 *
 * served by `artifacts/api-server/src/routes/portal-pii-governance.ts`, scoped to
 * the calling customer's own tenant.
 *
 * The wire shapes and the normalisation live in `piiGovernanceWire.ts` — pure
 * functions, no React — so this file is only the fetching, mirroring
 * `riskRegisterLive.ts`. `piiData.ts` (the design fixture) is intentionally NOT
 * used as a fallback: a read that fails or returns nothing shows an honest empty
 * state, never fictional Halden data dressed up as this tenant's.
 */

import { useEffect, useMemo, useState } from "react";

import { useAuth } from "@/lib/auth-context";
import {
  toPiiGovernanceView,
  type PiiGovernanceView,
  type WirePiiGovernance,
} from "./piiGovernanceWire";

const PII_GOVERNANCE_URL = "/api/portal/pii-governance";

/** loading → the first read is in flight; then exactly one of live/empty/error. */
export type PiiDataState = "loading" | "live" | "empty" | "error";

export interface PiiGovernanceState {
  readonly view: PiiGovernanceView | null;
  readonly dataState: PiiDataState;
  readonly error: string | null;
}

const EMPTY_VIEW: PiiGovernanceView = {
  status: "Not collected",
  scanned: null,
  cadence: "Daily",
  findings: [],
  coverage: [],
};

export function usePiiGovernance(): PiiGovernanceState {
  const { fetchWithAuth } = useAuth();
  const [view, setView] = useState<PiiGovernanceView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetchWithAuth(PII_GOVERNANCE_URL, undefined, { silent: true });
        if (!res.ok) throw new Error(`pii governance ${res.status}`);
        const body = (await res.json()) as WirePiiGovernance;
        if (cancelled) return;
        setView(toPiiGovernanceView(body ?? EMPTY_VIEW));
        setError(null);
      } catch (err: unknown) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchWithAuth]);

  return useMemo<PiiGovernanceState>(() => {
    if (loading) return { view, dataState: "loading", error: null };
    if (error) return { view, dataState: "error", error };
    const hasFindings = (view?.findings.length ?? 0) > 0;
    return { view, dataState: hasFindings ? "live" : "empty", error: null };
  }, [view, loading, error]);
}
