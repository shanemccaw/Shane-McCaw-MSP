/**
 * complianceObligationsLive.ts — the Compliance Obligations drill-down's real
 * data (Git #1223).
 *
 *   GET /api/portal/compliance-obligations
 *
 * served by `artifacts/api-server/src/routes/portal-compliance-obligations.ts`,
 * joining the tenant's real `tenant_compliance_scope` decision (Git #1256) to
 * its own open `msp_risk_decisions` findings.
 *
 * Same shape as `riskRegisterLive.ts`'s `useRiskRegister`: a plain fetch behind
 * `fetchWithAuth`, no retry/scan-status coupling, because this register does not
 * change mid-scan the way pillar scores do — it changes when a new finding lands
 * or a scope decision is edited, neither of which this page can trigger.
 */

import { useEffect, useMemo, useState } from "react";

import { useAuth } from "@/lib/auth-context";
import { CMP_OBLIGATIONS, type CmpObligation } from "./cmpDrilldownData";
import { toCmpObligation, type WireObligation } from "./complianceObligationsWire";

const OBLIGATIONS_URL = "/api/portal/compliance-obligations";

export interface ComplianceObligationsLiveState {
  /** Real rows once loaded; the design fixture until then or on error. */
  readonly obligations: readonly CmpObligation[];
  /** "live" once a real (possibly empty) catalog response has landed. */
  readonly dataState: "live" | "fixture";
  readonly loading: boolean;
}

export function useComplianceObligationsLive(): ComplianceObligationsLiveState {
  const { fetchWithAuth } = useAuth();
  const [obligations, setObligations] = useState<readonly CmpObligation[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetchWithAuth(OBLIGATIONS_URL, undefined, { silent: true });
        if (!res.ok) throw new Error(`compliance obligations ${res.status}`);
        const body = (await res.json()) as { obligations?: readonly WireObligation[] };
        if (cancelled) return;
        setObligations((body?.obligations ?? []).map(toCmpObligation));
      } catch {
        if (!cancelled) setObligations(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchWithAuth]);

  return useMemo(
    () => ({
      obligations: obligations ?? CMP_OBLIGATIONS,
      dataState: obligations !== null ? "live" : "fixture",
      loading,
    }),
    [obligations, loading],
  );
}
