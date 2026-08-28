/**
 * securityPlanLive.ts — the Security Plan page's real data.
 *
 *   GET /api/portal/security-plan
 *
 * served by `artifacts/api-server/src/routes/portal-security-plan.ts`, scoped to
 * the calling customer's own tenant.
 *
 * The wire shapes and the normalisation live in `securityPlanWire.ts` — pure
 * functions, no React, so they can be unit-tested directly. This file is only
 * the fetching, plus the ONE decision `securityPlanWire.ts` cannot make on its
 * own: which of four honest states the page is in.
 *
 * ── Git #1439: no more fixture-as-fallback ───────────────────────────────────
 * This hook previously fell back to the design fixture (SECURITY_PLAN /
 * SECURITY_PLAN_OWNER) on ANY non-live outcome — a failed read, or (far more
 * commonly, since the seed migration only seeds `customer_id = 1`) a real
 * customer with no plan authored yet. Shane's live testing caught exactly that
 * ("Security Plan fake data"): every other real tenant saw a fully fabricated,
 * confident-looking "Halden Materials" plan. `dataState` now has four honest
 * values instead of two:
 *   - "loading"  — first response not back yet.
 *   - "live"     — a real, usable plan for this customer.
 *   - "no-plan"  — the read succeeded; this customer genuinely has none
 *                  authored yet (case 2 — the backend is real and wired, this
 *                  tenant just isn't on it).
 *   - "error"    — the read failed, or came back malformed/unusable.
 * `plan`/`owner` are `null` for every state except "live" — there is no runtime
 * path left that renders the design fixture.
 *
 * Admin-authored, read-only by design (see the route header): this hook only
 * reads — a Security Plan is the plan of record the MSP authors FOR a tenant.
 */

import { useEffect, useMemo, useState } from "react";

import { useAuth } from "@/lib/auth-context";
import { reportClientEvent } from "@/lib/report-client-event";
import { type SecurityPlan } from "./securityPlanData";
import {
  isExplicitlyNoPlan,
  toSecurityPlan,
  type NormalisedSecurityPlan,
  type SecurityPlanOwner,
  type WireSecurityPlanPayload,
} from "./securityPlanWire";

export type { SecurityPlanOwner } from "./securityPlanWire";

const SECURITY_PLAN_URL = "/api/portal/security-plan";

/**
 * `engine.dashboard` is this app's existing channel for the portal-v2
 * pillar-dashboard family of hooks (see `useMfaRegistrationLive.ts`); there is
 * no client-side `logger.child` in this app, so the browser posts to
 * `/api/client-events` and the server binds the channel.
 */
const SECURITY_PLAN_CHANNEL = "engine.dashboard";

/** Which of the four honest states the page is currently in. */
export type SecurityPlanDataState = "loading" | "live" | "no-plan" | "error";

/**
 * A discriminated union on `dataState`, so the page can narrow `plan`/`owner`
 * to non-null with a plain `if (dataState === "live")` rather than an
 * assertion — the compiler enforces that nothing outside the "live" branch can
 * read a plan value at all, fixture or otherwise.
 */
export type SecurityPlanState =
  | {
      readonly dataState: "loading";
      readonly plan: null;
      readonly owner: null;
      readonly loading: true;
      readonly error: null;
    }
  | {
      readonly dataState: "live";
      readonly plan: SecurityPlan;
      readonly owner: SecurityPlanOwner;
      readonly loading: false;
      readonly error: null;
    }
  | {
      readonly dataState: "no-plan";
      readonly plan: null;
      readonly owner: null;
      readonly loading: false;
      readonly error: null;
    }
  | {
      readonly dataState: "error";
      readonly plan: null;
      readonly owner: null;
      readonly loading: false;
      readonly error: string;
    };

/**
 * The Security Plan, live from the endpoint. Never falls back to the design
 * fixture — a failed read or a customer with no plan authored yet resolve to
 * their own honest `dataState` instead (see the header).
 */
export function useSecurityPlan(): SecurityPlanState {
  const { fetchWithAuth, accessToken } = useAuth();
  const [normalised, setNormalised] = useState<NormalisedSecurityPlan | null>(null);
  const [status, setStatus] = useState<SecurityPlanDataState>("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetchWithAuth(SECURITY_PLAN_URL, undefined, { silent: true });
        if (!res.ok) throw new Error(`security plan ${res.status}`);
        const body = (await res.json()) as WireSecurityPlanPayload;
        if (cancelled) return;

        if (isExplicitlyNoPlan(body)) {
          setStatus("no-plan");
          setNormalised(null);
          setError(null);
          return;
        }

        const result = toSecurityPlan(body);
        if (result) {
          setNormalised(result);
          setStatus("live");
          setError(null);
        } else {
          // A non-null plan the wire could not use — malformed data, not the
          // expected "no plan yet" case. A real bug, worth knowing about.
          reportClientEvent(
            accessToken,
            "SecurityPlanMalformed",
            "GET /api/portal/security-plan returned a non-null plan toSecurityPlan could not normalise",
            SECURITY_PLAN_CHANNEL,
          );
          setNormalised(null);
          setStatus("error");
          setError("The security plan returned by the server was malformed.");
        }
      } catch (err: unknown) {
        if (cancelled) return;
        setNormalised(null);
        setStatus("error");
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchWithAuth, accessToken]);

  return useMemo<SecurityPlanState>(() => {
    if (status === "live" && normalised) {
      return {
        dataState: "live",
        plan: normalised.plan,
        owner: normalised.owner,
        loading: false,
        error: null,
      };
    }
    if (status === "error") {
      return { dataState: "error", plan: null, owner: null, loading: false, error: error ?? "Unknown error" };
    }
    if (status === "no-plan") {
      return { dataState: "no-plan", plan: null, owner: null, loading: false, error: null };
    }
    return { dataState: "loading", plan: null, owner: null, loading: true, error: null };
  }, [normalised, status, error]);
}
