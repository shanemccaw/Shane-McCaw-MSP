/**
 * securityPlanLive.ts — the Security Plan page's real data.
 *
 *   GET /api/portal/security-plan
 *
 * served by `artifacts/api-server/src/routes/portal-security-plan.ts`, scoped to
 * the calling customer's own tenant.
 *
 * The wire shapes and the normalisation (which source renders, state coercion,
 * fixture fallback) live in `securityPlanWire.ts` — pure functions, no React, so
 * they can be unit-tested directly. This file is only the fetching: it reads the
 * endpoint once and hands the page a `SecurityPlan` + owner chip, falling back to
 * the design fixture (SECURITY_PLAN / SECURITY_PLAN_OWNER) on a failed read or a
 * customer with no plan authored yet. `dataState` says which of the two is on
 * screen.
 *
 * Admin-authored, read-only by design (see the route header): this hook only
 * reads — a Security Plan is the plan of record the MSP authors FOR a tenant.
 */

import { useEffect, useMemo, useState } from "react";

import { useAuth } from "@/lib/auth-context";
import { SECURITY_PLAN, SECURITY_PLAN_OWNER, type SecurityPlan } from "./securityPlanData";
import {
  toSecurityPlan,
  type NormalisedSecurityPlan,
  type SecurityPlanOwner,
  type WireSecurityPlanPayload,
} from "./securityPlanWire";

export type { SecurityPlanOwner } from "./securityPlanWire";

const SECURITY_PLAN_URL = "/api/portal/security-plan";

/** Which of the two sources the page is currently rendering. */
export type SecurityPlanDataState = "loading" | "live" | "fixture";

export interface SecurityPlanState {
  readonly plan: SecurityPlan;
  readonly owner: SecurityPlanOwner;
  readonly dataState: SecurityPlanDataState;
  /** True until the first response arrives, success or failure. */
  readonly loading: boolean;
  /** Set when the read failed, so the page could say so rather than pretend. */
  readonly error: string | null;
}

/**
 * The Security Plan, live from the endpoint, falling back to the design fixture
 * on a failed read or a customer with no plan authored yet.
 */
export function useSecurityPlan(): SecurityPlanState {
  const { fetchWithAuth } = useAuth();
  const [normalised, setNormalised] = useState<NormalisedSecurityPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetchWithAuth(SECURITY_PLAN_URL, undefined, { silent: true });
        if (!res.ok) throw new Error(`security plan ${res.status}`);
        const body = (await res.json()) as WireSecurityPlanPayload;
        if (cancelled) return;
        setNormalised(toSecurityPlan(body));
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

  return useMemo<SecurityPlanState>(() => {
    if (normalised) {
      return {
        plan: normalised.plan,
        owner: normalised.owner,
        dataState: "live",
        loading,
        error,
      };
    }
    return {
      plan: SECURITY_PLAN,
      owner: SECURITY_PLAN_OWNER,
      dataState: loading ? "loading" : "fixture",
      loading,
      error,
    };
  }, [normalised, loading, error]);
}
