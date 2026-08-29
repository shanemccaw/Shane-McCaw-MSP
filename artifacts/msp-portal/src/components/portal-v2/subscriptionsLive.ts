/**
 * subscriptionsLive.ts — the Billing page's real plan state (Git #1611).
 *
 *   GET /api/portal/billing/subscriptions
 *
 * served by `artifacts/api-server/src/routes/portal-billing.ts:268-334`, scoped
 * to the calling customer's own `client_services` rows where the joined
 * service is `billingType = "recurring_monthly"`.
 *
 * ── No fixture fallback, by design ────────────────────────────────────────
 * Unlike Receipts (`billingLive.ts`), this surface has no design fixture to
 * fall back to — per the platform's fixture/real-data hard rule, a tenant
 * with no recurring subscriptions, or a failed read, renders an honest empty
 * state rather than borrowed content. The state machine is therefore a
 * strict three-state `PlanDataState`: "loading" | "live" | "error" — "live"
 * covers a genuinely empty list exactly the way billingLive.ts's "live"
 * covers a genuinely empty receipts list.
 *
 * The Monitoring-plan tier cards / add-on toggles stay entirely separate and
 * untouched (still fixture, DECIDED not-yet-wireable — #1594, blocked on
 * #1128); this hook only feeds the plan-state card that lists what the
 * tenant actually has, not the hypothetical-repricing calculator.
 */

import { useEffect, useMemo, useState } from "react";

import { useAuth } from "@/lib/auth-context";
import { toSubscriptionPlanRows, type SubscriptionPlanRow, type WireSubscription } from "./subscriptionsWire";

const SUBSCRIPTIONS_URL = "/api/portal/billing/subscriptions";

export type PlanDataState = "loading" | "live" | "error";

export interface SubscriptionsLiveState {
  readonly plans: readonly SubscriptionPlanRow[];
  readonly dataState: PlanDataState;
  readonly loading: boolean;
  readonly error: string | null;
}

/**
 * The tenant's real recurring-service subscriptions and their live Stripe
 * plan state. Genuinely no subscriptions is `dataState: "live"` with
 * `plans: []` — a distinct, honest fact from `dataState: "error"` (the read
 * itself never came back).
 */
export function useSubscriptionsLive(): SubscriptionsLiveState {
  const { fetchWithAuth } = useAuth();
  const [rows, setRows] = useState<readonly SubscriptionPlanRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetchWithAuth(SUBSCRIPTIONS_URL, undefined, { silent: true });
        if (!res.ok) throw new Error(`subscriptions ${res.status}`);
        const body = (await res.json()) as readonly WireSubscription[];
        if (cancelled) return;
        setRows(toSubscriptionPlanRows(body));
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

  return useMemo<SubscriptionsLiveState>(() => {
    const dataState: PlanDataState = loading ? "loading" : rows !== null ? "live" : "error";
    return { plans: rows ?? [], dataState, loading, error };
  }, [rows, loading, error]);
}
