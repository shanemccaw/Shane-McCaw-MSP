/**
 * riskRegisterLive.ts — the Risk Register and Policy Decisions pages' real data.
 *
 *   GET  /api/portal/risk-register
 *   GET  /api/portal/policy-decisions
 *   POST /api/portal/risk-register/:rbdId/accept
 *
 * served by `artifacts/api-server/src/routes/portal-risk-register.ts`, scoped to
 * the calling customer's own tenant.
 *
 * ── What this module is for ─────────────────────────────────────────────────
 * `riskRegisterData.ts` (RR_RISKS) and `policyDecisionsData.ts`
 * (POLICY_DECISIONS) are the DESIGN fixture — the prototype's fictional Halden
 * Materials register. They stay exactly as they are, because two other surfaces
 * still read them: the Governance and Security pillar pages' risk-accepted drop
 * panels, via `riskPanelModel.ts`. This module is the live replacement for the
 * two pages that own the register itself, and it reuses those modules' TYPES so
 * there is one shape rather than a parallel one.
 *
 * The wire shapes and the normalisation live in `riskRegisterWire.ts` — pure
 * functions, no React, so they can be tested directly. This file is only the
 * fetching.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/lib/auth-context";
import type { RiskEntry } from "./riskRegisterData";
import type { PolicyDecision } from "./policyDecisionsData";
import {
  toPolicyDecision,
  toRiskEntry,
  type WirePolicyDecision,
  type WireRisk,
} from "./riskRegisterWire";

export { NOT_RECORDED, formatLongDate } from "./riskRegisterWire";

const REGISTER_URL = "/api/portal/risk-register";
const DECISIONS_URL = "/api/portal/policy-decisions";

export interface RiskRegisterState {
  readonly risks: readonly RiskEntry[];
  /** True until the first response arrives, success or failure. */
  readonly loading: boolean;
  /** Set when the read failed, so the page can say so rather than show zero. */
  readonly error: string | null;
  /**
   * Records the acceptance. Resolves to null on success, or the reason it was
   * refused — a 409 here is the permanence guarantee doing its job, not a bug,
   * so the message is surfaced verbatim rather than retried.
   */
  readonly accept: (rbdId: string, fullName: string, statement: string) => Promise<string | null>;
  readonly accepting: boolean;
}

export function useRiskRegister(): RiskRegisterState {
  const { fetchWithAuth } = useAuth();
  const [risks, setRisks] = useState<readonly RiskEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetchWithAuth(REGISTER_URL, undefined, { silent: true });
        if (!res.ok) throw new Error(`risk register ${res.status}`);
        const body = (await res.json()) as { risks?: readonly WireRisk[] };
        if (cancelled) return;
        setRisks((body?.risks ?? []).map(toRiskEntry));
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
  }, [fetchWithAuth, reloadToken]);

  const accept = useCallback(
    async (rbdId: string, fullName: string, statement: string): Promise<string | null> => {
      setAccepting(true);
      try {
        const res = await fetchWithAuth(
          `${REGISTER_URL}/${encodeURIComponent(rbdId)}/accept`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fullName, confirmed: true, statement }),
          },
          { silent: true },
        );
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
          return body?.error?.message ?? `Could not record the acceptance (${res.status})`;
        }
        // Re-read rather than patching local state: the acceptance the register
        // shows must be the one the server stored, not the one the browser sent.
        setReloadToken((t) => t + 1);
        return null;
      } catch (err: unknown) {
        return err instanceof Error ? err.message : String(err);
      } finally {
        setAccepting(false);
      }
    },
    [fetchWithAuth],
  );

  return useMemo(
    () => ({ risks, loading, error, accept, accepting }),
    [risks, loading, error, accept, accepting],
  );
}

export interface PolicyDecisionsState {
  readonly decisions: readonly PolicyDecision[];
  readonly loading: boolean;
  readonly error: string | null;
}

export function usePolicyDecisions(): PolicyDecisionsState {
  const { fetchWithAuth } = useAuth();
  const [decisions, setDecisions] = useState<readonly PolicyDecision[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetchWithAuth(DECISIONS_URL, undefined, { silent: true });
        if (!res.ok) throw new Error(`policy decisions ${res.status}`);
        const body = (await res.json()) as { decisions?: readonly WirePolicyDecision[] };
        if (cancelled) return;
        setDecisions((body?.decisions ?? []).map(toPolicyDecision));
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

  return useMemo(() => ({ decisions, loading, error }), [decisions, loading, error]);
}
